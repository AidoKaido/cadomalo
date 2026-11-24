// Small helpers shared by the API functions (underscore: not an endpoint).

import {createHmac, timingSafeEqual, createHash} from 'node:crypto'

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body || '{}')
    } catch {
      return {}
    }
  }
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

export function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for']
  if (typeof fwd === 'string') return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

// In-memory per-instance bucket, like api/contact.js: only mitigates bursts.
export function makeRateLimiter(max, windowMs) {
  const hits = new Map()
  return function limited(key) {
    const now = Date.now()
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs)
    if (list.length >= max) return true
    list.push(now)
    hits.set(key, list)
    if (hits.size > 5000) hits.clear()
    return false
  }
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')

/* ---------- signed tokens ------------------------------------------------
   <base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "v1." + body))>
   `typ` separates offer tokens ('o') from download tokens ('d') so one can
   never be replayed as the other. */
const b64u = (buf) => Buffer.from(buf).toString('base64url')

function tokenSecret() {
  const s = process.env.FUNNEL_SECRET || process.env.STRIPE_WEBHOOK_SECRET
  if (!s) throw new Error('FUNNEL_SECRET (or STRIPE_WEBHOOK_SECRET) is not set')
  return s
}

export function signToken(payload) {
  const body = b64u(JSON.stringify(payload))
  const sig = b64u(createHmac('sha256', tokenSecret()).update('v1.' + body).digest())
  return `${body}.${sig}`
}

// Returns the payload when the signature is valid (expiry is NOT checked
// here, callers decide what an expired token means), otherwise null.
export function verifyToken(token, typ) {
  if (typeof token !== 'string' || token.length > 2000) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  let expected
  try {
    expected = createHmac('sha256', tokenSecret()).update('v1.' + body).digest()
  } catch {
    return null
  }
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typ && payload.typ !== typ) return null
    return payload
  } catch {
    return null
  }
}

/* ---------- funnel offer token -------------------------------------------
   exp: the headline one-time offer (Discovery Lab) — 48 h.
   fx:  the wider funnel window for the other funnel-priced products offered
        in emails 4–7 (single books, collections) — 14 days. */
export const OFFER_HOURS = 48
export const FUNNEL_WINDOW_DAYS = 14

export function makeOfferToken(email, now = Date.now()) {
  const iat = Math.floor(now / 1000)
  return signToken({
    typ: 'o',
    email: String(email).toLowerCase(),
    offer: 'discovery-lab',
    iat,
    exp: iat + OFFER_HOURS * 3600,
    fx: iat + FUNNEL_WINDOW_DAYS * 86400,
  })
}

// Is the funnel price for `productId` unlocked by this (verified) payload?
export function offerUnlocks(payload, productId, now = Date.now()) {
  if (!payload) return false
  const t = Math.floor(now / 1000)
  if (productId === payload.offer) return t < payload.exp
  return t < (payload.fx || payload.exp)
}

/* ---------- download tokens ----------------------------------------------- */
export const DOWNLOAD_DAYS = 7

export function makeDownloadToken({key, sid, name}, now = Date.now()) {
  return signToken({typ: 'd', k: key, sid: sid || '', n: name || '', exp: Math.floor(now / 1000) + DOWNLOAD_DAYS * 86400})
}

/* ---------- URLs ------------------------------------------------------------ */
const ALLOWED_HOST = /(^|\.)cadomalo\.com$|\.vercel\.app$|^localhost(:\d+)?$/

// Base URL for redirects coming back to the site from Stripe.
export function requestBaseUrl(req) {
  const origin = req.headers?.origin
  if (origin) {
    try {
      const u = new URL(origin)
      if (ALLOWED_HOST.test(u.host)) return u.origin
    } catch {}
  }
  const host = req.headers?.host
  if (host && ALLOWED_HOST.test(host)) return `${/^localhost/.test(host) ? 'http' : 'https'}://${host}`
  return defaultBaseUrl()
}

// Base URL for links in emails sent outside a request (webhook).
export function defaultBaseUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '')
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' && process.env.VERCEL_BRANCH_URL) {
    return `https://${process.env.VERCEL_BRANCH_URL}`
  }
  return 'https://cadomalo.com'
}

export function safeBaseUrl(candidate) {
  try {
    const u = new URL(candidate)
    if (ALLOWED_HOST.test(u.host)) return u.origin
  } catch {}
  return defaultBaseUrl()
}
