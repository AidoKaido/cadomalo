// Shared catalogue lookup for the checkout + webhook functions.
// (Underscore prefix: Vercel does not expose this file as an endpoint.)
//
// Two sources, merged:
//   - data/catalog-client.json — the site's own products (books, bundle,
//     wraps), written by scripts/build-pages.js from content/catalog.json.
//     Fulfilled by hand: the order lands in support@cadomalo.com and the
//     files are sent from there.
//   - data/products.json — the older Sanity/Printify catalogue, kept so
//     in-flight orders and the digital-delivery pipeline still resolve.
// Site products win on a slug clash.

import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

const SITE_URL = (process.env.SITE_URL || 'https://cadomalo.com').replace(/\/$/, '')

async function readJson(file) {
  const raw = await readFile(join(process.cwd(), 'data', file), 'utf8')
  return JSON.parse(raw)
}

export async function loadCatalog() {
  let site = []
  let legacy = []
  try {
    site = (await readJson('catalog-client.json')).map((p) => ({
      slug: p.slug,
      title: p.title.en,
      titleFr: p.title.fr,
      price: p.price,
      productType: 'digital',
      fulfillment: 'manual',
      source: 'site',
      images: p.img ? [{url: SITE_URL + p.img}] : [],
      attrs: p.attrs || [],
    }))
  } catch (err) {
    console.error('[catalog] failed to load catalog-client.json:', err.message)
  }
  try {
    legacy = (await readJson('products.json')).products || []
  } catch (err) {
    console.error('[catalog] failed to load products.json:', err.message)
  }
  if (!site.length && !legacy.length) throw new Error('Catalogue unavailable')
  const taken = new Set(site.map((p) => p.slug))
  return [...site, ...legacy.filter((p) => !taken.has(p.slug))]
}

// Site products encode the chosen options as "v-<i>-<j>…" (one index per
// attribute, see js/cart.js). Resolve that to a price and a label on the
// server so the browser never decides what gets charged.
export function resolveSiteVariant(product, variantId) {
  const attrs = product.attrs || []
  if (!attrs.length) return {price: product.price, label: ''}
  const picks = variantId ? String(variantId).replace(/^v-/, '').split('-').map(Number) : attrs.map(() => 0)
  if (picks.length !== attrs.length) return null
  let price = product.price
  const labels = []
  for (let i = 0; i < attrs.length; i++) {
    const option = attrs[i].options[picks[i]]
    if (!Number.isInteger(picks[i]) || !option) return null
    price += option.delta || 0
    labels.push(option.en)
  }
  return {price: Math.round(price * 100) / 100, label: labels.join(' · ')}
}
