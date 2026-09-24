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
 * without depending on a rewrite.
 *
 * Page bodies are built here in JS; the chrome lives in templates/_partials/
 * and the homepage additionally uses templates/home.html.
 */
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {join, dirname} from 'node:path'
import {renderProductBody, amazonUrl} from './lib/pdp.js'
import {renderBlogIndex, renderPostBody, readingTime} from './lib/blog.js'

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
const REVIEWS = readJson('reviews.json')
const POSTS = readJson('posts.json')
const LEGAL = readJson('legal.json')

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
const legalUrl = (id, lang) => pathToUrl(LEGAL_SLUGS[id][lang])
const productUrl = (p, lang) => pathToUrl(productPath(p, lang))
const postUrl = (post, lang) => pathToUrl(postPath(post, lang))

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
function renderHead({title, description, lang, pathEn, pathFr, ogImage, noindex}) {
  const self = lang === 'fr' ? pathFr : pathEn
  const canonical = SITE_URL + pathToUrl(self)
  const img = SITE_URL + (ogImage || '/assets/logo-square.png')
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${noindex ? '<meta name="robots" content="noindex,nofollow">' : ''}
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${SITE_URL + pathToUrl(pathEn)}">
  <link rel="alternate" hreflang="fr" href="${SITE_URL + pathToUrl(pathFr)}">
  <link rel="alternate" hreflang="x-default" href="${SITE_URL + pathToUrl(pathEn)}">
  <meta property="og:type" content="website">
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

  const navOrder = ['home', 'shop', 'collections', 'blog', 'about', 'sale']
  const navLinks = navOrder
    .map((p) => `<a href="${urlFor(p, lang)}"${p === activePage ? ' aria-current="page"' : ''}>${esc(t.nav[p])}</a>`)
    .join('\n      ')
  const navLinksMobile = navOrder
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
function shell({lang, activePage, pathEn, pathFr, title, description, body, ogImage, noindex, jsonLd}) {
  const ctx = baseContext(lang, activePage, pathEn, pathFr)
  const head = renderHead({title, description, lang, pathEn, pathFr, ogImage, noindex})
  const ld = jsonLd ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''
  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  ${head}${ld}
</head>
<body>
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
const money = (n) => `$${n.toFixed(2)}`
const assetUrl = (p) => `/assets/${String(p).replace(/^img\//, '')}`
const badgeClass = (tone) =>
  tone === 'solid' ? 'badge badge-solid' : tone === 'sky' ? 'badge badge-sky' : 'badge badge-soft'
const stars = (r) => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r))

/* once any product links to Amazon, every card reserves the second button
   slot so Add to cart lines up across a row, linked or not */
const AMAZON_SLOT = CATALOG.some((p) => amazonUrl(p, 'en'))

function renderCard(p, lang, t) {
  const href = productUrl(p, lang)
  const amazon = amazonUrl(p, lang)
  const amazonBtn = amazon
    ? `<a class="btn btn-quiet btn-full" href="${esc(amazon)}" target="_blank" rel="noopener">${esc(t.product.amazon)}</a>`
    : AMAZON_SLOT ? `<span class="btn btn-full card-slot" aria-hidden="true"></span>` : ''
  const badge = p.badge ? `<span class="${badgeClass(p.badgeTone)}">${esc(p.badge[lang])}</span>` : ''
  const was = p.compareAt ? `<del>${money(p.compareAt)}</del>` : ''
  return `<article class="card" data-type="${p.type}">
          <a class="card-media" href="${href}" tabindex="-1" aria-hidden="true">
            ${badge}<img src="${assetUrl(p.img)}" alt="" width="600" height="600" loading="lazy">
          </a>
          <div class="card-body">
            <p class="card-series">${esc(p.series[lang])}</p>
            <h3 class="card-title"><a href="${href}">${esc(p.title[lang])}</a></h3>
            <p class="rating"><span class="stars" aria-hidden="true">${stars(p.rating)}</span>
              <span>${p.rating.toFixed(1)} (${p.reviewCount})</span></p>
            <p class="card-price">${money(p.price)} ${was}</p>
            <p class="card-langs">${esc(p.langs)}</p>
          </div>
          <div class="card-actions">
            <button type="button" class="btn btn-primary btn-full" data-add="${p.id}">${esc(t.product.add)}</button>
            ${amazonBtn}
          </div>
        </article>`
}

const grid = (items, lang, t) =>
  `<div class="grid-products">${items.map((p) => renderCard(p, lang, t)).join('\n          ')}</div>`

/* ---------- builders ---------------------------------------------------- */
const out = []
const add = (path, html) => out.push({path, html})

function buildHome(lang) {
  const t = UI[lang]
  const bundle = CATALOG.find((p) => p.type === 'bundle')
  const TOPIC_KEYS = ['body', 'world', 'science', 'animals', 'feelings', 'languages', 'arts']
  const ctx = baseContext(lang, 'home', ROUTES.home.en, ROUTES.home.fr)

  Object.assign(ctx, {
    heroTrust: t.hero.trust.map((x) => `<li>${esc(x)}</li>`).join('\n            '),
    topicCards: t.topics.items
      .map((label, i) => `<li class="topic-card"><a href="${urlFor('shop', lang)}">
              <img src="/assets/topic-${TOPIC_KEYS[i]}.png" alt="" width="96" height="96" loading="lazy">
              <span>${esc(label)}</span></a></li>`)
      .join('\n          '),
    bookCards: CATALOG.filter((p) => p.type === 'book').map((p) => renderCard(p, lang, t)).join('\n          '),
    wrapCards: CATALOG.filter((p) => p.type === 'wrap').map((p) => renderCard(p, lang, t)).join('\n          '),
    methodSteps: t.method.items
      .map((s) => `<li class="method-step"><span class="method-n">${esc(s.n)}</span>
            <h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></li>`)
      .join('\n          '),
    reviewCards: REVIEWS.slice(0, 3)
      .map((r) => `<figure class="review-card">
            <p class="rating"><span class="stars" aria-hidden="true">${stars(r.rating)}</span></p>
            <blockquote>${esc(r[lang])}</blockquote>
            <figcaption>${esc(r.name)} · ${esc(r.place)}</figcaption></figure>`)
      .join('\n          '),
    blogCards: POSTS.slice(0, 3)
      .map((post) => `<article class="card">
            <a class="card-media" href="${postUrl(post, lang)}" tabindex="-1" aria-hidden="true">
              <img src="${assetUrl(post.img)}" alt="" width="600" height="600" loading="lazy"></a>
            <div class="card-body">
              <p class="card-series">${esc(post.cat[lang])} · ${post.min} ${esc(t.blog.min)}</p>
              <h3 class="card-title"><a href="${postUrl(post, lang)}">${esc(post.title[lang])}</a></h3>
              <p>${esc(post.excerpt[lang])}</p></div></article>`)
      .join('\n          '),
    bundleUrl: productUrl(bundle, lang),
    shopWrapsUrl: `${urlFor('shop', lang)}#wraps`,
  })

  const body = render(readFileSync(join(TPL, 'home.html'), 'utf8'), ctx, `home.${lang}`)
  add(ROUTES.home[lang], shell({
    lang, activePage: 'home', pathEn: ROUTES.home.en, pathFr: ROUTES.home.fr,
    title: `Cadomalo — ${t.hero.t1} ${t.hero.t2}`,
    description: t.hero.text, body, ogImage: '/assets/hero-reading.png',
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Cadomalo',
      url: SITE_URL, logo: `${SITE_URL}/assets/logo-square.png`,
      description: t.hero.text, email: 'support@cadomalo.com',
    },
  }))
}

function buildShop(lang) {
  const t = UI[lang]
  const filters = ['all', 'book', 'bundle', 'wrap']
  const chips = t.shop.filters
    .map((label, i) => `<button type="button" class="chip${i === 0 ? ' is-active' : ''}" data-filter="${filters[i]}">${esc(label)}</button>`)
    .join('\n          ')
  const body = `    <section class="section">
      <div class="wrap">
        <h1>${esc(t.shop.title)}</h1>
        <p class="lead">${esc(t.shop.p)}</p>
        <div class="filter-row" role="group">
          ${chips}
          <span class="filter-count" data-shop-count>${CATALOG.length} ${esc(t.shop.count)}</span>
        </div>
        <div id="wraps"></div>
        ${grid(CATALOG, lang, t)}
      </div>
    </section>`
  add(ROUTES.shop[lang], shell({
    lang, activePage: 'shop', pathEn: ROUTES.shop.en, pathFr: ROUTES.shop.fr,
    title: `${t.shop.title} — Cadomalo`, description: t.shop.p, body,
  }))
}

function buildCollections(lang) {
  const t = UI[lang]
  const books = CATALOG.filter((p) => p.type === 'book')
  const bundle = CATALOG.find((p) => p.type === 'bundle')
  const body = `    <section class="section">
      <div class="wrap center">
        <p class="eyebrow">${esc(t.cols.eyebrow)}</p>
        <h1>${esc(t.cols.h)}</h1>
        <p class="lead" style="margin-inline:auto">${esc(t.cols.p)}</p>
        <ul class="fact-pills">${t.cols.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <p class="hero-ctas" style="justify-content:center">
          <a class="btn btn-primary" href="${productUrl(bundle, lang)}">${esc(t.cols.cta)}</a>
          <a class="btn btn-quiet" href="${urlFor('shop', lang)}">${esc(t.cols.cta2)}</a>
        </p>
      </div>
    </section>

    <section class="section band-peach">
      <div class="wrap">
        <h2 class="center">${esc(t.cols.inside)}</h2>
        <div style="margin-top:var(--space-8)">${grid(books, lang, t)}</div>
      </div>
    </section>

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
  add(ROUTES.collections[lang], shell({
    lang, activePage: 'collections', pathEn: ROUTES.collections.en, pathFr: ROUTES.collections.fr,
    title: `${t.cols.h} — Cadomalo`, description: t.cols.p, body, ogImage: '/assets/bundle-cover.png',
  }))
}

function buildSale(lang) {
  const t = UI[lang]
  const reduced = CATALOG.filter((p) => p.compareAt)
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
    title: `${t.sale.h1} ${t.sale.h2} — Cadomalo`, description: t.sale.p, body,
  }))
}

function buildAbout(lang) {
  const t = UI[lang]
  const body = `    <section class="section">
      <div class="wrap-narrow">
        <p class="eyebrow">${esc(t.about.eyebrow)}</p>
        <h1 class="hero-title"><span>${esc(t.about.h1)}</span><span class="accent">${esc(t.about.h2)}</span></h1>
        <p class="lead">${esc(t.about.intro)}</p>
      </div>
    </section>
    <section class="section band-mint">
      <div class="wrap-narrow prose">
        <h2>${esc(t.about.storyH)}</h2>
        ${t.about.story.map((p) => `<p>${esc(p)}</p>`).join('\n        ')}
        <p class="signature">${esc(t.about.sign)}</p>
      </div>
    </section>
    <section class="section">
      <div class="wrap">
        <h2 class="center">${esc(t.about.valuesH)}</h2>
        <div class="method-row" style="margin-top:var(--space-8)">
          ${t.about.values.map((v) => `<div class="method-step"><h3>${esc(v.h)}</h3><p>${esc(v.p)}</p></div>`).join('\n          ')}
        </div>
      </div>
    </section>
    <section class="section band-butter">
      <div class="wrap-narrow center">
        <h2>${esc(t.about.etsyH)}</h2>
        <p class="lead" style="margin-inline:auto">${esc(t.about.etsyP)}</p>
        <p><a class="btn btn-secondary" href="https://www.etsy.com/shop/CadomaloShop" target="_blank" rel="noopener">${esc(t.about.etsyCta)}</a></p>
      </div>
    </section>`
  add(ROUTES.about[lang], shell({
    lang, activePage: 'about', pathEn: ROUTES.about.en, pathFr: ROUTES.about.fr,
    title: `${t.about.eyebrow} — Cadomalo`, description: t.about.intro, body,
  }))
}

const postCard = (post, lang, t) => `<article class="card">
            <a class="card-media" href="${postUrl(post, lang)}" tabindex="-1" aria-hidden="true">
              <img src="${assetUrl(post.img)}" alt="" width="600" height="600" loading="lazy"></a>
            <div class="card-body">
              <p class="card-series">${esc(post.cat[lang])} · ${post.min} ${esc(t.blog.min)}</p>
              <h3 class="card-title"><a href="${postUrl(post, lang)}">${esc(post.title[lang])}</a></h3>
              <p>${esc(post.excerpt[lang])}</p></div></article>`

function buildBlogIndex(lang) {
  const t = UI[lang]
  const bundle = CATALOG.find((p) => p.type === 'bundle')
  const body = renderBlogIndex(POSTS, lang, t, {
    esc, postUrl, assetUrl, urlFor, productUrl, money, bundle,
  })
  add(ROUTES.blog[lang], shell({
    lang, activePage: 'blog', pathEn: ROUTES.blog.en, pathFr: ROUTES.blog.fr,
    title: `${t.blog.title} — Cadomalo`, description: t.blog.p, body,
    ogImage: assetUrl(POSTS[0].img),
  }))
}

function buildPost(post, lang) {
  const t = UI[lang]
  const related = CATALOG.find((p) => p.id === post.product)
  const body = renderPostBody(post, lang, t, {
    esc, postUrl, assetUrl, urlFor,
    relatedCard: related ? renderCard(related, lang, t) : '',
  })
  add(postPath(post, lang), shell({
    lang, activePage: 'blog', pathEn: postPath(post, 'en'), pathFr: postPath(post, 'fr'),
    title: `${post.title[lang]} — Cadomalo`, description: post.excerpt[lang], body,
    ogImage: assetUrl(post.img),
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: post.title[lang], description: post.excerpt[lang],
      image: SITE_URL + assetUrl(post.img), inLanguage: lang,
      timeRequired: `PT${readingTime(post, lang)}M`,
      author: {'@type': 'Organization', name: 'Cadomalo'},
      publisher: {'@type': 'Organization', name: 'Cadomalo',
        logo: {'@type': 'ImageObject', url: `${SITE_URL}/assets/logo-square.png`}},
      mainEntityOfPage: SITE_URL + postUrl(post, lang),
    },
  }))
}


function buildProduct(p, lang) {
  const t = UI[lang]
  const gallery = (p.gallery && p.gallery.length ? p.gallery : [p.img]).map(assetUrl)
  const related = CATALOG.filter((x) => x.id !== p.id && x.type === p.type).slice(0, 4)

  const body = renderProductBody(p, lang, t, {
    esc, money, assetUrl, stars, badgeClass, urlFor, productUrl,
    reviews: REVIEWS,
    related,
    grid: related.map((x) => renderCard(x, lang, t)).join('\n          '),
  })

  add(productPath(p, lang), shell({
    lang, activePage: 'shop', pathEn: productPath(p, 'en'), pathFr: productPath(p, 'fr'),
    title: `${p.title[lang]} — Cadomalo`, description: p.desc[lang], body,
    ogImage: assetUrl(p.img),
    /* Deliberately no aggregateRating: the review counts shipped in the design
       are placeholders, and invented review markup is a Google structured-data
       violation that penalises the whole domain. */
    jsonLd: {
      '@context': 'https://schema.org', '@type': 'Product',
      name: p.title[lang], description: p.desc[lang],
      image: gallery.map((g) => SITE_URL + g),
      brand: {'@type': 'Brand', name: 'Cadomalo'},
      offers: {
        '@type': 'Offer', price: p.price.toFixed(2), priceCurrency: 'USD',
        availability: 'https://schema.org/InStock', url: SITE_URL + productUrl(p, lang),
      },
    },
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
    title: `${doc.title[lang]} — Cadomalo`, description: doc.title[lang], body,
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
    title: `${t.cart.title} — Cadomalo`, description: t.cart.title, body, noindex: true,
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
    title: `${t.footer.contact} — Cadomalo`, description: t.footer.contact, body,
  }))
}

/* Order confirmation: js/cart.js empties the basket and fills in the order
   from /api/get-checkout-session. Files are sent by hand from support@. */
function buildThanks(lang) {
  const t = UI[lang]
  const L = {
    en: {
      title: 'Thank you for your order!', order: 'Order', sentTo: 'A receipt is on its way to',
      summary: 'Your order', total: 'Total paid',
      steps: [
        ['Check your email', 'Stripe sends your payment receipt within a few minutes — have a look in spam if you don’t see it.'],
        ['We prepare your files', 'We check your order and get your printable files ready.'],
        ['Files in your inbox', 'Your files arrive from support@cadomalo.com within 24 hours. Print, colour, enjoy!'],
      ],
      help: 'Questions about your order? Write to support@cadomalo.com — we answer within 2 working days.',
      missing: 'We couldn’t load your order details, but your payment went through if you reached this page from checkout. Email support@cadomalo.com with any questions.',
      unpaid: 'Your payment is not complete yet. If you were charged, email support@cadomalo.com with your order number.',
      cta: 'Keep exploring',
    },
    fr: {
      title: 'Merci pour votre commande !', order: 'Commande', sentTo: 'Un reçu arrive à',
      summary: 'Votre commande', total: 'Total payé',
      steps: [
        ['Vérifiez vos e-mails', 'Stripe vous envoie le reçu de paiement en quelques minutes — pensez à regarder dans les spams.'],
        ['Nous préparons vos fichiers', 'Nous vérifions votre commande et préparons vos fichiers à imprimer.'],
        ['Vos fichiers par e-mail', 'Vos fichiers arrivent depuis support@cadomalo.com dans les 24 heures. Imprimez, coloriez, profitez !'],
      ],
      help: 'Une question sur votre commande ? Écrivez à support@cadomalo.com — nous répondons sous 2 jours ouvrés.',
      missing: 'Nous n’avons pas pu charger le détail de votre commande, mais si vous arrivez ici depuis le paiement, il a bien été accepté. Écrivez à support@cadomalo.com pour toute question.',
      unpaid: 'Votre paiement n’est pas encore finalisé. Si vous avez été débité, écrivez à support@cadomalo.com avec votre numéro de commande.',
      cta: 'Continuer la visite',
    },
  }[lang]
  const steps = L.steps
    .map(([h, p], i) => `<li class="thanks-step"><span class="objection-n">${i + 1}</span><div><h3>${esc(h)}</h3><p>${esc(p)}</p></div></li>`)
    .join('\n            ')
  const body = `    <section class="section">
      <div class="wrap-narrow" data-confirmation data-missing="${esc(L.missing)}" data-unpaid="${esc(L.unpaid)}">
        <h1>${esc(L.title)}</h1>
        <p class="lead">${esc(L.order)} <strong data-confirm-id>—</strong></p>
        <p data-confirm-email-row hidden>${esc(L.sentTo)} <strong data-confirm-email></strong></p>
        <p class="form-status" data-confirm-error role="status" hidden></p>
        <div class="cart-summary thanks-summary" data-confirm-summary hidden>
          <h2 class="thanks-h">${esc(L.summary)}</h2>
          <div data-confirm-lines></div>
          <p class="cart-row cart-total"><span>${esc(L.total)}</span><strong data-confirm-total></strong></p>
        </div>
        <ol class="thanks-steps">
            ${steps}
        </ol>
        <p class="nl-note">${esc(L.help)}</p>
        <p><a class="btn btn-primary" href="${urlFor('shop', lang)}">${esc(L.cta)}</a></p>
      </div>
    </section>`
  add(ROUTES.thanks[lang], shell({
    lang, activePage: 'thanks', pathEn: ROUTES.thanks.en, pathFr: ROUTES.thanks.fr,
    title: `${L.title} — Cadomalo`, description: L.title, body, noindex: true,
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
  for (const p of CATALOG) buildProduct(p, lang)
  for (const doc of LEGAL) buildLegal(doc, lang)
}

for (const {path, html} of out) {
  const file = path === '' ? join(ROOT, 'index.html') : join(ROOT, path, 'index.html')
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, html)
}

/* Minimal client catalogue so the cart can re-render lines on any page
   without the product being present in the DOM. `slug` is the English slug
   and is the stable key the checkout API will look products up by. */
const clientCatalog = CATALOG.map((p) => ({
  id: p.id,
  slug: productSlug(p, 'en'),
  type: p.type,
  price: p.price,
  img: assetUrl(p.img),
  title: {en: p.title.en, fr: p.title.fr},
  url: {en: productUrl(p, 'en'), fr: productUrl(p, 'fr')},
  cartProof: p.cartProof ? {en: p.cartProof.en, fr: p.cartProof.fr} : null,
  attrs: (p.attrs || []).map((a) => ({
    label: {en: a.label.en, fr: a.label.fr},
    options: a.options.map((o) => ({en: o.en, fr: o.fr, delta: o.delta || 0})),
  })),
}))
mkdirSync(join(ROOT, 'data'), {recursive: true})
writeFileSync(join(ROOT, 'data', 'catalog-client.json'), JSON.stringify(clientCatalog, null, 2) + '\n')
console.log(`[pages] wrote data/catalog-client.json (${clientCatalog.length} products)`)

const fr = out.filter((o) => o.path === 'fr' || o.path.startsWith('fr/')).length
console.log(`[pages] wrote ${out.length} pages  (en: ${out.length - fr}, fr: ${fr})`)

if (missing.length) {
  console.warn(`\n[pages] ${new Set(missing).size} missing key(s) — rendered empty:`)
  for (const m of [...new Set(missing)].slice(0, 30)) console.warn(`  ! ${m}`)
  process.exitCode = 1
}
