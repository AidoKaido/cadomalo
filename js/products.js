/* ==========================================================
   CADOMALO – Product renderer
   Reads /data/products.json (generated at build by scripts/sync-products.js).
   Renders the shop grid on shop.html and the single-product view on
   product.html. All user-controlled fields are inserted via textContent.
   ========================================================== */

'use strict'

const PRODUCTS_URL = '/data/products.json'

const esc = (s) => {
  const d = document.createElement('div')
  d.textContent = s == null ? '' : String(s)
  return d.innerHTML
}

const money = (n) => (typeof n === 'number' ? '$' + n.toFixed(2) : '')

const STAR_SVG = '<svg viewBox="0 0 24 24" fill="var(--cr)" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'
const HEART_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>'

let _cache = null
async function loadProducts() {
  if (_cache) return _cache
  const res = await fetch(PRODUCTS_URL, {cache: 'no-cache'})
  if (!res.ok) throw new Error(`Failed to load products: ${res.status}`)
  const data = await res.json()
  _cache = data.products || []
  return _cache
}

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

function renderShopCard(p, i) {
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
        <div class="prod-stars">${STAR_SVG.repeat(5)}<span>(★)</span></div>
      </div>
    </a>
  `
  return item
}

async function renderShopGrid() {
  const grid = document.getElementById('product-grid')
  if (!grid) return
  grid.innerHTML = '<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--mid);">Loading products…</div>'
  try {
    const products = await loadProducts()
    if (!products.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--mid);">No products yet. <a href="https://cadomalo.sanity.studio/" target="_blank" rel="noopener noreferrer">Add some in the CMS</a>.</div>'
      const count = document.querySelector('.shop-count')
      if (count) count.textContent = '0 products'
      return
    }
    grid.innerHTML = ''
    products.forEach((p, i) => grid.appendChild(renderShopCard(p, i)))
    const count = document.querySelector('.shop-count')
    if (count) count.textContent = `Showing ${products.length} product${products.length === 1 ? '' : 's'}`
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:#b00;">Couldn't load products: ${esc(err.message)}</div>`
  }
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
      root.innerHTML = '<div style="padding:80px;text-align:center;color:var(--mid);">Product not found.</div>'
      return
    }
    populateProduct(p)
  } catch (err) {
    root.innerHTML = `<div style="padding:80px;text-align:center;color:#b00;">Couldn't load product: ${esc(err.message)}</div>`
  }
}

function populateProduct(p) {
  // Title + meta
  document.title = `${p.title} – Cadomalo`
  const metaDesc = document.querySelector('meta[name="description"]')
  if (metaDesc) metaDesc.content = p.seo?.description || p.shortDescription || ''

  // Breadcrumb
  const bcCat = document.querySelector('[data-bc-cat]')
  if (bcCat) bcCat.textContent = p.category?.title || ''
  const bcName = document.querySelector('[data-bc-name]')
  if (bcName) bcName.textContent = p.title

  // Hero image
  const mainImg = document.getElementById('main-img')
  if (mainImg && p.images?.[0]) {
    mainImg.src = p.images[0].url
    mainImg.alt = p.images[0].alt || p.title
  }

  // Gallery thumbs
  const thumbWrap = document.querySelector('[data-thumb-wrap]')
  if (thumbWrap) {
    thumbWrap.innerHTML = ''
    p.images.forEach((img, i) => {
      const t = document.createElement('button')
      t.className = 'gallery-thumb' + (i === 0 ? ' active' : '')
      t.type = 'button'
      const im = document.createElement('img')
      im.src = img.url
      im.alt = img.alt || p.title
      t.appendChild(im)
      t.addEventListener('click', () => {
        mainImg.src = img.url
        mainImg.alt = img.alt || p.title
        thumbWrap.querySelectorAll('.gallery-thumb').forEach((x) => x.classList.remove('active'))
        t.classList.add('active')
      })
      thumbWrap.appendChild(t)
    })
  }

  // Badges
  const badgeWrap = document.querySelector('.prod-badges')
  if (badgeWrap) {
    badgeWrap.innerHTML = ''
    ;(p.badges || []).forEach((b) => {
      const s = document.createElement('span')
      s.className = 'prod-badge ' + badgeClass(b)
      s.textContent = b
      badgeWrap.appendChild(s)
    })
  }

  // Title
  const titleEl = document.querySelector('.prod-title')
  if (titleEl) titleEl.textContent = p.title

  // Price
  const priceNow = document.querySelector('.prod-price-now')
  const priceWas = document.querySelector('.prod-price-was')
  const priceSave = document.querySelector('.prod-price-save')
  if (priceNow) priceNow.textContent = money(p.price)
  if (priceWas) priceWas.textContent = p.compareAtPrice ? money(p.compareAtPrice) : ''
  if (priceSave) {
    const saveAmt = p.compareAtPrice ? (p.compareAtPrice - p.price).toFixed(2) : null
    priceSave.textContent = saveAmt ? `Save $${saveAmt}` : ''
    priceSave.style.display = saveAmt ? '' : 'none'
  }

  // Short description
  const descEl = document.getElementById('prod-desc-text')
  if (descEl) descEl.textContent = p.shortDescription || p.description?.slice(0, 220) || ''

  // Tab description
  const tabDesc = document.getElementById('tab-desc')
  if (tabDesc) {
    tabDesc.innerHTML = ''
    const para = document.createElement('p')
    para.style.whiteSpace = 'pre-line'
    para.textContent = p.description || ''
    tabDesc.appendChild(para)
    const note = document.createElement('p')
    note.style.marginTop = '12px'
    if (p.productType === 'digital') {
      note.innerHTML = '<strong>Delivery:</strong> Instantly via email after payment.'
    } else if (p.productType === 'printify') {
      note.innerHTML = '<strong>Processing:</strong> 1–3 business days (made to order). Tracked shipping.'
    } else {
      note.innerHTML = '<strong>Processing:</strong> 1–3 business days. Tracked shipping.'
    }
    tabDesc.appendChild(note)
  }

  // Personalization
  renderPersonalization(p)
}

function renderPersonalization(p) {
  const wrap = document.querySelector('.custom-text-wrap')
  if (!wrap) return
  const conf = p.personalization || {}
  if (!conf.allowText && !conf.allowImage) {
    wrap.style.display = 'none'
    return
  }
  wrap.style.display = ''
  wrap.innerHTML = ''

  if (conf.allowText) {
    const wrapT = document.createElement('div')
    wrapT.className = 'option-group'
    const lbl = document.createElement('label')
    lbl.className = 'option-label'
    lbl.textContent = `${conf.textLabel || 'Custom text'} (max ${conf.textMaxLength} chars)${conf.textRequired ? ' *' : ''}`
    const inp = document.createElement('input')
    inp.type = 'text'
    inp.maxLength = conf.textMaxLength
    inp.className = 'custom-text-input'
    if (conf.textRequired) inp.required = true
    inp.placeholder = `Up to ${conf.textMaxLength} characters`
    wrapT.appendChild(lbl)
    wrapT.appendChild(inp)
    wrap.appendChild(wrapT)
  }

  if (conf.allowImage) {
    const wrapI = document.createElement('div')
    wrapI.className = 'option-group'
    const lbl = document.createElement('label')
    lbl.className = 'option-label'
    lbl.textContent = `Upload your image (max ${conf.imageMaxSizeMB} MB)${conf.imageRequired ? ' *' : ''}`
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.className = 'custom-image-input'
    if (conf.imageRequired) inp.required = true
    inp.addEventListener('change', () => {
      const f = inp.files?.[0]
      if (f && f.size > conf.imageMaxSizeMB * 1024 * 1024) {
        if (typeof showToast === 'function') showToast(`⚠️ Image too large. Max ${conf.imageMaxSizeMB} MB.`)
        inp.value = ''
      }
    })
    wrapI.appendChild(lbl)
    wrapI.appendChild(inp)
    wrap.appendChild(wrapI)
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderShopGrid()
  renderProductPage()
})
