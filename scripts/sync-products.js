#!/usr/bin/env node
/*
 * Sync products from Sanity + Printify into data/products.json.
 * Runs at Vercel build time. Sanity is public-read (no token);
 * Printify needs PRINTIFY_API_TOKEN in env (set in Vercel Project Settings).
 */

import {writeFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

const SANITY_PROJECT_ID = '8ue8kmgn'
const SANITY_DATASET = 'production'
const SANITY_API_VERSION = '2024-02-23'
const PRINTIFY_API = 'https://api.printify.com/v1'
const OUT = 'data/products.json'

const log = (...a) => console.log('[sync]', ...a)
const warn = (...a) => console.warn('[sync]', ...a)

async function fetchSanityProducts() {
  const groq = `*[_type == "product" && !(_id in path("drafts.**"))]{
    _id, title, "slug": slug.current, productType,
    "category": category->{title, "slug": slug.current},
    "subcategory": subcategory->{title, "slug": slug.current},
    shortDescription,
    "description": pt::text(description),
    price, compareAtPrice, badges,
    "images": images[]{"url": asset->url, "alt": alt},
    personalization, printifyProductId, sku, stock,
    "digitalFile": digitalFile.asset->{"url": url, "originalFilename": originalFilename},
    seoTitle, seoDescription
  }`
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(groq)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity fetch failed: ${res.status} ${await res.text()}`)
  const {result} = await res.json()
  log(`Sanity: ${result.length} products`)
  return result.map(normalizeSanity)
}

function normalizeSanity(p) {
  return {
    id: p._id,
    source: 'sanity',
    slug: p.slug,
    title: p.title,
    shortDescription: p.shortDescription || '',
    description: p.description || '',
    category: p.category || null,
    subcategory: p.subcategory || null,
    productType: p.productType,
    price: p.price,
    compareAtPrice: p.compareAtPrice || null,
    badges: p.badges || [],
    images: (p.images || []).filter((i) => i?.url),
    personalization: normalizePersonalization(p.personalization),
    printifyProductId: p.printifyProductId || null,
    sku: p.sku || null,
    stock: typeof p.stock === 'number' ? p.stock : null,
    digitalFile: p.digitalFile?.url ? p.digitalFile : null,
    seo: {title: p.seoTitle || null, description: p.seoDescription || null},
  }
}

function normalizePersonalization(p) {
  if (!p) return {allowText: false, allowImage: false}
  return {
    allowText: !!p.allowText,
    textMaxLength: p.textMaxLength || 20,
    textLabel: p.textLabel || 'Custom text',
    textRequired: !!p.textRequired,
    allowImage: !!p.allowImage,
    imageMaxSizeMB: p.imageMaxSizeMB || 10,
    imageRequired: !!p.imageRequired,
  }
}

async function fetchPrintifyProducts() {
  const token = process.env.PRINTIFY_API_TOKEN
  if (!token) {
    warn('PRINTIFY_API_TOKEN not set — skipping Printify')
    return []
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'cadomalo-website-sync/1.0',
  }
  const shopsRes = await fetch(`${PRINTIFY_API}/shops.json`, {headers})
  if (!shopsRes.ok) {
    warn(`Printify /shops.json failed (${shopsRes.status}) — skipping`)
    return []
  }
  const shops = await shopsRes.json()
  if (!shops.length) {
    warn('Printify: no shops on this account — skipping')
    return []
  }

  // Iterate ALL shops (API channel + Etsy channel + any others). Products
  // from non-API channels are still displayed; orders for them are
  // fulfilled manually via the Printify dashboard for now.
  const all = []
  for (const shop of shops) {
    const prodRes = await fetch(`${PRINTIFY_API}/shops/${shop.id}/products.json?limit=50`, {headers})
    if (!prodRes.ok) {
      const body = await prodRes.text().catch(() => '<no body>')
      warn(`Printify shop "${shop.title}" (id ${shop.id}) failed (${prodRes.status}): ${body.slice(0, 200)}`)
      continue
    }
    const {data} = await prodRes.json()
    const visible = (data || []).filter((p) => p.visible !== false)
    log(`Printify "${shop.title}" (${shop.sales_channel || 'unknown'} channel): ${visible.length} visible products`)
    visible.forEach((p) => all.push(normalizePrintify(p, shop)))
  }
  return all
}

function normalizePrintify(p, shop) {
  const minPrice = Math.min(...(p.variants || []).filter((v) => v.is_enabled).map((v) => v.price)) || 0
  return {
    id: `printify-${p.id}`,
    source: 'printify',
    sourceShopId: shop?.id || null,
    sourceShopChannel: shop?.sales_channel || null,
    slug: slugify(p.title) + '-' + p.id.slice(0, 6),
    title: p.title,
    shortDescription: stripHtml(p.description).slice(0, 200),
    description: stripHtml(p.description),
    category: null,
    subcategory: null,
    productType: 'printify',
    price: minPrice / 100,
    compareAtPrice: null,
    badges: [],
    images: (p.images || []).map((i) => ({url: i.src, alt: p.title})),
    personalization: {allowText: false, allowImage: false},
    printifyProductId: p.id,
    sku: null,
    stock: null,
    digitalFile: null,
    seo: {title: null, description: null},
  }
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function mergeProducts(sanity, printify) {
  // Sanity products that reference a Printify ID overlay (=replace) the
  // Printify entry. Printify products with no Sanity overlay come through as-is.
  const overlaid = new Set(sanity.map((p) => p.printifyProductId).filter(Boolean))
  const printifyKept = printify.filter((p) => !overlaid.has(p.printifyProductId))
  return [...sanity, ...printifyKept]
}

async function main() {
  let products = []
  try {
    const [s, p] = await Promise.all([fetchSanityProducts(), fetchPrintifyProducts()])
    products = mergeProducts(s, p)
  } catch (err) {
    warn('Sync had errors:', err.message)
    if (!products.length) products = []
  }
  await mkdir(dirname(OUT), {recursive: true})
  await writeFile(
    OUT,
    JSON.stringify(
      {generatedAt: new Date().toISOString(), count: products.length, products},
      null,
      2
    )
  )
  log(`Wrote ${products.length} products to ${OUT}`)
}

main().catch((e) => {
  console.error('[sync] fatal:', e)
  process.exit(1)
})
