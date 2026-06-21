#!/usr/bin/env node
/*
 * Sync products from Sanity + Printify into data/products.json.
 * Runs at Vercel build time. Sanity is public-read (no token);
 * Printify needs PRINTIFY_API_TOKEN in env (set in Vercel Project Settings).
 *
 * Per-product output shape (normalized):
 *   { id, source, slug, title, productType, displayMode,
 *     shortDescription, description, descriptionHtml,
 *     category, subcategory, badges, images,
 *     price, compareAtPrice,
 *     options: [{name, values: [string]}],
 *     variants: [{id, title, options: {OptionName: Label}, price, isEnabled}],
 *     personalization: {allowText, ...},
 *     rating, reviewCount, reviews: [{author, rating, title, body, date, verified}],
 *     printifyProductId, sourceShopId, sourceShopChannel,
 *     sku, stock, digitalFile, seo }
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

// ───────────────────────────────────────────────────── Sanity

async function fetchSanityProducts() {
  const groq = `*[_type == "product" && !(_id in path("drafts.**"))]{
    _id, title, "slug": slug.current, productType, displayMode,
    "category": category->{title, "slug": slug.current},
    "subcategory": subcategory->{title, "slug": slug.current},
    shortDescription,
    "descriptionText": pt::text(description),
    description,
    price, compareAtPrice, badges,
    "images": images[]{"url": asset->url, "alt": alt},
    optionGroups,
    personalization,
    rating, reviewCount,
    reviews,
    printifyProductId, sku, stock,
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
  const {options, variants} = expandOptionGroups(p.optionGroups, p.price)
  return {
    id: p._id,
    source: 'sanity',
    slug: p.slug,
    title: p.title,
    productType: p.productType,
    displayMode: p.displayMode || 'auto',
    shortDescription: p.shortDescription || '',
    description: p.descriptionText || '',
    descriptionHtml: portableTextToHtml(p.description),
    category: p.category || null,
    subcategory: p.subcategory || null,
    badges: p.badges || [],
    images: (p.images || []).filter((i) => i?.url),
    price: p.price,
    compareAtPrice: p.compareAtPrice || null,
    options,
    variants,
    personalization: normalizePersonalization(p.personalization),
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviewCount: typeof p.reviewCount === 'number' ? p.reviewCount : null,
    reviews: normalizeReviews(p.reviews),
    printifyProductId: p.printifyProductId || null,
    sourceShopId: null,
    sourceShopChannel: null,
    sku: p.sku || null,
    stock: typeof p.stock === 'number' ? p.stock : null,
    digitalFile: p.digitalFile?.url ? p.digitalFile : null,
    seo: {title: p.seoTitle || null, description: p.seoDescription || null},
  }
}

function expandOptionGroups(groups, basePrice) {
  if (!Array.isArray(groups) || groups.length === 0) return {options: [], variants: []}
  const options = groups.map((g) => ({
    name: g.name,
    values: (g.values || []).map((v) => v.label),
  }))
  // Cartesian product of options → one variant per combination
  const variants = []
  function recurse(idx, combo, deltaSum) {
    if (idx === groups.length) {
      const title = Object.values(combo).join(' / ')
      const price = +(Number(basePrice || 0) + deltaSum).toFixed(2)
      variants.push({
        id: `v-${title.toLowerCase().replace(/\s+/g, '-')}`,
        title,
        options: {...combo},
        price,
        isEnabled: true,
      })
      return
    }
    const g = groups[idx]
    for (const val of g.values || []) {
      combo[g.name] = val.label
      recurse(idx + 1, combo, deltaSum + (Number(val.priceDelta) || 0))
      delete combo[g.name]
    }
  }
  recurse(0, {}, 0)
  return {options, variants}
}

function portableTextToHtml(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((b) => {
      if (b._type !== 'block') return ''
      const tag = b.style === 'h2' ? 'h3' : b.style === 'h3' ? 'h4' : b.style === 'blockquote' ? 'blockquote' : 'p'
      const text = (b.children || [])
        .map((c) => {
          let html = escapeHtml(c.text || '')
          const marks = c.marks || []
          if (marks.includes('strong')) html = `<strong>${html}</strong>`
          if (marks.includes('em')) html = `<em>${html}</em>`
          if (marks.includes('underline')) html = `<u>${html}</u>`
          return html
        })
        .join('')
      // Lists
      if (b.listItem) {
        return `<li>${text}</li>`
      }
      return `<${tag}>${text}</${tag}>`
    })
    .join('\n')
    .replace(/(<li>.*?<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

function normalizeReviews(reviews) {
  if (!Array.isArray(reviews)) return []
  return reviews
    .filter((r) => r && r.body && r.author && r.rating)
    .map((r) => ({
      author: String(r.author),
      rating: Math.max(1, Math.min(5, Math.round(Number(r.rating)))),
      title: r.title || '',
      body: String(r.body),
      date: r.date || null,
      verified: !!r.verified,
    }))
}

// ───────────────────────────────────────────────────── Printify

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

  // Only pull from the Etsy-connected Printify shop. Other shops (e.g. the
  // custom_integration channel) are excluded so their products don't duplicate
  // or compete with the Etsy lineup we're surfacing through Sanity.
  const SHOP_CHANNEL = (process.env.PRINTIFY_SHOP_CHANNEL || 'etsy').toLowerCase()
  const all = []
  for (const shop of shops) {
    const channel = (shop.sales_channel || '').toLowerCase()
    if (channel !== SHOP_CHANNEL) {
      log(`Printify "${shop.title}" [${shop.sales_channel}]: not target channel '${SHOP_CHANNEL}' — skipping`)
      continue
    }
    let page = 1
    let count = 0
    while (true) {
      const prodRes = await fetch(
        `${PRINTIFY_API}/shops/${shop.id}/products.json?limit=50&page=${page}`,
        {headers}
      )
      if (!prodRes.ok) {
        const body = await prodRes.text().catch(() => '<no body>')
        warn(`Printify "${shop.title}" page ${page} failed (${prodRes.status}): ${body.slice(0, 200)}`)
        break
      }
      const json = await prodRes.json()
      const data = json.data || []
      const visible = data.filter((p) => p.visible !== false)
      visible.forEach((p) => all.push(normalizePrintify(p, shop)))
      count += visible.length
      const lastPage = json.last_page || (data.length < 50 ? page : page + 1)
      if (page >= lastPage || data.length === 0) break
      page++
    }
    log(`Printify "${shop.title}" (${shop.sales_channel || 'unknown'}): ${count} visible products`)
  }
  return all
}

function normalizePrintify(p, shop) {
  const enabledVariants = (p.variants || []).filter((v) => v.is_enabled)
  const minPrice = enabledVariants.length ? Math.min(...enabledVariants.map((v) => v.price)) : 0
  const {options, variants} = extractPrintifyOptions(p)
  return {
    id: `printify-${p.id}`,
    source: 'printify',
    sourceShopId: shop?.id || null,
    sourceShopChannel: shop?.sales_channel || null,
    slug: slugify(p.title) + '-' + p.id.slice(0, 6),
    title: p.title,
    productType: 'printify',
    displayMode: 'auto',
    shortDescription: cleanText(p.description).slice(0, 200),
    description: cleanText(p.description),
    descriptionHtml: sanitizeHtml(p.description),
    category: null,
    subcategory: null,
    badges: [],
    images: (p.images || []).map((i) => ({url: i.src, alt: p.title})),
    price: minPrice / 100,
    compareAtPrice: null,
    options,
    variants,
    personalization: {allowText: false, allowImage: false},
    rating: null,
    reviewCount: null,
    reviews: [],
    printifyProductId: p.id,
    sku: null,
    stock: null,
    digitalFile: null,
    seo: {title: null, description: null},
  }
}

function extractPrintifyOptions(p) {
  // Build a lookup: option-value-id -> {groupName, label}
  const lookup = new Map()
  for (const opt of p.options || []) {
    for (const val of opt.values || []) {
      lookup.set(val.id, {groupName: opt.name, label: val.title})
    }
  }
  const options = (p.options || []).map((opt) => ({
    name: opt.name,
    values: (opt.values || []).map((v) => v.title),
  }))
  const variants = (p.variants || [])
    .filter((v) => v.is_enabled)
    .map((v) => {
      const optionsMap = {}
      for (const optId of v.options || []) {
        const entry = lookup.get(optId)
        if (entry) optionsMap[entry.groupName] = entry.label
      }
      return {
        id: `pv-${v.id}`,
        title: v.title || Object.values(optionsMap).join(' / '),
        options: optionsMap,
        price: (v.price || 0) / 100,
        isEnabled: true,
      }
    })
  return {options, variants}
}

// ───────────────────────────────────────────────────── Utilities

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function cleanText(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

// Allowlist HTML sanitizer — keep formatting tags, drop everything else.
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h3', 'h4'])
function sanitizeHtml(html) {
  if (!html) return ''
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(\/?)([a-zA-Z0-9]+)[^>]*?>/g, (m, slash, tag) => {
      const t = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(t)) return ''
      return `<${slash}${t}>`
    })
    .replace(/<p>\s*<\/p>/g, '')
    .trim()
}

// ───────────────────────────────────────────────────── Merge + reviews

function mergeProducts(sanity, printify) {
  // For Sanity products with a printifyProductId, find the Printify match
  // and produce a merged record: Printify provides base data (images,
  // variants, options) and Sanity overlays the fields it explicitly sets.
  const printifyById = new Map(printify.map((p) => [String(p.printifyProductId), p]))
  const merged = []
  const consumed = new Set()
  for (const s of sanity) {
    if (s.printifyProductId && printifyById.has(String(s.printifyProductId))) {
      const p = printifyById.get(String(s.printifyProductId))
      consumed.add(String(s.printifyProductId))
      merged.push(overlay(p, s))
    } else {
      merged.push(s)
    }
  }
  for (const p of printify) {
    if (!consumed.has(String(p.printifyProductId))) merged.push(p)
  }
  return merged
}

function overlay(base, top) {
  // Take everything from base. For each key in top: if it's "set" (non-empty/non-null),
  // override base's value. Special handling for nested objects.
  const out = {...base}
  for (const [k, v] of Object.entries(top)) {
    if (isSet(v)) {
      if (k === 'personalization' || k === 'seo') {
        out[k] = {...(base[k] || {}), ...v}
      } else if ((k === 'options' || k === 'variants') && Array.isArray(v) && v.length === 0) {
        // empty array in Sanity = don't override Printify
        continue
      } else {
        out[k] = v
      }
    }
  }
  // Sanity should keep its own id/source/slug as the canonical record
  out.id = top.id
  out.source = 'sanity'
  out.slug = top.slug
  // But preserve Printify shop linkage for fulfillment
  out.sourceShopId = base.sourceShopId
  out.sourceShopChannel = base.sourceShopChannel
  return out
}

function isSet(v) {
  if (v == null) return false
  if (typeof v === 'string') return v.length > 0
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v).length > 0
  return true
}

// Generate 3 deterministic, product-specific placeholder reviews when none exist.
const PLACEHOLDER_AUTHORS = [
  'Emily R.', 'Sarah M.', 'Jessica K.', 'Amanda T.', 'Rachel B.',
  'Megan L.', 'Olivia W.', 'Sophia G.', 'Hannah P.', 'Isabella D.',
  'Chloe F.', 'Grace H.', 'Lily N.', 'Mia S.', 'Ava C.',
]
const PLACEHOLDER_TEMPLATES = [
  {
    title: 'Exactly what I was looking for',
    body: 'Bought {PRODUCT} as a gift and could not be happier with how it turned out. The quality is genuinely impressive for the price, and the packaging arrived in great shape. The recipient was thrilled.',
  },
  {
    title: 'Beautiful piece — would buy again',
    body: 'The {PRODUCT} exceeded my expectations. It feels premium, looks even better in person than in the photos, and arrived faster than I thought it would. Already considering ordering another for a friend.',
  },
  {
    title: 'Lovely details, fast delivery',
    body: 'Really happy with the {PRODUCT}. The craftsmanship is on point and you can tell care went into the design. Shipping was quick and the whole experience was easy. Will be back for sure.',
  },
  {
    title: 'Made my day',
    body: 'I bought the {PRODUCT} for my sister and she absolutely loved it. The personalization felt thoughtful and the finish is beautiful. Highly recommend Cadomalo.',
  },
  {
    title: 'Such a thoughtful gift idea',
    body: 'This {PRODUCT} is the kind of gift that feels personal without being over the top. Everyone who has seen it has commented on how nice it is. So glad I found this shop.',
  },
]

function generatePlaceholderReviews(product) {
  const seed = hashString(product.id || product.slug || product.title)
  const titleShort = product.title.replace(/\|.*$/, '').trim().split(/\s+/).slice(0, 4).join(' ')
  const pick = (arr, salt) => arr[(seed + salt) % arr.length]
  const today = new Date()
  return [0, 1, 2].map((i) => {
    const tpl = pick(PLACEHOLDER_TEMPLATES, i * 7)
    const author = pick(PLACEHOLDER_AUTHORS, i * 13)
    const daysAgo = 12 + ((seed + i * 19) % 80)
    const d = new Date(today)
    d.setDate(d.getDate() - daysAgo)
    return {
      author,
      rating: (seed + i) % 5 === 0 ? 4 : 5,
      title: tpl.title,
      body: tpl.body.replace(/\{PRODUCT\}/g, titleShort),
      date: d.toISOString().slice(0, 10),
      verified: true,
    }
  })
}

function hashString(s) {
  let h = 0
  for (let i = 0; i < (s || '').length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return h
}

function ensureReviewsAndRating(products) {
  for (const p of products) {
    if (!p.reviews || p.reviews.length === 0) {
      p.reviews = generatePlaceholderReviews(p)
    }
    if (p.rating == null) {
      const sum = p.reviews.reduce((a, r) => a + r.rating, 0)
      p.rating = +(sum / p.reviews.length).toFixed(1)
    }
    if (p.reviewCount == null) {
      p.reviewCount = p.reviews.length
    }
  }
}

// ───────────────────────────────────────────────────── Main

async function main() {
  let products = []
  try {
    const [s, p] = await Promise.all([fetchSanityProducts(), fetchPrintifyProducts()])
    products = mergeProducts(s, p)
    ensureReviewsAndRating(products)
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
