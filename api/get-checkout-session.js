// Order confirmation data: GET ?session_id=cs_…[&upsell=pi_…]
//
// For paid sessions it also returns `downloads` [{label, url}] — signed
// 7-day links for every file the order delivers (bundles expand to their
// books). `&upsell=pi_…` adds the one-click upsell's files when that
// PaymentIntent succeeded for the same customer and points at this session.
// A funnel session created as a follow-up (metadata.parent) also includes
// the parent order's files, so one confirmation page shows everything.

import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {loadCatalog, FREE_IDS} from './_catalog.js'
import {getStripe, productsFromSession, productsFromPaymentIntent, buildDownloads} from './_stripe.js'
import {safeBaseUrl, requestBaseUrl} from './_util.js'

async function loadDigitalDelivery(slug) {
  if (!slug) return null
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
    const data = JSON.parse(raw)
    const p = data.products.find((x) => x.slug === slug)
    if (!p || p.productType !== 'digital') return null
    if (!p.digitalFile?.url) return null
    return {
      url: p.digitalFile.url,
      filename: p.digitalFile.originalFilename || `${slug}.pdf`,
      productTitle: p.title,
    }
  } catch {
    return null
  }
}

const customerId = (x) => (typeof x?.customer === 'string' ? x.customer : x?.customer?.id || null)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({error: 'Stripe not configured on the server'})
  }
  const sessionId = req.query?.session_id
  if (!sessionId || !/^cs_(test|live)_/.test(sessionId)) {
    return res.status(400).json({error: 'Missing or invalid session_id'})
  }
  const upsellId = String(req.query?.upsell || '')
  const stripe = getStripe()

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {expand: ['line_items']})
    const paid = session.payment_status === 'paid'
    const digitalDelivery = paid ? await loadDigitalDelivery(session.metadata?.product_slug) : null

    let downloads = []
    let manual = []
    let products = []
    const extraLines = []
    let extraTotal = 0
    if (paid) {
      const catalog = await loadCatalog().catch(() => [])
      products = productsFromSession(catalog, session)

      // Follow-up funnel session → include the parent order.
      const parentId = session.metadata?.parent
      if (parentId && /^cs_(test|live)_/.test(parentId)) {
        try {
          const parent = await stripe.checkout.sessions.retrieve(parentId)
          if (parent.payment_status === 'paid' && customerId(parent) && customerId(parent) === customerId(session)) {
            products = [...productsFromSession(catalog, parent), ...products]
          }
        } catch {}
      }

      if (/^pi_/.test(upsellId)) {
        try {
          const pi = await stripe.paymentIntents.retrieve(upsellId)
          if (
            pi.status === 'succeeded' &&
            pi.metadata?.upsell_of === session.id &&
            customerId(pi) &&
            customerId(pi) === customerId(session)
          ) {
            const extra = productsFromPaymentIntent(catalog, pi)
            products = [...products, ...extra]
            extra.forEach((p) => extraLines.push({description: p.title, quantity: 1, amount_total: pi.amount, currency: pi.currency}))
            extraTotal += pi.amount
          }
        } catch {}
      }

      const base = session.metadata?.site ? safeBaseUrl(session.metadata.site) : requestBaseUrl(req)
      const built = buildDownloads(catalog, products.filter((p) => !FREE_IDS.has(p.id)), {sid: session.id, baseUrl: base})
      downloads = built.downloads.map(({label, url, product}) => ({label, url, product}))
      manual = built.missing.map((p) => p.title)
    }

    return res.status(200).json({
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: (session.amount_total || 0) + extraTotal,
      amount_subtotal: session.amount_subtotal,
      currency: session.currency,
      customer_email: session.customer_details?.email || session.customer_email || null,
      customer_name: session.customer_details?.name || null,
      shipping_address: session.shipping_details?.address || session.collected_information?.shipping_details?.address || null,
      line_items: [
        ...(session.line_items?.data || []).map((item) => ({
          description: item.description,
          quantity: item.quantity,
          amount_total: item.amount_total,
          currency: item.currency,
        })),
        ...extraLines,
      ],
      products: products.map((p) => p.id || p.slug),
      funnel: session.metadata?.funnel === '1',
      metadata: session.metadata || {},
      digital_delivery: digitalDelivery,
      downloads,
      manual_fulfillment: manual,
    })
  } catch (err) {
    console.error('[get-checkout-session]', err.message)
    return res.status(404).json({error: 'Session not found'})
  }
}
