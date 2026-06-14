// Auth-gated lightweight orders dashboard data source.
// Returns the last N Stripe Checkout Sessions with payment + line items.
//
// Auth: HTTP Basic. Username/password from env:
//   ADMIN_USER, ADMIN_PASS
//
// Stripe:
//   STRIPE_SECRET_KEY

import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({error: 'Method not allowed'})
  }

  const adminUser = process.env.ADMIN_USER
  const adminPass = process.env.ADMIN_PASS
  if (!adminUser || !adminPass) {
    return res.status(500).json({error: 'Admin not configured'})
  }

  const auth = req.headers['authorization'] || ''
  if (!auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Cadomalo Admin"')
    return res.status(401).json({error: 'Authentication required'})
  }
  let user, pass
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    user = decoded.slice(0, idx)
    pass = decoded.slice(idx + 1)
  } catch {
    return res.status(401).json({error: 'Bad credentials'})
  }
  if (user !== adminUser || pass !== adminPass) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Cadomalo Admin"')
    return res.status(401).json({error: 'Invalid credentials'})
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({error: 'Stripe not configured'})
  }

  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit, 10) || 25))
    const sessions = await stripe.checkout.sessions.list({
      limit,
      expand: ['data.line_items'],
    })

    const orders = sessions.data.map((s) => ({
      id: s.id,
      created: s.created,
      amountTotal: (s.amount_total || 0) / 100,
      currency: (s.currency || 'usd').toUpperCase(),
      status: s.status,
      paymentStatus: s.payment_status,
      email: s.customer_details?.email || s.customer_email || null,
      name: s.customer_details?.name || null,
      country: s.customer_details?.address?.country || null,
      items: (s.line_items?.data || []).map((li) => ({
        description: li.description,
        quantity: li.quantity,
        amount: (li.amount_total || 0) / 100,
      })),
      hasPhysical: s.metadata?.has_physical === '1',
      cartSummary: s.metadata?.cart_summary || null,
    }))

    return res.status(200).json({orders, hasMore: sessions.has_more})
  } catch (err) {
    console.error('[admin-orders] Stripe error:', err.message)
    return res.status(502).json({error: err.message || 'Could not load orders'})
  }
}
