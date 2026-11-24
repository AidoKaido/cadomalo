// Stripe helpers shared by the checkout, funnel and webhook functions.
// (Underscore prefix: not an endpoint.)
//
// stripe@19 pins API version 2025-10-29.clover, which supports
// Checkout `branding_settings` — no apiVersion override needed.

import Stripe from 'stripe'
import {SITE_URL, toCents, deliverablesFor, findProduct} from './_catalog.js'
import {makeDownloadToken} from './_util.js'

let client = null
export function getStripe() {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_missing')
  return client
}
export function _setStripe(s) {
  client = s
}

// Site palette: cream page, coral pay button, Nunito, rounded corners.
// Logo/icon are served from the production domain so Stripe can always fetch
// them (assets are committed and already live there).
export function brandingSettings() {
  return {
    display_name: 'Cadomalo',
    background_color: '#FFF8ED',
    button_color: '#F06B4F',
    border_style: 'rounded',
    font_family: 'nunito',
    logo: {type: 'url', url: `${SITE_URL}/assets/logo-horizontal.png`},
    icon: {type: 'url', url: `${SITE_URL}/assets/logo-square.png`},
  }
}

// Create a Checkout Session with branding. If Stripe rejects part of the
// branding (e.g. it cannot fetch the logo), retry without logo/icon, then
// without branding at all, so a styling problem never blocks a sale.
export async function createBrandedSession(params, opts) {
  const stripe = getStripe()
  const full = {...params, branding_settings: brandingSettings()}
  try {
    return await stripe.checkout.sessions.create(full, opts)
  } catch (err) {
    if (!isBrandingError(err)) throw err
    console.warn('[stripe] branding_settings rejected, retrying without logo/icon:', err.message)
  }
  const {logo, icon, ...noImages} = brandingSettings()
  try {
    return await stripe.checkout.sessions.create({...params, branding_settings: noImages}, opts)
  } catch (err) {
    if (!isBrandingError(err)) throw err
    console.warn('[stripe] branding_settings rejected again, creating session without branding:', err.message)
  }
  return stripe.checkout.sessions.create(params, opts)
}

function isBrandingError(err) {
  const p = String(err?.param || '')
  const m = String(err?.message || '')
  return p.startsWith('branding_settings') || /branding_settings/i.test(m)
}

export function lineItemFor(product, unitPrice, {quantity = 1, adjustable = false, nameSuffix = ''} = {}) {
  return {
    price_data: {
      currency: 'usd',
      product_data: {
        name: product.title + (nameSuffix ? ` — ${nameSuffix}` : ''),
        images: (product.images || []).slice(0, 8).map((i) => i.url).filter(Boolean),
        metadata: {
          source: product.source || '',
          fulfillment: product.fulfillment || '',
          slug: product.slug,
          product_id: product.id || '',
        },
      },
      unit_amount: toCents(unitPrice),
      tax_behavior: 'exclusive',
    },
    quantity,
    ...(adjustable ? {adjustable_quantity: {enabled: true, minimum: 1, maximum: 10}} : {}),
  }
}

// Product ids bought in a Checkout Session. New sessions carry
// metadata.items ("id,id"); older ones carry cart_summary / product_slug.
export function productsFromSession(catalog, session) {
  const m = session?.metadata || {}
  const keys = []
  if (m.items) keys.push(...String(m.items).split(',').filter(Boolean))
  else if (m.cart_summary) {
    try {
      const arr = JSON.parse(m.cart_summary)
      if (Array.isArray(arr)) keys.push(...arr.map((x) => x.slug).filter(Boolean))
    } catch {}
  } else if (m.product_slug) keys.push(m.product_slug)
  return keys.map((k) => findProduct(catalog, k)).filter(Boolean)
}

export function productsFromPaymentIntent(catalog, pi) {
  const ids = String(pi?.metadata?.items || '').split(',').filter(Boolean)
  return ids.map((k) => findProduct(catalog, k)).filter(Boolean)
}

// Signed, 7-day download links for everything a list of products delivers.
export function buildDownloads(catalog, products, {sid, baseUrl}) {
  const {files, missing} = deliverablesFor(catalog, products)
  const multi = new Set(files.map((f) => f.product.id)).size > 1
  const downloads = files.map((f) => {
    const name = `${f.product.slug || f.product.id}-${f.key.split('/').pop()}`
    const t = makeDownloadToken({key: f.key, sid, name})
    return {
      product: f.product.id,
      parent: f.parent.id,
      label: multi || f.product.files.length > 1 ? `${f.product.title} — ${f.label}` : f.product.title,
      url: `${baseUrl}/api/download?t=${encodeURIComponent(t)}`,
    }
  })
  return {downloads, missing}
}
