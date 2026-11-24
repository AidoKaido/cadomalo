// Shared catalogue lookup for the checkout, funnel, download and webhook
// functions. (Underscore prefix: Vercel does not expose this file.)
//
// Sources, merged (site wins on a slug clash):
//   - content/catalog.json  — the source of truth for the site's products
//     (prices, funnelPrice, files, includes, hidden, fulfillment).
//   - data/catalog-client.json — the slim copy build-pages.js writes; used
//     only if content/catalog.json cannot be read.
//   - data/products.json — the older Sanity/Printify catalogue, kept so
//     in-flight orders and the legacy digital-delivery pipeline resolve.
//
// Prices are decided here, never by the browser:
//   - storePrice(p)  → p.price (one price per product; old cart lines that
//     still carry an edition/paper variantId are charged the same price).
//   - funnelPrice(p) → p.funnelPrice, only used by the funnel endpoints.

import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

export const SITE_URL = (process.env.SITE_URL || 'https://cadomalo.com').replace(/\/$/, '')

// The free lead magnet: never sold through Stripe.
export const FREE_IDS = new Set(['routine-sample'])

// Fallbacks used only when catalog.json does not (yet) carry the new fields.
const HBW_BOOKS = ['head', 'lungs', 'stomach', 'bones', 'muscles', 'skin', 'blood', 'eyes', 'ears', 'teeth']
const MH_BOOKS = Array.from({length: 10}, (_, i) => `mh${String(i + 1).padStart(2, '0')}`)
const KITS = ['routine', 'discovery-lab', 'party-kit', 'birthday-wish', 'wonder-island']
const BUNDLE_COLLECTION = {bundle: 'hbw', 'mh-bundle': 'mh'}

export const slugify = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const titleOf = (p, lang) => (p.title && typeof p.title === 'object' ? p.title[lang] || p.title.en : p.title) || p.id || ''

function guessCollection(id) {
  if (HBW_BOOKS.includes(id) || id === 'bundle') return 'hbw'
  if (MH_BOOKS.includes(id) || id === 'mh-bundle') return 'mh'
  return null
}
function guessCategory(id, p) {
  if (BUNDLE_COLLECTION[id]) return 'bundle'
  if (id === 'party-kit') return 'party'
  if (KITS.includes(id)) return 'kit'
  if (p.type === 'book' || HBW_BOOKS.includes(id) || MH_BOOKS.includes(id)) return 'book'
  return p.type || null
}

const absUrl = (u) => (!u ? '' : /^https?:\/\//.test(u) ? u : SITE_URL + (u.startsWith('/') ? u : '/' + u))

function normalizeSite(p) {
  const id = String(p.id || '')
  const files = Array.isArray(p.files)
    ? p.files.filter((f) => f && typeof f.key === 'string').map((f) => ({label: String(f.label || 'PDF'), key: f.key}))
    : []
  const includes = Array.isArray(p.includes) ? p.includes.map(String) : []
  let fulfillment = p.fulfillment
  if (!fulfillment) {
    if (id === 'birthday-wish') fulfillment = 'canva-links'
    else if (files.length || includes.length || BUNDLE_COLLECTION[id]) fulfillment = 'auto'
    else fulfillment = 'manual'
  }
  const imgs = Array.isArray(p.images) && p.images.length ? p.images : p.img ? [p.img] : []
  return {
    id,
    slug: p.slug || slugify(titleOf(p, 'en')),
    title: titleOf(p, 'en'),
    titleFr: titleOf(p, 'fr'),
    price: typeof p.price === 'number' ? p.price : Number(p.price) || 0,
    compareAt: typeof p.compareAt === 'number' ? p.compareAt : null,
    funnelPrice: typeof p.funnelPrice === 'number' ? p.funnelPrice : null,
    hidden: !!p.hidden,
    collection: p.collection !== undefined ? p.collection : guessCollection(id),
    category: p.category || guessCategory(id, p),
    fulfillment,
    files,
    includes,
    productType: 'digital',
    source: 'site',
    images: imgs.map((u) => ({url: absUrl(typeof u === 'string' ? u : u.url)})).filter((i) => i.url),
  }
}

// Read files whose paths Vercel's tracer can see (import.meta.url) and fall
// back to cwd-relative paths. CATALOG_FILE lets tests point at a fixture.
async function readFirst(candidates) {
  for (const c of candidates) {
    try {
      return JSON.parse(await readFile(c, 'utf8'))
    } catch {}
  }
  return null
}

let cache = null
let cacheAt = 0

export async function loadCatalog() {
  if (cache && Date.now() - cacheAt < 60_000) return cache
  let site = []
  const content = await readFirst([
    ...(process.env.CATALOG_FILE ? [process.env.CATALOG_FILE] : []),
    new URL('../content/catalog.json', import.meta.url),
    join(process.cwd(), 'content', 'catalog.json'),
  ])
  const contentList = Array.isArray(content) ? content : Array.isArray(content?.products) ? content.products : null
  if (contentList) {
    site = contentList.filter((p) => p && p.id).map(normalizeSite)
  } else {
    const client = await readFirst([
      new URL('../data/catalog-client.json', import.meta.url),
      join(process.cwd(), 'data', 'catalog-client.json'),
    ])
    if (Array.isArray(client)) site = client.filter((p) => p && p.id).map(normalizeSite)
    else console.error('[catalog] no site catalogue found')
  }
  let legacy = []
  if (!process.env.CATALOG_FILE) {
    const l = await readFirst([
      new URL('../data/products.json', import.meta.url),
      join(process.cwd(), 'data', 'products.json'),
    ])
    legacy = (l && l.products) || []
  }
  if (!site.length && !legacy.length) throw new Error('Catalogue unavailable')
  const taken = new Set(site.map((p) => p.slug))
  cache = [...site, ...legacy.filter((p) => !taken.has(p.slug))]
  cacheAt = Date.now()
  return cache
}

export function _resetCatalogCache() {
  cache = null
}

// Look up by slug (what the cart sends) or by id.
// Slugs that changed; stale carts in localStorage still send the old one.
const SLUG_ALIASES = {'human-body-wonders-all-5-books': 'bundle'}

export function findProduct(catalog, key) {
  if (!key) return null
  const k = SLUG_ALIASES[String(key)] || String(key)
  return catalog.find((p) => p.slug === k) || catalog.find((p) => p.source === 'site' && p.id === k) || null
}

export const siteProducts = (catalog) => catalog.filter((p) => p.source === 'site')

// Can this product be bought through the normal store checkout?
export function isPurchasable(p) {
  if (!p) return false
  if (p.source === 'site') {
    if (p.hidden || FREE_IDS.has(p.id)) return false
    return typeof p.price === 'number' && p.price > 0
  }
  return true // legacy products keep their old behaviour
}

export const storePrice = (p) => (p && typeof p.price === 'number' ? p.price : null)

export function funnelPriceOf(p) {
  if (!p || p.source !== 'site' || FREE_IDS.has(p.id)) return null
  return typeof p.funnelPrice === 'number' && p.funnelPrice > 0 ? p.funnelPrice : null
}

export const toCents = (n) => Math.round(Number(n) * 100)

// The books a product delivers: a bundle expands to its books, anything else
// is itself. Returns site products.
export function expandProduct(catalog, p) {
  if (!p) return []
  if (p.source !== 'site') return [p]
  if (p.files.length) return [p]
  let ids = p.includes
  if (!ids.length && BUNDLE_COLLECTION[p.id]) {
    const col = BUNDLE_COLLECTION[p.id]
    ids = siteProducts(catalog)
      .filter((x) => x.collection === col && x.category === 'book' && x.id !== p.id)
      .map((x) => x.id)
  }
  if (!ids.length) return [p]
  const out = []
  for (const id of ids) {
    const child = findProduct(catalog, id)
    if (child && child.id !== p.id) out.push(...expandProduct(catalog, child))
  }
  return out.length ? out : [p]
}

// [{product, label, key}] for every file a list of products delivers
// (deduplicated by key). Products without files are reported in `missing`.
export function deliverablesFor(catalog, products) {
  const files = []
  const seen = new Set()
  const missing = []
  for (const p of products) {
    if (!p) continue
    if (p.source !== 'site') {
      missing.push(p)
      continue
    }
    const books = expandProduct(catalog, p)
    let found = false
    for (const b of books) {
      for (const f of b.files || []) {
        found = true
        if (seen.has(f.key)) continue
        seen.add(f.key)
        files.push({product: b, parent: p, label: f.label, key: f.key})
      }
    }
    if (!found) missing.push(p)
  }
  return {files, missing}
}

// Kept for any caller that still passes a "v-…" variant id: options no longer
// change the price, so every variant resolves to the product price.
export function resolveSiteVariant(product) {
  return {price: product.price, label: ''}
}
