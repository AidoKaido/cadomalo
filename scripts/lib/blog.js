/* Blog index + article body.
 *
 * The index reproduces the LAYOUT of the old cadomalo.com blog page
 * (hero, category filter, featured post, card grid, two-widget sidebar) in the
 * new visual language. Class names match the existing initBlogFilter() contract
 * in js/main.js — `.blog-filter-btn[data-cat]` and `.blog-item[data-cat]`,
 * toggling `active` / `hidden` — so no new filter code is needed.
 *
 * Post body format (content/posts.json, body.en / body.fr = array of blocks):
 *   {h: "…"}            H2
 *   {h3: "…"}           H3
 *   {p: "…"}            paragraph — supports [link text](/internal-url) and **bold**
 *   {ul: ["…", …]}      bullet list (items support the same inline markup)
 *   {ol: ["…", …]}      numbered list
 *   {note: "…"}         small muted aside (e.g. "ask your doctor" reminders)
 *   {product: "id"}     inline product card (catalog id); skipped if unknown/hidden
 *   {cta: "sample"}     free routine sample opt-in block (/free-routine-sample)
 *
 * Products: `products: ["id", …]` lists the cards shown under the article.
 * The legacy single `product` field still works (and is what build-pages.js
 * resolves into `relatedCard`). When build-pages passes `renderCard` +
 * `productById`, those are used; otherwise blog.js renders cards itself from
 * content/catalog.json with the same markup.
 *
 * Optional per-post fields: `seo: {title: {en, fr}, description: {en, fr}}`,
 * `published` / `modified` (ISO dates) — exposed through postSeo() and
 * postJsonLd() so build-pages can use them.
 */
import {readFileSync, existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

const clock = `<svg class="ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

/* strings that are not (yet) in ui.json */
const STR = {
  en: {
    home: 'Home', blog: 'Blog', shopTitle: 'Read it together',
    shopP1: 'The book that goes with this article.', shopPn: 'The books and printables mentioned in this article.',
    see: 'See details', add: 'Add to basket',
    sampleH: 'Try it free: our morning & bedtime routine pages',
    sampleP: 'Get free sample pages from the Morning & Bedtime Routine Busy Book by email and test a visual routine with your child this week.',
    sampleBtn: 'Get the free sample',
  },
  fr: {
    home: 'Accueil', blog: 'Blog', shopTitle: 'À lire ensemble',
    shopP1: 'Le livre qui accompagne cet article.', shopPn: 'Les livres et activités à imprimer cités dans cet article.',
    see: 'Voir le produit', add: 'Ajouter au panier',
    sampleH: 'À tester gratuitement : nos pages routine du matin et du soir',
    sampleP: 'Recevez par e-mail des pages gratuites du cahier routine du matin et du soir (en anglais) et testez une routine visuelle avec votre enfant dès cette semaine.',
    sampleBtn: 'Recevoir l’échantillon gratuit',
  },
}

/* ---------- self-contained catalog access (fallback) ------------------- */
const ROOT = process.cwd()
let catalogCache = null
const catalog = () => {
  if (!catalogCache) {
    try {
      catalogCache = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8'))
    } catch {
      catalogCache = []
    }
  }
  return catalogCache
}
const findProduct = (id, d) => {
  const p = (d.productById && d.productById(id)) || catalog().find((x) => x.id === id)
  return p && !p.hidden ? p : null
}
/* same slug rule as build-pages.js */
const slugify = (s) =>
  String(s)
    .replace(/œ/g, 'oe').replace(/Œ/g, 'Oe').replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const tr = (o, lang) => (o ? o[lang] ?? o.en ?? '' : '')
const productHref = (p, lang, d) =>
  d.productUrl ? d.productUrl(p, lang)
    : lang === 'fr' ? `/fr/produits/${slugify(tr(p.title, 'fr'))}` : `/products/${slugify(tr(p.title, 'en'))}`
const onDisk = (url) => !!url && existsSync(join(ROOT, String(url).replace(/^\//, '')))
const productImage = (p, d) => {
  if (d.primaryImage) return d.primaryImage(p)
  const listed = (p.images || []).find(onDisk)
  if (listed) return listed
  const dir = join(ROOT, 'images', 'products', p.id)
  if (existsSync(dir)) {
    const f = readdirSync(dir).filter((n) => /\.(webp|png|jpe?g)$/i.test(n)).sort()[0]
    if (f) return `/images/products/${p.id}/${f}`
  }
  return p.img && d.assetUrl ? d.assetUrl(p.img) : ''
}
const price = (n) => `$${Number(n).toFixed(2)}`

/* inline markup: escape first, then allow [text](/internal) links and **bold** */
const inline = (s, esc) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '<a href="$2">$1</a>')

const strip = (s) => String(s || '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')

/* Estimated reading time from the real body text at ~200 wpm.
   Falls back to the stored `min` only when the body is too short to measure. */
export function wordCount(post, lang) {
  return (post.body?.[lang] || [])
    .map((b) => [b.h, b.h3, b.p, b.note, ...(b.ul || []), ...(b.ol || [])].filter(Boolean).map(strip).join(' '))
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}
export function readingTime(post, lang) {
  const computed = Math.ceil(wordCount(post, lang) / 200)
  return computed >= 1 ? computed : post.min || 1
}

/* product ids shown under a post: `products` array, else the legacy `product` */
export const postProducts = (post) =>
  Array.isArray(post.products) && post.products.length ? post.products : post.product ? [post.product] : []

/* SEO title/description with fallbacks to the visible title/excerpt */
export function postSeo(post, lang) {
  return {
    title: tr(post.seo?.title, lang) || `${post.title[lang]} — Cadomalo`,
    description: tr(post.seo?.description, lang) || post.excerpt[lang],
  }
}

/* Full BlogPosting object (headline, dates, image, author …) for build-pages */
export function postJsonLd(post, lang, {siteUrl, postUrl, assetUrl}) {
  const ld = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title[lang], description: postSeo(post, lang).description,
    image: siteUrl + assetUrl(post.img), inLanguage: lang,
    timeRequired: `PT${readingTime(post, lang)}M`,
    wordCount: wordCount(post, lang),
    author: {'@type': 'Organization', name: 'Cadomalo'},
    publisher: {'@type': 'Organization', name: 'Cadomalo',
      logo: {'@type': 'ImageObject', url: `${siteUrl}/assets/logo-square.png`}},
    mainEntityOfPage: siteUrl + postUrl(post, lang),
  }
  if (post.published) ld.datePublished = post.published
  if (post.modified || post.published) ld.dateModified = post.modified || post.published
  return ld
}

export function breadcrumbJsonLd(post, lang, {siteUrl, postUrl, urlFor}) {
  const s = STR[lang] || STR.en
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      {'@type': 'ListItem', position: 1, name: s.home, item: siteUrl + urlFor('home', lang)},
      {'@type': 'ListItem', position: 2, name: s.blog, item: siteUrl + urlFor('blog', lang)},
      {'@type': 'ListItem', position: 3, name: post.title[lang], item: siteUrl + postUrl(post, lang)},
    ],
  }
}

export function renderBlogIndex(posts, lang, t, d) {
  const {esc, postUrl, assetUrl, productUrl, bundle, money} = d

  /* unique categories, in first-appearance order */
  const cats = []
  for (const p of posts) if (!cats.includes(p.cat[lang])) cats.push(p.cat[lang])

  const filters =
    `<button type="button" class="blog-filter-btn active" data-cat="all">${esc(t.blog.back)}</button>` +
    cats.map((c) => `<button type="button" class="blog-filter-btn" data-cat="${esc(c)}">${esc(c)}</button>`).join('')

  const [feature, ...rest] = posts
  const ft = readingTime(feature, lang)

  const featured = `<article class="blog-feat blog-item" data-cat="${esc(feature.cat[lang])}">
            <a class="blog-feat-img" href="${postUrl(feature, lang)}" tabindex="-1" aria-hidden="true">
              <img src="${assetUrl(feature.img)}" alt="" width="800" height="600" loading="lazy">
            </a>
            <div class="blog-feat-body">
              <span class="blog-cat-pill">${esc(feature.cat[lang])}</span>
              <h2 class="blog-feat-title"><a href="${postUrl(feature, lang)}">${esc(feature.title[lang])}</a></h2>
              <p>${esc(feature.excerpt[lang])}</p>
              <p class="blog-meta">${clock}<span>${ft} ${esc(t.blog.min)}</span>
                <span class="blog-meta-dot"></span><span>${esc(feature.date[lang])}</span></p>
              <p class="blog-read"><a class="btn btn-quiet btn-sm" href="${postUrl(feature, lang)}">${esc(t.blog.read)} <span aria-hidden="true">&rarr;</span></a></p>
            </div>
          </article>`

  const cards = rest
    .map((post) => {
      const rt = readingTime(post, lang)
      return `<article class="blog-card blog-item" data-cat="${esc(post.cat[lang])}">
              <a class="blog-thumb" href="${postUrl(post, lang)}" tabindex="-1" aria-hidden="true">
                <img src="${assetUrl(post.img)}" alt="" width="600" height="400" loading="lazy">
              </a>
              <div class="blog-body">
                <span class="blog-cat-pill">${esc(post.cat[lang])}</span>
                <h3 class="blog-title"><a href="${postUrl(post, lang)}">${esc(post.title[lang])}</a></h3>
                <p>${esc(post.excerpt[lang])}</p>
                <p class="blog-meta">${clock}<span>${rt} ${esc(t.blog.min)}</span>
                  <span class="blog-meta-dot"></span><span>${esc(post.date[lang])}</span></p>
                <p class="blog-read"><a href="${postUrl(post, lang)}">${esc(t.blog.read)} <span aria-hidden="true">&rarr;</span></a></p>
              </div>
            </article>`
    })
    .join('\n            ')

  /* sidebar: recent posts + bundle promo */
  const recent = posts
    .slice(0, 4)
    .map((post) => `<a class="sidebar-post" href="${postUrl(post, lang)}">
                <span class="sidebar-thumb"><img src="${assetUrl(post.img)}" alt="" width="64" height="64" loading="lazy"></span>
                <span>
                  <span class="sidebar-post-title">${esc(post.title[lang])}</span>
                  <span class="sidebar-post-date">${esc(post.date[lang])}</span>
                </span>
              </a>`)
    .join('\n              ')

  const promo = `<div class="sidebar-promo">
              <img src="${assetUrl(bundle.img)}" alt="" width="300" height="225" loading="lazy">
              <strong>${esc(bundle.title[lang])}</strong>
              <p class="sidebar-promo-price">${money(bundle.price)}
                ${bundle.compareAt ? `<del>${money(bundle.compareAt)}</del>` : ''}</p>
              <a class="btn btn-primary btn-full btn-sm" href="${productUrl(bundle, lang)}">${esc(t.cols.cta)}</a>
            </div>`

  return `    <section class="blog-hero">
      <div class="wrap">
        <h1>${esc(t.blog.title)}</h1>
        <p class="lead">${esc(t.blog.p)}</p>
      </div>
    </section>

    <div class="wrap">
      <div class="blog-cats">${filters}</div>

      <div class="blog-layout">
        <div class="blog-main">
          ${featured}
          <div class="blog-grid">
            ${cards}
          </div>
        </div>

        <aside class="blog-sidebar">
          <div class="sidebar-widget">
            <h2>${esc(t.blog.kicker)}</h2>
            <div class="sidebar-posts">
              ${recent}
            </div>
          </div>
          <div class="sidebar-widget">
            <h2>${esc(t.collection.bundleEyebrow)}</h2>
            ${promo}
          </div>
        </aside>
      </div>
    </div>`
}

/* grid card — same markup as build-pages renderCard (minus badges/ratings) */
function fallbackCard(p, lang, t, d) {
  const {esc} = d
  const s = STR[lang] || STR.en
  const href = productHref(p, lang, d)
  const img = productImage(p, d)
  const media = img
    ? `<img src="${img}" alt="${esc(tr(p.title, lang))}" width="600" height="600" loading="lazy">`
    : `<span class="card-cover" style="--tile:${p.color}"><strong>${esc(tr(p.title, lang))}</strong></span>`
  const was = p.compareAt ? `<del>${price(p.compareAt)}</del>` : ''
  return `<article class="card" data-type="${p.category}">
          <a class="card-media" href="${href}" tabindex="-1" aria-hidden="true">
            ${media}
          </a>
          <div class="card-body">
            <p class="card-series">${esc(tr(p.series, lang))}</p>
            <h3 class="card-title"><a href="${href}">${esc(tr(p.title, lang))}</a></h3>
            <p class="card-price">${price(p.price)} ${was}</p>
            <p class="card-langs">${esc(p.langs || '')}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-full" data-add="${p.id}">${esc(t.product?.add || s.add)}</button>
          </div>
        </article>`
}

/* compact card placed inside the article text */
function inlineProduct(id, lang, t, d) {
  const p = findProduct(id, d)
  if (!p) return ''
  const {esc} = d
  const s = STR[lang] || STR.en
  const href = productHref(p, lang, d)
  const img = productImage(p, d)
  const was = p.compareAt ? ` <del>${price(p.compareAt)}</del>` : ''
  return `<aside class="nbo-card blog-product" aria-label="${esc(tr(p.title, lang))}">
          ${img ? `<a href="${href}" tabindex="-1" aria-hidden="true"><img src="${img}" alt="" width="220" height="220" loading="lazy"></a>` : '<span></span>'}
          <div>
            <p class="card-series" style="margin:0">${esc(tr(p.series, lang))}</p>
            <h3 style="margin:var(--space-1) 0 var(--space-2)"><a href="${href}">${esc(tr(p.title, lang))}</a></h3>
            ${p.desc ? `<p style="margin:0 0 var(--space-3)">${esc(tr(p.desc, lang))}</p>` : ''}
            <p class="card-price" style="margin:0 0 var(--space-3)">${price(p.price)}${was}</p>
            <p style="margin:0;display:flex;flex-wrap:wrap;gap:var(--space-2)">
              <button type="button" class="btn btn-primary btn-sm" data-add="${p.id}">${esc(t.product?.add || s.add)}</button>
              <a class="btn btn-quiet btn-sm" href="${href}">${esc(s.see)}</a>
            </p>
          </div>
        </aside>`
}

function sampleCta(lang, d) {
  const {esc} = d
  const s = STR[lang] || STR.en
  const img = onDisk('/images/products/routine-sample/01.webp') ? '/images/products/routine-sample/01.webp' : ''
  return `<aside class="nbo-card blog-sample" aria-label="${esc(s.sampleH)}">
          ${img ? `<img src="${img}" alt="" width="220" height="220" loading="lazy">` : '<span></span>'}
          <div>
            <h3 style="margin:0 0 var(--space-2)">${esc(s.sampleH)}</h3>
            <p style="margin:0 0 var(--space-3)">${esc(s.sampleP)}</p>
            <p style="margin:0"><a class="btn btn-primary btn-sm" href="/free-routine-sample">${esc(s.sampleBtn)}</a></p>
          </div>
        </aside>`
}

function renderBlock(b, lang, t, d) {
  const {esc} = d
  if (b.h) return `<h2>${esc(b.h)}</h2>`
  if (b.h3) return `<h3>${esc(b.h3)}</h3>`
  if (b.ul) return `<ul>\n          ${b.ul.map((i) => `<li>${inline(i, esc)}</li>`).join('\n          ')}\n        </ul>`
  if (b.ol) return `<ol>\n          ${b.ol.map((i) => `<li>${inline(i, esc)}</li>`).join('\n          ')}\n        </ol>`
  if (b.note) return `<p class="post-meta"><em>${inline(b.note, esc)}</em></p>`
  if (b.product) return inlineProduct(b.product, lang, t, d)
  if (b.cta === 'sample') return sampleCta(lang, d)
  if (b.p) return `<p>${inline(b.p, esc)}</p>`
  return ''
}

export function renderPostBody(post, lang, t, d) {
  const {esc, postUrl, assetUrl, urlFor, relatedCard, renderCard} = d
  const s = STR[lang] || STR.en
  const rt = readingTime(post, lang)

  const body = post.body[lang]
    .map((b) => renderBlock(b, lang, t, d))
    .filter(Boolean)
    .join('\n        ')

  /* cards under the article: build-pages' renderCard when given, its
     pre-rendered relatedCard for the legacy `product`, else our own markup */
  const ids = postProducts(post)
  const cardHtml = ids
    .map((id) => {
      if (renderCard) {
        const p = findProduct(id, d)
        return p ? renderCard(p, lang, t) : ''
      }
      if (id === post.product && relatedCard) return relatedCard
      const p = findProduct(id, d)
      return p ? fallbackCard(p, lang, t, d) : ''
    })
    .filter(Boolean)

  const shop = cardHtml.length
    ? `<section class="section band-peach">
      <div class="wrap">
        <div class="center">
          <h2>${esc(t.blog.shopThis || s.shopTitle)}</h2>
          <p class="lead" style="margin-inline:auto">${esc(cardHtml.length > 1 ? s.shopPn : t.blog.shopThisP || s.shopP1)}</p>
        </div>
        ${cardHtml.length > 1
          ? `<div class="grid-products" style="margin-top:var(--space-7)">${cardHtml.join('\n          ')}</div>`
          : `<div class="single-card">${cardHtml[0]}</div>`}
      </div>
    </section>`
    : ''

  /* BreadcrumbList JSON-LD; pass breadcrumbLd:false if build-pages emits its own */
  const site = d.siteUrl || process.env.SITE_URL || 'https://cadomalo.com'
  const crumbLd = d.breadcrumbLd === false
    ? ''
    : `<script type="application/ld+json">${JSON.stringify(breadcrumbJsonLd(post, lang, {siteUrl: site, postUrl, urlFor})).replace(/</g, String.fromCharCode(92) + 'u003c')}</script>`

  return `    <div id="reading-bar" aria-hidden="true"></div>

    <nav class="breadcrumb wrap-narrow" aria-label="Breadcrumb">
      <a href="${urlFor('home', lang)}">${esc(s.home)}</a> <span aria-hidden="true">/</span>
      <a href="${urlFor('blog', lang)}">${esc(s.blog)}</a> <span aria-hidden="true">/</span>
      <span aria-current="page">${esc(post.title[lang])}</span>
    </nav>
    ${crumbLd}

    <article class="section">
      <div class="wrap-narrow prose">
        <h1>${esc(post.title[lang])}</h1>
        <p class="post-meta">
          <span class="blog-cat-pill">${esc(post.cat[lang])}</span>
          ${clock}<span>${rt} ${esc(t.blog.min)}</span>
          <span class="blog-meta-dot"></span><span>${post.published ? `<time datetime="${esc(post.published)}">${esc(post.date[lang])}</time>` : esc(post.date[lang])}</span>
        </p>
        <img class="post-hero" src="${assetUrl(post.img)}" alt="${esc(post.imgAlt?.[lang] || post.title[lang])}" width="800" height="600">
        ${body}
      </div>
    </article>

    ${shop}`
}
