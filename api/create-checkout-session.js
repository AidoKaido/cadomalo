import {loadCatalog, isPurchasable, findProduct} from './_catalog.js'
import {getStripe, createBrandedSession} from './_stripe.js'
import {readJson, requestBaseUrl} from './_util.js'

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

  const stripe = getStripe()
  const body = await readJson(req)

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
    catalog = await loadCatalog()
  } catch (err) {
    console.error('[checkout] failed to load catalogue:', err.message)
    return res.status(500).json({error: 'Catalogue unavailable'})
  }
  const lang = body?.lang === 'fr' ? 'fr' : 'en'

  const lineItems = []
  const resolved = []
  let hasPhysical = false

  for (const raw of lines) {
    const slug = raw?.slug
    if (!slug) return res.status(400).json({error: 'Line missing slug'})
    if (PURCHASE_PAUSED_SLUGS.has(slug)) {
      return res.status(409).json({error: `Product "${slug}" is temporarily unavailable.`})
    }
    const product = findProduct(catalog, slug)
    if (!product) return res.status(404).json({error: `Product not found: ${slug}`})
    // Hidden products (old tumbler wraps) and the free sample are not sold here.
    if (!isPurchasable(product)) {
      return res.status(409).json({error: `Product "${product.title || slug}" is no longer available.`})
    }

    const quantity = Math.max(1, Math.min(99, parseInt(raw.quantity) || 1))
    const variantId = raw.variantId || null
    const personalizationText = (raw.personalization?.text || '').toString().slice(0, 200)
    const personalizationImage = (raw.personalization?.imageUrl || raw.personalization?.imageName || '').toString().slice(0, 300)

    let unitPrice = product.price
    let variantLabel = ''
    if (product.source === 'site') {
      // One price per product now. Old cart lines may still carry an
      // edition/paper variantId: it is ignored, never priced.
      unitPrice = product.price
    } else if (variantId && Array.isArray(product.variants)) {
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
            fulfillment: product.fulfillment || '',
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
      // Stripe rejects min/max when adjustment is disabled, so multi-item carts omit them
      adjustable_quantity: lines.length === 1 ? {enabled: true, minimum: 1, maximum: 10} : {enabled: false},
    })

    resolved.push({
      id: product.id || '',
      slug: product.slug,
      qty: quantity,
      variant: variantId,
      type: product.productType || '',
    })
  }

  const baseUrl = requestBaseUrl(req)

  const cancelUrl = lang === 'fr'
    ? `${baseUrl}/fr/panier`
    : lines.length === 1
      ? `${baseUrl}/products/${encodeURIComponent(lines[0].slug)}`
      : `${baseUrl}/cart`
  const successPath = lang === 'fr' ? '/fr/confirmation' : '/order-confirmation'

  // Compact cart summary for top-level metadata (Stripe limits values to 500 chars).
  const cartSummary = JSON.stringify(resolved.map(({id, ...r}) => r)).slice(0, 480)
  // Site product ids, read by the webhook + confirmation page for delivery.
  const itemIds = resolved.filter((r) => r.id).map((r) => r.id).join(',').slice(0, 480)

  // No payment_method_types: Stripe shows every method enabled in the
  // Dashboard (cards, Apple Pay, Google Pay, Link). Digital-only carts skip
  // the billing-address and phone steps; automatic tax still asks for the
  // country/postcode it needs.
  const sessionParams = {
    mode: 'payment',
    line_items: lineItems,
    success_url: `${baseUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    billing_address_collection: hasPhysical ? 'required' : 'auto',
    ...(hasPhysical ? {phone_number_collection: {enabled: true}} : {}),
    customer_creation: 'always',
    allow_promotion_codes: true,
    automatic_tax: {enabled: true},
    metadata: {
      items: itemIds,
      site: baseUrl,
      cart_summary: cartSummary,
      item_count: String(resolved.reduce((a, x) => a + x.qty, 0)),
      has_physical: hasPhysical ? '1' : '0',
      lang,
    },
    locale: lang === 'fr' ? 'fr' : 'auto',
  }

  // The cart shows a code's discount as a preview; apply the matching Stripe
  // promotion code so the charged total agrees. Unknown codes fall back to
  // the promo-code field on the Stripe page.
  const code = typeof body?.discountCode === 'string' ? body.discountCode.trim().slice(0, 40) : ''
  if (code) {
    try {
      const found = await stripe.promotionCodes.list({code, active: true, limit: 1})
      if (found.data[0]) {
        sessionParams.discounts = [{promotion_code: found.data[0].id}]
        delete sessionParams.allow_promotion_codes
      } else {
        console.warn(`[checkout] promotion code not found in Stripe: ${code}`)
      }
    } catch (err) {
      console.error('[checkout] promotion code lookup failed:', err.message)
    }
  }

  if (hasPhysical) {
    sessionParams.shipping_address_collection = {allowed_countries: SHIPPING_COUNTRIES}
    sessionParams.shipping_options = SHIPPING_OPTIONS
  }

  try {
    const session = await createBrandedSession(sessionParams)
    return res.status(200).json({url: session.url})
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message)
    return res.status(500).json({error: err.message || 'Checkout error'})
  }
}
