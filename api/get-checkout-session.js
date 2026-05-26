import Stripe from 'stripe'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

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

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items'],
    })
    const digitalDelivery =
      session.payment_status === 'paid'
        ? await loadDigitalDelivery(session.metadata?.product_slug)
        : null
    return res.status(200).json({
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      amount_subtotal: session.amount_subtotal,
      currency: session.currency,
      customer_email: session.customer_details?.email || session.customer_email || null,
      customer_name: session.customer_details?.name || null,
      shipping_address: session.shipping_details?.address || null,
      line_items: (session.line_items?.data || []).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        amount_total: item.amount_total,
        currency: item.currency,
      })),
      metadata: session.metadata || {},
      digital_delivery: digitalDelivery,
    })
  } catch (err) {
    console.error('[get-checkout-session]', err.message)
    return res.status(404).json({error: 'Session not found'})
  }
}
