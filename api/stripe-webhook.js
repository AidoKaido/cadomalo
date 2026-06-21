// Stripe webhook: handles checkout completion (digital delivery + Klaviyo
// purchase event) and abandoned-checkout signals (Klaviyo "Started Checkout").
//
// Events handled:
//   - checkout.session.completed         → digital delivery emails + Klaviyo purchase event
//   - checkout.session.expired           → Klaviyo "Started Checkout" event for abandoned-cart flow
//   - checkout.session.async_payment_failed → Klaviyo abandoned-cart event too
//
// Idempotency: relies on the Stripe event id; if Stripe retries, we re-send.
// (Acceptable for a small store; can switch to a dedupe table later.)

import Stripe from 'stripe'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
const RESEND_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM || 'Cadomalo <support@cadomalo.com>'
const REPLY_TO = process.env.RESEND_REPLY_TO || 'support@cadomalo.com'
const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY

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
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object)
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

async function handleCheckoutCompleted(session) {
  if (session.payment_status !== 'paid') {
    console.log(`[stripe-webhook] session ${session.id} not paid (status: ${session.payment_status}), skipping`)
    return
  }

  const email = session.customer_details?.email || session.customer_email
  const name = session.customer_details?.name || ''
  if (!email) {
    console.warn(`[stripe-webhook] session ${session.id} has no customer email, skipping`)
    return
  }

  const slugs = resolveSlugsFromSession(session)
  if (!slugs.length) {
    console.warn(`[stripe-webhook] session ${session.id} has no resolvable product slugs, skipping`)
    return
  }

  const catalog = await loadCatalog()
  let digitalCount = 0
  for (const slug of slugs) {
    const product = catalog.find((p) => p.slug === slug)
    if (!product) {
      console.warn(`[stripe-webhook] product not found for slug=${slug}`)
      continue
    }
    if (product.productType !== 'digital') continue

    digitalCount++
    const fileUrl = product.digitalFile?.url
    const fileName = product.digitalFile?.originalFilename || `${slug}.pdf`
    if (!fileUrl) {
      console.error(`[stripe-webhook] digital product ${slug} has no digitalFile.url — sending fallback`)
      await sendFallbackEmail({email, name, productTitle: product.title})
      continue
    }
    try {
      await sendDigitalDeliveryEmail({email, name, product, fileUrl, fileName, orderId: session.id})
      console.log(`[stripe-webhook] delivered ${slug} → ${email} (session ${session.id})`)
    } catch (err) {
      console.error(`[stripe-webhook] delivery failed for ${slug}:`, err.message)
    }
  }

  // Fire Klaviyo "Placed Order" event for the purchase (any product type).
  await trackKlaviyoEvent({
    eventName: 'Placed Order',
    email,
    properties: {
      $event_id: session.id,
      $value: (session.amount_total || 0) / 100,
      Currency: (session.currency || 'usd').toUpperCase(),
      Items: slugs,
      DigitalCount: digitalCount,
      OrderId: session.id,
    },
  })
}

async function handleAbandonedCheckout(session, eventType) {
  const email = session.customer_details?.email || session.customer_email
  if (!email) {
    console.log(`[stripe-webhook] abandoned ${session.id} (${eventType}) has no email, can't track`)
    return
  }
  const slugs = resolveSlugsFromSession(session)
  if (!slugs.length) return

  const catalog = await loadCatalog()
  const items = slugs
    .map((slug) => catalog.find((p) => p.slug === slug))
    .filter(Boolean)
    .map((p) => ({Slug: p.slug, Title: p.title, Price: p.price, Image: p.images?.[0]?.url || null}))

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

// Pull the list of product slugs in a session from either the new cart_summary
// metadata (multi-item) or the legacy product_slug metadata (single-item).
function resolveSlugsFromSession(session) {
  const m = session.metadata || {}
  if (m.cart_summary) {
    try {
      const arr = JSON.parse(m.cart_summary)
      if (Array.isArray(arr)) return arr.map((x) => x.slug).filter(Boolean)
    } catch (e) {
      console.warn('[stripe-webhook] failed to parse cart_summary:', e.message)
    }
  }
  if (m.product_slug) return [m.product_slug]
  return []
}

async function loadCatalog() {
  const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
  const data = JSON.parse(raw)
  return data.products || []
}

async function sendDigitalDeliveryEmail({email, name, product, fileUrl, fileName, orderId}) {
  if (!RESEND_KEY) {
    throw new Error('RESEND_API_KEY not configured')
  }
  const pdfResp = await fetch(fileUrl)
  if (!pdfResp.ok) {
    throw new Error(`Failed to fetch ${fileUrl}: ${pdfResp.status}`)
  }
  const pdfBuffer = Buffer.from(await pdfResp.arrayBuffer())
  const pdfBase64 = pdfBuffer.toString('base64')

  const firstName = (name || '').split(' ')[0] || 'there'
  const subject = `Your ${product.title} download is ready`
  const html = renderEmailHtml({firstName, product, fileUrl, orderId})

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      reply_to: REPLY_TO,
      subject,
      html,
      attachments: [{filename: fileName, content: pdfBase64}],
    }),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`Resend ${r.status}: ${text.slice(0, 300)}`)
  }
}

async function sendFallbackEmail({email, name, productTitle}) {
  if (!RESEND_KEY) return
  const firstName = (name || '').split(' ')[0] || 'there'
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email],
      reply_to: REPLY_TO,
      subject: `We're preparing your ${productTitle} download`,
      html: `<p>Hi ${escapeHtml(firstName)},</p><p>Thank you for purchasing <strong>${escapeHtml(productTitle)}</strong>. Your download is being prepared and we'll send it within a few hours. If you don't receive it, reply to this email.</p><p>— Cadomalo</p>`,
    }),
  }).catch(() => {})
}

async function trackKlaviyoEvent({eventName, email, properties}) {
  if (!KLAVIYO_KEY) {
    console.log(`[stripe-webhook] KLAVIYO_PRIVATE_KEY not set — skipping ${eventName} event`)
    return
  }
  try {
    const r = await fetch('https://a.klaviyo.com/api/events/', {
      method: 'POST',
      headers: {
        'accept': 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        'revision': '2024-10-15',
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
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

function renderEmailHtml({firstName, product, fileUrl, orderId}) {
  const title = escapeHtml(product.title)
  const shortId = orderId.slice(-12).toUpperCase()
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2a2522;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f4f1;padding:32px 12px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:560px;">
<tr><td style="padding:32px 32px 0;text-align:center;">
<div style="font-size:24px;font-weight:800;letter-spacing:-.02em;">cado<span style="color:#9c0202;">malo</span></div>
</td></tr>
<tr><td style="padding:24px 32px;">
<h1 style="font-size:22px;font-weight:800;margin:0 0 12px;color:#2a2522;">Your download is ready 🎉</h1>
<p style="font-size:15px;line-height:1.6;color:#5a514c;margin:0 0 16px;">Hi ${escapeHtml(firstName)},</p>
<p style="font-size:15px;line-height:1.6;color:#5a514c;margin:0 0 20px;">Thank you for your order! Your copy of <strong style="color:#2a2522;">${title}</strong> is attached to this email as a PDF. You can also download it again any time using the button below.</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 24px;">
<tr><td style="background:#9c0202;border-radius:10px;">
<a href="${escapeAttr(fileUrl)}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">Download your file</a>
</td></tr>
</table>
<p style="font-size:13px;line-height:1.6;color:#8a807a;margin:0 0 8px;">Order ID: <span style="font-family:monospace;color:#2a2522;">${shortId}</span></p>
<p style="font-size:13px;line-height:1.6;color:#8a807a;margin:0;">Need help? Just reply to this email and we'll get back to you.</p>
</td></tr>
<tr><td style="padding:20px 32px 32px;border-top:1px solid #efece8;text-align:center;">
<p style="font-size:12px;color:#8a807a;margin:0;">© 2026 Cadomalo · Fokebo LLC</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))
}
function escapeAttr(s) {
  return escapeHtml(s)
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
