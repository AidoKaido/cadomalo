/* Blog index + article body.
 *
 * The index reproduces the LAYOUT of the old cadomalo.com blog page
 * (hero, category filter, featured post, card grid, two-widget sidebar) in the
 * new visual language. Class names match the existing initBlogFilter() contract
 * in js/main.js — `.blog-filter-btn[data-cat]` and `.blog-item[data-cat]`,
 * toggling `active` / `hidden` — so no new filter code is needed.
 */

const clock = `<svg class="ic" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

/* Estimated reading time from the real body text at ~200 wpm.
   The drop ships a `min` field; we trust the computed value but fall back to
   it when the body is too short to measure meaningfully. */
export function readingTime(post, lang) {
  const words = (post.body?.[lang] || [])
    .map((b) => b.h || b.p || '')
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const computed = Math.ceil(words / 200)
  return computed >= 1 ? computed : post.min || 1
}

export function renderBlogIndex(posts, lang, t, d) {
  const {esc, postUrl, assetUrl, urlFor, productUrl, bundle, money} = d

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

export function renderPostBody(post, lang, t, d) {
  const {esc, postUrl, assetUrl, urlFor, relatedCard} = d
  const rt = readingTime(post, lang)

  const body = post.body[lang]
    .map((b) => (b.h ? `<h2>${esc(b.h)}</h2>` : `<p>${esc(b.p)}</p>`))
    .join('\n        ')

  return `    <div id="reading-bar" aria-hidden="true"></div>

    <article class="section">
      <div class="wrap-narrow prose">
        <p class="eyebrow"><a href="${urlFor('blog', lang)}">&larr; ${esc(t.blog.back)}</a></p>
        <h1>${esc(post.title[lang])}</h1>
        <p class="post-meta">
          <span class="blog-cat-pill">${esc(post.cat[lang])}</span>
          ${clock}<span>${rt} ${esc(t.blog.min)}</span>
          <span class="blog-meta-dot"></span><span>${esc(post.date[lang])}</span>
        </p>
        <img class="post-hero" src="${assetUrl(post.img)}" alt="" width="800" height="600">
        ${body}
      </div>
    </article>

    ${relatedCard ? `<section class="section band-peach">
      <div class="wrap">
        <div class="center">
          <h2>${esc(t.blog.shopThis)}</h2>
          <p class="lead" style="margin-inline:auto">${esc(t.blog.shopThisP)}</p>
        </div>
        <div class="single-card">${relatedCard}</div>
      </div>
    </section>` : ''}`
}
