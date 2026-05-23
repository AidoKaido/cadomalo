/* ==========================================================
   CADOMALO – Product page renderer (modular)
   Reads /data/products.json (generated at build by sync-products.js).
   On shop pages, renders the grid. On product pages, the product page
   is composed of self-controlling modules identified by data-mod=*.
   Each module knows when to show itself based on product props.
   ========================================================== */

'use strict'

const PRODUCTS_URL = '/data/products.json'

const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="var(--cr)" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
const STAR_EMPTY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="var(--cr)" stroke-width="1.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
const HEART_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>'

const esc = (s) => {
  const d = document.createElement('div')
  d.textContent = s == null ? '' : String(s)
  return d.innerHTML
}
const money = (n) => (typeof n === 'number' ? '$' + n.toFixed(2) : '')
const $ = (sel, ctx = document) => ctx.querySelector(sel)
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)]

let _cache = null
async function loadProducts() {
  if (_cache) return _cache
  const res = await fetch(PRODUCTS_URL, {cache: 'no-cache'})
  if (!res.ok) throw new Error(`Failed to load products: ${res.status}`)
  const data = await res.json()
  _cache = data.products || []
  return _cache
}

// ─────────────────────────────────────────────────── Shop grid

function badgeClass(label) {
  const l = (label || '').toLowerCase()
  if (l.includes('bestseller')) return 'bdg-bestseller'
  if (l.includes('new')) return 'bdg-new'
  if (l.includes('sale')) return 'bdg-sale'
  if (l.includes('ships')) return 'bdg-ships'
  if (l.includes('gift')) return 'bdg-gift'
  return 'bdg-bestseller'
}

function productHref(p) {
  return `product.html?slug=${encodeURIComponent(p.slug)}`
}

function thumbUrl(p) {
  return p.images?.[0]?.url || ''
}

function renderShopCard(p) {
  const cat = p.category?.title || ''
  const catCls = (p.category?.slug || '') + ' ' + (p.productType || '')
  const badge = p.badges?.[0]
  const item = document.createElement('div')
  item.className = 'prod-item'
  item.setAttribute('data-cat', catCls.trim())
  item.setAttribute('data-price', String(p.price || 0))

  item.innerHTML = `
    <a class="prod-card" href="${esc(productHref(p))}" style="display:block;text-decoration:none;color:inherit">
      <div class="prod-thumb">
        <img src="${esc(thumbUrl(p))}" alt="${esc(p.images?.[0]?.alt || p.title)}" loading="lazy">
        ${badge ? `<span class="prod-bdg ${badgeClass(badge)}">${esc(badge)}</span>` : ''}
        <div class="prod-wish" aria-label="Wishlist">${HEART_SVG}</div>
        <div class="prod-quick" role="button">+ Quick Add</div>
      </div>
      <div class="prod-body">
        <p class="prod-cat">${esc(cat)}</p>
        <h3 class="prod-name">${esc(p.title)}</h3>
        <div class="prod-price">
          <span class="p-now">${money(p.price)}</span>
          ${p.compareAtPrice ? `<span class="p-was">${money(p.compareAtPrice)}</span>` : ''}
        </div>
        <div class="prod-stars">${renderStarsHtml(p.rating || 0)}<span>(${p.reviewCount || 0})</span></div>
      </div>
    </a>
  `
  return item
}

function renderStarsHtml(rating) {
  const full = Math.round(rating || 0)
  let html = ''
  for (let i = 0; i < 5; i++) html += i < full ? STAR_SVG : STAR_EMPTY_SVG
  return html
}

async function renderShopGrid() {
  const grid = document.getElementById('product-grid')
  if (!grid) return
  grid.innerHTML = '<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--mid);">Loading products…</div>'
  try {
    const products = await loadProducts()
    if (!products.length) {
      grid.innerHTML =
        '<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--mid);">No products yet.</div>'
      const count = document.querySelector('.shop-count')
      if (count) count.textContent = '0 products'
      return
    }
    grid.innerHTML = ''
    products.forEach((p) => grid.appendChild(renderShopCard(p)))
    const count = document.querySelector('.shop-count')
    if (count) count.textContent = `Showing ${products.length} product${products.length === 1 ? '' : 's'}`
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:#b00;">Couldn't load products: ${esc(err.message)}</div>`
  }
}

// ─────────────────────────────────────────────────── Product page

// State for the current product page.
const state = {
  product: null,
  selectedOptions: {},     // {OptionName: SelectedLabel}
  selectedVariant: null,   // resolved variant object
  personalization: {text: '', image: null},
  quantity: 1,
}

async function renderProductPage() {
  const root = document.querySelector('[data-product-page]')
  if (!root) return
  const params = new URLSearchParams(window.location.search)
  const slug = params.get('slug')
  const legacyId = parseInt(params.get('id'))

  try {
    const products = await loadProducts()
    let p
    if (slug) p = products.find((x) => x.slug === slug)
    else if (legacyId && products[legacyId - 1]) p = products[legacyId - 1]
    else p = products[0]
    if (!p) {
      root.innerHTML =
        '<div style="padding:80px;text-align:center;color:var(--mid);">Product not found.</div>'
      return
    }
    state.product = p
    initSelections(p)
    runModules()
  } catch (err) {
    root.innerHTML = `<div style="padding:80px;text-align:center;color:#b00;">Couldn't load product: ${esc(err.message)}</div>`
  }
}

function initSelections(p) {
  state.selectedOptions = {}
  if (p.variants && p.variants.length && p.options && p.options.length) {
    // Default: first enabled variant
    const def = p.variants.find((v) => v.isEnabled !== false) || p.variants[0]
    state.selectedVariant = def
    state.selectedOptions = {...(def.options || {})}
  } else {
    state.selectedVariant = null
  }
}

function effectivePrice() {
  if (state.selectedVariant && typeof state.selectedVariant.price === 'number') {
    return state.selectedVariant.price
  }
  return state.product?.price || 0
}

function runModules() {
  const p = state.product
  document.title = `${p.title} – Cadomalo`
  setMeta('description', p.seo?.description || p.shortDescription || '')
  setBreadcrumb(p)
  renderJsonLd(p)
  modGallery(p)
  modBadges(p)
  modTitle(p)
  modRating(p)
  modPrice(p)
  modShortDesc(p)
  modVariants(p)
  modPersonalization(p)
  modQuantity(p)
  modActions(p)
  modTrust(p)
  modTabs(p)
}

function setMeta(name, value) {
  const m = document.querySelector(`meta[name="${name}"]`)
  if (m) m.content = value
}

function setBreadcrumb(p) {
  const bcCat = document.querySelector('[data-bc-cat]')
  if (bcCat) bcCat.textContent = p.category?.title || 'Shop'
  const bcName = document.querySelector('[data-bc-name]')
  if (bcName) bcName.textContent = p.title
}

function renderJsonLd(p) {
  const slot = document.getElementById('product-jsonld')
  if (!slot) return
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.title,
    description: p.shortDescription || (p.description || '').slice(0, 200),
    image: (p.images || []).slice(0, 4).map((i) => i.url),
    brand: {'@type': 'Brand', name: 'Cadomalo'},
    offers: {
      '@type': 'Offer',
      price: String(effectivePrice().toFixed(2)),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: window.location.href,
    },
  }
  if (p.rating && p.reviewCount) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: String(p.rating),
      reviewCount: String(p.reviewCount),
    }
  }
  slot.textContent = JSON.stringify(data)
}

// ─── Modules

function modGallery(p) {
  const mainImg = document.getElementById('main-img')
  if (mainImg && p.images?.[0]) {
    mainImg.src = p.images[0].url
    mainImg.alt = p.images[0].alt || p.title
  }
  const thumbWrap = document.querySelector('[data-thumb-wrap]')
  if (!thumbWrap) return
  thumbWrap.innerHTML = ''
  if (!p.images || p.images.length <= 1) {
    thumbWrap.style.display = 'none'
    return
  }
  thumbWrap.style.display = ''
  p.images.forEach((img, i) => {
    const t = document.createElement('button')
    t.className = 'gallery-thumb' + (i === 0 ? ' active' : '')
    t.type = 'button'
    const im = document.createElement('img')
    im.src = img.url
    im.alt = img.alt || p.title
    t.appendChild(im)
    t.addEventListener('click', () => {
      if (mainImg) {
        mainImg.src = img.url
        mainImg.alt = img.alt || p.title
      }
      thumbWrap.querySelectorAll('.gallery-thumb').forEach((x) => x.classList.remove('active'))
      t.classList.add('active')
    })
    thumbWrap.appendChild(t)
  })
}

function modBadges(p) {
  const wrap = document.querySelector('[data-mod="badges"]')
  if (!wrap) return
  wrap.innerHTML = ''
  if (!p.badges?.length) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  p.badges.forEach((b) => {
    const s = document.createElement('span')
    s.className = 'prod-badge ' + badgeClassFor(b)
    s.textContent = b
    wrap.appendChild(s)
  })
}

function badgeClassFor(label) {
  const l = (label || '').toLowerCase()
  if (l.includes('bestseller')) return 'badge-bestseller'
  if (l.includes('ships') || l.includes('fast')) return 'badge-ships-fast'
  if (l.includes('gift')) return 'badge-gift-box'
  return 'badge-bestseller'
}

function modTitle(p) {
  const el = document.querySelector('[data-mod="title"]')
  if (el) el.textContent = p.title
}

function modRating(p) {
  const wrap = document.querySelector('[data-mod="rating"]')
  if (!wrap) return
  if (!p.rating || !p.reviewCount) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  const stars = wrap.querySelector('[data-rating-stars]')
  if (stars) stars.innerHTML = renderStarsHtml(p.rating)
  const text = wrap.querySelector('[data-rating-text]')
  if (text) {
    text.innerHTML = `<strong>${esc(p.rating)}</strong> · <a href="#reviews">${esc(p.reviewCount)} review${p.reviewCount === 1 ? '' : 's'}</a>`
  }
}

function modPrice(p) {
  const wrap = document.querySelector('[data-mod="price"]')
  if (!wrap) return
  const now = wrap.querySelector('[data-price-now]')
  const was = wrap.querySelector('[data-price-was]')
  const save = wrap.querySelector('[data-price-save]')
  const price = effectivePrice()
  if (now) now.textContent = money(price)
  if (was) {
    if (p.compareAtPrice && p.compareAtPrice > price) {
      was.textContent = money(p.compareAtPrice)
      was.style.display = ''
    } else {
      was.style.display = 'none'
    }
  }
  if (save) {
    if (p.compareAtPrice && p.compareAtPrice > price) {
      save.textContent = `Save $${(p.compareAtPrice - price).toFixed(2)}`
      save.style.display = ''
    } else {
      save.style.display = 'none'
    }
  }
}

function modShortDesc(p) {
  const el = document.querySelector('[data-mod="short-desc"]')
  if (!el) return
  el.textContent = p.shortDescription || (p.description || '').slice(0, 200) || ''
}

function modVariants(p) {
  const wrap = document.querySelector('[data-mod="variants"]')
  if (!wrap) return
  wrap.innerHTML = ''
  if (!p.options?.length) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  p.options.forEach((opt) => {
    const group = document.createElement('div')
    group.className = 'option-group'
    const label = document.createElement('p')
    label.className = 'option-label'
    const labelSelected = document.createElement('span')
    labelSelected.textContent = state.selectedOptions[opt.name] || ''
    label.append(opt.name + ' ', labelSelected)
    const btnWrap = document.createElement('div')
    btnWrap.className = 'option-btns'
    btnWrap.setAttribute('role', 'group')
    opt.values.forEach((value) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'opt-btn' + (state.selectedOptions[opt.name] === value ? ' selected' : '')
      btn.textContent = value
      btn.addEventListener('click', () => {
        state.selectedOptions[opt.name] = value
        resolveVariant(p)
        labelSelected.textContent = value
        btnWrap.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('selected'))
        btn.classList.add('selected')
        modPrice(p)
        renderJsonLd(p)
      })
      btnWrap.appendChild(btn)
    })
    group.appendChild(label)
    group.appendChild(btnWrap)
    wrap.appendChild(group)
  })
}

function resolveVariant(p) {
  if (!p.variants?.length) {
    state.selectedVariant = null
    return
  }
  const match = p.variants.find((v) =>
    Object.entries(state.selectedOptions).every(([k, val]) => v.options?.[k] === val)
  )
  state.selectedVariant = match || p.variants[0]
}

function modPersonalization(p) {
  const wrap = document.querySelector('[data-mod="personalization"]')
  if (!wrap) return
  const c = p.personalization || {}
  if (!c.allowText && !c.allowImage) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  wrap.innerHTML = ''

  if (c.allowText) {
    const block = document.createElement('div')
    block.className = 'pers-block'
    const lbl = document.createElement('label')
    lbl.className = 'pers-label'
    lbl.htmlFor = 'pers-text'
    lbl.innerHTML =
      `${esc(c.textLabel || 'Custom text')}${c.textRequired ? ' <span class="pers-required">*</span>' : ' <span class="pers-hint">(optional)</span>'}`
    const input = document.createElement('input')
    input.className = 'pers-input'
    input.type = 'text'
    input.id = 'pers-text'
    input.placeholder = `Up to ${c.textMaxLength || 20} characters`
    input.maxLength = c.textMaxLength || 20
    input.addEventListener('input', () => {
      state.personalization.text = input.value
      hint.textContent = `${input.value.length}/${c.textMaxLength || 20} characters`
      updateActionState()
    })
    const hint = document.createElement('p')
    hint.className = 'pers-hint'
    hint.textContent = `0/${c.textMaxLength || 20} characters`
    block.appendChild(lbl)
    block.appendChild(input)
    block.appendChild(hint)
    wrap.appendChild(block)
  }

  if (c.allowImage) {
    const block = document.createElement('div')
    block.className = 'pers-block'
    const lbl = document.createElement('label')
    lbl.className = 'pers-label'
    lbl.htmlFor = 'pers-image'
    lbl.innerHTML = `Upload your image (max ${esc(c.imageMaxSizeMB || 10)} MB)${c.imageRequired ? ' <span class="pers-required">*</span>' : ' <span class="pers-hint">(optional)</span>'}`
    const input = document.createElement('input')
    input.className = 'pers-file'
    input.type = 'file'
    input.id = 'pers-image'
    input.accept = 'image/*'
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (f && f.size > (c.imageMaxSizeMB || 10) * 1024 * 1024) {
        if (typeof showToast === 'function') showToast(`⚠️ Image too large. Max ${c.imageMaxSizeMB || 10} MB.`)
        input.value = ''
        state.personalization.image = null
      } else {
        state.personalization.image = f || null
      }
      updateActionState()
    })
    block.appendChild(lbl)
    block.appendChild(input)
    wrap.appendChild(block)
  }
}

function modQuantity(p) {
  const wrap = document.querySelector('[data-mod="quantity"]')
  if (!wrap) return
  if (p.productType === 'digital' || p.displayMode === 'digital-simple') {
    wrap.style.display = 'none'
    state.quantity = 1
    return
  }
  wrap.style.display = ''
  const input = wrap.querySelector('[data-qty-input]')
  const down = wrap.querySelector('[data-qty-down]')
  const up = wrap.querySelector('[data-qty-up]')
  if (!input) return
  const sync = () => {
    let v = Math.max(1, Math.min(10, parseInt(input.value || '1') || 1))
    input.value = v
    state.quantity = v
  }
  // Remove any old listeners by cloning
  const freshIn = input.cloneNode(true)
  input.parentNode.replaceChild(freshIn, input)
  freshIn.addEventListener('input', sync)
  if (down) {
    const fd = down.cloneNode(true)
    down.parentNode.replaceChild(fd, down)
    fd.addEventListener('click', () => {
      freshIn.value = Math.max(1, parseInt(freshIn.value || '1') - 1)
      sync()
    })
  }
  if (up) {
    const fu = up.cloneNode(true)
    up.parentNode.replaceChild(fu, up)
    fu.addEventListener('click', () => {
      freshIn.value = Math.min(10, parseInt(freshIn.value || '1') + 1)
      sync()
    })
  }
  sync()
}

function modActions(p) {
  const wrap = document.querySelector('[data-mod="actions"]')
  if (!wrap) return
  const buyBtn = wrap.querySelector('[data-action="buy-now"]')
  const addBtn = wrap.querySelector('[data-action="add-to-cart"]')
  if (!buyBtn) return
  const buyLbl = buyBtn.querySelector('[data-action-label]')
  if (buyLbl) buyLbl.textContent = actionLabelFor(p)
  const buyFresh = buyBtn.cloneNode(true)
  buyBtn.parentNode.replaceChild(buyFresh, buyBtn)
  buyFresh.addEventListener('click', () => buyNow(p, buyFresh))
  state._actionBtn = buyFresh

  if (addBtn) {
    const addFresh = addBtn.cloneNode(true)
    addBtn.parentNode.replaceChild(addFresh, addBtn)
    addFresh.addEventListener('click', () => addToCart(p, addFresh))
  }
  updateActionState()
}

function addToCart(p, btn) {
  const c = p.personalization || {}
  if (c.allowText && c.textRequired && !state.personalization.text.trim()) {
    if (typeof showToast === 'function') showToast('⚠️ Please add your personalization text.')
    document.getElementById('pers-text')?.focus()
    return
  }
  if (c.allowImage && c.imageRequired && !state.personalization.image) {
    if (typeof showToast === 'function') showToast('⚠️ Please upload the required image.')
    document.getElementById('pers-image')?.focus()
    return
  }
  // Persist cart item to localStorage. Image files aren't serializable; for
  // now we just keep the filename hint. Real upload happens at checkout.
  const item = {
    slug: p.slug,
    title: p.title,
    image: p.images?.[0]?.url || null,
    quantity: state.quantity,
    variantId: state.selectedVariant?.id || null,
    variantLabel: state.selectedVariant?.title || null,
    unitPrice: effectivePrice(),
    personalization: {
      text: state.personalization.text || null,
      imageName: state.personalization.image?.name || null,
    },
    addedAt: Date.now(),
  }
  try {
    const raw = localStorage.getItem('cadomalo_cart') || '[]'
    const cart = JSON.parse(raw)
    const existing = cart.find(
      (x) => x.slug === item.slug && x.variantId === item.variantId && x.personalization.text === item.personalization.text
    )
    if (existing) existing.quantity += item.quantity
    else cart.push(item)
    localStorage.setItem('cadomalo_cart', JSON.stringify(cart))
    if (window.Cart?.bump) window.Cart.bump()
    else {
      const counter = document.querySelector('.cart-count')
      if (counter) {
        const n = cart.reduce((a, x) => a + (x.quantity || 0), 0)
        counter.textContent = n
        counter.setAttribute('aria-label', `${n} items in cart`)
      }
    }
  } catch (err) {
    console.error('[cart] save failed', err)
  }
  const lbl = btn.querySelector('[data-add-label]')
  const originalLbl = lbl ? lbl.textContent : btn.textContent
  if (lbl) lbl.textContent = '✓ Added to Cart'
  btn.style.background = '#059669'
  setTimeout(() => {
    if (lbl) lbl.textContent = originalLbl
    btn.style.background = ''
  }, 1800)
  if (typeof window.trackAddToCart === 'function') {
    window.trackAddToCart({id: p.id, name: p.title, price: effectivePrice(), quantity: state.quantity})
  }
}

function actionLabelFor(p) {
  if (p.productType === 'digital') return 'Buy Now — Instant Download'
  if (p.productType === 'custom') return 'Order This Custom Piece'
  return 'Buy Now — Secure Checkout'
}

function updateActionState() {
  const btn = state._actionBtn
  const p = state.product
  if (!btn || !p) return
  const c = p.personalization || {}
  let blocked = false
  if (c.allowText && c.textRequired && !state.personalization.text.trim()) blocked = true
  if (c.allowImage && c.imageRequired && !state.personalization.image) blocked = true
  btn.disabled = blocked
  btn.style.opacity = blocked ? '0.55' : ''
  btn.style.cursor = blocked ? 'not-allowed' : ''
}

async function buyNow(p, btn) {
  const c = p.personalization || {}
  if (c.allowText && c.textRequired && !state.personalization.text.trim()) {
    if (typeof showToast === 'function') showToast('⚠️ Please add your personalization text.')
    document.getElementById('pers-text')?.focus()
    return
  }
  if (c.allowImage && c.imageRequired && !state.personalization.image) {
    if (typeof showToast === 'function') showToast('⚠️ Please upload the required image.')
    document.getElementById('pers-image')?.focus()
    return
  }
  const lbl = btn.querySelector('[data-action-label]')
  const originalLabel = lbl ? lbl.textContent : btn.textContent
  btn.disabled = true
  if (lbl) lbl.textContent = 'Redirecting to checkout…'
  try {
    const body = {
      slug: p.slug,
      quantity: state.quantity,
      variantId: state.selectedVariant?.id || null,
      personalization: {
        text: state.personalization.text || null,
        // Image upload not yet wired through Stripe metadata (Phase 4)
      },
    }
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.url) throw new Error(data.error || `Checkout error (${res.status})`)
    if (typeof window.fbTrack?.initiateCheckout === 'function') {
      window.fbTrack.initiateCheckout({value: effectivePrice() * state.quantity, currency: 'USD'})
    }
    window.location.href = data.url
  } catch (err) {
    console.error('[buy-now]', err)
    btn.disabled = false
    if (lbl) lbl.textContent = originalLabel
    if (typeof showToast === 'function') showToast(`⚠️ ${err.message}`)
    else alert(err.message)
  }
}

function modTrust(p) {
  const shipping = document.querySelector('[data-trust-shipping]')
  if (!shipping) return
  if (p.productType === 'digital') {
    shipping.style.display = 'none'
  } else {
    shipping.style.display = ''
  }
}

function modTabs(p) {
  // Description tab
  const descPane = document.querySelector('[data-tab-pane="desc"]')
  if (descPane) {
    descPane.innerHTML = ''
    if (p.descriptionHtml) {
      descPane.innerHTML = p.descriptionHtml
    } else if (p.description) {
      const para = document.createElement('p')
      para.style.whiteSpace = 'pre-line'
      para.textContent = p.description
      descPane.appendChild(para)
    }
    // Append a small footer about delivery
    const note = document.createElement('p')
    note.style.marginTop = '14px'
    if (p.productType === 'digital') {
      note.innerHTML = '<strong>Delivery:</strong> Instant email delivery after purchase.'
    } else if (p.productType === 'printify') {
      note.innerHTML = '<strong>Processing:</strong> Made to order in 1–3 business days. Tracked shipping.'
    } else if (p.productType === 'custom') {
      note.innerHTML = '<strong>Processing:</strong> Custom orders take 3–7 business days. We may contact you for details.'
    } else {
      note.innerHTML = '<strong>Processing:</strong> Ships within 1–3 business days.'
    }
    descPane.appendChild(note)
  }

  // Reviews tab + label
  const reviewsPane = document.querySelector('[data-tab-pane="reviews"]')
  const reviewsTabBtn = document.querySelector('[data-tab-reviews]')
  const reviews = p.reviews || []
  if (reviewsTabBtn) {
    reviewsTabBtn.textContent = `Reviews (${reviews.length})`
  }
  if (reviewsPane) {
    reviewsPane.innerHTML = ''
    if (!reviews.length) {
      reviewsPane.innerHTML = '<div class="review-empty">No reviews yet. Be the first to share your experience.</div>'
    } else {
      reviews.forEach((r) => {
        const card = document.createElement('div')
        card.className = 'review-card'
        const head = document.createElement('div')
        head.className = 'review-head'
        const stars = document.createElement('div')
        stars.className = 'review-stars'
        stars.innerHTML = renderStarsHtml(r.rating)
        const author = document.createElement('span')
        author.className = 'review-author'
        author.textContent = r.author
        const verified = document.createElement('span')
        verified.className = 'review-verified'
        verified.textContent = '✓ Verified'
        const date = document.createElement('span')
        date.className = 'review-date'
        date.textContent = formatReviewDate(r.date)
        head.appendChild(stars)
        head.appendChild(author)
        if (r.verified) head.appendChild(verified)
        head.appendChild(date)
        card.appendChild(head)
        if (r.title) {
          const t = document.createElement('p')
          t.className = 'review-title'
          t.textContent = r.title
          card.appendChild(t)
        }
        const body = document.createElement('p')
        body.className = 'review-body'
        body.textContent = r.body
        card.appendChild(body)
        reviewsPane.appendChild(card)
      })
    }
  }

  // Tab nav handlers
  const navBtns = document.querySelectorAll('.tab-nav-btn[data-tab]')
  const panes = document.querySelectorAll('.tab-content[data-tab-pane]')
  navBtns.forEach((btn) => {
    const fresh = btn.cloneNode(true)
    btn.parentNode.replaceChild(fresh, btn)
    fresh.addEventListener('click', () => {
      const tab = fresh.getAttribute('data-tab')
      navBtns.forEach((b) => b.classList.remove('active'))
      panes.forEach((p2) => p2.classList.remove('active'))
      fresh.classList.add('active')
      const target = document.querySelector(`[data-tab-pane="${tab}"]`)
      if (target) target.classList.add('active')
    })
  })
}

function formatReviewDate(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'})
}

// ─────────────────────────────────────────────────── Boot

function showBootError(msg) {
  const grid = document.getElementById('product-grid')
  if (grid) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:#b00;font-family:monospace;">JS error: ${esc(msg)}</div>`
  }
  console.error('[products.js boot]', msg)
}

window.addEventListener('error', (e) => showBootError(e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')))
window.addEventListener('unhandledrejection', (e) => showBootError('Unhandled: ' + (e.reason?.message || e.reason)))

function syncCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem('cadomalo_cart') || '[]')
    const n = cart.reduce((a, x) => a + (x.quantity || 0), 0)
    document.querySelectorAll('.cart-count').forEach((el) => {
      el.textContent = n
      el.setAttribute('aria-label', `${n} items in cart`)
    })
  } catch (e) {
    /* ignore */
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    syncCartCount()
    renderShopGrid()
    renderProductPage()
  } catch (err) {
    showBootError(err.message)
  }
})
