/* Cadomalo cart + product interactions.
 *
 * The cart array in localStorage['cadomalo_cart'] keeps exactly the item shape
 * api/create-checkout-session.js already expects:
 *   {slug, title, image, quantity, variantId, variantLabel, unitPrice,
 *    personalization, addedAt}
 * Anything else the UI needs (reservation deadline, applied code, last added
 * product) lives in a separate 'cadomalo_cart_meta' key so the array stays
 * API-compatible.
 *
 * Discount codes are DISPLAY ONLY here. The code is handed to the checkout
 * endpoint, which maps it to a real Stripe promotion code — Stripe is the only
 * thing allowed to set a price.
 *
 * Every block no-ops when its markup is absent, so this file is safe on every page.
 */
(function () {
  'use strict';

  var CART_KEY = 'cadomalo_cart';
  var META_KEY = 'cadomalo_cart_meta';
  var LANG = document.documentElement.lang === 'fr' ? 'fr' : 'en';
  var RESERVE_MS = 10 * 60 * 1000;
  var CODES = {CURIOUS10: 0.10, WELCOME15: 0.15};
  var catalog = null;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- storage --------------------------------------------------- */
  function read() {
    try { var v = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setMeta(patch) {
    var m = meta();
    for (var k in patch) m[k] = patch[k];
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) {}
    return m;
  }
  function write(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) {}
    if (!items.length) setMeta({reserveEnd: 0, code: '', lastAdded: ''});
    renderAll(items);
  }

  var money = function (n) { return '$' + Number(n).toFixed(2); };
  var lineKey = function (i) { return i.slug + '|' + (i.variantId || ''); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------- catalogue -------------------------------------------------- */
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return fetch('/data/catalog-client.json', {cache: 'no-cache'})
      .then(function (r) { return r.json(); })
      .then(function (j) { catalog = j; return j; })
      .catch(function () { catalog = []; return catalog; });
  }
  var byId = function (id) { return (catalog || []).filter(function (p) { return p.id === id; })[0] || null; };
  var bySlug = function (s) { return (catalog || []).filter(function (p) { return p.slug === s; })[0] || null; };

  /* ---------- totals ------------------------------------------------------ */
  function subtotal(items) {
    return items.reduce(function (a, x) { return a + x.unitPrice * x.quantity; }, 0);
  }
  function discountRate() {
    var c = meta().code;
    return c && CODES[c] ? CODES[c] : 0;
  }

  /* ---------- toast -------------------------------------------------------- */
  var toastTimer;
  function toast(msg) {
    var el = $('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------- add / mutate -------------------------------------------------- */
  function addToCart(id, opts) {
    var p = byId(id);
    if (!p) return;
    opts = opts || {};
    var picks = opts.picks || (p.attrs || []).map(function () { return 0; });
    var qty = Math.max(1, Math.min(10, opts.qty || 1));

    var delta = 0, labels = [];
    (p.attrs || []).forEach(function (a, i) {
      var o = a.options[picks[i]];
      if (!o) return;
      delta += o.delta || 0;
      labels.push(o[LANG]);
    });

    var item = {
      slug: p.slug,
      title: p.title[LANG],
      image: p.img,
      quantity: qty,
      variantId: picks.length ? 'v-' + picks.join('-') : '',
      variantLabel: labels.join(' · '),
      unitPrice: Number((p.price + delta).toFixed(2)),
      personalization: null,
      addedAt: Date.now()
    };

    var items = read(), found = null;
    for (var i = 0; i < items.length; i++) {
      if (lineKey(items[i]) === lineKey(item)) { found = items[i]; break; }
    }
    if (found) found.quantity = Math.min(10, found.quantity + qty);
    else items.push(item);

    var m = meta();
    setMeta({
      lastAdded: p.id,
      reserveEnd: m.reserveEnd && m.reserveEnd > Date.now() ? m.reserveEnd : Date.now() + RESERVE_MS
    });

    write(items);

    if (window.trackAddToCart) {
      try {
        window.trackAddToCart({id: p.slug, name: item.title, value: item.unitPrice * qty, currency: 'USD'});
      } catch (e) {}
    }
    openDrawer();
  }

  function changeQty(key, d) {
    var items = read();
    for (var i = 0; i < items.length; i++) {
      if (lineKey(items[i]) === key) {
        items[i].quantity += d;
        if (items[i].quantity < 1) items.splice(i, 1);
        else items[i].quantity = Math.min(10, items[i].quantity);
        break;
      }
    }
    write(items);
  }
  function removeLine(key) {
    write(read().filter(function (x) { return lineKey(x) !== key; }));
  }

  /* ---------- line markup ---------------------------------------------------- */
  function lineHtml(item, removeLabel) {
    var p = bySlug(item.slug);
    var href = p ? p.url[LANG] : '#';
    var k = lineKey(item);
    return '<div class="cart-line" data-key="' + k + '">' +
      '<a class="cart-line-media" href="' + href + '" tabindex="-1" aria-hidden="true">' +
        '<img src="' + item.image + '" alt="" width="96" height="128" loading="lazy"></a>' +
      '<div class="cart-line-body">' +
        '<div class="cart-line-top">' +
          '<a class="cart-line-title" href="' + href + '">' + item.title + '</a>' +
          '<span class="cart-line-total">' + money(item.unitPrice * item.quantity) + '</span>' +
        '</div>' +
        (item.variantLabel ? '<p class="cart-line-variant">' + item.variantLabel + '</p>' : '') +
        '<div class="cart-line-foot">' +
          '<div class="qty-control">' +
            '<button type="button" class="icon-btn" data-qty-dec="' + k + '" aria-label="-">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>' +
            '<span class="qty-num">' + item.quantity + '</span>' +
            '<button type="button" class="icon-btn" data-qty-inc="' + k + '" aria-label="+">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
          '</div>' +
          '<button type="button" class="cart-remove-link" data-remove="' + k + '">' + (removeLabel || 'Remove') + '</button>' +
        '</div>' +
      '</div></div>';
  }

  /* ---------- render ---------------------------------------------------------- */
  function renderAll(items) {
    items = items || read();
    var n = items.reduce(function (a, x) { return a + x.quantity; }, 0);

    $$('[data-cart-count]').forEach(function (el) { el.textContent = String(n); el.hidden = n === 0; });

    var head = $('[data-drawer-count]');
    if (head) head.textContent = n ? '(' + n + ')' : '';

    renderDrawer(items);
    renderCartPage(items);
  }

  function renderDrawer(items) {
    var lines = $('[data-drawer-lines]');
    if (!lines) return;
    var empty = $('[data-drawer-empty]');
    var body = $('[data-drawer-body]');
    var foot = $('[data-drawer-foot]');
    var urg = $('[data-drawer-urgency]');
    var filled = items.length > 0;

    if (empty) empty.hidden = filled;
    if (body) body.hidden = !filled;
    if (foot) foot.hidden = !filled;
    if (urg) urg.hidden = !filled;
    if (!filled) { lines.innerHTML = ''; return; }

    var removeLabel = (lines.getAttribute('data-remove-label')) || 'Remove';
    lines.innerHTML = items.map(function (i) { return lineHtml(i, removeLabel); }).join('');

    /* per-product proof from the last added item */
    var proof = $('[data-drawer-proof]');
    var proofText = $('[data-drawer-proof-text]');
    var last = byId(meta().lastAdded);
    if (proof && proofText) {
      if (last && last.cartProof && last.cartProof[LANG]) {
        proofText.textContent = last.cartProof[LANG];
        proof.hidden = false;
      } else proof.hidden = true;
    }

    var sub = subtotal(items);
    var rate = discountRate();
    var disc = sub * rate;
    var set = function (sel, v) { var e = $(sel); if (e) e.textContent = v; };
    set('[data-drawer-subtotal]', money(sub));
    set('[data-drawer-total]', money(sub - disc));
    var dRow = $('[data-drawer-discount-row]');
    if (dRow) {
      dRow.hidden = !rate;
      set('[data-drawer-discount]', '-' + money(disc));
      set('[data-drawer-code]', meta().code || '');
    }
  }

  function renderCartPage(items) {
    var page = $('[data-cart-page]');
    if (!page) return;
    var lines = $('[data-cart-lines]', page);
    var empty = $('[data-cart-empty]', page);
    var summary = $('[data-cart-summary]', page);
    var filled = items.length > 0;
    if (empty) empty.hidden = filled;
    if (lines) { lines.hidden = !filled; lines.innerHTML = filled ? items.map(function (i) { return lineHtml(i); }).join('') : ''; }
    if (summary) summary.hidden = !filled;
    if (!filled) return;
    var sub = subtotal(items), disc = sub * discountRate();
    var s = $('[data-cart-subtotal]', page), t = $('[data-cart-total]', page);
    if (s) s.textContent = money(sub);
    if (t) t.textContent = money(sub - disc);
  }

  /* ---------- drawer open/close ------------------------------------------------ */
  var lastFocused = null;
  var FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea';

  function openDrawer() {
    var d = $('#cart-drawer'), scrim = $('[data-cart-scrim]');
    if (!d) return;
    lastFocused = document.activeElement;
    d.hidden = false;
    if (scrim) scrim.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { d.classList.add('is-open'); });
    var f = d.querySelector(FOCUSABLE);
    if (f) f.focus();
  }
  function closeDrawer() {
    var d = $('#cart-drawer'), scrim = $('[data-cart-scrim]');
    if (!d || d.hidden) return;
    d.classList.remove('is-open');
    d.hidden = true;
    if (scrim) scrim.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  /* ---------- countdowns -------------------------------------------------------- */
  /* Presentational only — the basket reserves nothing and the launch price
     does not actually expire. Kept because the design specifies it. */
  function tickClocks() {
    var day = $('[data-day-clock]');
    if (day) {
      var end = new Date(); end.setHours(23, 59, 59, 999);
      var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      day.textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    }
    var res = $('[data-reserve-clock]');
    if (res) {
      var m = meta();
      var left = m.reserveEnd ? Math.max(0, Math.floor((m.reserveEnd - Date.now()) / 1000)) : RESERVE_MS / 1000;
      res.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
    }
  }

  /* ---------- product page ------------------------------------------------------- */
  function initPdp() {
    var box = $('[data-product]');
    if (!box) return;
    var id = box.getAttribute('data-product');
    var priceEl = $('[data-price]', box);
    var qtyEl = $('[data-qty-num]', box);
    var qty = 1;

    function picks() {
      return $$('[data-attr-group]', box).map(function (g) {
        var sel = g.querySelector('.tag.is-selected');
        return sel ? parseInt(sel.getAttribute('data-opt'), 10) : 0;
      });
    }
    function updatePrice() {
      var p = byId(id);
      if (!p || !priceEl) return;
      var delta = $$('.tag.is-selected', box).reduce(function (a, el) {
        return a + (parseFloat(el.getAttribute('data-delta')) || 0);
      }, 0);
      priceEl.textContent = money(p.price + delta);
    }

    /* variant pills */
    box.addEventListener('click', function (e) {
      var tag = e.target.closest('.tag[data-attr]');
      if (tag) {
        var gi = tag.getAttribute('data-attr');
        var group = box.querySelector('[data-attr-group="' + gi + '"]');
        $$('.tag', group).forEach(function (x) { x.classList.remove('is-selected'); x.setAttribute('aria-pressed', 'false'); });
        tag.classList.add('is-selected');
        tag.setAttribute('aria-pressed', 'true');
        var val = box.querySelector('[data-attr-value="' + gi + '"]');
        if (val) val.textContent = tag.textContent.replace(/\s*\+\$[\d.]+\s*$/, '').trim();
        updatePrice();
        return;
      }
      if (e.target.closest('[data-qty-up]')) { qty = Math.min(10, qty + 1); if (qtyEl) qtyEl.textContent = qty; return; }
      if (e.target.closest('[data-qty-down]')) { qty = Math.max(1, qty - 1); if (qtyEl) qtyEl.textContent = qty; return; }
      if (e.target.closest('[data-from-pdp]')) { addToCart(id, {picks: picks(), qty: qty}); return; }
    });

    loadCatalog().then(updatePrice);

    /* gallery */
    var main = $('#pdp-main');
    $$('.pdp-thumb').forEach(function (b) {
      b.addEventListener('click', function () {
        if (main) main.src = b.getAttribute('data-src');
        $$('.pdp-thumb').forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
    });
  }

  /* review slider inside the buy box */
  function initReviewSlider() {
    var el = $('[data-review-slider]');
    if (!el) return;
    var slides;
    try { slides = JSON.parse(el.getAttribute('data-slides')); } catch (e) { return; }
    if (!slides || slides.length < 2) return;

    var i = 0;
    var q = $('[data-slide-quote]', el), au = $('[data-slide-author]', el);
    var ini = $('[data-slide-initial]', el), st = $('[data-slide-stars]', el);
    var dots = $$('[data-slide-dots] .dot', el);

    function show(n) {
      i = (n + slides.length) % slides.length;
      var s = slides[i];
      if (q) q.textContent = s.q;
      if (au) au.textContent = s.a;
      if (ini) ini.textContent = s.a.slice(0, 1);
      if (st) st.textContent = '★'.repeat(Math.round(s.r)) + '☆'.repeat(5 - Math.round(s.r));
      dots.forEach(function (d, di) { d.classList.toggle('is-active', di === i); });
    }
    var prev = $('[data-slide-prev]', el), next = $('[data-slide-next]', el);
    if (prev) prev.addEventListener('click', function () { show(i - 1); stop(); });
    if (next) next.addEventListener('click', function () { show(i + 1); stop(); });

    var timer = null;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    if (!reduced) {
      timer = setInterval(function () { show(i + 1); }, 6000);
      el.addEventListener('mouseenter', stop);
      el.addEventListener('focusin', stop);
    }
  }

  /* copy the coupon code */
  function initCopyCode() {
    $$('[data-copy-code]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var code = btn.getAttribute('data-copy-code');
        var done = function () {
          btn.textContent = btn.getAttribute('data-label-copied') || 'Copied';
          setTimeout(function () { btn.textContent = btn.getAttribute('data-label-copy') || 'Copy'; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done).catch(done);
        } else done();
      });
    });
  }

  /* ---------- discount code ------------------------------------------------------ */
  function initCodeForm() {
    var form = $('[data-code-form]');
    if (!form) return;
    var input = $('[data-code-input]', form.parentNode) || $('[data-code-input]');
    var msg = $('[data-code-msg]');
    var okLabel = form.getAttribute('data-ok') || '';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var code = (input.value || '').trim().toUpperCase();
      if (CODES[code]) {
        setMeta({code: code});
        if (input) input.classList.remove('is-bad');
        if (msg) {
          msg.hidden = false;
          msg.className = 'code-msg is-ok';
          msg.textContent = code + ' ' + (form.getAttribute('data-applied') || okLabel);
        }
        renderAll();
      } else {
        setMeta({code: ''});
        if (input) input.classList.add('is-bad');
        if (msg) {
          msg.hidden = false;
          msg.className = 'code-msg is-bad';
          msg.textContent = form.getAttribute('data-bad') || '';
        }
        renderAll();
      }
    });
  }

  /* ---------- shop filters ---------------------------------------------------------- */
  function initShopFilters() {
    var chips = $$('.chip[data-filter]');
    if (!chips.length) return;
    var cards = $$('.card[data-type]');
    var countEl = $('[data-shop-count]');
    var label = countEl ? countEl.textContent.replace(/^\d+\s*/, '') : '';
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var f = chip.getAttribute('data-filter');
        chips.forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        var shown = 0;
        cards.forEach(function (card) {
          var match = f === 'all' || card.getAttribute('data-type') === f;
          card.hidden = !match;
          if (match) shown++;
        });
        if (countEl) countEl.textContent = shown + ' ' + label;
      });
    });
  }

  /* ---------- checkout ---------------------------------------------------------------- */
  function initCheckout() {
    $$('[data-checkout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var items = read();
        if (!items.length) return;
        btn.disabled = true;
        var original = btn.innerHTML;
        btn.textContent = '…';
        fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            cart: items.map(function (x) {
              return {slug: x.slug, quantity: x.quantity, variantId: x.variantId};
            }),
            discountCode: meta().code || undefined,
            lang: LANG
          })
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d && d.url) { window.location.href = d.url; return; }
            throw new Error((d && d.error) || 'checkout failed');
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.innerHTML = original;
            toast(String(err.message || err));
          });
      });
    });
  }

  /* ---------- order confirmation ------------------------------------------------------- */
  function initConfirmation() {
    var root = $('[data-confirmation]');
    if (!root) return;
    var sessionId = new URLSearchParams(window.location.search).get('session_id') || '';
    var error = $('[data-confirm-error]', root);
    function fail(msg) { error.textContent = msg; error.hidden = false; }
    if (!/^cs_(test|live)_/.test(sessionId)) { fail(root.getAttribute('data-missing')); return; }

    write([]);
    $('[data-confirm-id]', root).textContent = sessionId.slice(-12).toUpperCase();

    var fmt = function (cents) { return money((cents || 0) / 100); };
    fetch('/api/get-checkout-session?session_id=' + encodeURIComponent(sessionId))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        if (d.payment_status !== 'paid') fail(root.getAttribute('data-unpaid'));
        if (d.customer_email) {
          $('[data-confirm-email]', root).textContent = d.customer_email;
          $('[data-confirm-email-row]', root).hidden = false;
        }
        var lines = $('[data-confirm-lines]', root);
        lines.innerHTML = '';
        (d.line_items || []).forEach(function (li) {
          var row = document.createElement('p');
          row.className = 'cart-row';
          var name = document.createElement('span');
          name.textContent = (li.description || '') + ' × ' + (li.quantity || 1);
          var amount = document.createElement('strong');
          amount.textContent = fmt(li.amount_total);
          row.appendChild(name);
          row.appendChild(amount);
          lines.appendChild(row);
        });
        $('[data-confirm-total]', root).textContent = fmt(d.amount_total);
        $('[data-confirm-summary]', root).hidden = false;
        if (window.trackPurchase && d.payment_status === 'paid') {
          try { window.trackPurchase({orderId: d.id, value: (d.amount_total || 0) / 100, currency: 'USD'}); } catch (e) {}
        }
      })
      .catch(function () { fail(root.getAttribute('data-missing')); });
  }

  /* ---------- contact form ------------------------------------------------------------- */
  function initContactForm() {
    var form = $('[data-contact-form]');
    if (!form) return;
    var status = $('[data-form-status]', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var body = {};
      new FormData(form).forEach(function (v, k) { body[k] = v; });
      if (status) status.textContent = '…';
      fetch('/api/contact', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (status) status.textContent = d && d.ok ? form.getAttribute('data-ok') : form.getAttribute('data-err');
          if (d && d.ok) form.reset();
        })
        .catch(function () { if (status) status.textContent = form.getAttribute('data-err'); });
    });
  }

  /* ---------- wire up --------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    renderAll();
    tickClocks();
    setInterval(tickClocks, 1000);

    loadCatalog().then(function () {
      renderAll();
      initPdp();
    });

    initReviewSlider();
    initCopyCode();
    initCodeForm();
    initShopFilters();
    initCheckout();
    initContactForm();
    initConfirmation();

    document.addEventListener('click', function (e) {
      var add = e.target.closest('[data-add]');
      if (add && !add.hasAttribute('data-from-pdp')) {
        loadCatalog().then(function () { addToCart(add.getAttribute('data-add')); });
        return;
      }
      var inc = e.target.closest('[data-qty-inc]');
      if (inc) { changeQty(inc.getAttribute('data-qty-inc'), 1); return; }
      var dec = e.target.closest('[data-qty-dec]');
      if (dec) { changeQty(dec.getAttribute('data-qty-dec'), -1); return; }
      var rm = e.target.closest('[data-remove]');
      if (rm) { removeLine(rm.getAttribute('data-remove')); return; }
      if (e.target.closest('[data-cart-close]') || e.target.closest('[data-cart-scrim]')) closeDrawer();
      if (e.target.closest('[data-open-cart]')) { e.preventDefault(); openDrawer(); }
    });

    document.addEventListener('keydown', function (e) {
      var d = $('#cart-drawer');
      if (!d || d.hidden) return;
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key === 'Tab') {
        var items = $$(FOCUSABLE, d).filter(function (el) { return el.offsetParent !== null; });
        if (!items.length) return;
        var first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  });
})();
