import Stripe from 'stripe'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

// Countries cadomalo.com will ship to (start broad, tighten if needed).
const SHIPPING_COUNTRIES = [
  'US', 'CA', 'MX',
  'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'IT', 'ES', 'PT',
  'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IS',
  'AU', 'NZ',
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({error: 'Method not allowed'})
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({error: 'Stripe not configured on the server'})
  }

  const body = req.body || (await readJson(req))
  const slug = body?.slug
  const quantity = Math.max(1, Math.min(99, parseInt(body?.quantity) || 1))
  const variantId = body?.variantId || null
  const personalizationText = (body?.personalization?.text || '').toString().slice(0, 200)
  if (!slug) return res.status(400).json({error: 'Missing slug'})

  let product
  try {
    const raw = await readFile(join(process.cwd(), 'data', 'products.json'), 'utf8')
    const data = JSON.parse(raw)
    product = data.products.find((p) => p.slug === slug)
  } catch (err) {
    console.error('[checkout] failed to load products.json:', err.message)
    return res.status(500).json({error: 'Catalogue unavailable'})
  }
  if (!product) return res.status(404).json({error: 'Product not found'})

  // Slugs paused from purchase. Keep in sync with PURCHASE_PAUSED_SLUGS in js/products.js.
  const PURCHASE_PAUSED_SLUGS = new Set([])
  if (PURCHASE_PAUSED_SLUGS.has(slug)) {
    return res.status(409).json({error: 'This product is temporarily unavailable for purchase.'})
  }

  // Resolve effective price and label from variant if provided
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
    return res.status(400).json({error: 'Product is not purchasable'})
  }

  const baseUrl =
    req.headers.origin ||
    (req.headers.host ? `https://${req.headers.host}` : 'https://cadomalo.com')

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
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
            },
          },
          unit_amount: Math.round(unitPrice * 100),
        },
        quantity,
        adjustable_quantity: {enabled: true, minimum: 1, maximum: 10},
      },
    ],
    success_url: `${baseUrl}/order-confirmation?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/product?slug=${encodeURIComponent(slug)}`,
    shipping_address_collection:
      product.productType === 'digital' ? undefined : {allowed_countries: SHIPPING_COUNTRIES},
    billing_address_collection: 'required',
    phone_number_collection: {enabled: true},
    metadata: {
      product_slug: slug,
      product_source: product.source || '',
      printify_product_id: product.printifyProductId || '',
      printify_shop_id: String(product.sourceShopId || ''),
      variant_id: variantId || '',
      variant_label: variantLabel,
      personalization_text: personalizationText,
    },
  })

  return res.status(200).json({url: session.url})
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
