// Review submission → a pending review document in Sanity.
// Moderated in Sanity Studio: set approved = true (status 'approved') to
// publish it. Product pages only show approved reviews.
//
// Required env vars:
//   SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_TOKEN (write access)
// Optional: STRIPE_SECRET_KEY — used to mark the review "verified buyer" when
//   a paid order for that email contains the product (bundles count for
//   their books).
//
// POST JSON:
//   { product | productSlug (id or slug), name | author, rating 1–5,
//     title?, text | body, email?, photo? (data:image/...;base64,… ≤ 3 MB),
//     orderId?, website (honeypot — must stay empty) }

import {loadCatalog, findProduct, expandProduct} from './_catalog.js'
import {getStripe, productsFromSession, productsFromPaymentIntent} from './_stripe.js'
import {readJson, clientIp, makeRateLimiter, isEmail, sha256} from './_util.js'

const SANITY_REVISION = 'v2024-01-01'
const MAX_PHOTO = 3 * 1024 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const limited = makeRateLimiter(5, 10 * 60 * 1000)

export const config = {api: {bodyParser: {sizeLimit: '4.5mb'}}}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const token = process.env.SANITY_API_TOKEN
  if (!projectId || !dataset || !token) {
    return res.status(500).json({error: 'Reviews are temporarily unavailable.'})
  }
  if (limited(clientIp(req))) {
    return res.status(429).json({error: 'Too many reviews from here — try again in a few minutes'})
  }

  const body = await readJson(req)
  if (body?.website) return res.status(200).json({ok: true}) // honeypot

  const productKey = String(body?.product || body?.productSlug || body?.productId || '').trim().slice(0, 120)
  const name = String(body?.name || body?.author || '').trim().slice(0, 80)
  const rating = Math.round(Number(body?.rating) || 0)
  const title = String(body?.title || '').trim().slice(0, 120)
  const text = String(body?.text || body?.body || '').trim().slice(0, 2000)
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 254)
  const orderId = String(body?.orderId || '').trim().slice(0, 80) || null

  const catalog = await loadCatalog().catch(() => [])
  const product = findProduct(catalog, productKey)
  if (!product || product.source !== 'site') return res.status(400).json({error: 'Please choose a product'})
  if (!name) return res.status(400).json({error: 'Please add your name'})
  if (rating < 1 || rating > 5) return res.status(400).json({error: 'Please choose a rating'})
  if (text.length < 20) return res.status(400).json({error: 'Please write at least a sentence about your experience'})
  if (email && !isEmail(email)) return res.status(400).json({error: 'Please check your email address'})

  const sanity = (path, init) =>
    fetch(`https://${projectId}.api.sanity.io/${SANITY_REVISION}${path}`, {
      ...init,
      headers: {Authorization: `Bearer ${token}`, ...(init.headers || {})},
    })

  // Optional photo → Sanity image asset.
  let photo = null
  if (typeof body?.photo === 'string' && body.photo.startsWith('data:')) {
    const m = body.photo.match(/^data:(image\/[\w.+-]+);base64,(.+)$/)
    if (!m || !PHOTO_TYPES.has(m[1])) return res.status(400).json({error: 'Photo must be a JPG, PNG or WebP image'})
    const bytes = Buffer.from(m[2], 'base64')
    if (bytes.length > MAX_PHOTO) return res.status(400).json({error: 'Photo is too large (max 3 MB)'})
    try {
      const r = await sanity(`/assets/images/${dataset}?filename=review-${Date.now()}`, {
        method: 'POST',
        headers: {'Content-Type': m[1]},
        body: bytes,
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok && d?.document?._id) photo = {_type: 'image', asset: {_type: 'reference', _ref: d.document._id}}
      else console.error('[submit-review] photo upload', r.status, JSON.stringify(d).slice(0, 300))
    } catch (err) {
      console.error('[submit-review] photo upload error:', err.message)
    }
  }

  const verified = email ? await isVerifiedBuyer(catalog, email, product).catch(() => false) : false

  const doc = {
    _type: 'reviewSubmission',
    product: product.id,
    productSlug: product.slug,
    productId: product.id,
    name,
    author: name,
    rating,
    title,
    text,
    body: text,
    ...(photo ? {photo} : {}),
    emailHash: email ? sha256(email) : null,
    verified,
    orderId,
    approved: false,
    status: 'pending',
    submittedAt: new Date().toISOString(),
  }

  try {
    const r = await sanity(`/data/mutate/${dataset}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({mutations: [{create: doc}]}),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error('[submit-review] Sanity', r.status, JSON.stringify(data).slice(0, 400))
      return res.status(502).json({error: 'Could not save your review. Try again later.'})
    }
    return res.status(200).json({ok: true, verified, id: data?.results?.[0]?.id || null})
  } catch (err) {
    console.error('[submit-review] fetch error:', err.message)
    return res.status(502).json({error: 'Could not save your review. Try again later.'})
  }
}

// A paid Stripe order for this email that includes the product (directly or
// inside a bundle). Checks Checkout Sessions and one-click upsell payments.
async function isVerifiedBuyer(catalog, email, product) {
  if (!process.env.STRIPE_SECRET_KEY) return false
  const stripe = getStripe()
  const covers = (products) =>
    products.some((p) => p.id === product.id || expandProduct(catalog, p).some((b) => b.id === product.id))

  const sessions = []
  try {
    const r = await stripe.checkout.sessions.list({customer_details: {email}, limit: 100})
    sessions.push(...r.data)
  } catch {}
  let customers = []
  try {
    const safe = email.replace(/['\\]/g, '')
    customers = (await stripe.customers.search({query: `email:'${safe}'`, limit: 10})).data
  } catch {}
  for (const c of customers) {
    try {
      sessions.push(...(await stripe.checkout.sessions.list({customer: c.id, limit: 100})).data)
    } catch {}
  }
  if (covers(sessions.filter((s) => s.payment_status === 'paid').flatMap((s) => productsFromSession(catalog, s)))) return true

  for (const c of customers) {
    try {
      const pis = (await stripe.paymentIntents.list({customer: c.id, limit: 100})).data
      const bought = pis.filter((pi) => pi.status === 'succeeded' && pi.metadata?.items).flatMap((pi) => productsFromPaymentIntent(catalog, pi))
      if (covers(bought)) return true
    } catch {}
  }
  return false
}
