/* Product detail page body.
 *
 * Started as a translation of the design prototype (New/Cadomalo Site Phone);
 * since the 25-product restructure it renders only honest content: no
 * invented ratings, basket counters, countdowns or placeholder UGC tiles.
 * Reviews come from real, approved review documents only.
 *
 * Media (images + optional video) is resolved by build-pages.js from what
 * actually exists on disk, so nothing here can point at a missing file.
 */

/* small inline icon set — inlined to avoid a CDN dependency */
const ICON = {
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M13 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  play: '<path d="M6 3l14 9-14 9z"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 21h16"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  heart: '<path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
}
export const icon = (name, size) =>
  `<svg class="ic" width="${size || 20}" height="${size || 20}" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ` +
  `aria-hidden="true">${ICON[name] || ''}</svg>`

/* optional Amazon listing — a plain URL, or {en, fr} for per-market stores */
export const amazonUrl = (p, lang) =>
  p.amazon ? (typeof p.amazon === 'string' ? p.amazon : p.amazon[lang] || p.amazon.en) : ''

export function renderProductBody(p, lang, t, d) {
  const {esc, money, stars, badgeClass, urlFor, productUrl, media, reviews, complete, reviewUrl} = d
  const T = t.pdp2
  const {images, videos} = media
  const savePct = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0
  const isCanva = p.fulfillment === 'canva-links'

  /* ---------- gallery: images on disk + optional demo video ---------- */
  const badge = p.badge ? `<span class="${badgeClass(p.badgeTone)} pdp-badge">${esc(p.badge[lang])}</span>` : ''
  const slides = [
    ...images.slice(0, 1).map((src) => ({kind: 'img', src})),
    ...videos.map((v) => ({kind: 'video', src: v.src, poster: v.poster})),
    ...images.slice(1).map((src) => ({kind: 'img', src})),
  ]
  const first = slides[0]
  const mainMedia = !first
    ? `<div class="pdp-cover-tile" style="--tile:${p.color}"><span>${esc(p.series[lang])}</span><strong>${esc(p.title[lang])}</strong></div>`
    : first.kind === 'img'
      ? `<img data-gallery-main src="${first.src}" alt="${esc(p.title[lang])}" width="800" height="800" fetchpriority="high">`
      : `<video data-gallery-main src="${first.src}"${first.poster ? ` poster="${first.poster}"` : ''} muted autoplay loop playsinline preload="metadata" aria-label="${esc(T.videoLabel)}"></video>`

  const thumbs = slides.length > 1
    ? `<div class="pdp-thumbs" data-gallery-thumbs>${slides
        .map((s, i) => s.kind === 'img'
          ? `<button type="button" class="pdp-thumb${i === 0 ? ' is-active' : ''}" data-kind="img" data-src="${s.src}"
              aria-label="${esc(p.title[lang])} — ${i + 1}"><img src="${s.src}" alt="" width="144" height="144" loading="lazy"></button>`
          : `<button type="button" class="pdp-thumb pdp-thumb-video${i === 0 ? ' is-active' : ''}" data-kind="video" data-src="${s.src}"${s.poster ? ` data-poster="${s.poster}"` : ''}
              aria-label="${esc(T.playVideo)}">${s.poster ? `<img src="${s.poster}" alt="" width="144" height="144" loading="lazy">` : ''}<span class="thumb-play">${icon('play', 16)}</span></button>`)
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
  const ratingLink = reviews.length
    ? `<a class="rating-link" href="#reviews"><span class="stars" aria-hidden="true">${stars(avg(reviews))}</span>
              <span>${avg(reviews).toFixed(1)} · ${reviews.length} ${esc(t.product.reviews)}</span></a>`
    : ''

  const priceRow = `<div class="pdp-price-row">
            <span class="pdp-price" data-price>${money(p.price)}</span>
            ${p.compareAt ? `<s class="pdp-compare">${money(p.compareAt)}</s>
            <span class="badge badge-solid pdp-save">${esc(t.product.save)} ${savePct}%</span>` : ''}
          </div>`

  const instantBadge = `<div class="instant-badge">${icon('download', 22)}
            <div><strong>${esc(isCanva ? T.canvaBadge : T.instantBadge)}</strong><span>${esc(isCanva ? T.canvaSub : T.instantSub)}</span></div>
          </div>`

  const benefits = p.benefits
    ? `<ul class="benefit-list">${p.benefits[lang]
        .map((b) => `<li><span class="benefit-check">${icon('check', 14)}</span><span>${esc(b)}</span></li>`)
        .join('')}</ul>`
    : ''

  const buyTrust = [
    {ic: 'download', label: t.product.instant},
    {ic: 'lock', label: t.product.secure},
    {ic: 'heart', label: t.product.promise},
  ].map((b) => `<span class="buy-trust-item">${icon(b.ic, 18)}${esc(b.label)}</span>`).join('')

  const amazon = amazonUrl(p, lang)
  const amazonBtn = amazon
    ? `<a class="btn btn-quiet btn-lg amazon-btn" href="${esc(amazon)}" target="_blank" rel="noopener">${esc(t.product.amazon)}</a>`
    : ''

  const buyRow = `<div class="buy-actions">
          <div class="buy-row">
            <div class="qty-control">
              <button type="button" class="icon-btn" data-qty-down aria-label="−">${icon('minus', 18)}</button>
              <span class="qty-num" data-qty-num>1</span>
              <button type="button" class="icon-btn" data-qty-up aria-label="+">${icon('plus', 18)}</button>
            </div>
            <button type="button" class="btn btn-primary btn-lg buy-btn" data-add="${p.id}" data-from-pdp data-buy-main>
              ${esc(t.product.add)}
            </button>
          </div>
          ${amazonBtn}
          </div>
          <div class="buy-trust">${buyTrust}</div>`

  const guarantee = `<div class="guarantee-box">${icon('shield', 26)}
            <div><strong>${esc(T.guaranteeH)}</strong><p>${esc(T.guaranteeP)}</p></div>
          </div>`

  /* ---------- what's inside + page previews ---------- */
  const inside = p.inside ? p.inside[lang] : []
  const previews = images.slice(1, 5)
  const insideBlock = inside.length || previews.length
    ? `<section class="section inside" id="inside">
      <div class="wrap inside-grid">
        <div>
          <h2>${esc(T.insideH)}</h2>
          ${inside.length ? `<ul class="spec-list">${inside
            .map((s) => `<li><span class="spec-icon">${icon('sparkle', 18)}</span>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${p.specs ? `<ul class="spec-chips">${p.specs[lang].map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
        </div>
        ${previews.length ? `<div>
          <h3 class="visually-hidden">${esc(T.previewsH)}</h3>
          <div class="preview-grid">${previews
            .map((src) => `<img src="${src}" alt="${esc(T.previewsH)} — ${esc(p.title[lang])}" width="400" height="400" loading="lazy">`).join('')}</div>
        </div>` : ''}
      </div>
    </section>`
    : ''

  /* ---------- FAQ from objections ---------- */
  const faq = (p.objections && p.objections[lang]) || []
  const faqBlock = faq.length
    ? `<section class="section band-blue" id="faq">
      <div class="wrap-narrow">
        <p class="eyebrow">${esc(t.product.descKicker)}</p>
        <h2>${esc(T.faqH)}</h2>
        <div class="faq-list">${faq
          .map((o, i) => `<details class="faq-item"${i === 0 ? ' open' : ''}>
            <summary><span>${esc(o.q)}</span>${icon('chevron', 20)}</summary>
            <p>${esc(o.a)}</p>
          </details>`).join('\n          ')}</div>
      </div>
    </section>`
    : ''

  /* ---------- reviews: real ones, or an honest invitation ---------- */
  const reviewsBlock = reviews.length
    ? `<section class="section" id="reviews">
      <div class="wrap">
        <div class="reviews-head">
          <h2>${esc(t.product.reviewsH)}</h2>
          <div class="reviews-score">
            <span class="score-num">${avg(reviews).toFixed(1)}</span>
            <div>
              <span class="stars" aria-hidden="true">${stars(avg(reviews))}</span>
              <p class="score-based">${esc(t.product.based)} ${reviews.length} ${esc(t.product.reviews)}</p>
            </div>
          </div>
        </div>
        <div class="review-row">${reviews.slice(0, 6)
          .map((r) => `<figure class="review-card">
            <p class="rating"><span class="stars" aria-label="${r.rating}/5">${stars(r.rating)}</span></p>
            ${r.photo ? `<img class="review-photo" src="${esc(r.photo)}" alt="" width="320" height="240" loading="lazy">` : ''}
            <blockquote>${esc(r.text)}</blockquote>
            <figcaption>${esc(r.name)}${r.verified ? ` · <span class="verified">${icon('check', 12)} ${esc(t.product.verified)}</span>` : ''}</figcaption>
          </figure>`).join('\n          ')}</div>
        <p class="center" style="margin-top:var(--space-6)"><a class="btn btn-quiet" href="${reviewUrl}">${esc(T.reviewsEmptyCta)}</a></p>
      </div>
    </section>`
    : `<section class="section" id="reviews">
      <div class="wrap-narrow review-invite">
        ${icon('pen', 28)}
        <h2>${esc(T.reviewsEmptyH)}</h2>
        <p>${esc(T.reviewsEmptyP)}</p>
        <a class="btn btn-secondary" href="${reviewUrl}">${esc(T.reviewsEmptyCta)}</a>
      </div>
    </section>`

  /* ---------- complete the collection / related ---------- */
  const {bundle, cards, heading} = complete
  const bundleOffer = bundle
    ? `<div class="complete-offer">
          ${bundle.image ? `<img src="${bundle.image}" alt="" width="240" height="240" loading="lazy">` : ''}
          <div>
            <p class="eyebrow">${esc(bundle.p.series[lang])}</p>
            <h3><a href="${productUrl(bundle.p, lang)}">${esc(bundle.p.title[lang])}</a></h3>
            <p>${esc(T.completeBundle)} <strong>${money(bundle.p.price)}</strong>
              ${bundle.p.compareAt ? `<s>${money(bundle.p.compareAt)}</s> · ${esc(T.completeSave)} ${money(bundle.p.compareAt - bundle.p.price)}` : ''}</p>
            <p class="complete-actions">
              <button type="button" class="btn btn-primary" data-add="${bundle.p.id}">${esc(t.product.add)}</button>
              <a class="btn btn-quiet" href="${productUrl(bundle.p, lang)}">${esc(t.shop2.seeCollection)}</a>
            </p>
          </div>
        </div>`
    : ''
  const completeBlock = bundleOffer || cards
    ? `<section class="section band-peach">
      <div class="wrap">
        <h2>${esc(heading)}</h2>
        ${bundleOffer}
        ${cards ? `<div class="related-grid">${cards}</div>` : ''}
      </div>
    </section>`
    : ''

  /* ---------- sticky mobile add-to-cart ---------- */
  const sticky = `<div class="sticky-buy" data-sticky-buy hidden>
      <div class="sticky-buy-copy"><strong>${esc(p.title[lang])}</strong><span>${money(p.price)}${p.compareAt ? ` <s>${money(p.compareAt)}</s>` : ''}</span></div>
      <button type="button" class="btn btn-primary" data-add="${p.id}">${esc(t.product.add)}</button>
    </div>`

  /* ---------- assemble ---------- */
  return `    <nav class="breadcrumb wrap" aria-label="Breadcrumb">
      <a href="${urlFor('home', lang)}">${esc(t.product.home)}</a> <span aria-hidden="true">/</span>
      <a href="${urlFor('shop', lang)}">${esc(t.product.shop)}</a> <span aria-hidden="true">/</span>
      <span>${esc(p.title[lang])}</span>
    </nav>

    <section class="pdp">
      <div class="wrap pdp-grid">

        <div class="pdp-media" data-gallery>
          <div class="pdp-frame" style="background:${p.color}22" data-gallery-frame>
            ${badge}
            ${mainMedia}
          </div>
          ${thumbs}
          ${couponBox}
        </div>

        <div class="buy-box" data-product="${p.id}" data-name="${esc(p.title.en)}" data-value="${p.price.toFixed(2)}" data-category="${p.category}">
          <p class="pdp-series" style="color:${p.color}">${esc(p.series[lang])}</p>
          <h1>${esc(p.title[lang])}</h1>
          ${ratingLink}
          <p class="pdp-desc">${esc(p.desc[lang])}</p>
          ${priceRow}
          ${instantBadge}
          ${benefits}
          ${buyRow}
          ${guarantee}
        </div>

      </div>
    </section>

    ${insideBlock}
    ${faqBlock}
    ${reviewsBlock}
    ${completeBlock}
    ${sticky}`
}

export const avg = (rs) => (rs.length ? rs.reduce((a, r) => a + Number(r.rating || 0), 0) / rs.length : 0)
