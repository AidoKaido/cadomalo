// One-click upsell on /offer/medical-heroes: POST {session_id}.
//
// Charges the card saved by the funnel's Discovery Lab checkout
// (setup_future_usage: off_session) for the Medical Heroes collection at its
// funnelPrice, without the buyer re-entering anything.
//
// Rules: the session must be paid, a funnel session (metadata.funnel = '1'),
// less than 1 hour old, and not already upsold (checked on the customer's
// PaymentIntents via metadata.upsell_of).
//
// Responses:
//   {ok:true, redirect:'/order-confirmation?session_id=…&upsell=pi_…'}
//   {requiresAction:true, url}  — card needs 3-D Secure or was declined: a
//       branded Stripe Checkout for the same product + price, prefilled with
//       the customer.
// The webhook delivers the files on payment_intent.succeeded (metadata.items).

import {loadCatalog, findProduct, funnelPriceOf, toCents} from './_catalog.js'
import {getStripe} from './_stripe.js'
import {createFallbackSession} from './funnel-checkout.js'
import {readJson, requestBaseUrl, clientIp, makeRateLimiter} from './_util.js'

const UPSELL_ID = 'mh-bundle'
const WINDOW_S = 3600
const limited = makeRateLimiter(10, 10 * 60 * 1000)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({error: 'Stripe not configured on the server'})
  if (limited(clientIp(req))) return res.status(429).json({error: 'Too many requests — try again in a few minutes'})

  const body = await readJson(req)
  const sessionId = String(body.session_id || '')
  if (!/^cs_(test|live)_/.test(sessionId)) return res.status(400).json({error: 'Missing or invalid session_id'})

  const stripe = getStripe()
  const base = requestBaseUrl(req)
  const confirmUrl = (pi) =>
    `/order-confirmation?session_id=${encodeURIComponent(sessionId)}${pi ? `&upsell=${encodeURIComponent(pi)}` : ''}`

  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {expand: ['payment_intent']})
  } catch {
    return res.status(404).json({error: 'Session not found'})
  }
  if (session.payment_status !== 'paid' || session.metadata?.funnel !== '1') {
    return res.status(409).json({error: 'This offer is not available for this order.'})
  }
  if (Date.now() / 1000 - session.created > WINDOW_S) {
    return res.status(410).json({error: 'This one-time offer has expired.', redirect: confirmUrl()})
  }
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id
  const first = session.payment_intent
  const paymentMethod = first && typeof first === 'object'
    ? (typeof first.payment_method === 'string' ? first.payment_method : first.payment_method?.id)
    : null
  if (!customer) return res.status(409).json({error: 'This offer is not available for this order.'})

  let catalog
  try {
    catalog = await loadCatalog()
  } catch {
    return res.status(500).json({error: 'Catalogue unavailable'})
  }
  const product = findProduct(catalog, UPSELL_ID)
  const price = funnelPriceOf(product)
  if (!product || !price) return res.status(404).json({error: 'This offer is not available'})

  // Already upsold? (double click, back button, second tab)
  try {
    const list = await stripe.paymentIntents.list({customer, limit: 20})
    const done = list.data.find(
      (pi) => pi.metadata?.upsell_of === sessionId && ['succeeded', 'processing', 'requires_capture'].includes(pi.status)
    )
    if (done) return res.status(200).json({ok: true, already: true, redirect: confirmUrl(done.id)})
  } catch (err) {
    console.error('[one-click-upsell] list PaymentIntents failed:', err.message)
  }

  const fallback = async (reason) => {
    try {
      const s = await createFallbackSession({parent: session, product, price, base})
      return res.status(200).json({requiresAction: true, reason, url: s.url})
    } catch (err) {
      console.error('[one-click-upsell] fallback session failed:', err.message)
      return res.status(502).json({error: 'We could not start the payment. Please try again.'})
    }
  }

  if (!paymentMethod) return fallback('no_saved_card')

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: toCents(price),
        currency: 'usd',
        customer,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `${product.title} (one-click add-on)`,
        receipt_email: session.customer_details?.email || undefined,
        metadata: {items: UPSELL_ID, upsell_of: sessionId, funnel: '1', site: base},
      },
      {idempotencyKey: `upsell-${sessionId}`}
    )
    if (pi.status === 'succeeded' || pi.status === 'processing') {
      return res.status(200).json({ok: true, redirect: confirmUrl(pi.id)})
    }
    return fallback(pi.status)
  } catch (err) {
    // authentication_required (3-D Secure), card_declined, etc.
    console.warn('[one-click-upsell] off-session charge failed:', err.code || err.type, err.message)
    return fallback(err.code || 'payment_failed')
  }
}
