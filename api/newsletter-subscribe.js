/**
 * Newsletter signup.
 *
 * Primary: Brevo, list BREVO_LIST_NEWSLETTER, with double opt-in
 *          (BREVO_API_KEY, BREVO_LIST_NEWSLETTER, BREVO_DOI_TEMPLATE_ID).
 * Fallback: the Resend Audience (RESEND_API_KEY, RESEND_AUDIENCE_ID) while
 *          Brevo is not configured.
 *
 * Idempotent: an existing subscriber gets {ok:true}.
 */

import {brevoConfigured, listId, getContact, doubleOptIn} from './_brevo.js'
import {readJson, clientIp, makeRateLimiter, isEmail, requestBaseUrl} from './_util.js'

const RESEND_KEY = process.env.RESEND_API_KEY
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID
const limited = makeRateLimiter(5, 10 * 60 * 1000)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (limited(clientIp(req))) {
    return res.status(429).json({error: 'Too many requests — try again in a few minutes'})
  }

  const body = await readJson(req)
  if (body?.website) return res.status(200).json({ok: true}) // honeypot
  const email = (body?.email || '').toString().trim().toLowerCase()
  if (!isEmail(email)) {
    return res.status(400).json({error: 'Please enter a valid email address'})
  }

  const list = listId('BREVO_LIST_NEWSLETTER')
  if (brevoConfigured() && list) {
    try {
      const existing = await getContact(email)
      if (Array.isArray(existing?.listIds) && existing.listIds.includes(list)) {
        return res.status(200).json({ok: true, alreadySubscribed: true})
      }
      const r = await doubleOptIn({
        email,
        list,
        attributes: {},
        redirectionUrl: `${requestBaseUrl(req)}/?subscribed=1`,
      })
      if (r.ok || r.status === 204) return res.status(200).json({ok: true, confirm: true})
      console.error('[newsletter-subscribe] Brevo', r.status, JSON.stringify(r.data).slice(0, 300))
    } catch (err) {
      console.error('[newsletter-subscribe] Brevo error:', err.message)
    }
    // fall through to Resend if it is configured
  }

  if (!RESEND_KEY || !AUDIENCE_ID) {
    return res.status(503).json({error: 'Newsletter signup is not available right now. Please try again later.'})
  }
  try {
    const r = await fetch(`https://api.resend.com/audiences/${AUDIENCE_ID}/contacts`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({email, unsubscribed: false}),
    })
    // 422 usually means already subscribed — treat as success.
    if (r.ok || r.status === 422) return res.status(200).json({ok: true})
    const text = await r.text().catch(() => '')
    console.error('[newsletter-subscribe] Resend non-2xx:', r.status, text.slice(0, 400))
    return res.status(502).json({error: 'Newsletter signup is temporarily unavailable. Please try again later.'})
  } catch (err) {
    console.error('[newsletter-subscribe] fetch error:', err.message)
    return res.status(502).json({error: 'Could not reach newsletter service. Please try again later.'})
  }
}
