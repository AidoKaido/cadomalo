#!/usr/bin/env node
/*
 * Cadomalo static page generator.
 *
 * Content files + one chrome partial set -> real static HTML for both
 * languages. Output is plain crawlable markup: no runtime translation,
 * no JS-injected chrome, no hash routing.
 *
 * English lives at the root (preserving existing URLs); French under /fr/.
 * Product and blog pages are emitted as real directories so they resolve
 * without depending on a rewrite. Funnel pages (free sample opt-in, one-time
 * offers, review form) are English-only and noindex.
 *
 * Honesty rules baked in here: product media is only rendered when the file
 * exists on disk (no placeholders, no broken images); reviews are only real,
 * approved review documents (content/reviews.json + Sanity, fetched at build
 * time); no invented ratings, counters or countdowns.
 */
import {readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {renderProductBody, amazonUrl, icon, avg} from './lib/pdp.js'
import {renderBlogIndex, renderPostBody, postSeo, postJsonLd, postProducts} from './lib/blog.js'

const ROOT = process.cwd()
const TPL = join(ROOT, 'templates')
const CONTENT = join(ROOT, 'content')
const SITE_URL = process.env.SITE_URL || 'https://cadomalo.com'
const LANGS = ['en', 'fr']

/* ---------- content ---------------------------------------------------- */
const readJson = (f) => JSON.parse(readFileSync(join(CONTENT, f), 'utf8'))

const deepMerge = (base, extra) => {
  const out = {...base}
  for (const [k, v] of Object.entries(extra || {})) {
    if (k.startsWith('_')) continue
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v
  }
  return out
}

const uiBase = readJson('ui.json')
const uiExtra = readJson('ui-extra.json')
const UI = Object.fromEntries(LANGS.map((l) => [l, deepMerge(uiBase[l], uiExtra[l])]))
const CATALOG = readJson('catalog.json')
const SHOP = CATALOG.filter((p) => !p.hidden)
const byId = (id) => CATALOG.find((p) => p.id === id)
const POSTS = readJson('posts.json')
const LEGAL = readJson('legal.json')
const CATEGORIES = readJson('categories.json')
const ULTIMATE = 'ultimate-human-body'
/* real inside pages: {"<id>": [{src, w, h, alt: {en, fr}}]} — optional, partial is fine */
const PAGE_PREVIEWS = (() => {
  try { return readJson('page-previews.json') } catch { return {} }
})()
const pagesFor = (p) => (Array.isArray(PAGE_PREVIEWS[p.id]) ? PAGE_PREVIEWS[p.id] : [])
  .filter((x) => x && x.src && onDisk(x.src))

/* ---------- media: only what exists on disk --------------------------- */
const onDisk = (url) => !!url && existsSync(join(ROOT, String(url).replace(/^\//, '')))
const listDir = (rel, re) => {
  const dir = join(ROOT, rel)
  return existsSync(dir) ? readdirSync(dir).filter((n) => re.test(n)).sort() : []
}
const assetUrl = (p) => (String(p).startsWith('/') ? String(p) : `/assets/${String(p).replace(/^img\//, '')}`)

const mediaCache = new Map()
function mediaFor(p) {
  if (mediaCache.has(p.id)) return mediaCache.get(p.id)
  /* catalog-listed images that exist, then anything else in the product's folder */
  const listed = (p.images || []).filter(onDisk)
  /* p01.webp… are real inside pages (content/page-previews.json), shown separately */
  const found = listDir(`images/products/${p.id}`, /^(?!p\d+\.)[^.].*\.(webp|png|jpe?g)$/i).map((n) => `/images/products/${p.id}/${n}`)
  const images = [...new Set([...listed, ...found])]
  /* legacy artwork in /assets (original 5 HBW books + HBW bundle) as a fallback */
  if (!images.length && p.img && onDisk(assetUrl(p.img))) images.push(assetUrl(p.img))
  const videoIds = p.id === 'routine-sample' ? ['routine'] : [p.id]
  const videos = [
    ...(p.video && onDisk(p.video) ? [p.video] : []),
    ...videoIds.flatMap((id) => listDir('videos', new RegExp(`^${id}-\\d+\\.mp4$`)).map((n) => `/videos/${n}`)),
  ]
  /* poster: the frame grabbed next to the clip (videos/<id>-n.jpg), else the first image */
  const m = {images, videos: [...new Set(videos)].map((src) => {
    const jpg = src.replace(/.mp4$/, '.jpg')
    return {src, poster: onDisk(jpg) ? jpg : images[0] || ''}
  })}
  mediaCache.set(p.id, m)
  return m
}
const primaryImage = (p) => mediaFor(p).images[0] || ''

/* ---------- reviews: real, approved only -------------------------------- */
/* content/reviews.json: [{product, name, rating, text, verified?, photo?, date?}]
   plus approved review documents from Sanity (type `review`, or the existing
   `reviewSubmission` with status "approved"). Build never fails on Sanity. */
async function loadReviews() {
  const local = readJson('reviews.json')
  const list = Array.isArray(local) ? local.filter((r) => r && r.product && r.text && r.rating) : []
  if (process.env.SKIP_SANITY_REVIEWS === '1') return list
  const projectId = process.env.SANITY_PROJECT_ID || '8ue8kmgn'
  const dataset = process.env.SANITY_DATASET || 'production'
  const groq = `*[_type in ["review","reviewSubmission"] && (approved == true || status == "approved")]{
    "product": coalesce(productId, product, productSlug), "slug": productSlug,
    "name": coalesce(author, name), rating, "text": coalesce(body, text), verified,
    "photo": coalesce(photo.asset->url, photoUrl), "date": coalesce(submittedAt, _createdAt)}`
  const url = `https://${projectId}.apicdn.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(groq)}`
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 6000)
    const headers = process.env.SANITY_READ_TOKEN ? {Authorization: `Bearer ${process.env.SANITY_READ_TOKEN}`} : {}
    const r = await fetch(url, {signal: ctrl.signal, headers})
    clearTimeout(timer)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const {result} = await r.json()
    const remote = (result || []).filter((x) => x && x.product && x.text && x.rating)
    console.log(`[pages] ${remote.length} approved review(s) from Sanity`)
    return [...list, ...remote]
  } catch (err) {
    console.warn(`[pages] reviews: Sanity fetch skipped (${err.message})`)
    return list
  }
}
const REVIEWS = await loadReviews()

/* ---------- routing ---------------------------------------------------- */
const ROUTES = {
  home:        {en: '',            fr: 'fr'},
  shop:        {en: 'shop',        fr: 'fr/boutique'},
  collections: {en: 'collections', fr: 'fr/collections'},
  blog:        {en: 'blog',        fr: 'fr/blog'},
  about:       {en: 'about',       fr: 'fr/a-propos'},
  sale:        {en: 'sale',        fr: 'fr/promotions'},
  contact:     {en: 'contact',     fr: 'fr/contact'},
  cart:        {en: 'cart',        fr: 'fr/panier'},
  /* Stripe success_url — api/create-checkout-session.js builds these paths */
  thanks:      {en: 'order-confirmation', fr: 'fr/confirmation'},
}
/* category landing pages (content/categories.json) */
for (const c of CATEGORIES) ROUTES[`cat:${c.id}`] = c.path
const catUrl = (id, lang) => pathToUrl(ROUTES[`cat:${id}`][lang])
const catById = (id) => CATEGORIES.find((c) => c.id === id)
/* English-only funnel pages (noindex, not in the sitemap) */
const FUNNEL = {
  optin: 'free-routine-sample',
  thankYou: 'thank-you-sample',
  mhOffer: 'offer/medical-heroes',
  review: 'review',
}

/* English legal paths match the live site so no existing URL 404s. */
const LEGAL_SLUGS = {
  'legal-notice': {en: 'legal-notice',   fr: 'fr/mentions-legales'},
  terms:          {en: 'terms',          fr: 'fr/conditions'},
  privacy:        {en: 'privacy-policy', fr: 'fr/confidentialite'},
  refunds:        {en: 'returns',        fr: 'fr/remboursements'},
  cookies:        {en: 'cookie-policy',  fr: 'fr/cookies'},
}

const slugify = (s) =>
  String(s)
    .replace(/œ/g, "oe").replace(/Œ/g, "Oe").replace(/æ/g, "ae")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const productSlug = (p, lang) => slugify(p.title[lang])
const postSlug = (post, lang) => slugify(post.title[lang])
const productPath = (p, lang) =>
  lang === 'fr' ? `fr/produits/${productSlug(p, 'fr')}` : `products/${productSlug(p, 'en')}`
const postPath = (post, lang) =>
  lang === 'fr' ? `fr/blog/${postSlug(post, 'fr')}` : `blog/${postSlug(post, 'en')}`

const pathToUrl = (p) => (p === '' ? '/' : `/${p}`)
const urlFor = (page, lang) => pathToUrl(ROUTES[page][lang])
/* "<title> | Cadomalo", dropping the suffix rather than overflowing ~65 chars */
const pageTitle = (s) => (`${s} | Cadomalo`.length <= 65 ? `${s} | Cadomalo` : s)
/* meta descriptions: ≤155 chars, cut at a word boundary */
const clip = (s, n = 155) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n - 1)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:—–-]+$/, '') + '…'
}
const crumbsLd = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, url], i) => ({'@type': 'ListItem', position: i + 1, name, item: SITE_URL + url})),
})
const legalUrl = (id, lang) => pathToUrl(LEGAL_SLUGS[id][lang])
const productUrl = (p, lang) => pathToUrl(productPath(p, lang))
const postUrl = (post, lang) => pathToUrl(postPath(post, lang))
const reviewUrl = (p) => `/${FUNNEL.review}${p ? `?product=${encodeURIComponent(p.id)}` : ''}`

/* ---------- template engine -------------------------------------------- */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]))

const partialCache = new Map()
const loadPartial = (name) => {
  if (!partialCache.has(name)) {
    partialCache.set(name, readFileSync(join(TPL, '_partials', `${name}.html`), 'utf8'))
  }
  return partialCache.get(name)
}

const lookup = (ctx, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx)

const missing = []
function render(tpl, ctx, where) {
  return tpl
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, n) => render(loadPartial(n), ctx, `partial:${n}`))
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, p) => {
      const v = lookup(ctx, p)
      if (v === undefined) missing.push(`${where} -> {{{${p}}}}`)
      return v ?? ''
    })
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
      const v = lookup(ctx, p)
      if (v === undefined) missing.push(`${where} -> {{${p}}}`)
      return v === undefined ? '' : esc(v)
    })
}

/* ---------- head ------------------------------------------------------- */
function renderHead({title, description, lang, pathEn, pathFr, ogImage, noindex, enOnly, ogType, price}) {
  const self = lang === 'fr' ? pathFr : pathEn
  const canonical = SITE_URL + pathToUrl(self)
  const img = SITE_URL + (ogImage || '/assets/logo-square.png')
  const alternates = enOnly ? '' : `<link rel="alternate" hreflang="en" href="${SITE_URL + pathToUrl(pathEn)}">
  <link rel="alternate" hreflang="fr" href="${SITE_URL + pathToUrl(pathFr)}">
  <link rel="alternate" hreflang="x-default" href="${SITE_URL + pathToUrl(pathEn)}">`
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
  <link rel="canonical" href="${canonical}">
  ${alternates}
  <meta property="og:type" content="${ogType || 'website'}">${price != null ? `
  <meta property="product:price:amount" content="${Number(price).toFixed(2)}">
  <meta property="product:price:currency" content="USD">` : ''}
  <meta property="og:url" content="${canonical}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${img}">
  <meta property="og:locale" content="${lang === 'fr' ? 'fr_FR' : 'en_US'}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#FFF8ED">
  <link rel="icon" href="/assets/logo-mark.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="/css/style.css">`
}

/* ---------- shared context --------------------------------------------- */
function baseContext(lang, activePage, pathEn, pathFr) {
  const t = UI[lang]
  const url = Object.fromEntries(Object.keys(ROUTES).map((p) => [p, urlFor(p, lang)]))
  url.legalCookies = legalUrl('cookies', lang)
  url.legalRefunds = legalUrl('refunds', lang)

  /* Shop ▾ (6 categories + All products + Bundles) · Collections · Blog · About */
  const shopItems = [
    ...CATEGORIES.map((c) => [catUrl(c.id, lang), c.label[lang], `cat:${c.id}`]),
    [urlFor('shop', lang), t.nav.all, 'shop'],
    [urlFor('sale', lang), t.nav.bundles, 'sale'],
  ]
  const shopActive = activePage === 'shop' || activePage === 'sale' || String(activePage).startsWith('cat:')
  const chev = '<svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  const subLinks = shopItems
    .map(([href, label, key]) => `<li><a href="${href}"${key === activePage ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`)
    .join('')
  const navOrder = ['collections', 'blog', 'about']
  const navLinks = `<div class="nav-shop">
        <button type="button" class="nav-shop-btn${shopActive ? ' is-current' : ''}" aria-expanded="false" aria-controls="shop-menu" data-menu-toggle>${esc(t.nav.shop)}${chev}</button>
        <div class="nav-dropdown" id="shop-menu" hidden><ul>${subLinks}</ul></div>
      </div>
      ` + navOrder
    .map((p) => `<a href="${urlFor(p, lang)}"${p === activePage ? ' aria-current="page"' : ''}>${esc(t.nav[p])}</a>`)
    .join('\n      ')
  const navLinksMobile = `<button type="button" class="mobile-sub-toggle" aria-expanded="false" aria-controls="mobile-shop-menu" data-menu-toggle>${esc(t.nav.shop)}${chev}</button>
      <ul class="mobile-sub" id="mobile-shop-menu" hidden>${subLinks}</ul>
      ` + navOrder
    .map((p) => `<a href="${urlFor(p, lang)}">${esc(t.nav[p])}<span class="arrow" aria-hidden="true">&rarr;</span></a>`)
    .join('\n      ')
  const legalLinks = LEGAL.map(
    (d) => `<li><a href="${legalUrl(d.id, lang)}">${esc(d.title[lang])}</a></li>`
  ).join('\n          ')

  /* three trust items under the drawer checkout button */
  const TRUST_ICONS = [
    '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 21h16"/>',
    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    '<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z"/>',
  ]
  const cartTrustRow = (t.cart.trustRow || [])
    .map((label, i) => `<span><svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRUST_ICONS[i] || ''}</svg>${esc(label)}</span>`)
    .join('')

  return {
    lang, t, url, navLinks, navLinksMobile, legalLinks, cartTrustRow,
    urlEn: pathToUrl(pathEn),
    urlFr: pathToUrl(pathFr),
    isEn: String(lang === 'en'),
    isFr: String(lang === 'fr'),
  }
}

/* ---------- page shell -------------------------------------------------- */
function shell({lang, activePage, pathEn, pathFr, title, description, body, ogImage, noindex, jsonLd, enOnly, bodyClass, ogType, price}) {
  const ctx = baseContext(lang, activePage, pathEn, enOnly ? ROUTES.home.fr : pathFr)
  const head = renderHead({title, description: clip(description), lang, pathEn, pathFr, ogImage, noindex, enOnly, ogType, price})
  const lds = [].concat(jsonLd || [])
  const ld = lds.map((j) => `\n  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join('')
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  ${head}${ld}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
  {{> header }}
  <main id="main">
${body}
  </main>
  {{> footer }}
  {{> cookie-banner }}
  {{> cart-drawer }}
  <script src="/js/pixels.js"></script>
  <script src="/js/main.js"></script>
  <script src="/js/cart.js"></script>
</body>
</html>
`
  return render(html, ctx, `${activePage}.${lang}`)
}

/* ---------- product helpers -------------------------------------------- */
const money = (n) => `$${Number(n).toFixed(2)}`
const coverAlt = (p, lang) => (p.category === 'bundle'
  ? (lang === 'fr' ? `Couvertures : ${p.title.fr}` : `Covers: ${p.title.en}`)
  : (lang === 'fr' ? `Couverture de ${p.title.fr}` : `Cover of ${p.title.en}`))
const badgeClass = (tone) =>
  tone === 'solid' ? 'badge badge-solid' : tone === 'sky' ? 'badge badge-sky' : 'badge badge-soft'
const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r))
const reviewsFor = (p) => REVIEWS.filter((r) => r.product === p.id || r.product === productSlug(p, 'en') || r.slug === productSlug(p, 'en'))

/* a product card; never references an image that isn't on disk */
function renderCard(p, lang, t, {amazonSlot = false} = {}) {
  const href = productUrl(p, lang)
  const amazon = amazonUrl(p, lang)
  const amazonBtn = amazon
    ? `<a class="btn btn-quiet btn-full" href="${esc(amazon)}" target="_blank" rel="noopener">${esc(t.product.amazon)}</a>`
    : amazonSlot ? `<span class="btn btn-full card-slot" aria-hidden="true"></span>` : ''
  const badge = p.badge ? `<span class="${badgeClass(p.badgeTone)}">${esc(p.badge[lang])}</span>` : ''
  const was = p.compareAt ? `<del>${money(p.compareAt)}</del>` : ''
  const img = primaryImage(p)
  const media = img
    ? `<img src="${img}" alt="${esc(coverAlt(p, lang))}" width="600" height="600" loading="lazy">`
    : `<span class="card-cover" style="--tile:${p.color}"><span>${esc(p.series[lang])}</span><strong>${esc(p.title[lang])}</strong><em>${esc(t.shop2.cover)}</em></span>`
  const rs = reviewsFor(p)
  const rating = rs.length
    ? `<p class="rating"><span class="stars" aria-hidden="true">${stars(avg(rs))}</span> <span>${avg(rs).toFixed(1)} (${rs.length})</span></p>`
    : ''
  return `<article class="card" data-type="${p.category}">
          <a class="card-media" href="${href}" tabindex="-1">
            ${badge}${media}
          </a>
          <div class="card-body">
            <p class="card-series">${esc(p.series[lang])}</p>
            <h3 class="card-title"><a href="${href}">${esc(p.title[lang])}</a></h3>
            ${rating}
            <p class="card-price">${money(p.price)} ${was}</p>
            <p class="card-langs">${esc(p.langs)}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-full" data-add="${p.id}">${esc(t.product.add)}</button>
            ${amazonBtn}
          </div>
        </article>`
}

/* once any card in a grid links to Amazon, every card in it reserves the
   second button slot so Add to basket lines up across a row */
const cards = (items, lang, t) => {
  const amazonSlot = items.some((p) => amazonUrl(p, lang))
  return items.map((p) => renderCard(p, lang, t, {amazonSlot})).join('\n          ')
}
const grid = (items, lang, t) => `<div class="grid-products">${cards(items, lang, t)}</div>`

const series = (c) => SHOP.filter((p) => p.collection === c && p.category === 'book')
const bundleOf = (c) => SHOP.find((p) => p.collection === c && p.category === 'bundle' && p.id !== ULTIMATE)
const KITS = SHOP.filter((p) => p.category === 'kit' || p.category === 'party')

/* honest review section used on home + collections */
function reviewsSection(lang, t) {
  const rs = [...REVIEWS].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 3)
  const inner = rs.length
    ? `<div class="review-row">${rs.map((r) => `<figure class="review-card">
            <p class="rating"><span class="stars" aria-label="${r.rating}/5">${stars(r.rating)}</span></p>
            <blockquote>${esc(r.text)}</blockquote>
            <figcaption>${esc(r.name)}${r.verified ? ` · ${esc(t.product.verified)}` : ''}</figcaption></figure>`).join('\n          ')}</div>`
    : `<p class="review-invite-note">${esc(t.home2.noReviews)}</p>
        <p><a class="btn btn-secondary" href="${reviewUrl()}">${esc(t.pdp2.reviewsEmptyCta)}</a></p>`
  return `<section class="section">
      <div class="wrap center">
        <p class="eyebrow">${esc(t.reviews.kicker)}</p>
        <h2>${esc(t.reviews.h)}</h2>
        <p class="lead" style="margin-inline:auto">${esc(t.reviews.p)}</p>
        ${inner}
      </div>
    </section>`
}

/* ---------- builders ---------------------------------------------------- */
const out = []
const add = (path, html) => out.push({path, html})

/* the free-sample opt-in form: one markup for /free-routine-sample and the
   home page; js/main.js initOptin() handles both (POST /api/lead) */
function optinForm(lang, id = 'optin-email') {
  const H = UI[lang].home3
  return `<form class="optin-form" data-optin-form novalidate data-msg-invalid="${esc(H.optinInvalid)}" data-msg-tick="${esc(H.optinTick)}" data-msg-sending="${esc(H.optinSending)}" data-msg-error="${esc(H.optinError)}">
            <label for="${id}">${esc(H.optinLabel)}</label>
            <div class="optin-row">
              <input id="${id}" name="email" type="email" required autocomplete="email" placeholder="${esc(H.optinPh)}">
              <button type="submit" class="btn btn-primary btn-lg">${esc(H.optinCta)}</button>
            </div>
            <label class="consent-row">
              <input type="checkbox" name="consent" required>
              <span>${esc(H.optinConsent)} <a href="${legalUrl('privacy', lang)}">${esc(H.optinPrivacy)}</a>.</span>
            </label>
            <input type="text" name="website" tabindex="-1" autocomplete="off" class="visually-hidden" aria-hidden="true">
            <p class="form-status" data-optin-status role="status"></p>
          </form>`
}

const latestPosts = (n) => [...POSTS]
  .sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')))
  .slice(0, n)

const faqHtml = (faq) => faq.map((o, i) => `<details class="faq-item"${i === 0 ? ' open' : ''}>
            <summary><span>${esc(o.q)}</span>${icon('chevron', 20)}</summary>
            <p>${esc(o.a)}</p>
          </details>`).join('\n          ')
const faqLdOf = (faq) => ({
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faq.map((o) => ({'@type': 'Question', name: o.q, acceptedAnswer: {'@type': 'Answer', text: o.a}})),
})

function bundleCard(b, lang, t) {
  const img = primaryImage(b)
  return `<article class="bundle-feature" style="--tile:${b.color}">
            ${img ? `<a href="${productUrl(b, lang)}" tabindex="-1"><img src="${img}" alt="${esc(coverAlt(b, lang))}" width="520" height="520" loading="lazy"></a>` : ''}
            <div>
              <p class="eyebrow">${esc(b.series[lang])}</p>
              <h3><a href="${productUrl(b, lang)}">${esc(b.title[lang])}</a></h3>
              <p>${esc(b.desc[lang])}</p>
              <p class="card-price">${money(b.price)}${b.compareAt ? ` <del>${money(b.compareAt)}</del>` : ''}</p>
              <p class="hero-ctas">
                <button type="button" class="btn btn-primary" data-add="${b.id}">${esc(t.product.add)}</button>
                <a class="btn btn-quiet" href="${productUrl(b, lang)}">${esc(t.shop2.seeCollection)}</a>
              </p>
            </div>
          </article>`
}

function buildHome(lang) {
  const t = UI[lang]
  const H = t.home3
  const ctx = baseContext(lang, 'home', ROUTES.home.en, ROUTES.home.fr)
  const routine = byId('routine')
  const picks = ['discovery-lab', 'routine', 'wonder-island', 'birthday-wish', 'head', 'bones', 'mh01', 'mh07']
    .map(byId).filter((p) => p && !p.hidden)
  const catLabel = (id) => catById(id).label[lang]

  Object.assign(ctx, {
    heroImg: '/images/home/hero-sample.webp',
    optinUrl: `/${FUNNEL.optin}`,
    trustStrip: H.trust.map((x) => `<li>${icon('check', 16)}<span>${esc(x)}</span></li>`).join(''),
    catTiles: CATEGORIES.map((c) => {
      const img = primaryImage(byId(c.tile))
      return `<li><a class="cat-tile" href="${catUrl(c.id, lang)}">
            ${img ? `<img src="${img}" alt="" width="320" height="320" loading="lazy">` : ''}
            <span class="cat-tile-body"><strong>${esc(c.label[lang])}</strong><span>${esc(c.short[lang])}</span></span></a></li>`
    }).join('\n          '),
    bundleFeatures: ['bundle', 'mh-bundle', ULTIMATE].map(byId).filter((b) => b && !b.hidden).map((b) => bundleCard(b, lang, t)).join('\n          '),
    routineUrl: productUrl(routine, lang),
    routineImg: primaryImage(routine),
    routineAlt: coverAlt(routine, lang),
    optinForm: optinForm(lang, 'home-optin-email'),
    pickCards: cards(picks, lang, t),
    ageTiles: H.ages.map((a) => `<div class="age-tile">
            <h3>${esc(a.h)}</h3><p>${esc(a.p)}</p>
            <p class="age-links">${a.links.map((id) => `<a href="${catUrl(id, lang)}">${esc(catLabel(id))}</a>`).join('')}</p>
          </div>`).join('\n          '),
    reviewsBlock: reviewsSection(lang, t),
    founderAlt: lang === 'fr' ? 'Illustration : un livre ouvert entouré des drapeaux anglais, français, allemand et espagnol' : 'Illustration: an open book with the English, French, German and Spanish flags',
    blogCards: latestPosts(3).map((post) => postCard(post, lang, t)).join('\n          '),
    faqItems: faqHtml(H.faq),
  })

  const body = render(readFileSync(join(TPL, 'home.html'), 'utf8'), ctx, `home.${lang}`)
  add(ROUTES.home[lang], shell({
    lang, activePage: 'home', pathEn: ROUTES.home.en, pathFr: ROUTES.home.fr,
    title: pageTitle(H.title), description: H.description, body,
    ogImage: primaryImage(byId('bundle')) || undefined,
    jsonLd: [
      {
        '@context': 'https://schema.org', '@type': 'Organization', name: 'Cadomalo',
        url: SITE_URL, logo: `${SITE_URL}/assets/logo-square.png`,
        description: H.description, email: 'support@cadomalo.com',
        sameAs: ['https://www.etsy.com/shop/CadomaloShop'],
      },
      {
        '@context': 'https://schema.org', '@type': 'WebSite', name: 'Cadomalo',
        url: SITE_URL + urlFor('home', lang), inLanguage: lang,
        publisher: {'@type': 'Organization', name: 'Cadomalo'},
      },
      faqLdOf(H.faq),
    ],
  }))
}

function buildShop(lang) {
  const t = UI[lang]
  /* category links (they used to be client-side filter chips) */
  const chips = [
    `<a class="chip is-active" href="${urlFor('shop', lang)}" aria-current="page">${esc(t.nav.all)}</a>`,
    ...CATEGORIES.map((c) => `<a class="chip" href="${catUrl(c.id, lang)}">${esc(c.label[lang])}</a>`),
    `<a class="chip" href="${urlFor('sale', lang)}">${esc(t.nav.bundles)}</a>`,
  ].join('\n          ')
  const section = (id, h, p, items, link) => `<section class="shop-section" id="${id}" data-shop-section>
          <div class="shop-section-head">
            <div><h2>${esc(h)}</h2><p>${esc(p)}</p></div>
            ${link ? `<a class="btn btn-quiet btn-sm" href="${link}">${esc(t.shop2.seeCollection)}</a>` : ''}
          </div>
          ${grid(items, lang, t)}
        </section>`
  const body = `    <nav class="breadcrumb wrap" aria-label="Breadcrumb">
      <a href="${urlFor('home', lang)}">${esc(t.product.home)}</a> <span aria-hidden="true">/</span>
      <span>${esc(t.shop.title)}</span>
    </nav>
    <section class="section section-tight">
      <div class="wrap">
        <h1>${esc(t.shop.title)}</h1>
        <p class="lead">${esc(t.shop.p)}</p>
        <nav class="filter-row" aria-label="${esc(t.nav.shop)}">
          ${chips}
          <span class="filter-count">${SHOP.length} ${esc(t.shop.count)}</span>
        </nav>
        ${section('hbw', t.shop2.hbwH, t.shop2.hbwP, [bundleOf('hbw'), byId(ULTIMATE), ...series('hbw')].filter((p) => p && !p.hidden), `${urlFor('collections', lang)}#hbw`)}
        ${section('mh', t.shop2.mhH, t.shop2.mhP, [bundleOf('mh'), ...series('mh')].filter(Boolean), `${urlFor('collections', lang)}#mh`)}
        ${section('kits', t.shop2.kitsH, t.shop2.kitsP, KITS, '')}
      </div>
    </section>`
  add(ROUTES.shop[lang], shell({
    lang, activePage: 'shop', pathEn: ROUTES.shop.en, pathFr: ROUTES.shop.fr,
    title: pageTitle(lang === 'fr' ? 'Livres et activités à imprimer pour enfants' : 'Shop Kids’ Books & Printable Activities'),
    description: t.shop.p, body,
    jsonLd: crumbsLd([[t.product.home, urlFor('home', lang)], [t.shop.title, urlFor('shop', lang)]]),
  }))
}

/* ---------- category landing pages -------------------------------------- */
function buildCategory(c, lang) {
  const t = UI[lang]
  const C = t.cat
  const key = `cat:${c.id}`
  const self = catUrl(c.id, lang)
  const sections = c.sections
    ? c.sections.map(({collection}) => {
        const b = bundleOf(collection)
        const h = collection === 'hbw' ? t.shop2.hbwH : t.shop2.mhH
        const p = collection === 'hbw' ? t.shop2.hbwP : t.shop2.mhP
        return `<section class="shop-section" id="${collection}">
          <div class="shop-section-head">
            <div><h2>${esc(h)}</h2><p>${esc(p)}</p></div>
            <a class="btn btn-quiet btn-sm" href="${urlFor('collections', lang)}#${collection}">${esc(t.shop2.seeCollection)}</a>
          </div>
          ${grid([b, ...series(collection)].filter(Boolean), lang, t)}
        </section>`
      }).join('\n        ')
    : `<div class="cat-products">${grid((c.products || []).map(byId).filter((p) => p && !p.hidden), lang, t)}</div>`
  const featured = (c.featured || []).map(byId).filter((p) => p && !p.hidden)
  const featuredBlock = featured.length
    ? `<div class="bundle-features cat-featured">${featured.map((b) => bundleCard(b, lang, t)).join('')}</div>`
    : ''
  const also = (c.also || []).map(byId).filter((p) => p && !p.hidden)
  const alsoBlock = also.length ? `<section class="section band-blush">
      <div class="wrap">
        <h2>${esc(C.alsoH)}</h2>
        ${grid(also, lang, t)}
      </div>
    </section>` : ''
  const ids = new Set([...(c.products || []), ...featured.map((p) => p.id), ...(c.sections ? SHOP.filter((p) => c.sections.some((s) => s.collection === p.collection)).map((p) => p.id) : [])])
  const posts = POSTS.filter((post) => postProducts(post).some((id) => ids.has(id))).slice(0, 3)
  const postsBlock = posts.length ? `<section class="section band-butter">
      <div class="wrap">
        <h2>${esc(C.postsH)}</h2>
        <div class="grid-products" style="margin-top:var(--space-6)">${posts.map((post) => postCard(post, lang, t)).join('\n          ')}</div>
      </div>
    </section>` : ''
  const how = C.how[c.how] || C.how.kit
  const faq = c.faq[lang] || []
  const related = (c.related || []).map(catById).filter(Boolean)

  const body = `    <nav class="breadcrumb wrap" aria-label="Breadcrumb">
      <a href="${urlFor('home', lang)}">${esc(t.product.home)}</a> <span aria-hidden="true">/</span>
      <a href="${urlFor('shop', lang)}">${esc(t.product.shop)}</a> <span aria-hidden="true">/</span>
      <span>${esc(c.label[lang])}</span>
    </nav>
    <section class="section section-tight">
      <div class="wrap">
        <div class="cat-intro">
          <p class="eyebrow">${esc(C.kicker)}</p>
          <h1>${esc(c.h1[lang])}</h1>
          ${c.intro[lang].map((p, i) => `<p${i === 0 ? ' class="lead"' : ''}>${esc(p)}</p>`).join('\n          ')}
        </div>
        ${featuredBlock}
        ${sections}
      </div>
    </section>
    ${alsoBlock}
    <section class="section band-mint">
      <div class="wrap center">
        <h2>${esc(C.howH)}</h2>
        <ol class="method-row">${how.map(([h, p], i) => `<li class="method-step"><span class="method-n">${i + 1}</span>
            <h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join('\n          ')}</ol>
      </div>
    </section>
    <section class="section" id="faq">
      <div class="wrap-narrow">
        <h2>${esc(C.faqH)}</h2>
        <div class="faq-list">${faqHtml(faq)}</div>
      </div>
    </section>
    ${postsBlock}
    <section class="section">
      <div class="wrap center">
        <h2>${esc(C.relatedH)}</h2>
        <p class="cat-related">${related.map((r) => `<a class="chip" href="${catUrl(r.id, lang)}">${esc(r.label[lang])}</a>`).join('')}
          <a class="chip" href="${urlFor('shop', lang)}">${esc(C.allLink)}</a></p>
      </div>
    </section>`
  add(c.path[lang], shell({
    lang, activePage: key, pathEn: c.path.en, pathFr: c.path.fr,
    title: pageTitle(c.title[lang]), description: c.description[lang], body,
    ogImage: primaryImage(byId(c.tile)) || undefined,
    jsonLd: [
      crumbsLd([[t.product.home, urlFor('home', lang)], [t.product.shop, urlFor('shop', lang)], [c.label[lang], self]]),
      ...(faq.length ? [faqLdOf(faq)] : []),
    ],
  }))
}

function buildCollections(lang) {
  const t = UI[lang]
  const block = (c, h, p, band) => {
    const b = bundleOf(c)
    const books = series(c)
    const img = b ? primaryImage(b) : ''
    return `<section class="section${band ? ` ${band}` : ''}" id="${c}">
      <div class="wrap">
        <div class="collection-head">
          ${img ? `<img src="${img}" alt="${esc(coverAlt(b, lang))}" width="420" height="420" loading="lazy">` : ''}
          <div>
            <p class="eyebrow">${esc(t.cols.eyebrow.replace(/^2 collections · /, ''))} · ${books.length} ${esc(t.shop.count)}</p>
            <h2>${esc(h)}</h2>
            <p class="lead">${esc(p)}</p>
            ${b ? `<p class="card-price">${money(b.price)} <del>${money(b.compareAt)}</del></p>
            <p class="hero-ctas">
              <button type="button" class="btn btn-primary" data-add="${b.id}">${esc(t.cols.cta)}</button>
              <a class="btn btn-quiet" href="${productUrl(b, lang)}">${esc(t.shop2.seeCollection)}</a>
            </p>` : ''}
          </div>
        </div>
        <h3 class="collection-sub">${esc(t.cols.inside)}</h3>
        ${grid(books, lang, t)}
      </div>
    </section>`
  }
  const body = `    <section class="section">
      <div class="wrap center">
        <p class="eyebrow">${esc(t.cols.eyebrow)}</p>
        <h1>${esc(t.cols.h)}</h1>
        <p class="lead" style="margin-inline:auto">${esc(t.cols.p)}</p>
        <ul class="fact-pills">${t.cols.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="hero-ctas" style="justify-content:center">
          <a class="btn btn-primary" href="#hbw">${esc(t.shop2.hbwH)}</a>
          <a class="btn btn-primary" href="#mh">${esc(t.shop2.mhH)}</a>
        </p>
      </div>
    </section>

    ${block('hbw', t.shop2.hbwH, t.shop2.hbwP, 'band-peach')}
    ${block('mh', t.shop2.mhH, t.shop2.mhP, 'band-mint')}

    <section class="section">
      <div class="wrap center">
        <h2>${esc(t.cols.nextH)}</h2>
        <p class="lead" style="margin-inline:auto">${esc(t.cols.nextP)}</p>
        <div class="method-row" style="margin-top:var(--space-8)">
          ${t.cols.next.map((n) => `<div class="method-step">
            <span class="badge badge-sky" style="position:static;display:inline-block">${esc(t.cols.soon)}</span>
            <h3 style="margin-top:var(--space-3)">${esc(n.h)}</h3><p>${esc(n.p)}</p></div>`).join('\n          ')}
        </div>
      </div>
    </section>`
  const og = primaryImage(byId('bundle'))
  add(ROUTES.collections[lang], shell({
    lang, activePage: 'collections', pathEn: ROUTES.collections.en, pathFr: ROUTES.collections.fr,
    title: pageTitle(lang === 'fr' ? 'Collections de livres pour enfants en 4 langues' : 'Picture Book Collections for Kids in 4 Languages'), description: t.cols.p, body, ogImage: og || undefined,
  }))
}

function buildSale(lang) {
  const t = UI[lang]
  const reduced = SHOP.filter((p) => p.compareAt)
  const body = `    <section class="section band-blush">
      <div class="wrap center">
        <p class="eyebrow">${esc(t.sale.eyebrow)}</p>
        <h1 class="hero-title"><span>${esc(t.sale.h1)}</span><span class="accent">${esc(t.sale.h2)}</span></h1>
        <p class="lead" style="margin-inline:auto">${esc(t.sale.p)}</p>
        <p class="sale-stack">${esc(t.sale.stack)}</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap">${grid(reduced, lang, t)}</div>
    </section>`
  add(ROUTES.sale[lang], shell({
    lang, activePage: 'sale', pathEn: ROUTES.sale.en, pathFr: ROUTES.sale.fr,
    title: pageTitle(lang === 'fr' ? 'Coffrets de livres pour enfants à prix réduit' : 'Kids’ Book Bundles & Collection Savings'), description: t.sale.p, body,
  }))
}

function buildAbout(lang) {
  const t = UI[lang]
  const A = t.about
  const makeLinks = CATEGORIES.map((c) => `<a class="chip" href="${catUrl(c.id, lang)}">${esc(c.label[lang])}</a>`).join('')
  const body = `    <section class="section">
      <div class="wrap-narrow">
        <p class="eyebrow">${esc(A.eyebrow)}</p>
        <h1 class="hero-title"><span>${esc(A.h1)}</span><span class="accent">${esc(A.h2)}</span></h1>
        <p class="lead">${esc(A.intro)}</p>
      </div>
    </section>
    <section class="section band-mint">
      <div class="wrap-narrow prose">
        <h2>${esc(A.storyH)}</h2>
        ${A.story.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
        <p class="signature">${esc(A.sign)}</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap-narrow prose">
        <h2>${esc(A.whyH)}</h2>
        ${A.why.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
      </div>
    </section>
    <section class="section band-sky">
      <div class="wrap">
        <h2 class="center">${esc(A.approachH)}</h2>
        <div class="method-row" style="margin-top:var(--space-8)">
          ${A.approach.map((v) => `<div class="method-step"><h3>${esc(v.h)}</h3><p>${esc(v.p)}</p></div>`).join('\n          ')}
        </div>
      </div>
    </section>
    <section class="section">
      <div class="wrap-narrow center">
        <h2>${esc(A.makeH)}</h2>
        <p class="lead" style="margin-inline:auto">${esc(A.makeP)}</p>
        <p class="cat-related">${makeLinks}</p>
      </div>
    </section>
    <section class="section band-butter">
      <div class="wrap-narrow center">
        <h2>${esc(A.etsyH)}</h2>
        <p class="lead" style="margin-inline:auto">${esc(A.etsyP)}</p>
        <p><a class="btn btn-secondary" href="https://www.etsy.com/shop/CadomaloShop" target="_blank" rel="noopener">${esc(A.etsyCta)}</a></p>
      </div>
    </section>`
  add(ROUTES.about[lang], shell({
    lang, activePage: 'about', pathEn: ROUTES.about.en, pathFr: ROUTES.about.fr,
    title: pageTitle(lang === 'fr' ? 'À propos — livres créés par une sage-femme' : 'About Cadomalo — Books Created by a Midwife'),
    description: A.intro, body,
  }))
}

const postCard = (post, lang, t) => `<article class="card">
            <a class="card-media" href="${postUrl(post, lang)}" tabindex="-1">
              <img src="${assetUrl(post.img)}" alt="${esc((post.imgAlt && post.imgAlt[lang]) || post.title[lang])}" width="600" height="600" loading="lazy"></a>
            <div class="card-body">
              <p class="card-series">${esc(post.cat[lang])} · ${post.min} ${esc(t.blog.min)}</p>
              <h3 class="card-title"><a href="${postUrl(post, lang)}">${esc(post.title[lang])}</a></h3>
              <p>${esc(post.excerpt[lang])}</p></div></article>`

/* blog.js renders the bundle promo with assetUrl(bundle.img); hand it the
   resolved on-disk image */
const blogBundle = () => {
  const b = byId('bundle')
  return {...b, img: primaryImage(b) || '/assets/bundle-cover.png'}
}

function buildBlogIndex(lang) {
  const t = UI[lang]
  const body = renderBlogIndex(POSTS, lang, t, {
    esc, postUrl, assetUrl, urlFor, productUrl, money, bundle: blogBundle(),
  })
  add(ROUTES.blog[lang], shell({
    lang, activePage: 'blog', pathEn: ROUTES.blog.en, pathFr: ROUTES.blog.fr,
    title: pageTitle(lang === 'fr' ? 'Blog : idées pour enfants curieux' : 'Blog: Ideas for Curious Kids and Their Parents'), description: t.blog.p, body,
    ogImage: assetUrl(POSTS[0].img),
  }))
}

function buildPost(post, lang) {
  const t = UI[lang]
  const related = SHOP.find((p) => p.id === post.product)
  const body = renderPostBody(post, lang, t, {
    esc, postUrl, assetUrl, urlFor, siteUrl: SITE_URL,
    relatedCard: related ? renderCard(related, lang, t) : '',
    renderCard, productById: (id) => SHOP.find((p) => p.id === id), productUrl, primaryImage, money,
  })
  const seo = postSeo(post, lang)
  add(postPath(post, lang), shell({
    lang, activePage: 'blog', pathEn: postPath(post, 'en'), pathFr: postPath(post, 'fr'),
    title: /Cadomalo/.test(seo.title) ? seo.title : pageTitle(seo.title), description: seo.description, body,
    ogImage: assetUrl(post.img), ogType: 'article',
    jsonLd: postJsonLd(post, lang, {siteUrl: SITE_URL, postUrl, assetUrl}),
  }))
}

/* "Complete the collection": HBW books -> their 10-book bundle + the Ultimate
   pack + siblings; MH books -> bundle + siblings; Discovery Lab and the HBW
   bundle -> the Ultimate pack; other bundles/kits -> related products */
const ULT_COPY = {
  en: {h: 'Make it the Ultimate pack', fromLab: 'This kit plus all 10 Human Body Wonders books for', fromBundle: 'Add the Discovery Lab science kit — all 11 for'},
  fr: {h: 'Passez au pack ultime', fromLab: 'Ce kit et les 10 livres Merveilles du corps pour', fromBundle: 'Ajoutez le labo de découverte — les 11 pour'},
}
function completeFor(p, lang, t) {
  const T = t.pdp2
  const U = ULT_COPY[lang]
  const ult = byId(ULTIMATE)
  const ultOffer = (lead) => (ult && !ult.hidden ? {p: ult, image: primaryImage(ult), lead} : null)
  const visible = (xs) => xs.filter((x) => x && !x.hidden && x.id !== p.id)
  if (p.category === 'book' && p.collection) {
    const b = bundleOf(p.collection)
    const sib = series(p.collection).filter((x) => x.id !== p.id)
    const i = sib.findIndex((x) => x.id > p.id)
    const pick = [...sib.slice(Math.max(0, i)), ...sib].slice(0, 4)
    const items = p.collection === 'hbw' ? visible([ult, ...pick]).slice(0, 4) : pick
    return {heading: T.completeH, bundle: b ? {p: b, image: primaryImage(b)} : null, cards: cards(items, lang, t)}
  }
  if (p.id === 'discovery-lab') {
    return {heading: U.h, bundle: ultOffer(U.fromLab), cards: cards(visible([byId('bundle'), byId('routine'), byId('wonder-island')]), lang, t)}
  }
  if (p.id === 'bundle') {
    return {heading: U.h, bundle: ultOffer(U.fromBundle), cards: cards(visible([byId('mh-bundle'), byId('discovery-lab'), byId('routine')]), lang, t)}
  }
  if (p.category === 'bundle') {
    const items = visible([byId('bundle'), byId('mh-bundle'), byId(ULTIMATE), byId('discovery-lab'), byId('routine')]).slice(0, 3)
    return {heading: T.relatedKits, bundle: null, cards: cards(items, lang, t)}
  }
  const items = KITS.filter((x) => x.id !== p.id).slice(0, 4)
  return {heading: T.relatedKits, bundle: null, cards: cards(items, lang, t)}
}

/* the category page a product belongs to (for breadcrumbs) */
const categoryOf = (p) =>
  CATEGORIES.find((c) => (c.featured || []).includes(p.id)) ||
  CATEGORIES.find((c) => (c.products || []).includes(p.id)) ||
  (p.collection ? catById('books') : null)

function buildProduct(p, lang) {
  const t = UI[lang]
  const media = mediaFor(p)
  const reviews = reviewsFor(p)
  const cat = categoryOf(p)
  const pages = pagesFor(p).map((x) => ({src: x.src, w: x.w || 1600, h: x.h || 1600,
    alt: (x.alt && (x.alt[lang] || x.alt.en)) || `${lang === 'fr' ? 'Page intérieure' : 'Inside page'} — ${p.title[lang]}`}))
  const body = renderProductBody(p, lang, t, {
    esc, money, stars, badgeClass, urlFor, productUrl, media, reviews, pages,
    complete: completeFor(p, lang, t),
    reviewUrl: reviewUrl(p),
    coverAlt: coverAlt(p, lang),
    crumb: cat ? {label: cat.label[lang], url: catUrl(cat.id, lang)} : null,
  })
  const productLd = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: p.title[lang], description: p.desc[lang],
    ...(media.images.length ? {image: media.images.map((g) => SITE_URL + g)} : {}),
    brand: {'@type': 'Brand', name: 'Cadomalo'},
    offers: {
      '@type': 'Offer', price: p.price.toFixed(2), priceCurrency: 'USD',
      availability: 'https://schema.org/InStock', url: SITE_URL + productUrl(p, lang),
    },
    /* rating markup only from real, approved reviews */
    ...(reviews.length ? {
      aggregateRating: {'@type': 'AggregateRating', ratingValue: avg(reviews).toFixed(1), reviewCount: reviews.length},
      review: reviews.slice(0, 5).map((r) => ({
        '@type': 'Review', author: {'@type': 'Person', name: r.name},
        reviewRating: {'@type': 'Rating', ratingValue: r.rating, bestRating: 5}, reviewBody: r.text,
      })),
    } : {}),
  }
  const faq = (p.objections && p.objections[lang]) || []
  const crumbs = [[t.product.home, urlFor('home', lang)], [t.product.shop, urlFor('shop', lang)],
    ...(cat ? [[cat.label[lang], catUrl(cat.id, lang)]] : []), [p.title[lang], productUrl(p, lang)]]

  add(productPath(p, lang), shell({
    lang, activePage: 'shop', pathEn: productPath(p, 'en'), pathFr: productPath(p, 'fr'),
    title: pageTitle((p.seo && p.seo.title && p.seo.title[lang]) || p.title[lang]),
    description: (p.seo && p.seo.description && p.seo.description[lang]) || p.desc[lang], body,
    ogImage: media.images[0] || undefined, bodyClass: 'has-sticky-buy',
    ogType: 'product', price: p.price,
    jsonLd: [productLd, crumbsLd(crumbs), ...(faq.length ? [faqLdOf(faq)] : [])],
  }))
}

function buildLegal(doc, lang) {
  const t = UI[lang]
  const nav = LEGAL.map(
    (d) => `<a href="${legalUrl(d.id, lang)}"${d.id === doc.id ? ' aria-current="page"' : ''}>${esc(d.title[lang])}</a>`
  ).join('\n            ')
  const sections = doc.sections[lang]
    .map((s) => `<h2>${esc(s.h)}</h2>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}`)
    .join('\n          ')
  const body = `    <section class="section">
      <div class="wrap legal-grid">
        <nav class="legal-nav" aria-label="${esc(t.legal.nav)}">
          ${nav}
        </nav>
        <div class="prose">
          <h1>${esc(doc.title[lang])}</h1>
          ${sections}
        </div>
      </div>
    </section>`
  add(LEGAL_SLUGS[doc.id][lang], shell({
    lang, activePage: 'legal',
    pathEn: LEGAL_SLUGS[doc.id].en, pathFr: LEGAL_SLUGS[doc.id].fr,
    title: pageTitle(doc.title[lang]), description: `${doc.title[lang]} — Cadomalo (cadomalo.com).`, body,
  }))
}

function buildCart(lang) {
  const t = UI[lang]
  const body = `    <section class="section">
      <div class="wrap">
        <h1>${esc(t.cart.title)}</h1>
        <div data-cart-page>
          <div data-cart-empty>
            <p class="lead">${esc(t.cart.empty)}</p>
            <p>${esc(t.cart.emptyP)}</p>
            <p><a class="btn btn-primary" href="${urlFor('shop', lang)}">${esc(t.cart.emptyCta)}</a></p>
          </div>
          <div class="cart-lines" data-cart-lines hidden></div>
          <div class="cart-summary" data-cart-summary hidden>
            <p class="cart-row"><span>${esc(t.cart.subtotal)}</span><strong data-cart-subtotal>$0.00</strong></p>
            <p class="cart-row cart-total"><span>${esc(t.cart.total)}</span><strong data-cart-total>$0.00</strong></p>
            <button type="button" class="btn btn-primary btn-full" data-checkout>${esc(t.cart.checkout)}</button>
            <p class="nl-note">${esc(t.cart.trustP)}</p>
          </div>
        </div>
      </div>
    </section>`
  add(ROUTES.cart[lang], shell({
    lang, activePage: 'cart', pathEn: ROUTES.cart.en, pathFr: ROUTES.cart.fr,
    title: pageTitle(t.cart.title), description: t.cart.title, body, noindex: true,
  }))
}

function buildContact(lang) {
  const t = UI[lang]
  const L = {
    en: {name: 'Your name', email: 'Your email', msg: 'Message', send: 'Send message',
         ok: 'Thank you — we reply within 2 working days.', err: 'Something went wrong. Please email support@cadomalo.com.'},
    fr: {name: 'Votre nom', email: 'Votre e-mail', msg: 'Message', send: 'Envoyer le message',
         ok: 'Merci — nous répondons sous 2 jours ouvrés.', err: 'Une erreur est survenue. Écrivez-nous à support@cadomalo.com.'},
  }[lang]
  const body = `    <section class="section">
      <div class="wrap-narrow">
        <h1>${esc(t.footer.contact)}</h1>
        <p class="lead">support@cadomalo.com</p>
        <form class="contact-form" data-contact-form data-ok="${esc(L.ok)}" data-err="${esc(L.err)}" novalidate>
          <label for="c-name">${esc(L.name)}</label>
          <input id="c-name" name="name" required autocomplete="name">
          <label for="c-email">${esc(L.email)}</label>
          <input id="c-email" name="email" type="email" required autocomplete="email">
          <label for="c-message">${esc(L.msg)}</label>
          <textarea id="c-message" name="message" rows="6" required></textarea>
          <input type="text" name="website" tabindex="-1" autocomplete="off" class="visually-hidden" aria-hidden="true">
          <button type="submit" class="btn btn-primary">${esc(L.send)}</button>
          <p class="form-status" data-form-status role="status"></p>
        </form>
      </div>
    </section>`
  add(ROUTES.contact[lang], shell({
    lang, activePage: 'contact', pathEn: ROUTES.contact.en, pathFr: ROUTES.contact.fr,
    title: pageTitle(t.footer.contact), description: lang === 'fr' ? 'Une question sur une commande ou un produit Cadomalo ? Écrivez-nous, nous répondons sous 2 jours ouvrés.' : 'Questions about an order or a Cadomalo product? Write to us — we reply within 2 working days.', body,
  }))
}

/* the funnel's price stack: strike-through store price, big funnel price,
   "You save $X (NN%)" badge — the discount is real (server-side token) */
const priceStack = (store, offer, lang = 'en') => {
  const save = store - offer
  const pct = Math.round((save / store) * 100)
  const label = lang === 'fr' ? 'Vous économisez' : 'You save'
  return `<div class="offer-price">
          <s class="offer-was">${money(store)}</s>
          <span class="offer-now">${money(offer)}</span>
          <span class="badge badge-solid offer-save">${label} ${money(save)} (${pct}%)</span>
        </div>`
}

/* Order confirmation: js/cart.js empties the basket and fills in the order;
   js/main.js adds the download buttons from /api/get-checkout-session
   (`downloads: [{label, url}]`) and the next-best-offer card. */
function buildThanks(lang) {
  const t = UI[lang]
  const L = {
    en: {
      title: 'Thank you for your order!', order: 'Order', sentTo: 'A receipt is on its way to',
      summary: 'Your order', total: 'Total paid',
      dlH: 'Your downloads', dlWait: 'Preparing your download links…',
      dlNone: 'Your download links are on their way by email. If nothing arrives within 15 minutes (check spam), write to support@cadomalo.com.',
      steps: [
        ['Download your files', 'Use the buttons above — they work on a computer, tablet or phone.'],
        ['Check your email', 'We also email your download links, and Stripe sends your receipt. Have a look in spam if you don’t see them.'],
        ['Print and enjoy', 'Print at 100% (“actual size”) at home or at any copy shop, as often as you need for your family.'],
      ],
      help: 'Questions about your order? Write to support@cadomalo.com — we answer within 2 working days.',
      missing: 'We couldn’t load your order details, but your payment went through if you reached this page from checkout. Email support@cadomalo.com with any questions.',
      unpaid: 'Your payment is not complete yet. If you were charged, email support@cadomalo.com with your order number.',
      cta: 'Keep exploring',
      nboKicker: 'One more idea', nboH: 'Complete the Human Body Wonders library',
      nboP: 'All 10 Human Body Wonders books — head to teeth, in four languages.',
      nboCta: 'Add to basket', nboOffer: 'Your buyer-only price', nboOfferCta: 'Yes, add it for',
      reviewH: 'Loving it?', reviewP: 'Tell other parents how it went — verified buyers get 15% off their next order.', reviewCta: 'Write a review',
    },
    fr: {
      title: 'Merci pour votre commande !', order: 'Commande', sentTo: 'Un reçu arrive à',
      summary: 'Votre commande', total: 'Total payé',
      dlH: 'Vos téléchargements', dlWait: 'Préparation de vos liens de téléchargement…',
      dlNone: 'Vos liens de téléchargement arrivent par e-mail. Si rien n’arrive sous 15 minutes (pensez aux spams), écrivez à support@cadomalo.com.',
      steps: [
        ['Téléchargez vos fichiers', 'Utilisez les boutons ci-dessus — ils fonctionnent sur ordinateur, tablette ou téléphone.'],
        ['Vérifiez vos e-mails', 'Nous vous envoyons aussi vos liens par e-mail, et Stripe vous envoie le reçu. Pensez à regarder dans les spams.'],
        ['Imprimez et profitez', 'Imprimez à 100 % (« taille réelle ») chez vous ou en boutique, autant que nécessaire pour votre famille.'],
      ],
      help: 'Une question sur votre commande ? Écrivez à support@cadomalo.com — nous répondons sous 2 jours ouvrés.',
      missing: 'Nous n’avons pas pu charger le détail de votre commande, mais si vous arrivez ici depuis le paiement, il a bien été accepté. Écrivez à support@cadomalo.com pour toute question.',
      unpaid: 'Votre paiement n’est pas encore finalisé. Si vous avez été débité, écrivez à support@cadomalo.com avec votre numéro de commande.',
      cta: 'Continuer la visite',
      nboKicker: 'Une idée de plus', nboH: 'Complétez la bibliothèque Merveilles du corps',
      nboP: 'Les 10 livres Merveilles du corps — de la tête aux dents, en quatre langues.',
      nboCta: 'Ajouter au panier', nboOffer: 'Votre prix client', nboOfferCta: 'Oui, ajoutez-le pour',
      reviewH: 'Ça vous plaît ?', reviewP: 'Racontez aux autres parents — les acheteurs vérifiés reçoivent 15 % sur leur prochaine commande.', reviewCta: 'Donner mon avis',
    },
  }[lang]
  const steps = L.steps
    .map(([h, p], i) => `<li class="thanks-step"><span class="objection-n">${i + 1}</span><div><h3>${esc(h)}</h3><p>${esc(p)}</p></div></li>`)
    .join('\n            ')
  const b = byId('bundle')
  const bImg = primaryImage(b)
  const nbo = b ? `<aside class="nbo-card" data-nbo data-nbo-product="bundle" data-funnel-price="${b.funnelPrice || ''}">
          ${bImg ? `<img src="${bImg}" alt="${esc(coverAlt(b, lang))}" width="240" height="240" loading="lazy">` : ''}
          <div>
            <p class="eyebrow">${esc(L.nboKicker)}</p>
            <h2 class="thanks-h">${esc(L.nboH)}</h2>
            <p>${esc(L.nboP)}</p>
            <div data-nbo-store>
              <p class="card-price">${money(b.price)} <del>${money(b.compareAt)}</del></p>
              <p class="hero-ctas"><button type="button" class="btn btn-primary" data-add="bundle">${esc(L.nboCta)}</button>
                <a class="btn btn-quiet" href="${productUrl(b, lang)}">${esc(t.shop2.seeCollection)}</a></p>
            </div>
            ${b.funnelPrice ? `<div data-nbo-funnel hidden>
              <p class="eyebrow">${esc(L.nboOffer)}</p>
              ${priceStack(b.price, b.funnelPrice, lang)}
              <p><button type="button" class="btn btn-primary btn-lg" data-funnel-buy="bundle">${esc(L.nboOfferCta)} ${money(b.funnelPrice)}</button></p>
            </div>` : ''}
          </div>
        </aside>` : ''
  const body = `    <section class="section">
      <div class="wrap-narrow" data-confirmation data-missing="${esc(L.missing)}" data-unpaid="${esc(L.unpaid)}">
        <h1>${esc(L.title)}</h1>
        <p class="lead">${esc(L.order)} <strong data-confirm-id>—</strong></p>
        <p data-confirm-email-row hidden>${esc(L.sentTo)} <strong data-confirm-email></strong></p>
        <p class="form-status" data-confirm-error role="status" hidden></p>
        <div class="downloads-box" data-downloads data-none="${esc(L.dlNone)}">
          <h2 class="thanks-h">${esc(L.dlH)}</h2>
          <p class="nl-note" data-downloads-status>${esc(L.dlWait)}</p>
          <div class="downloads-list" data-downloads-list></div>
        </div>
        <div class="cart-summary thanks-summary" data-confirm-summary hidden>
          <h2 class="thanks-h">${esc(L.summary)}</h2>
          <div data-confirm-lines></div>
          <p class="cart-row cart-total"><span>${esc(L.total)}</span><strong data-confirm-total></strong></p>
        </div>
        <ol class="thanks-steps">
            ${steps}
        </ol>
        ${nbo}
        <div class="review-invite review-invite-sm">
          <h2 class="thanks-h">${esc(L.reviewH)}</h2>
          <p>${esc(L.reviewP)}</p>
          <a class="btn btn-secondary" href="${reviewUrl()}">${esc(L.reviewCta)}</a>
        </div>
        <p class="nl-note">${esc(L.help)}</p>
        <p><a class="btn btn-quiet" href="${urlFor('shop', lang)}">${esc(L.cta)}</a></p>
      </div>
    </section>`
  add(ROUTES.thanks[lang], shell({
    lang, activePage: 'thanks', pathEn: ROUTES.thanks.en, pathFr: ROUTES.thanks.fr,
    title: pageTitle(L.title), description: L.title, body, noindex: true,
  }))
}

/* ---------- funnel (English only, noindex) ------------------------------ */
const funnelShell = (path, title, description, body, ogImage) =>
  add(path, shell({
    lang: 'en', activePage: 'funnel', pathEn: path, pathFr: path, enOnly: true, noindex: true,
    title, description, body, ogImage, bodyClass: 'funnel-page',
  }))

const videoTag = (v, cls = 'funnel-video') =>
  `<video class="${cls}" src="${v.src}"${v.poster ? ` poster="${v.poster}"` : ''} muted autoplay loop playsinline preload="metadata" aria-label="Product demo video"></video>`

function buildOptin() {
  const sample = byId('routine-sample')
  const mock = onDisk('/images/products/routine-sample/01.webp') ? '/images/products/routine-sample/01.webp' : primaryImage(byId('routine'))
  const vid = mediaFor(sample).videos[0]
  const body = `    <section class="section funnel-hero">
      <div class="wrap funnel-grid">
        <div class="funnel-copy">
          <p class="eyebrow">Free printable sample · ages 5–7</p>
          <h1 class="hero-title"><span>Calmer mornings.</span><span class="accent">Easier bedtimes.</span></h1>
          <p class="lead">Get 10 free pages from our Morning &amp; Bedtime Routine Busy Book — print them tonight and let your child run their own routine with picture cards.</p>
          <ul class="benefit-list">
            <li><span class="benefit-check">${icon('check', 14)}</span><span>A visual routine your child follows by themselves — fewer reminders, fewer battles</span></li>
            <li><span class="benefit-check">${icon('check', 14)}</span><span>One complete routine world, the weekly star chart and a Routine Superstar certificate</span></li>
            <li><span class="benefit-check">${icon('check', 14)}</span><span>One short PDF to print at home tonight</span></li>
          </ul>
          ${optinForm('en', 'optin-email')}
        </div>
        <div class="funnel-media">
          ${mock ? `<img src="${mock}" alt="Printed pages from the Morning and Bedtime Routine Busy Book" width="640" height="640" fetchpriority="high">` : ''}
          ${vid ? videoTag(vid) : ''}
        </div>
      </div>
    </section>`
  funnelShell(FUNNEL.optin, 'Free Morning & Bedtime Routine pages — Cadomalo',
    'Get 10 free printable pages from the Morning & Bedtime Routine Busy Book.', body, mock || undefined)
}

function buildThankYouSample() {
  const lab = byId('discovery-lab')
  const img = primaryImage(lab)
  const vid = mediaFor(lab).videos[0]
  const books = SHOP.filter((p) => p.category === 'book' && p.funnelPrice)
  const singles = books.length ? `<details class="funnel-singles" data-needs-token hidden>
          <summary>Or pick single books for ${money(books[0].funnelPrice)} each <s>${money(books[0].price)}</s></summary>
          <ul class="singles-list">${books.map((b) => `<li><span>${esc(b.title.en)} <small>${esc(b.series.en)}</small></span>
            <button type="button" class="btn btn-quiet btn-sm" data-funnel-buy="${b.id}">${money(b.funnelPrice)}</button></li>`).join('')}</ul>
        </details>` : ''
  const body = `    <section class="section funnel-hero" data-offer-page data-expired-url="${productUrl(lab, 'en')}">
      <div class="wrap-narrow center">
        <p class="funnel-step">${icon('check', 18)} Your free sample is on its way — check your inbox in a few minutes.</p>
        <h1>Before you go: a one-time offer, just for you</h1>
        <p class="lead" style="margin-inline:auto">Add <strong>My Amazing Body Discovery Lab</strong> — 38 pages, 5 hands-on science missions — for a fraction of the shop price.</p>
      </div>
      <div class="wrap funnel-grid">
        <div class="funnel-media">
          ${img ? `<img src="${img}" alt="My Amazing Body Discovery Lab printable pages" width="640" height="640" fetchpriority="high">` : ''}
          ${vid ? videoTag(vid) : ''}
        </div>
        <div class="funnel-copy">
          ${priceStack(lab.price, lab.funnelPrice)}
          <p class="offer-timer" data-offer-timer hidden>${icon('check', 16)} This price is reserved for you for <strong data-offer-left>48:00:00</strong></p>
          <ul class="benefit-list">${lab.benefits.en.map((b) => `<li><span class="benefit-check">${icon('check', 14)}</span><span>${esc(b)}</span></li>`).join('')}</ul>
          <p><button type="button" class="btn btn-primary btn-lg btn-full" data-funnel-buy="discovery-lab">Yes! Add the Discovery Lab for ${money(lab.funnelPrice)}</button></p>
          <p class="nl-note">Instant PDF download · secure Stripe checkout · 30-day happiness promise</p>
          <p class="form-status" data-funnel-status role="status"></p>
          <p class="offer-expired" data-offer-expired hidden>This offer has expired. The Discovery Lab is still available in the shop at ${money(lab.price)}. <a href="${productUrl(lab, 'en')}">See it in the shop</a></p>
          ${singles}
          <p><a class="funnel-skip" href="/">No thanks, I’ll just wait for my free pages</a></p>
        </div>
      </div>
    </section>`
  funnelShell(FUNNEL.thankYou, 'Your free sample is on its way — Cadomalo',
    'Your free routine pages are on their way.', body, img || undefined)
}

function buildMhOffer() {
  const mh = byId('mh-bundle')
  const img = primaryImage(mh)
  const vid = mediaFor(mh).videos[0]
  const covers = series('mh').map(primaryImage).filter(Boolean).slice(0, 10)
  const books = SHOP.filter((p) => p.category === 'book' && p.funnelPrice)
  const body = `    <section class="section funnel-hero" data-upsell-page>
      <div class="wrap-narrow center">
        <p class="funnel-step">${icon('check', 18)} Your order is confirmed — your files are ready on the next page.</p>
        <h1>Wait! Add all 10 Medical Heroes books with one click</h1>
        <p class="lead" style="margin-inline:auto">Doctors, nurses, dentists, paramedics and more — ten picture books in four languages that make every check-up feel familiar. Added to your order with the card you just used, no forms.</p>
      </div>
      <div class="wrap funnel-grid">
        <div class="funnel-media">
          ${img ? `<img src="${img}" alt="Medical Heroes collection" width="640" height="640" fetchpriority="high">` : ''}
          ${vid ? videoTag(vid) : ''}
          ${covers.length > 1 ? `<div class="cover-strip">${covers.map((c) => `<img src="${c}" alt="Medical Heroes book cover" width="120" height="120" loading="lazy">`).join('')}</div>` : ''}
        </div>
        <div class="funnel-copy">
          ${priceStack(mh.price, mh.funnelPrice)}
          <p class="nl-note">Bought one by one, the 10 books are ${money(mh.compareAt)}.</p>
          <ul class="benefit-list">${mh.benefits.en.slice(0, 1).concat(['10 picture books, 58 pages each, with colouring pages', 'Every page in English, French, Spanish and German', 'Instant PDF download — added to this order']).map((b) => `<li><span class="benefit-check">${icon('check', 14)}</span><span>${esc(b)}</span></li>`).join('')}</ul>
          <p><button type="button" class="btn btn-primary btn-lg btn-full" data-one-click>Yes! Add Medical Heroes for ${money(mh.funnelPrice)}</button></p>
          <p class="nl-note">One click — charged to the card you just used. 30-day happiness promise.</p>
          <p class="form-status" data-funnel-status role="status"></p>
          ${books.length ? `<details class="funnel-singles" data-needs-token hidden>
            <summary>Or pick single books for ${money(books[0].funnelPrice)} each <s>${money(books[0].price)}</s></summary>
            <ul class="singles-list">${books.filter((b) => b.collection === 'mh').map((b) => `<li><span>${esc(b.title.en)}</span>
              <button type="button" class="btn btn-quiet btn-sm" data-funnel-buy="${b.id}">${money(b.funnelPrice)}</button></li>`).join('')}</ul>
          </details>` : ''}
          <p><a class="funnel-skip" data-no-thanks href="/order-confirmation">No thanks, take me to my downloads</a></p>
        </div>
      </div>
    </section>`
  funnelShell(FUNNEL.mhOffer, 'Add Medical Heroes — Cadomalo', 'A one-time offer on the Medical Heroes collection.', body, img || undefined)
}

function buildReview() {
  const options = SHOP.map((p) => `<option value="${p.id}" data-slug="${productSlug(p, 'en')}">${esc(p.title.en)}</option>`).join('')
  const body = `    <section class="section">
      <div class="wrap-narrow">
        <p class="eyebrow">Reviews</p>
        <h1>Tell other parents how it went</h1>
        <p class="lead">Honest reviews help other families choose — the good and the not-so-good. Verified buyers (we check your order email) get a 15% code for their next order once the review is approved.</p>
        <form class="contact-form review-form" data-review-form novalidate>
          <label for="r-product">Product</label>
          <select id="r-product" name="productId" required><option value="">Choose a product…</option>${options}</select>
          <fieldset class="star-input">
            <legend>Your rating</legend>
            ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="r-star-${n}" name="rating" value="${n}" required><label for="r-star-${n}" title="${n} star${n > 1 ? 's' : ''}">★<span class="visually-hidden">${n} star${n > 1 ? 's' : ''}</span></label>`).join('')}
          </fieldset>
          <label for="r-name">Your first name (shown with the review)</label>
          <input id="r-name" name="author" required autocomplete="given-name" maxlength="80">
          <label for="r-text">Your review</label>
          <textarea id="r-text" name="body" rows="6" required minlength="20" maxlength="2000" placeholder="What did your child think? How did you use it?"></textarea>
          <label for="r-photo">Add a photo (optional)</label>
          <input id="r-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp">
          <label for="r-email">Order email (not shown — used to verify your purchase and send your 15% code)</label>
          <input id="r-email" name="email" type="email" required autocomplete="email">
          <input type="text" name="website" tabindex="-1" autocomplete="off" class="visually-hidden" aria-hidden="true">
          <button type="submit" class="btn btn-primary">Send my review</button>
          <p class="form-status" data-form-status role="status"></p>
        </form>
      </div>
    </section>`
  funnelShell(FUNNEL.review, 'Write a review — Cadomalo', 'Share your experience with a Cadomalo product.', body)
}

/* Branded 404 (Vercel serves /404.html for any path with no file or route).
   English first, with a French line; noindex. */
function build404() {
  const t = UI.en
  const N = t.notFound
  const body = `    <section class="section">
      <div class="wrap-narrow center not-found">
        <p class="eyebrow">404</p>
        <h1>${esc(N.h)}</h1>
        <p class="lead" style="margin-inline:auto">${esc(N.p)}</p>
        <p class="cat-related">${CATEGORIES.map((c) => `<a class="chip" href="${catUrl(c.id, 'en')}">${esc(c.label.en)}</a>`).join('')}</p>
        <p class="hero-ctas" style="justify-content:center">
          <a class="btn btn-primary" href="${urlFor('shop', 'en')}">${esc(N.shop)}</a>
          <a class="btn btn-quiet" href="${urlFor('home', 'en')}">${esc(N.home)}</a>
        </p>
        <p lang="fr">${esc(N.fr)} <a href="${urlFor('home', 'fr')}">${esc(N.frLink)}</a> · <a href="${urlFor('shop', 'fr')}">Boutique</a></p>
      </div>
    </section>`
  add('404', shell({
    lang: 'en', activePage: '404', pathEn: '', pathFr: '', enOnly: true, noindex: true,
    title: pageTitle(N.title), description: N.p, body,
  }))
}

/* ---------- run --------------------------------------------------------- */
for (const lang of LANGS) {
  buildHome(lang)
  buildShop(lang)
  buildCollections(lang)
  buildSale(lang)
  buildAbout(lang)
  buildBlogIndex(lang)
  buildCart(lang)
  buildContact(lang)
  buildThanks(lang)
  for (const post of POSTS) buildPost(post, lang)
  for (const p of SHOP) buildProduct(p, lang)
  for (const doc of LEGAL) buildLegal(doc, lang)
  for (const c of CATEGORIES) buildCategory(c, lang)
}
buildOptin()
buildThankYouSample()
buildMhOffer()
buildReview()
build404()

for (const {path, html} of out) {
  const file = path === '' ? join(ROOT, 'index.html') : path === '404' ? join(ROOT, '404.html') : join(ROOT, path, 'index.html')
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, html)
}

/* Client + API catalogue. `slug` is the English slug and is the stable key
   the checkout API looks products up by. One PDF per product (no variants):
   `attrs` is always empty. Hidden products (free sample, retired wraps) are
   listed with url null so the API can still resolve them. */
const clientCatalog = CATALOG.map((p) => ({
  id: p.id,
  slug: productSlug(p, 'en'),
  type: p.type,
  category: p.category || p.type,
  collection: p.collection || null,
  fulfillment: p.fulfillment || 'auto',
  hidden: !!p.hidden,
  price: p.price,
  compareAt: p.compareAt || null,
  funnelPrice: p.funnelPrice ?? null,
  img: primaryImage(p) || null,
  title: {en: p.title.en, fr: p.title.fr},
  url: p.hidden ? null : {en: productUrl(p, 'en'), fr: productUrl(p, 'fr')},
  includes: p.includes || null,
  files: p.files || [],
  attrs: [],
}))
mkdirSync(join(ROOT, 'data'), {recursive: true})
writeFileSync(join(ROOT, 'data', 'catalog-client.json'), JSON.stringify(clientCatalog, null, 2) + '\n')
console.log(`[pages] wrote data/catalog-client.json (${clientCatalog.length} products, ${SHOP.length} in shop)`)

const fr = out.filter((o) => o.path === 'fr' || o.path.startsWith('fr/')).length
console.log(`[pages] wrote ${out.length} pages  (en: ${out.length - fr}, fr: ${fr})`)

if (missing.length) {
  console.warn(`\n[pages] ${new Set(missing).size} missing key(s) — rendered empty:`)
  for (const m of [...new Set(missing)].slice(0, 30)) console.warn(`  ! ${m}`)
  process.exitCode = 1
}
