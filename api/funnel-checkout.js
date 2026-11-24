// Funnel checkout: the only way to buy at a catalog `funnelPrice`.
//
// Request (POST JSON, or GET query string so email links can point here):
//   {offerToken | t, product}      — lead offer token from api/lead.js.
//        product defaults to 'discovery-lab'. Valid + unexpired → funnelPrice,
//        expired → the normal store price. Discovery Lab uses the 48 h
//        deadline (exp); other funnel products the 14-day window (fx).
//   {session_id, product}          — post-purchase step (3-D Secure fallback of
//        the one-click upsell, or the HBW-collection downsell on the
//        confirmation page): a paid funnel session from the last 24 h unlocks
//        the funnel price; the new session reuses that Stripe customer.
//   add `quote: 1` to get the prices as JSON instead of a Checkout URL.
//
// POST → {url}. GET → 303 redirect to Stripe Checkout.

import {loadCatalog, findProduct, funnelPriceOf, storePrice, FREE_IDS} from './_catalog.js'
import {getStripe, createBrandedSession, lineItemFor} from './_stripe.js'
import {readJson, verifyToken, offerUnlocks, requestBaseUrl, clientIp, makeRateLimiter} from './_util.js'

const limited = makeRateLimiter(30, 10 * 60 * 1000)
const SESSION_WINDOW_S = 24 * 3600

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({error: 'Stripe not configured on the server'})
  if (limited(clientIp(req))) return res.status(429).json({error: 'Too many requests — try again in a few minutes'})

  const isGet = req.method === 'GET'
  const input = isGet ? req.query || {} : await readJson(req)
  const fail = (status, error) => {
    if (isGet) {
      res.statusCode = 303
      res.setHeader('Location', '/shop')
      return res.end()
    }
    return res.status(status).json({error})
  }

  const token = String(input.offerToken || input.t || '')
  const parentId = String(input.session_id || '')
  const productKey = String(input.product || 'discovery-lab')

  let catalog
  try {
    catalog = await loadCatalog()
  } catch {
    return fail(500, 'Catalogue unavailable')
  }
  const product = findProduct(catalog, productKey)
  if (!product || product.source !== 'site' || product.hidden || FREE_IDS.has(product.id) || !(product.price > 0)) {
    return fail(404, 'This offer is not available')
  }
  const fp = funnelPriceOf(product)
  const sp = storePrice(product)
  const stripe = getStripe()

  let unlocked = false
  let email = null
  let customer = null
  let parent = null
  let exp = null

  if (parentId) {
    if (!/^cs_(test|live)_/.test(parentId)) return fail(400, 'Invalid session')
    try {
      parent = await stripe.checkout.sessions.retrieve(parentId)
    } catch {
      return fail(404, 'Session not found')
    }
    const fresh = Date.now() / 1000 - parent.created < SESSION_WINDOW_S
    unlocked = parent.payment_status === 'paid' && parent.metadata?.funnel === '1' && fresh
    customer = typeof parent.customer === 'string' ? parent.customer : parent.customer?.id || null
    email = parent.customer_details?.email || parent.customer_email || null
    exp = parent.created + SESSION_WINDOW_S
  } else if (token) {
    const payload = verifyToken(token, 'o')
    if (!payload) return fail(400, 'This offer link is not valid')
    unlocked = offerUnlocks(payload, product.id)
    email = payload.email || null
    exp = product.id === payload.offer ? payload.exp : payload.fx || payload.exp
  } else {
    return fail(400, 'Missing offer')
  }

  const useFunnel = unlocked && fp !== null
  const price = useFunnel ? fp : sp

  if (input.quote) {
    return res.status(200).json({
      product: product.id,
      title: product.title,
      storePrice: sp,
      funnelPrice: fp,
      price,
      unlocked: useFunnel,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
      savings: useFunnel ? Math.round((sp - fp) * 100) / 100 : 0,
      savingsPct: useFunnel ? Math.round(((sp - fp) / sp) * 100) : 0,
    })
  }

  const base = requestBaseUrl(req)
  const isEntry = !parent // first purchase of the funnel (from the lead token)
  const successUrl =
    isEntry && product.id === 'discovery-lab'
      ? `${base}/offer/medical-heroes?session_id={CHECKOUT_SESSION_ID}`
      : `${base}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = parent
    ? product.id === 'mh-bundle'
      ? `${base}/offer/medical-heroes?session_id=${encodeURIComponent(parent.id)}`
      : `${base}/order-confirmation?session_id=${encodeURIComponent(parent.id)}`
    : `${base}/thank-you-sample?t=${encodeURIComponent(token)}`

  const params = {
    mode: 'payment',
    line_items: [lineItemFor(product, price)],
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: 'auto',
    automatic_tax: {enabled: true},
    // Save the card so the next page can offer a one-click add-on.
    payment_intent_data: isEntry ? {setup_future_usage: 'off_session'} : undefined,
    metadata: {
      funnel: '1',
      items: product.id,
      offer: product.id,
      price_type: useFunnel ? 'funnel' : 'store',
      parent: parent ? parent.id : '',
      site: base,
      lang: 'en',
    },
  }
  if (!params.payment_intent_data) delete params.payment_intent_data
  if (customer) {
    params.customer = customer
    params.customer_update = {address: 'auto', name: 'auto'}
  } else {
    params.customer_creation = 'always'
    if (email) params.customer_email = email
  }

  try {
    const session = await createBrandedSession(params)
    if (isGet) {
      res.statusCode = 303
      res.setHeader('Location', session.url)
      return res.end()
    }
    return res.status(200).json({url: session.url, price, unlocked: useFunnel})
  } catch (err) {
    console.error('[funnel-checkout] Stripe error:', err.message)
    return fail(500, 'Checkout is unavailable right now — please try again.')
  }
}

// Exposed for api/one-click-upsell.js (3-D Secure / decline fallback).
export async function createFallbackSession({parent, product, price, base}) {
  return createBrandedSession({
    mode: 'payment',
    line_items: [lineItemFor(product, price)],
    customer: typeof parent.customer === 'string' ? parent.customer : parent.customer?.id,
    customer_update: {address: 'auto', name: 'auto'},
    success_url: `${base}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/order-confirmation?session_id=${encodeURIComponent(parent.id)}`,
    billing_address_collection: 'auto',
    automatic_tax: {enabled: true},
    metadata: {funnel: '1', items: product.id, offer: product.id, price_type: 'funnel', parent: parent.id, site: base, lang: 'en'},
  })
}
