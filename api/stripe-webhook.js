// Stripe webhook: on checkout.session.completed, look up the purchased product
// and — if it's digital — fetch its file from Sanity and email it to the buyer.
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

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({received: true, ignored: event.type})
  }

  try {
    await handleCheckoutCompleted(event.data.object)
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err)
    // Return 200 anyway so Stripe doesn't keep retrying — we've logged the failure.
    // Switch to 500 once we have proper alerting on the logs.
    return res.status(200).json({received: true, handlerError: err.message})
  }

  return res.status(200).json({received: true})
}

async function handleCheckoutCompleted(session) {
  if (session.payment_status !== 'paid') {
    console.log(`[stripe-webhook] session ${session.id} not paid (status: ${session.payment_status}), skipping`)
    return
  }

  const slug = session.metadata?.product_slug
  const email = session.customer_details?.email || session.customer_email
  const name = session.customer_details?.name || ''

  if (!slug) {
    console.warn(`[stripe-webhook] session ${session.id} has no product_slug metadata, skipping`)
    return
  }
  if (!email) {
    console.warn(`[stripe-webhook] session ${session.id} has no customer email, skipping`)
    return
  }

  const product = await loadProduct(slug)
  if (!product) {
    console.warn(`[stripe-webhook] product not found for slug=${slug}`)
    return
  }

  if (product.productType !== 'digital') {
    console.log(`[stripe-webhook] product ${slug} is not digital (${product.productType}), skipping email`)
    return
  }

  const fileUrl = product.digitalFile?.url
  const fileName = product.digitalFile?.originalFilename || `${slug}.pdf`
  if (!fileUrl) {
    console.error(`[stripe-webhook] digital product ${slug} has no digitalFile.url — cannot deliver`)
    await sendFallbackEmail({email, name, productTitle: product.title})
    return
  }

  await sendDigitalDeliveryEmail({
    email,
    name,
    product,
    fileUrl,
    fileName,
    orderId: session.id,
  })
  console.log(`[stripe-webhook] delivered ${slug} → ${email} (session ${session.id})`)
}

async function loadProduct(slug) {
  const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
  const data = JSON.parse(raw)
  return data.products.find((p) => p.slug === slug) || null
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
