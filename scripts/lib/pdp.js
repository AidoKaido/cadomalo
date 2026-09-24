/* Product detail page body.
 *
 * This is a faithful translation of the prototype at
 * New/Cadomalo Site Phone/Cadomalo Site.dc.html lines 446-644 — React with
 * inline styles there, static HTML + CSS classes here. Where this file and
 * the prototype disagree, the prototype is right.
 *
 * Extracted from build-pages.js to keep that file readable.
 */

/* small inline icon set — the design system substitutes Lucide, but inlining
   avoids a CDN dependency and keeps icons working under a strict CSP */
const ICON = {
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  flame: '<path d="M12 2c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 2 2 2 0 0-2-1-3 1-5z"/>',
  play: '<path d="M6 3l14 9-14 9z"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 21h16"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  heart: '<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z"/>',
}
const icon = (name, size) =>
  `<svg class="ic" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true">${ICON[name] || ''}</svg>`

/* three overlapping initial avatars, as in the prototype trust row */
const AVATARS = [
  {i: 'S', bg: 'var(--coral-500)', fg: '#fff'},
  {i: 'D', bg: 'var(--sky-500)', fg: '#fff'},
  {i: 'N', bg: 'var(--yellow-500)', fg: 'var(--blue-700)'},
]
const avatarStack = () =>
  `<span class="avatar-stack">${AVATARS.map(
    (a) => `<span class="avatar" style="background:${a.bg};color:${a.fg}">${a.i}</span>`
  ).join('')}</span>`

const UGC_HANDLES = ['@sophie.and.leo', '@maman.bilingue', '@curious.twins']
const UGC_TINTS = ['var(--coral-100)', 'var(--sky-100)', 'var(--sage-100)']

/* optional Amazon listing — a plain URL, or {en, fr} for per-market stores */
export const amazonUrl = (p, lang) =>
  p.amazon ? (typeof p.amazon === 'string' ? p.amazon : p.amazon[lang] || p.amazon.en) : ''

export function renderProductBody(p, lang, t, d) {
  const {esc, money, assetUrl, stars, badgeClass, urlFor, productUrl, reviews: ALL_REVIEWS, grid, related} = d

  const gallery = (p.gallery && p.gallery.length ? p.gallery : [p.img]).map(assetUrl)
  const reviews = ALL_REVIEWS.filter((r) => r.type === p.reviewType)
  const slides = reviews.length ? reviews : ALL_REVIEWS.slice(0, 3)
  const objections = (p.objections && p.objections[lang]) || []
  const firstObj = objections[0]
  const restObj = objections.slice(1)
  const specImg = gallery[2] || gallery[1] || gallery[0]

  const savePct = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0

  /* ---------- left column ---------- */
  const badge = p.badge
    ? `<span class="${badgeClass(p.badgeTone)} pdp-badge">${esc(p.badge[lang])}</span>`
    : ''

  const thumbs = gallery.length > 1
    ? `<div class="pdp-thumbs">${gallery
        .map((g, i) => `<button type="button" class="pdp-thumb${i === 0 ? ' is-active' : ''}" data-src="${g}"
              aria-label="${esc(p.title[lang])} — ${i + 1}"><img src="${g}" alt="" width="144" height="144" loading="lazy"></button>`)
        .join('')}</div>`
    : ''

  const couponBox = `<div class="coupon-box">
            <span class="coupon-icon">${icon('ticket', 22)}</span>
            <div class="coupon-copy">
              <span class="eyebrow">${esc(t.product.couponEyebrow)}</span>
              <strong>${esc(t.product.couponText)}</strong>
            </div>
            <span class="coupon-code" data-coupon-code>CURIOUS10</span>
            <button type="button" class="btn btn-quiet btn-sm" data-copy-code="CURIOUS10"
                    data-label-copy="${esc(t.product.copy)}" data-label-copied="${esc(t.product.copied)}">${esc(t.product.copy)}</button>
          </div>`

  /* ---------- buy box ---------- */
  const trustRow = `<div class="pdp-social">
            <span class="trust-pill">${avatarStack()}<span>${esc(p.trust[lang])}</span></span>
            <a class="rating-link" href="#reviews">
              <span class="stars" aria-hidden="true">${stars(p.rating)}</span>
              <span>${p.reviewCount} ${esc(t.product.reviews)}</span>
            </a>
          </div>`

  const priceRow = `<div class="pdp-price-row">
            <span class="pdp-price" data-price>${money(p.price)}</span>
            ${p.compareAt ? `<s class="pdp-compare">${money(p.compareAt)}</s>
            <span class="badge badge-solid pdp-save">${esc(t.product.save)} ${savePct}%</span>` : ''}
          </div>`

  const benefits = p.benefits
    ? `<ul class="benefit-list">${p.benefits[lang]
        .map((b) => `<li><span class="benefit-check">${icon('check', 14)}</span><span>${esc(b)}</span></li>`)
        .join('')}</ul>`
    : ''

  /* review slider — first slide rendered, the rest carried as data for js/cart.js */
  const sliderData = slides.map((r) => ({
    q: r[lang], a: r.name, p: r.place, r: r.rating,
  }))
  const s0 = sliderData[0]
  const reviewSlider = s0
    ? `<div class="review-slider" data-review-slider data-slides='${esc(JSON.stringify(sliderData))}'
               data-verified="${esc(t.product.verified)}">
            <div class="review-slider-head">
              <span class="stars" aria-hidden="true" data-slide-stars>${stars(s0.r)}</span>
              <span class="review-slider-nav">
                <button type="button" class="icon-btn" data-slide-prev aria-label="${esc(t.product.reviews)} ←">${icon('left', 18)}</button>
                <button type="button" class="icon-btn" data-slide-next aria-label="${esc(t.product.reviews)} →">${icon('right', 18)}</button>
              </span>
            </div>
            <blockquote data-slide-quote>${esc(s0.q)}</blockquote>
            <div class="review-slider-foot">
              <span class="review-author">
                <span class="review-initial" data-slide-initial>${esc(s0.a.slice(0, 1))}</span>
                <span data-slide-author>${esc(s0.a)}</span>
                <span class="verified">${icon('check', 12)} ${esc(t.product.verified)}</span>
              </span>
              <span class="slider-dots" data-slide-dots>${sliderData
                .map((_, i) => `<span class="dot${i === 0 ? ' is-active' : ''}"></span>`)
                .join('')}</span>
            </div>
          </div>`
    : ''

  /* variant attributes as selectable pills, not dropdowns */
  const attrs = (p.attrs || [])
    .map((a, ai) => `<div class="attr-group" data-attr-group="${ai}">
            <p class="attr-head">${esc(a.label[lang])}: <span data-attr-value="${ai}">${esc(a.options[0][lang])}</span></p>
            <div class="attr-options">${a.options
              .map((o, oi) => `<button type="button" class="tag${oi === 0 ? ' is-selected' : ''}"
                  data-attr="${ai}" data-opt="${oi}" data-delta="${o.delta || 0}"
                  aria-pressed="${oi === 0}">${esc(o[lang])}${o.delta ? ` <span class="tag-delta">+${money(o.delta)}</span>` : ''}</button>`)
              .join('')}</div>
          </div>`)
    .join('\n          ')

  const ugc = `<div class="ugc-block">
            <p class="attr-head">${esc(t.product.ugcH)}</p>
            <div class="ugc-row">${UGC_HANDLES.map(
              (h, i) => `<div class="ugc-tile" style="background:${UGC_TINTS[i]}">
                <span class="ugc-tag">UGC video</span>
                <span class="ugc-play">${icon('play', 20)}</span>
                <span class="ugc-handle">${esc(h)}</span>
              </div>`
            ).join('')}</div>
          </div>`

  const urgency = `<div class="urgency-box">
            <p class="urgency-line"><span class="urgency-icon">${icon('timer', 20)}</span>
              ${esc(t.product.urgency)} <span class="urgency-clock" data-day-clock>--:--:--</span></p>
            <p class="urgency-sub"><span class="urgency-flame">${icon('flame', 18)}</span>${esc(p.basket[lang])}</p>
          </div>`

  const buyTrust = [
    {ic: 'download', label: t.product.instant},
    {ic: 'lock', label: t.product.secure},
    {ic: 'heart', label: t.product.promise},
  ]
    .map((b) => `<span class="buy-trust-item">${icon(b.ic, 18)}${esc(b.label)}</span>`)
    .join('')

  const amazon = amazonUrl(p, lang)
  const amazonBtn = amazon
    ? `<a class="btn btn-quiet btn-lg amazon-btn" href="${esc(amazon)}" target="_blank" rel="noopener">
              ${esc(t.product.amazon)}
            </a>`
    : ''

  const buyRow = `<div class="buy-actions">
          <div class="buy-row">
            <div class="qty-control">
              <button type="button" class="icon-btn" data-qty-down aria-label="−">${icon('minus', 18)}</button>
              <span class="qty-num" data-qty-num>1</span>
              <button type="button" class="icon-btn" data-qty-up aria-label="+">${icon('plus', 18)}</button>
            </div>
            <button type="button" class="btn btn-primary btn-lg buy-btn" data-add="${p.id}" data-from-pdp>
              ${esc(t.product.add)}
            </button>
          </div>
          ${amazonBtn}
          </div>
          <div class="buy-trust">${buyTrust}</div>`

  /* ---------- objections: biggest first, and big ---------- */
  const objectionsBlock = firstObj
    ? `<section class="section band-blue objections">
      <div class="wrap">
        <p class="eyebrow">${esc(t.product.descKicker)}</p>
        <h2 class="objections-h">${esc(t.product.descH)}</h2>

        <div class="objection-lead">
          <span class="objection-n objection-n-lg">1</span>
          <div>
            <h3>${esc(firstObj.q)}</h3>
            <p>${esc(firstObj.a)}</p>
          </div>
        </div>

        ${restObj.length ? `<div class="objection-grid">${restObj
          .map((o, i) => `<div class="objection-card">
            <span class="objection-n">${i + 2}</span>
            <div><h3>${esc(o.q)}</h3><p>${esc(o.a)}</p></div>
          </div>`)
          .join('\n          ')}</div>` : ''}
      </div>
    </section>`
    : ''

  const specsBlock = p.specs
    ? `<section class="section specs">
      <div class="wrap specs-grid">
        <div>
          <h2>${esc(t.product.specsH)}</h2>
          <ul class="spec-list">${p.specs[lang]
            .map((s) => `<li><span class="spec-icon">${icon('sparkle', 18)}</span>${esc(s)}</li>`)
            .join('')}</ul>
        </div>
        <img src="${specImg}" alt="" width="600" height="600" loading="lazy">
      </div>
    </section>`
    : ''

  const reviewsBlock = reviews.length
    ? `<section class="section" id="reviews">
      <div class="wrap">
        <div class="reviews-head">
          <h2>${esc(t.product.reviewsH)}</h2>
          <div class="reviews-score">
            <span class="score-num">${p.rating.toFixed(1)}</span>
            <div>
              <span class="stars" aria-hidden="true">${stars(p.rating)}</span>
              <p class="score-based">${esc(t.product.based)} ${p.reviewCount} ${esc(t.product.reviews)}</p>
            </div>
          </div>
        </div>
        <div class="review-row">${reviews
          .slice(0, 4)
          .map((r) => `<figure class="review-card">
            <p class="rating"><span class="stars" aria-hidden="true">${stars(r.rating)}</span></p>
            <blockquote>${esc(r[lang])}</blockquote>
            <figcaption>${esc(r.name)} · ${esc(r.place)}</figcaption>
          </figure>`)
          .join('\n          ')}</div>
      </div>
    </section>`
    : ''

  const relatedBlock = related.length
    ? `<section class="section">
      <div class="wrap">
        <h2>${esc(t.product.related)}</h2>
        <div class="related-grid">${grid}</div>
      </div>
    </section>`
    : ''

  /* ---------- assemble ---------- */
  return `    <nav class="breadcrumb wrap" aria-label="Breadcrumb">
      <a href="${urlFor('home', lang)}">${esc(t.product.home)}</a> <span aria-hidden="true">/</span>
      <a href="${urlFor('shop', lang)}">${esc(t.product.shop)}</a> <span aria-hidden="true">/</span>
      <span>${esc(p.title[lang])}</span>
    </nav>

    <section class="pdp">
      <div class="wrap pdp-grid">

        <div class="pdp-media">
          <div class="pdp-frame" style="background:${p.color}22">
            ${badge}
            <img id="pdp-main" src="${gallery[0]}" alt="${esc(p.title[lang])}" width="800" height="800" fetchpriority="high">
          </div>
          ${thumbs}
          ${couponBox}
        </div>

        <div class="buy-box" data-product="${p.id}">
          <p class="pdp-series" style="color:${p.color}">${esc(p.series[lang])}</p>
          <h1>${esc(p.title[lang])}</h1>
          <p class="pdp-desc">${esc(p.desc[lang])}</p>
          ${trustRow}
          ${priceRow}
          ${benefits}
          ${reviewSlider}
          ${attrs}
          ${ugc}
          ${urgency}
          ${buyRow}
        </div>

      </div>
    </section>

    ${objectionsBlock}
    ${specsBlock}
    ${reviewsBlock}
    ${relatedBlock}`
}
