#!/usr/bin/env node
/*
 * One-shot import: pulls products from the Printify shop connected to Etsy
 * and creates one editable Sanity `product` doc per Printify product.
 *
 * Per-doc shape (intentionally minimal):
 *   title, slug, productType='printify', category, price (frozen at import time),
 *   shortDescription (plain text from Printify), printifyProductId
 *
 * Everything left blank (description, images, variants, options, badges, SEO)
 * flows live from Printify via the existing sync overlay until you fill it in
 * in Sanity Studio.
 *
 * Idempotent: each doc gets a deterministic _id derived from the Printify id,
 * so re-runs skip products already imported.
 *
 * Usage:
 *   PRINTIFY_API_TOKEN=... SANITY_WRITE_TOKEN=... \
 *     node scripts/import-printify-to-sanity.js [--dry-run] [--limit=N] [--shop-channel=etsy] [--undo]
 *
 *   --dry-run        Show what would happen, write nothing
 *   --limit=N        Only create up to N new docs (handy for a test run)
 *   --shop-channel   Override the Printify sales_channel to target (default: etsy)
 *   --undo           Delete every doc this script previously created (matches _id prefix)
 */

const SANITY_PROJECT_ID = '8ue8kmgn'
const SANITY_DATASET = 'production'
const SANITY_API_VERSION = '2024-02-23'
const PRINTIFY_API = 'https://api.printify.com/v1'
const ID_PREFIX = 'printifyImport-'

const args = parseArgs(process.argv.slice(2))
const DRY_RUN = !!args['dry-run']
const UNDO = !!args.undo
const IMAGES_MODE = !!args.images
const FORCE_IMAGES = !!args['force-images']
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity
const SHOP_CHANNEL_HINT = (args['shop-channel'] || 'etsy').toLowerCase()

const PRINTIFY_TOKEN = process.env.PRINTIFY_API_TOKEN
const SANITY_TOKEN = process.env.SANITY_WRITE_TOKEN

const log = (...a) => console.log('[import]', ...a)
const warn = (...a) => console.warn('[import]', ...a)

function parseArgs(argv) {
  const o = {}
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      o[k] = v === undefined ? true : v
    }
  }
  return o
}

function safeSlug(s) {
  return (s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
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

async function sanityQuery(query) {
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: SANITY_TOKEN ? {Authorization: `Bearer ${SANITY_TOKEN}`} : {},
  })
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status} ${await res.text()}`)
  return (await res.json()).result
}

async function sanityMutate(mutations) {
  if (DRY_RUN) {
    log(`DRY RUN — would send ${mutations.length} mutations`)
    return {results: []}
  }
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/data/mutate/${SANITY_DATASET}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SANITY_TOKEN}`,
    },
    body: JSON.stringify({mutations}),
  })
  if (!res.ok) throw new Error(`Sanity mutate failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function ensureImportCategory() {
  const existing = await sanityQuery(`*[_type=="category" && slug.current=="etsy-store"][0]{_id}`)
  if (existing?._id) {
    log(`Using existing category "Etsy Store" (${existing._id})`)
    return existing._id
  }
  const _id = 'category-etsy-store'
  if (DRY_RUN) {
    log(`DRY RUN — would create category "Etsy Store" (_id=${_id})`)
    return _id
  }
  await sanityMutate([
    {
      createOrReplace: {
        _id,
        _type: 'category',
        title: 'Etsy Store',
        slug: {_type: 'slug', current: 'etsy-store'},
        description: 'Products imported from the Etsy-connected Printify shop.',
      },
    },
  ])
  log(`Created category "Etsy Store" (_id=${_id})`)
  return _id
}

async function listPrintifyShops() {
  const res = await fetch(`${PRINTIFY_API}/shops.json`, {
    headers: {Authorization: `Bearer ${PRINTIFY_TOKEN}`, 'User-Agent': 'cadomalo-import/1.0'},
  })
  if (!res.ok) throw new Error(`Printify /shops.json failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function listPrintifyProducts(shopId) {
  const all = []
  let page = 1
  while (true) {
    const res = await fetch(
      `${PRINTIFY_API}/shops/${shopId}/products.json?limit=50&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${PRINTIFY_TOKEN}`,
          'User-Agent': 'cadomalo-import/1.0',
        },
      }
    )
    if (!res.ok) {
      throw new Error(`Printify products page ${page}: ${res.status} ${await res.text()}`)
    }
    const json = await res.json()
    const data = json.data || []
    data.forEach((p) => all.push(p))
    const lastPage = json.last_page || (data.length < 50 ? page : page + 1)
    if (page >= lastPage || data.length === 0) break
    page++
  }
  return all
}

async function undoImport() {
  log('UNDO mode — finding docs to delete')
  const ids =
    (await sanityQuery(
      `*[_type=="product" && string::startsWith(_id, "${ID_PREFIX}")]._id`
    )) || []
  if (!ids.length) {
    log('No imported docs found, nothing to delete')
    return
  }
  log(`Will delete ${ids.length} docs (e.g. ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? '...' : ''})`)
  if (DRY_RUN) {
    log('DRY RUN — no deletions performed')
    return
  }
  // batch deletes 50 at a time
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50)
    await sanityMutate(slice.map((id) => ({delete: {id}})))
    log(`Deleted ${Math.min(i + 50, ids.length)}/${ids.length}`)
  }
  log('Undo complete')
}

function randomKey() {
  return Math.random().toString(36).slice(2, 14)
}

async function uploadImage(srcUrl, filenameHint) {
  const imgRes = await fetch(srcUrl)
  if (!imgRes.ok) throw new Error(`fetch ${srcUrl}: ${imgRes.status}`)
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
  const ext = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
    ? 'webp'
    : contentType.includes('gif')
    ? 'gif'
    : 'jpg'
  const bytes = await imgRes.arrayBuffer()
  const uploadUrl = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VERSION}/assets/images/${SANITY_DATASET}?filename=${encodeURIComponent(
    filenameHint + '.' + ext
  )}`
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Authorization: `Bearer ${SANITY_TOKEN}`,
    },
    body: Buffer.from(bytes),
  })
  if (!res.ok) throw new Error(`Sanity upload: ${res.status} ${await res.text()}`)
  const json = await res.json()
  return json.document._id // 'image-xxxx-WxH-ext'
}

async function importImages() {
  const docs =
    (await sanityQuery(
      `*[_type=="product" && defined(printifyProductId)]{_id, printifyProductId, title, "imageCount": count(images)}`
    )) || []
  log(`${docs.length} Sanity product(s) with printifyProductId`)

  const shops = await listPrintifyShops()
  const etsyShop =
    shops.find((s) => (s.sales_channel || '').toLowerCase() === SHOP_CHANNEL_HINT) ||
    shops.find((s) => (s.title || '').toLowerCase().includes(SHOP_CHANNEL_HINT))
  if (!etsyShop) throw new Error(`No shop with channel=${SHOP_CHANNEL_HINT}`)
  log(`Sourcing images from "${etsyShop.title}" (id=${etsyShop.id})`)

  const products = await listPrintifyProducts(etsyShop.id)
  const byId = new Map(products.map((p) => [p.id, p]))
  log(`Indexed ${products.length} Printify product(s)`)

  let processed = 0
  let skipped = 0
  let uploaded = 0
  let failed = 0
  let noPrintify = 0
  let noImages = 0

  for (const doc of docs) {
    if (doc.imageCount > 0 && !FORCE_IMAGES) {
      skipped++
      continue
    }
    const p = byId.get(doc.printifyProductId)
    if (!p) {
      noPrintify++
      warn(`No Printify product for ${doc._id} (printifyProductId=${doc.printifyProductId})`)
      continue
    }
    const imgs = p.images || []
    if (!imgs.length) {
      noImages++
      continue
    }
    if (processed >= LIMIT) break

    if (DRY_RUN) {
      log(`DRY RUN — would upload ${imgs.length} image(s) for "${p.title}"`)
      processed++
      continue
    }

    const results = await Promise.allSettled(
      imgs.map((img, i) => uploadImage(img.src, `${doc._id}-${i}`))
    )
    const assetIds = []
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        assetIds.push(results[i].value)
        uploaded++
      } else {
        failed++
        warn(`upload failed [${p.title} #${i}]: ${results[i].reason?.message || results[i].reason}`)
      }
    }
    if (!assetIds.length) {
      warn(`No images uploaded for "${p.title}" — leaving doc untouched`)
      continue
    }

    const imagesField = assetIds.map((id) => ({
      _type: 'image',
      _key: randomKey(),
      asset: {_type: 'reference', _ref: id},
      alt: p.title,
    }))
    await sanityMutate([{patch: {id: doc._id, set: {images: imagesField}}}])
    processed++
    log(`[${processed}/${docs.length}] "${p.title}" — ${assetIds.length} image(s) attached`)
  }

  log(
    `Done. processed=${processed}, skipped(already had images)=${skipped}, uploaded=${uploaded}, failed=${failed}, noPrintifyMatch=${noPrintify}, noImagesOnPrintify=${noImages}`
  )
}

async function main() {
  if (!PRINTIFY_TOKEN) throw new Error('PRINTIFY_API_TOKEN env var required')
  if (!SANITY_TOKEN) throw new Error('SANITY_WRITE_TOKEN env var required (with Editor permission)')

  if (UNDO) return undoImport()
  if (IMAGES_MODE) return importImages()

  const shops = await listPrintifyShops()
  log(
    `Found ${shops.length} Printify shop(s): ${shops
      .map((s) => `"${s.title}" [${s.sales_channel}]`)
      .join(', ')}`
  )

  const etsyShop =
    shops.find((s) => (s.sales_channel || '').toLowerCase() === SHOP_CHANNEL_HINT) ||
    shops.find((s) => (s.title || '').toLowerCase().includes(SHOP_CHANNEL_HINT))
  if (!etsyShop) {
    throw new Error(
      `No shop with sales_channel='${SHOP_CHANNEL_HINT}' or title containing '${SHOP_CHANNEL_HINT}'.`
    )
  }
  log(`Importing from "${etsyShop.title}" (id=${etsyShop.id}, channel=${etsyShop.sales_channel})`)

  const products = await listPrintifyProducts(etsyShop.id)
  log(`Printify returned ${products.length} product(s)`)
  const visible = products.filter((p) => p.visible !== false)
  if (visible.length !== products.length) {
    log(`${products.length - visible.length} hidden product(s) skipped`)
  }

  const linked = await sanityQuery(
    `*[_type=="product" && defined(printifyProductId)]{printifyProductId}`
  )
  const existingIds = new Set((linked || []).map((r) => r.printifyProductId).filter(Boolean))
  log(`${existingIds.size} Printify product(s) already linked in Sanity`)

  const categoryId = await ensureImportCategory()

  const toCreate = []
  let skipped = 0
  for (const p of visible) {
    if (existingIds.has(p.id)) {
      skipped++
      continue
    }
    if (toCreate.length >= LIMIT) break

    const enabledVariants = (p.variants || []).filter((v) => v.is_enabled)
    const minCents = enabledVariants.length
      ? Math.min(...enabledVariants.map((v) => v.price || 0))
      : 0
    // schema requires price > 0; fall back to $1 placeholder so import doesn't fail
    const price = Math.max(0.01, +(minCents / 100).toFixed(2)) || 0.01
    const slug = `${safeSlug(p.title)}-${String(p.id).slice(0, 6)}`

    toCreate.push({
      createIfNotExists: {
        _id: `${ID_PREFIX}${p.id}`,
        _type: 'product',
        title: p.title,
        slug: {_type: 'slug', current: slug},
        productType: 'printify',
        displayMode: 'auto',
        category: {_type: 'reference', _ref: categoryId},
        shortDescription: cleanText(p.description).slice(0, 200),
        price,
        printifyProductId: p.id,
      },
    })
  }

  log(`Plan: ${toCreate.length} to create, ${skipped} already linked (skipped)`)
  if (!toCreate.length) {
    log('Nothing to do')
    return
  }

  if (DRY_RUN) {
    log('DRY RUN — would create:')
    toCreate.slice(0, 5).forEach((m) => {
      const c = m.createIfNotExists
      log(`  - "${c.title}"  ($${c.price})  slug=${c.slug.current}`)
    })
    if (toCreate.length > 5) log(`  ... and ${toCreate.length - 5} more`)
    return
  }

  const BATCH = 25
  let done = 0
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const slice = toCreate.slice(i, i + BATCH)
    await sanityMutate(slice)
    done += slice.length
    log(`Created ${done}/${toCreate.length}`)
  }
  log('Import complete')
}

main().catch((e) => {
  console.error('[import] fatal:', e.message)
  process.exit(1)
})
