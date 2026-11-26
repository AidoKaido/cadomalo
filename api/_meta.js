// Meta Conversions API (CAPI) helpers. Underscore prefix: not an endpoint
// (Vercel Hobby allows 12 functions; keep shared code in _files).
//
// Env:
//   META_CAPI_TOKEN       access token (no token → every send is skipped)
//   FB_PIXEL_ID           dataset / pixel id (falls back to the live pixel)
//   META_TEST_EVENT_CODE  optional: adds test_event_code so events show in
//                         Events Manager → Test events. Remove when done.
//
// Consent (GDPR): the browser only loads the Meta pixel after the visitor
// accepts marketing cookies. Checkout and opt-in requests carry that choice
// as tracking.consent (plus the first-party `cadomalo_mc` cookie as a
// fallback). Checkout stores it as Stripe metadata mc='1'|'0'; fbp / fbc /
// ip / ua are only stored when mc='1', and server events are only sent when
// mc='1'. Visitors who declined are never sent to Meta.
//
// Deduplication: the browser event and the server event share event_id —
// Purchase: the Stripe Checkout Session id (cs_…) or, for the one-click
// upsell, its PaymentIntent id (pi_…); Lead: a uuid made in the browser.
//
// sendCapiEvent never throws and gives up after 4 s.

import {createHash, randomUUID} from 'node:crypto'

export const GRAPH_VERSION = 'v21.0'
export const DEFAULT_PIXEL_ID = '954704759459704'
const TIMEOUT_MS = 4000
const META_MAX = 500 // Stripe metadata value limit

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const isHashed = (s) => /^[a-f0-9]{64}$/.test(s)

/* ---------- normalisation + hashing (Meta customer-information spec) ---- */
const NORMALIZE = {
  em: (v) => v.trim().toLowerCase(),
  ph: (v) => v.replace(/\D/g, '').replace(/^0+/, ''),
  fn: (v) => v.trim().toLowerCase().replace(/[\p{P}\p{S}]/gu, '').trim(),
  ln: (v) => v.trim().toLowerCase().replace(/[\p{P}\p{S}]/gu, '').trim(),
  ct: (v) => v.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''),
  st: (v) => v.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, ''),
  zp: (v) => {
    const z = v.toLowerCase().replace(/[\s-]/g, '')
    return /^\d{9}$/.test(z) ? z.slice(0, 5) : z // US ZIP+4 → 5 digits
  },
  country: (v) => v.trim().toLowerCase().slice(0, 2),
  external_id: (v) => v.trim().toLowerCase(),
}
export const HASHED_FIELDS = Object.keys(NORMALIZE)

// Normalise + SHA-256 one field. Already-hashed values pass through.
export function hashField(field, value) {
  if (value === undefined || value === null) return undefined
  const raw = String(value)
  if (!raw.trim()) return undefined
  if (isHashed(raw.trim().toLowerCase())) return raw.trim().toLowerCase()
  const norm = (NORMALIZE[field] || ((v) => v.trim().toLowerCase()))(raw)
  return norm ? sha(norm) : undefined
}

export function buildUserData(u = {}) {
  const out = {}
  for (const f of HASHED_FIELDS) {
    const h = hashField(f, u[f])
    if (h) out[f] = [h]
  }
  if (u.client_ip_address) out.client_ip_address = String(u.client_ip_address)
  if (u.client_user_agent) out.client_user_agent = String(u.client_user_agent)
  if (u.fbp) out.fbp = String(u.fbp)
  if (u.fbc) out.fbc = String(u.fbc)
  return out
}

const pixelId = () => {
  const id = String(process.env.FB_PIXEL_ID || '').trim()
  return /^\d{5,20}$/.test(id) ? id : DEFAULT_PIXEL_ID
}

/* ---------- send ----------------------------------------------------------- */
export async function sendCapiEvent(evt = {}) {
  const token = process.env.META_CAPI_TOKEN
  if (!token) return {ok: false, skipped: 'no_token'}
  try {
    if (!evt.event_name) return {ok: false, skipped: 'no_event_name'}
    const event = {
      event_name: evt.event_name,
      event_time: Math.floor(Number(evt.event_time) || Date.now() / 1000),
      event_id: String(evt.event_id || randomUUID()),
      action_source: 'website',
      ...(evt.event_source_url ? {event_source_url: String(evt.event_source_url)} : {}),
      user_data: buildUserData(evt.user_data),
      ...(evt.custom_data ? {custom_data: evt.custom_data} : {}),
    }
    const payload = {data: [event]}
    const testCode = String(process.env.META_TEST_EVENT_CODE || '').trim()
    if (testCode) payload.test_event_code = testCode

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId()}/events?access_token=${encodeURIComponent(token)}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    let r
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      // Never log the URL: it carries the access token.
      console.warn(`[meta-capi] ${event.event_name} ${event.event_id} rejected (${r.status}):`, String(data?.error?.message || '').slice(0, 300))
      return {ok: false, status: r.status}
    }
    console.log(`[meta-capi] ${event.event_name} ${event.event_id} sent (received: ${data?.events_received ?? '?'}${testCode ? ', test' : ''})`)
    return {ok: true, status: r.status, events_received: data?.events_received}
  } catch (err) {
    console.warn(`[meta-capi] ${evt.event_name || 'event'} failed:`, err?.name === 'AbortError' ? 'timeout' : err?.message)
    return {ok: false, error: err?.name === 'AbortError' ? 'timeout' : 'fetch_failed'}
  }
}

/* ---------- capturing match data at checkout ----------------------------- */
export function parseCookies(header) {
  const out = {}
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=')
    if (i < 1) return
    const k = part.slice(0, i).trim()
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      out[k] = part.slice(i + 1).trim()
    }
  })
  return out
}

const cleanFbp = (v) => (typeof v === 'string' && /^fb\.\d\.\d{10,16}\.\d+$/.test(v.trim()) ? v.trim() : '')
const cleanFbc = (v) => (typeof v === 'string' && /^fb\.\d\.\d{10,16}\.[\w-]+$/.test(v.trim()) && v.length <= META_MAX ? v.trim() : '')

export function requestIp(req) {
  const fwd = req?.headers?.['x-forwarded-for']
  const first = typeof fwd === 'string' ? fwd.split(',')[0].trim() : ''
  return (first || req?.headers?.['x-real-ip'] || req?.socket?.remoteAddress || '').toString().slice(0, 64)
}

// {mc, fbp, fbc, ip, ua} from a checkout / opt-in request. body.tracking is
// {fbp, fbc, consent} sent by js/pixels.js cadomaloTracking(); cookies are
// the fallback (GET links from emails carry no body).
export function trackingFromRequest(req, body = {}) {
  const t = body && typeof body.tracking === 'object' && body.tracking ? body.tracking : {}
  const cookies = parseCookies(req?.headers?.cookie)
  const mc = typeof t.consent === 'boolean' ? t.consent : cookies.cadomalo_mc === '1'
  if (!mc) return {mc: false}
  return {
    mc: true,
    fbp: cleanFbp(t.fbp) || cleanFbp(cookies._fbp),
    fbc: cleanFbc(t.fbc) || cleanFbc(cookies._fbc),
    ip: requestIp(req),
    ua: String(req?.headers?.['user-agent'] || '').slice(0, META_MAX),
  }
}

// Stripe metadata entries (only non-empty values; ids only with consent).
export function trackingMetadata(t = {}) {
  const out = {mc: t.mc ? '1' : '0'}
  if (!t.mc) return out
  for (const k of ['fbp', 'fbc', 'ip', 'ua']) {
    if (t[k]) out[k] = String(t[k]).slice(0, META_MAX)
  }
  return out
}

export const TRACKING_KEYS = ['mc', 'fbp', 'fbc', 'ip', 'ua']

// Copy the tracking keys from a parent session (one-click upsell, fallback).
export function copyTrackingMetadata(meta = {}) {
  const out = {}
  for (const k of TRACKING_KEYS) if (meta?.[k]) out[k] = String(meta[k]).slice(0, META_MAX)
  return out
}

// Metadata safe to return to the browser (drops ip / ua / fbp / fbc).
export function publicMetadata(meta = {}) {
  const out = {...(meta || {})}
  for (const k of ['fbp', 'fbc', 'ip', 'ua']) delete out[k]
  return out
}

/* ---------- order → pixel / CAPI custom_data ------------------------------ */
const round2 = (n) => Math.round(Number(n) * 100) / 100

// contents [{id, quantity, item_price}] from catalog products + Stripe line
// items (same order as created). Falls back to catalog prices.
export function contentsFor(products = [], lines = []) {
  if (lines.length && lines.length === products.length) {
    return products.map((p, i) => {
      const li = lines[i] || {}
      const qty = Math.max(1, Number(li.quantity) || 1)
      const cents = li.amount_subtotal ?? li.subtotal ?? li.amount ?? li.amount_total ?? Math.round((p.price || 0) * 100)
      return {id: p.id || p.slug, quantity: qty, item_price: round2(cents / qty / 100)}
    })
  }
  return products.map((p) => ({id: p.id || p.slug, quantity: 1, item_price: round2(p.price || 0)}))
}

export function purchaseData({value, currency, contents = []}) {
  return {
    value: round2(value || 0),
    currency: String(currency || 'usd').toUpperCase(),
    content_type: 'product',
    content_ids: contents.map((c) => c.id),
    contents,
    num_items: contents.reduce((a, c) => a + (c.quantity || 1), 0),
  }
}

const splitName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  return {fn: parts[0] || '', ln: parts.length > 1 ? parts[parts.length - 1] : ''}
}

// Server Purchase. Only with marketing consent (metadata.mc === '1').
export async function sendPurchaseEvent({eventId, meta = {}, email, name, phone, address = {}, value, currency, contents, sourceUrl}) {
  if (meta?.mc !== '1') return {ok: false, skipped: 'no_consent'}
  const {fn, ln} = splitName(name)
  return sendCapiEvent({
    event_name: 'Purchase',
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    event_source_url: sourceUrl,
    user_data: {
      em: email,
      ph: phone,
      fn,
      ln,
      ct: address?.city,
      st: address?.state,
      zp: address?.postal_code,
      country: address?.country,
      external_id: email,
      client_ip_address: meta.ip,
      client_user_agent: meta.ua,
      fbp: meta.fbp,
      fbc: meta.fbc,
    },
    custom_data: {...purchaseData({value, currency, contents}), order_id: eventId},
  })
}
