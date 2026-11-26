// Funnel opt-in: POST {email, consent} from /free-mini-discovery-kit (and the
// inline form on the home page).
//
// Adds the contact to the Brevo list "Mini Discovery Kit" (env
// BREVO_LIST_ROUTINE — same list id as the old routine sample) with double
// opt-in, sets MAGNET=body-mini-kit, and
// returns a signed offer token for the one-time Discovery Lab offer shown on
// /thank-you-sample?t=<token>. The token is also stored on the contact
// (OFFER_TOKEN, OFFER_EXP, FUNNEL_EXP) so the email sequence can link to it.
//
// Env: BREVO_API_KEY, BREVO_LIST_ROUTINE, BREVO_DOI_TEMPLATE_ID,
//      FUNNEL_SECRET (falls back to STRIPE_WEBHOOK_SECRET).
// One offer per email: signing up again returns the original token (so the
// 48-hour deadline is real), it never mints a fresh one.
//
// Meta CAPI: body.eventId (uuid, same as the browser Lead's eventID) and
// body.tracking {fbp, fbc, consent}. A server Lead is sent only when
// tracking.consent is true (marketing cookies accepted).

import {brevoConfigured, listId, getContact, doubleOptIn, updateContact} from './_brevo.js'
import {readJson, clientIp, makeRateLimiter, isEmail, makeOfferToken, verifyToken, requestBaseUrl} from './_util.js'
import {sendCapiEvent, trackingFromRequest} from './_meta.js'

const limited = makeRateLimiter(5, 10 * 60 * 1000)

// The current lead magnet (catalog id) and its opt-in page.
const MAGNET = 'body-mini-kit'
const OPTIN_PATH = '/free-mini-discovery-kit'

const fmtDate = (sec) =>
  new Date(sec * 1000).toLocaleString('en-US', {
    month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ok: false, error: 'Method not allowed'})
  }
  const list = listId('BREVO_LIST_ROUTINE')
  if (!brevoConfigured() || !list) {
    return res.status(503).json({ok: false, error: 'Sign-ups are opening very soon — please try again in a little while.'})
  }
  if (limited(clientIp(req))) {
    return res.status(429).json({ok: false, error: 'Too many requests — try again in a few minutes'})
  }

  const body = await readJson(req)
  if (body.website) return res.status(200).json({ok: true}) // honeypot
  const email = String(body.email || '').trim().toLowerCase()
  if (!isEmail(email)) return res.status(400).json({ok: false, error: 'Please enter a valid email address'})
  if (body.consent !== true && body.consent !== 'true' && body.consent !== 'on' && body.consent !== 1) {
    return res.status(400).json({ok: false, error: 'Please tick the box so we can email you the free kit'})
  }

  try {
    const existing = await getContact(email)
    const prev = verifyToken(existing?.attributes?.OFFER_TOKEN, 'o')
    const t = prev && prev.email === email ? existing.attributes.OFFER_TOKEN : makeOfferToken(email)
    const payload = verifyToken(t, 'o')
    const attributes = {
      OFFER_TOKEN: t,
      OFFER_EXP: fmtDate(payload.exp),
      FUNNEL_EXP: fmtDate(payload.fx || payload.exp),
      MAGNET: MAGNET,
    }
    const base = requestBaseUrl(req)
    const onList = Array.isArray(existing?.listIds) && existing.listIds.includes(list)

    let r
    if (onList) {
      r = await updateContact(email, {attributes})
    } else {
      r = await doubleOptIn({
        email,
        list,
        attributes,
        redirectionUrl: `${base}/thank-you-sample?confirmed=1&t=${encodeURIComponent(t)}`,
      })
    }
    if (!r.ok && r.status !== 204) {
      console.error('[lead] Brevo', r.status, JSON.stringify(r.data).slice(0, 300))
      return res.status(502).json({ok: false, error: 'We could not sign you up right now. Please try again shortly.'})
    }
    await sendLeadEvent(req, body, email, base)
    return res.status(200).json({ok: true, t, alreadySubscribed: onList})
  } catch (err) {
    console.error('[lead] error:', err.message)
    return res.status(502).json({ok: false, error: 'We could not sign you up right now. Please try again shortly.'})
  }
}

// Server Lead for Meta (consent only). Never throws; capped at 4 s.
async function sendLeadEvent(req, body, email, base) {
  try {
    const tr = trackingFromRequest(req, body)
    if (!tr.mc) return
    const eventId = /^[A-Za-z0-9_-]{8,64}$/.test(String(body.eventId || '')) ? String(body.eventId) : undefined
    await sendCapiEvent({
      event_name: 'Lead',
      event_id: eventId,
      event_source_url: `${base}${OPTIN_PATH}`,
      user_data: {em: email, external_id: email, client_ip_address: tr.ip, client_user_agent: tr.ua, fbp: tr.fbp, fbc: tr.fbc},
      custom_data: {content_name: MAGNET, value: 0, currency: 'USD'},
    })
  } catch (err) {
    console.warn('[lead] meta capi:', err.message)
  }
}
