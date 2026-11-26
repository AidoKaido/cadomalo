// Stripe webhook: order delivery, owner notification, Brevo + Klaviyo.
//
// Events handled:
//   - checkout.session.completed / checkout.session.async_payment_succeeded
//       → owner copy to ORDER_NOTIFY_TO, branded download email (Resend),
//         buyer added to the Brevo "Customers" list, Klaviyo "Placed Order"
//   - payment_intent.succeeded with metadata.items + metadata.upsell_of
//       → same, for the one-click funnel upsell (charged off-session, so
//         there is no Checkout Session)
//   - checkout.session.expired / checkout.session.async_payment_failed
//       → Klaviyo "Started Checkout" (abandoned-cart flow)
//
// Delivery: products with files (and bundles, which expand to their books)
// get signed 7-day links to /api/download. The storybook (`canva-links`) gets
// its Canva-links PDF highlighted. Products without files fall back to the
// "we'll email your files within 24 hours" message and are fulfilled by hand.
//
// Idempotency: after delivering, the PaymentIntent gets metadata.delivered;
// a Stripe retry of the same event finds it and skips. (Sessions with no
// PaymentIntent — 100% discount — are not deduplicated.)
//
// In the Stripe Dashboard the endpoint must subscribe to:
//   checkout.session.completed, checkout.session.async_payment_succeeded,
//   checkout.session.expired, checkout.session.async_payment_failed,
//   payment_intent.succeeded
//
// Meta Conversions API: after delivery, a server Purchase is sent with
// event_id = the Checkout Session id (or the upsell PaymentIntent id) — the
// same eventID the browser pixel uses on the confirmation page, so Meta
// deduplicates them. Sent ONLY when metadata.mc === '1' (the buyer accepted
// marketing cookies before checkout); see api/_meta.js.

import {loadCatalog, FREE_IDS} from './_catalog.js'
import {getStripe, productsFromSession, productsFromPaymentIntent, buildDownloads} from './_stripe.js'
import {brevoConfigured, listId, getContact, upsertContact} from './_brevo.js'
import {escapeHtml, safeBaseUrl, defaultBaseUrl} from './_util.js'
import {layout, button, h1, p, small, C} from './_email.js'
import {sendPurchaseEvent, contentsFor} from './_meta.js'

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const RESEND_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM || 'Cadomalo <support@cadomalo.com>'
const REPLY_TO = process.env.RESEND_REPLY_TO || 'support@cadomalo.com'
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY
// Every paid order is copied here.
const ORDER_NOTIFY_TO = process.env.ORDER_NOTIFY_TO || 'support@cadomalo.com'

export const config = {
  api: {bodyParser: false}, // Stripe needs the raw body for signature verification
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).end('Method not allowed')
  }
  if (!WEBHOOK_SECRET) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured')
    return res.status(500).end('Webhook secret missing')
  }

  const stripe = getStripe()
  const rawBody = await readRawBody(req)
  const sig = req.headers['stripe-signature']
  let event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      await handleCheckoutCompleted(event.data.object)
    } else if (event.type === 'payment_intent.succeeded') {
      await handleUpsellPaymentIntent(event.data.object)
    } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      await handleAbandonedCheckout(event.data.object, event.type)
    } else {
      return res.status(200).json({received: true, ignored: event.type})
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err)
    // Return 200 anyway so Stripe doesn't keep retrying — we've logged the failure.
    return res.status(200).json({received: true, handlerError: err.message})
  }

  return res.status(200).json({received: true})
}

const idOf = (x) => (typeof x === 'string' ? x : x?.id || null)

async function handleCheckoutCompleted(session) {
  if (session.payment_status !== 'paid') {
    console.log(`[stripe-webhook] session ${session.id} not paid (status: ${session.payment_status}), skipping`)
    return
  }
  const email = session.customer_details?.email || session.customer_email
  if (!email) {
    console.warn(`[stripe-webhook] session ${session.id} has no customer email, skipping`)
    return
  }
  const catalog = await loadCatalog()
  const products = productsFromSession(catalog, session)
  if (!products.length) {
    console.warn(`[stripe-webhook] session ${session.id} has no resolvable products, skipping`)
    return
  }
  const stripe = getStripe()
  const lines = await stripe.checkout.sessions
    .listLineItems(session.id, {limit: 100})
    .then((r) => r.data.map((li) => ({description: li.description, quantity: li.quantity, amount: li.amount_total, amount_subtotal: li.amount_subtotal, currency: li.currency})))
    .catch(() => [])

  await fulfil({
    orderId: session.id,
    piId: idOf(session.payment_intent),
    email,
    name: session.customer_details?.name || '',
    phone: session.customer_details?.phone || '',
    country: session.customer_details?.address?.country || '',
    lang: session.metadata?.lang === 'fr' ? 'fr' : 'en',
    amount: session.amount_total,
    currency: session.currency,
    base: session.metadata?.site ? safeBaseUrl(session.metadata.site) : defaultBaseUrl(),
    confirmPath: `/order-confirmation?session_id=${encodeURIComponent(session.id)}`,
    catalog,
    products,
    lines,
    capi: {
      eventId: session.id,
      meta: session.metadata || {},
      email,
      name: session.customer_details?.name || '',
      phone: session.customer_details?.phone || '',
      address: session.customer_details?.address || {},
      value: (session.amount_total || 0) / 100,
      currency: session.currency,
      contents: contentsFor(products, lines),
    },
  })
}

async function handleUpsellPaymentIntent(pi) {
  // Only the off-session funnel upsell: Checkout PaymentIntents carry no
  // metadata.items and are handled by checkout.session.completed.
  if (!pi.metadata?.items || !pi.metadata?.upsell_of) return
  const stripe = getStripe()
  let email = pi.receipt_email || ''
  let name = ''
  if (!email && pi.customer) {
    const c = await stripe.customers.retrieve(idOf(pi.customer)).catch(() => null)
    email = c?.email || ''
    name = c?.name || ''
  }
  if (!email) {
    const s = await stripe.checkout.sessions.retrieve(pi.metadata.upsell_of).catch(() => null)
    email = s?.customer_details?.email || ''
    name = s?.customer_details?.name || ''
  }
  if (!email) {
    console.warn(`[stripe-webhook] upsell ${pi.id} has no email, skipping`)
    return
  }
  const catalog = await loadCatalog()
  const products = productsFromPaymentIntent(catalog, pi)
  if (!products.length) return
  // Buyer details for Meta matching come from the parent session (consent only).
  let parentDetails = {}
  if (pi.metadata?.mc === '1') {
    const s = await stripe.checkout.sessions.retrieve(pi.metadata.upsell_of).catch(() => null)
    parentDetails = s?.customer_details || {}
  }
  const amount = pi.amount_received || pi.amount
  await fulfil({
    orderId: pi.id,
    piId: pi.id,
    email,
    name,
    lang: 'en',
    amount: pi.amount_received || pi.amount,
    currency: pi.currency,
    base: pi.metadata?.site ? safeBaseUrl(pi.metadata.site) : defaultBaseUrl(),
    confirmPath: `/order-confirmation?session_id=${encodeURIComponent(pi.metadata.upsell_of)}&upsell=${encodeURIComponent(pi.id)}`,
    catalog,
    products,
    lines: products.map((p) => ({description: `${p.title} (one-click add-on)`, quantity: 1, amount: pi.amount, currency: pi.currency})),
    capi: {
      eventId: pi.id,
      meta: pi.metadata || {},
      email,
      name: name || parentDetails.name || '',
      phone: parentDetails.phone || '',
      address: parentDetails.address || {},
      value: (amount || 0) / 100,
      currency: pi.currency,
      contents: products.map((p) => ({id: p.id || p.slug, quantity: 1, item_price: Math.round((amount || 0) / products.length) / 100})),
    },
  })
}

async function fulfil(o) {
  const stripe = getStripe()

  // Idempotency: skip if this payment was already delivered.
  let pi = null
  if (o.piId) {
    pi = await stripe.paymentIntents.retrieve(o.piId).catch(() => null)
    if (pi?.metadata?.delivered) {
      console.log(`[stripe-webhook] ${o.orderId} already delivered at ${pi.metadata.delivered}, skipping`)
      return
    }
  }

  const sold = o.products.filter((p) => !FREE_IDS.has(p.id))
  const site = sold.filter((p) => p.source === 'site')
  const legacy = sold.filter((p) => p.source !== 'site')
  const {downloads, missing} = buildDownloads(o.catalog, site, {sid: o.orderId, baseUrl: o.base})
  const manualTitles = missing.map((p) => p.title)

  // Owner copy first — it is the only record hand-fulfilled products get.
  try {
    await sendOrderNotification({...o, downloads, manualTitles})
  } catch (err) {
    console.error(`[stripe-webhook] order notification failed for ${o.orderId}:`, err.message)
  }

  let delivered = false
  if (downloads.length) {
    try {
      const canva = site.some((p) => p.fulfillment === 'canva-links')
      await sendDownloadsEmail({...o, downloads, canva})
      delivered = true
      console.log(`[stripe-webhook] ${downloads.length} download link(s) → ${o.email} (${o.orderId})`)
    } catch (err) {
      console.error(`[stripe-webhook] download email failed for ${o.orderId}:`, err.message)
    }
  }

  // Legacy Sanity digital products (data/products.json) keep their old flow.
  for (const product of legacy) {
    if (product.fulfillment === 'manual' || product.productType !== 'digital') {
      manualTitles.push(product.title)
      continue
    }
    const fileUrl = product.digitalFile?.url
    if (!fileUrl) {
      manualTitles.push(product.title)
      continue
    }
    try {
      await sendLegacyDigitalEmail({email: o.email, name: o.name, product, fileUrl, fileName: product.digitalFile?.originalFilename || `${product.slug}.pdf`, orderId: o.orderId})
      delivered = true
    } catch (err) {
      console.error(`[stripe-webhook] legacy delivery failed for ${product.slug}:`, err.message)
      manualTitles.push(product.title)
    }
  }

  if (manualTitles.length) {
    try {
      await sendOrderReceivedEmail({...o, titles: manualTitles})
      delivered = true
    } catch (err) {
      console.error(`[stripe-webhook] order-received email failed for ${o.orderId}:`, err.message)
    }
  }

  await addToBrevoCustomers(o.email, o.name, sold.map((p) => p.id || p.slug))

  await trackKlaviyoEvent({
    eventName: 'Placed Order',
    email: o.email,
    properties: {
      $event_id: o.orderId,
      $value: (o.amount || 0) / 100,
      Currency: String(o.currency || 'usd').toUpperCase(),
      Items: sold.map((p) => p.id || p.slug),
      DownloadCount: downloads.length,
      OrderId: o.orderId,
    },
  })

  if (pi && delivered) {
    await stripe.paymentIntents
      .update(pi.id, {metadata: {delivered: new Date().toISOString()}})
      .catch((err) => console.error('[stripe-webhook] could not mark delivered:', err.message))
  }

  // Meta CAPI Purchase — last, so it can never delay or break delivery.
  if (o.capi) {
    try {
      await sendPurchaseEvent({...o.capi, sourceUrl: `${o.base}/order-confirmation`})
    } catch (err) {
      console.warn('[stripe-webhook] meta capi:', err.message)
    }
  }
}

async function addToBrevoCustomers(email, name, ids) {
  const list = listId('BREVO_LIST_CUSTOMERS')
  if (!brevoConfigured() || !list) return
  try {
    const existing = await getContact(email)
    const prev = String(existing?.attributes?.PURCHASED || '').split(',').filter(Boolean)
    const merged = [...new Set([...prev, ...ids.filter(Boolean)])].join(',')
    const attributes = {PURCHASED: merged}
    const first = (name || '').split(' ')[0]
    if (first && !existing?.attributes?.FIRSTNAME) attributes.FIRSTNAME = first
    const r = await upsertContact({email, attributes, listIds: [list]})
    if (!r.ok && r.status !== 204) console.error('[stripe-webhook] Brevo customer', r.status, JSON.stringify(r.data).slice(0, 300))
  } catch (err) {
    console.error('[stripe-webhook] Brevo customer error:', err.message)
  }
}

async function handleAbandonedCheckout(session, eventType) {
  const email = session.customer_details?.email || session.customer_email
  if (!email) {
    console.log(`[stripe-webhook] abandoned ${session.id} (${eventType}) has no email, can't track`)
    return
  }
  const catalog = await loadCatalog()
  const items = productsFromSession(catalog, session).map((p) => ({
    Slug: p.slug,
    Title: p.title,
    Price: p.price,
    Image: p.images?.[0]?.url || null,
  }))
  if (!items.length) return

  await trackKlaviyoEvent({
    eventName: 'Started Checkout',
    email,
    properties: {
      $event_id: session.id,
      $value: (session.amount_total || session.amount_subtotal || 0) / 100,
      Currency: (session.currency || 'usd').toUpperCase(),
      CheckoutUrl: session.url || null,
      Items: items,
      ItemCount: items.length,
      Reason: eventType,
    },
  })
  console.log(`[stripe-webhook] abandoned-checkout tracked: ${email} (${session.id}, ${eventType})`)
}

/* ---------- email ---------------------------------------------------------- */

async function sendEmail(payload) {
  if (!RESEND_KEY) throw new Error('RESEND_API_KEY not configured')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: FROM_EMAIL, ...payload}),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Resend ${r.status}: ${text.slice(0, 300)}`)
  }
}

const money = (cents, currency) => `${((cents || 0) / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`
const shortId = (id) => String(id).slice(-12).toUpperCase()
const firstNameOf = (name) => (name || '').split(' ')[0] || ''

async function sendOrderNotification(o) {
  const rows = (o.lines || [])
    .map((li) => `<tr><td style="padding:6px 12px 6px 0;">${escapeHtml(li.description || '(item)')}</td>` +
      `<td style="padding:6px 12px;">× ${li.quantity || 1}</td>` +
      `<td style="padding:6px 0;text-align:right;">${money(li.amount, li.currency)}</td></tr>`)
    .join('')
  const auto = o.downloads.length
    ? `<p style="margin:0 0 12px;">Download links were emailed automatically (${o.downloads.length} file${o.downloads.length > 1 ? 's' : ''}).</p>`
    : ''
  const manual = o.manualTitles.length
    ? `<p style="margin:0 0 12px;color:#b4442c;"><strong>Send by hand:</strong> ${o.manualTitles.map(escapeHtml).join(', ')}</p>`
    : ''
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#29333A;font-size:15px;line-height:1.6;">
<h2 style="margin:0 0 12px;">New order${o.manualTitles.length ? ' — send the files' : ''}</h2>
<p style="margin:0 0 12px;"><strong>${escapeHtml(o.name || '(no name)')}</strong><br>
<a href="mailto:${escapeHtml(o.email)}">${escapeHtml(o.email)}</a>${o.phone ? '<br>' + escapeHtml(o.phone) : ''}${o.country ? '<br>' + escapeHtml(o.country) : ''}<br>
Language: ${o.lang === 'fr' ? 'French' : 'English'}</p>
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 12px;">${rows}
<tr><td colspan="3" style="padding:8px 0 0;border-top:1px solid #ddd;text-align:right;"><strong>Paid: ${money(o.amount, o.currency)}</strong></td></tr></table>
${auto}${manual}
<p style="margin:0;color:#6B7680;font-size:13px;">Order ID ${shortId(o.orderId)} · Stripe ${escapeHtml(o.orderId)}<br>
Reply to this email to answer the customer directly.</p></div>`
  await sendEmail({
    to: [ORDER_NOTIFY_TO],
    reply_to: o.email,
    subject: `New order ${shortId(o.orderId)} — ${o.name || o.email} — ${money(o.amount, o.currency)}`,
    html,
  })
}

async function sendDownloadsEmail(o) {
  const fr = o.lang === 'fr'
  const first = firstNameOf(o.name)
  const confirmUrl = o.base + o.confirmPath
  const list = o.downloads
    .map((d) => `<tr><td style="padding:8px 0;border-bottom:1px solid #F1E6D6;font-family:'Nunito Sans',Arial,sans-serif;font-size:15px;color:${C.ink};">
<a href="${escapeHtml(d.url)}" style="color:${C.navy};font-weight:700;text-decoration:underline;">${escapeHtml(d.label)}</a></td></tr>`)
    .join('')
  const canvaLink = o.canva ? o.downloads.find((d) => /canva/i.test(d.label)) || o.downloads.find((d) => d.product === 'birthday-wish') : null
  const canvaBlock = canvaLink
    ? `<div style="background:${C.cream};border-radius:14px;padding:16px 18px;margin:0 0 18px;">
${p(fr ? '<strong>Votre livre personnalisé :</strong> ouvrez le PDF « liens Canva », cliquez sur le lien du modèle, puis « Utiliser le modèle » pour ajouter le prénom et la photo de votre enfant. Un compte Canva gratuit suffit.'
        : '<strong>Your personalised storybook:</strong> open the Canva-links PDF, click the template link, then “Use template” to add your child’s name and photo. A free Canva account is all you need.', 'margin:0 0 8px;')}
<a href="${escapeHtml(canvaLink.url)}" style="color:${C.coral};font-weight:800;font-family:'Nunito Sans',Arial,sans-serif;">${fr ? 'Ouvrir les liens Canva' : 'Open the Canva links PDF'} →</a></div>`
    : ''
  const body = `${h1(fr ? 'Vos fichiers sont prêts' : 'Your PDFs are ready')}
${p(fr ? `Bonjour${first ? ' ' + escapeHtml(first) : ''},` : `Hi${first ? ' ' + escapeHtml(first) : ''},`)}
${p(fr ? 'Merci pour votre commande ! Tout est prêt à télécharger et à imprimer à la maison.' : 'Thank you for your order! Everything is ready to download and print at home.')}
${button(confirmUrl, fr ? 'Télécharger vos PDF' : 'Download your PDFs')}
${canvaBlock}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">${list}</table>
${small(fr ? 'Les liens restent valables 7 jours. Enregistrez les fichiers sur votre appareil : vous pourrez les imprimer autant de fois que vous voulez pour votre famille.'
          : 'Links work for 7 days — save the files to your device and print them as often as you like for your family.')}
${small(fr ? 'Astuce : imprimez en « taille réelle » (100 %) sur du papier US Letter ou A4.' : 'Tip: print at “actual size” (100%) on US Letter or A4 paper.')}
${small(`${fr ? 'Commande' : 'Order'}: <span style="font-family:monospace;">${shortId(o.orderId)}</span>`)}`
  await sendEmail({
    to: [o.email],
    reply_to: REPLY_TO,
    subject: fr ? 'Vos PDF Cadomalo sont prêts à télécharger' : 'Your Cadomalo PDFs are ready to download',
    html: layout({preheader: fr ? 'Vos fichiers sont prêts.' : 'Your files are ready — print them tonight.', body, siteUrl: o.base, lang: o.lang}),
  })
}

async function sendOrderReceivedEmail(o) {
  const fr = o.lang === 'fr'
  const first = firstNameOf(o.name)
  const titles = o.titles.map((t) => `<li>${escapeHtml(t)}</li>`).join('')
  const body = `${h1(fr ? 'Merci pour votre commande' : 'Thank you for your order')}
${p(fr ? `Bonjour${first ? ' ' + escapeHtml(first) : ''},` : `Hi${first ? ' ' + escapeHtml(first) : ''},`)}
${p(fr ? 'Nous préparons ces fichiers et vous les enverrons par e-mail depuis support@cadomalo.com dans les 24 heures :'
        : "We're preparing these files and will email them to you from support@cadomalo.com within 24 hours:")}
<ul style="margin:0 0 14px;padding-left:20px;font-family:'Nunito Sans',Arial,sans-serif;color:${C.ink};">${titles}</ul>
${small(`${fr ? 'Commande' : 'Order'}: <span style="font-family:monospace;">${shortId(o.orderId)}</span>`)}`
  await sendEmail({
    to: [o.email],
    reply_to: REPLY_TO,
    subject: fr ? 'Merci pour votre commande Cadomalo' : 'Thank you for your Cadomalo order',
    html: layout({preheader: fr ? 'Vos fichiers arrivent sous 24 h.' : 'Your files are on their way within 24 hours.', body, siteUrl: o.base, lang: o.lang}),
  })
}

// Legacy Sanity digital products: PDF attached + link (unchanged behaviour).
async function sendLegacyDigitalEmail({email, name, product, fileUrl, fileName, orderId}) {
  const pdfResp = await fetch(fileUrl)
  if (!pdfResp.ok) throw new Error(`Failed to fetch ${fileUrl}: ${pdfResp.status}`)
  const pdfBase64 = Buffer.from(await pdfResp.arrayBuffer()).toString('base64')
  const first = firstNameOf(name)
  const body = `${h1('Your download is ready')}
${p(`Hi${first ? ' ' + escapeHtml(first) : ''},`)}
${p(`Thank you for your order! Your copy of <strong>${escapeHtml(product.title)}</strong> is attached as a PDF. You can also download it again with the button below.`)}
${button(fileUrl, 'Download your PDF')}
${small(`Order: <span style="font-family:monospace;">${shortId(orderId)}</span>`)}`
  await sendEmail({
    to: [email],
    reply_to: REPLY_TO,
    subject: `Your ${product.title} download is ready`,
    html: layout({preheader: 'Your download is ready.', body}),
    attachments: [{filename: fileName, content: pdfBase64}],
  })
}

async function trackKlaviyoEvent({eventName, email, properties}) {
  if (!KLAVIYO_KEY) return
  try {
    const r = await fetch('https://a.klaviyo.com/api/events/', {
      method: 'POST',
      headers: {
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        revision: '2024-10-15',
        Authorization: `Klaviyo-API-Key ${KLAVIYO_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: 'event',
          attributes: {
            properties,
            metric: {data: {type: 'metric', attributes: {name: eventName}}},
            profile: {data: {type: 'profile', attributes: {email}}},
          },
        },
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error(`[stripe-webhook] Klaviyo ${eventName} ${r.status}: ${text.slice(0, 300)}`)
    }
  } catch (err) {
    console.error(`[stripe-webhook] Klaviyo ${eventName} fetch error:`, err.message)
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
