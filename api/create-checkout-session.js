import Stripe from 'stripe'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const SHIPPING_COUNTRIES = [
  'US', 'CA', 'MX',
  'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'IT', 'ES', 'PT',
  'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IS',
  'AU', 'NZ',
]

// Flat-rate shipping options shown at Stripe Checkout for physical orders.
// Cost is per-order, USD. Update once live Printify shipping quotes are wired.
const SHIPPING_OPTIONS = [
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: 'Standard (3–7 business days)',
      fixed_amount: {amount: 499, currency: 'usd'},
      tax_behavior: 'exclusive',
      delivery_estimate: {
        minimum: {unit: 'business_day', value: 3},
        maximum: {unit: 'business_day', value: 7},
      },
    },
  },
  {
    shipping_rate_data: {
      type: 'fixed_amount',
      display_name: 'Express (1–2 business days)',
      fixed_amount: {amount: 999, currency: 'usd'},
      tax_behavior: 'exclusive',
      delivery_estimate: {
        minimum: {unit: 'business_day', value: 1},
        maximum: {unit: 'business_day', value: 2},
      },
    },
  },
]

// Keep in sync with PURCHASE_PAUSED_SLUGS in js/products.js.
const PURCHASE_PAUSED_SLUGS = new Set([])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({error: 'Stripe not configured on the server'})
  }

  const body = req.body || (await readJson(req))

  // Normalize input into a `lines` array. Two shapes accepted:
  //   1) Multi-item:   { cart: [{slug, quantity, variantId, personalization}, ...] }
  //   2) Single-item:  { slug, quantity, variantId, personalization }
  let lines
  if (Array.isArray(body?.cart) && body.cart.length) {
    lines = body.cart
  } else if (body?.slug) {
    lines = [{
      slug: body.slug,
      quantity: body.quantity,
      variantId: body.variantId,
      personalization: body.personalization,
    }]
  } else {
    return res.status(400).json({error: 'Missing cart or slug'})
  }
  if (lines.length > 50) return res.status(400).json({error: 'Cart too large'})

  let catalog
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
    catalog = JSON.parse(raw).products || []
  } catch (err) {
    console.error('[checkout] failed to load products.json:', err.message)
    return res.status(500).json({error: 'Catalogue unavailable'})
  }

  const lineItems = []
  const resolved = []
  let hasPhysical = false

  for (const raw of lines) {
    const slug = raw?.slug
    if (!slug) return res.status(400).json({error: 'Line missing slug'})
    if (PURCHASE_PAUSED_SLUGS.has(slug)) {
      return res.status(409).json({error: `Product "${slug}" is temporarily unavailable.`})
    }
    const product = catalog.find((p) => p.slug === slug)
    if (!product) return res.status(404).json({error: `Product not found: ${slug}`})

    const quantity = Math.max(1, Math.min(99, parseInt(raw.quantity) || 1))
    const variantId = raw.variantId || null
    const personalizationText = (raw.personalization?.text || '').toString().slice(0, 200)
    const personalizationImage = (raw.personalization?.imageUrl || raw.personalization?.imageName || '').toString().slice(0, 300)

    let unitPrice = product.price
    let variantLabel = ''
    if (variantId && Array.isArray(product.variants)) {
      const v = product.variants.find((x) => x.id === variantId)
      if (v) {
        unitPrice = v.price
        variantLabel = v.title || ''
      }
    }
    if (typeof unitPrice !== 'number' || unitPrice <= 0) {
      return res.status(400).json({error: `Product not purchasable: ${slug}`})
    }

    if (product.productType !== 'digital') hasPhysical = true

    lineItems.push({
      price_data: {
        currency: 'usd',
        product_data: {
          name: variantLabel ? `${product.title} — ${variantLabel}` : product.title,
          description: (product.shortDescription || '').slice(0, 200) || undefined,
          images: (product.images || []).slice(0, 8).map((i) => i.url).filter(Boolean),
          metadata: {
            source: product.source || '',
            source_shop_channel: product.sourceShopChannel || '',
            printify_product_id: product.printifyProductId || '',
            slug: product.slug,
            variant_id: variantId || '',
            variant_label: variantLabel,
            personalization_text: personalizationText,
            personalization_image: personalizationImage,
          },
        },
        unit_amount: Math.round(unitPrice * 100),
        tax_behavior: 'exclusive',
      },
      quantity,
      adjustable_quantity: {enabled: lines.length === 1, minimum: 1, maximum: 10},
    })

    resolved.push({
      slug: product.slug,
      qty: quantity,
      variant: variantId,
      type: product.productType || '',
    })
  }

  const baseUrl =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : 'https://cadomalo.com')

  const cancelUrl = lines.length === 1
    ? `${baseUrl}/products/${encodeURIComponent(lines[0].slug)}`
    : `${baseUrl}/cart`

  // Compact cart summary for top-level metadata (Stripe limits values to 500 chars).
  const cartSummary = JSON.stringify(resolved).slice(0, 480)

  const sessionParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    success_url: `${baseUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    billing_address_collection: 'required',
    phone_number_collection: {enabled: true},
    allow_promotion_codes: true,
    automatic_tax: {enabled: true},
    metadata: {
      cart_summary: cartSummary,
      item_count: String(resolved.reduce((a, x) => a + x.qty, 0)),
      has_physical: hasPhysical ? '1' : '0',
    },
  }

  if (hasPhysical) {
    sessionParams.shipping_address_collection = {allowed_countries: SHIPPING_COUNTRIES}
    sessionParams.shipping_options = SHIPPING_OPTIONS
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams)
    return res.status(200).json({url: session.url})
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message)
    return res.status(500).json({error: err.message || 'Checkout error'})
  }
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}
