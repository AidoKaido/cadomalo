/**
 * Contact form handler — receives a POST from contact.html and emails
 * the message to support@cadomalo.com via Resend.
 *
 * Env vars (already set in Vercel for the digital-delivery flow):
 *   RESEND_API_KEY
 *   RESEND_FROM        e.g. "Cadomalo <support@cadomalo.com>"
 *   CONTACT_TO         defaults to support@cadomalo.com
 *
 * Rate-limit: simple in-memory IP bucket (5 requests / 10 min / IP).
 * Vercel serverless instances are short-lived so this only mitigates burst
 * spam — fine for v1.
 */

const RESEND_KEY = process.env.RESEND_API_KEY
const FROM_EMAIL = process.env.RESEND_FROM || 'Cadomalo <support@cadomalo.com>'
const CONTACT_TO = process.env.CONTACT_TO || 'support@cadomalo.com'

const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 5
const ipHits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_MAX) return true
  hits.push(now)
  ipHits.set(ip, hits)
  return false
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length < 200
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ok: false, error: 'Method not allowed'})
  }
  if (!RESEND_KEY) {
    return res.status(503).json({ok: false, error: 'Contact form is not configured yet'})
  }

  const ip = clientIp(req)
  if (rateLimited(ip)) {
    return res.status(429).json({ok: false, error: 'Too many requests — try again in a few minutes'})
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      return res.status(400).json({ok: false, error: 'Invalid JSON body'})
    }
  }
  body = body || {}

  const {name, email, topic, orderNumber, message, website} = body

  // Honeypot — if a bot fills the hidden 'website' field, silently accept and drop.
  if (website) return res.status(200).json({ok: true})

  if (!isEmail(email)) return res.status(400).json({ok: false, error: 'Valid email required'})
  if (!message || String(message).trim().length < 10) {
    return res.status(400).json({ok: false, error: 'Message must be at least 10 characters'})
  }
  if (String(message).length > 5000) {
    return res.status(400).json({ok: false, error: 'Message is too long'})
  }

  const safeName = esc(name).slice(0, 120) || 'Anonymous'
  const safeEmail = esc(email)
  const safeTopic = esc(topic).slice(0, 80) || 'General'
  const safeOrder = esc(orderNumber).slice(0, 80)
  const safeMessage = esc(message).slice(0, 5000)

  const subject = `[Contact] ${safeTopic} — ${safeName}`
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#1A1A1A;max-width:560px;">
      <h2 style="margin:0 0 16px;font-size:18px;">New contact form submission</h2>
      <p><strong>From:</strong> ${safeName} &lt;${safeEmail}&gt;</p>
      <p><strong>Topic:</strong> ${safeTopic}</p>
      ${safeOrder ? `<p><strong>Order #:</strong> ${safeOrder}</p>` : ''}
      <p><strong>IP:</strong> ${esc(ip)}</p>
      <hr style="border:none;border-top:1px solid #E8E8E8;margin:20px 0;">
      <p style="white-space:pre-wrap;">${safeMessage}</p>
    </div>
  `

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [CONTACT_TO],
        reply_to: email,
        subject,
        html,
      }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error('[contact] Resend error', r.status, text.slice(0, 300))
      return res.status(502).json({ok: false, error: 'Could not send right now — please email us at support@cadomalo.com'})
    }
    return res.status(200).json({ok: true})
  } catch (err) {
    console.error('[contact] fetch error', err)
    return res.status(502).json({ok: false, error: 'Could not send right now — please email us at support@cadomalo.com'})
  }
}
