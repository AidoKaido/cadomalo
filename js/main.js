/* ==========================================================
   CADOMALO – Main JavaScript v1.0
   ========================================================== */

'use strict';

/* ----------------------------------------------------------
   UTILITY
   ---------------------------------------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function showToast(msg, duration = 3000) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ----------------------------------------------------------
   COOKIE CONSENT  (GDPR + CCPA compliant)
   ---------------------------------------------------------- */
const CookieConsent = {
  KEY: 'cadomalo_consent_v1',

  get() {
    try { return JSON.parse(localStorage.getItem(this.KEY)); }
    catch { return null; }
  },

  save(prefs) {
    const record = { ...prefs, ts: new Date().toISOString(), v: '1.0' };
    localStorage.setItem(this.KEY, JSON.stringify(record));
    this.apply(record);
  },

  apply(prefs) {
    // First-party record of the marketing choice so the server (Meta CAPI)
    // can respect it on requests without a JSON body (e.g. email links).
    try {
      document.cookie = 'cadomalo_mc=' + (prefs?.marketing ? '1' : '0') + '; path=/; max-age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
    if (!prefs?.marketing && typeof window.clearMarketingIds === 'function') window.clearMarketingIds();
    if (prefs?.marketing) {
      if (typeof window.loadMarketingPixels === 'function') window.loadMarketingPixels();
    }
    if (prefs?.analytics) {
      if (typeof window.loadAnalytics === 'function') window.loadAnalytics();
    }
    if (!prefs?.marketing && !prefs?.analytics) {
      if (typeof window.rejectAllConsent === 'function') window.rejectAllConsent();
    }
    // Dispatch event so other modules can react
    window.dispatchEvent(new CustomEvent('consentUpdated', { detail: prefs }));
  },

  acceptAll() {
    this.save({ necessary: true, analytics: true, marketing: true });
    this.hide();
  },

  rejectAll() {
    this.save({ necessary: true, analytics: false, marketing: false });
    this.hide();
  },

  savePrefs() {
    const analytics  = $('#toggle-analytics')?.checked  || false;
    const marketing  = $('#toggle-marketing')?.checked  || false;
    this.save({ necessary: true, analytics, marketing });
    this.closePanel();
    this.hide();
  },

  show() {
    const banner = $('#cookie-banner');
    if (banner) {
      banner.style.display = 'block';
      banner.removeAttribute('hidden');
      console.log('[Cadomalo] Cookie banner shown');
    } else {
      console.warn('[Cadomalo] #cookie-banner element not found in DOM');
    }
  },

  hide() {
    const banner = $('#cookie-banner');
    if (banner) { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 300); }
  },

  openPanel() {
    const panel = $('#cookie-prefs');
    if (panel) { panel.classList.add('open'); panel.style.display = 'flex'; }
  },

  closePanel() {
    const panel = $('#cookie-prefs');
    if (panel) { panel.classList.remove('open'); setTimeout(() => { panel.style.display = ''; }, 200); }
  },

  init() {
    const existing = this.get();
    console.log('[Cadomalo] CookieConsent.init — existing prefs:', existing);
    if (!existing) {
      // Show banner after short delay for better UX
      setTimeout(() => this.show(), 800);
    } else {
      this.apply(existing);
    }

    // Wire up banner buttons
    $('#btn-accept-all')?.addEventListener('click', () => this.acceptAll());
    $('#btn-reject-all')?.addEventListener('click', () => this.rejectAll());
    $('#btn-manage-prefs')?.addEventListener('click', () => this.openPanel());
    $('#btn-save-prefs')?.addEventListener('click', () => this.savePrefs());
    $('#btn-close-panel')?.addEventListener('click', () => this.closePanel());
    $('#btn-accept-panel')?.addEventListener('click', () => this.acceptAll());

    // Close panel on backdrop click
    $('#cookie-prefs')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closePanel();
    });
  }
};

/* Language switcher disabled — EN only at launch. */
const LangSwitcher = { init() {} };

/* ----------------------------------------------------------
   HEADER – scroll shadow
   ---------------------------------------------------------- */
function initHeader() {
  const hdr = $('header');
  if (!hdr) return;
  const onScroll = () => hdr.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ----------------------------------------------------------
   MOBILE NAV DRAWER
   ---------------------------------------------------------- */
function initMobileNav() {
  const toggle   = $('#nav-toggle');
  const drawer   = $('#nav-drawer');
  const overlay  = $('#nav-overlay');
  const closeBtn = $('#nav-close');
  if (!toggle || !drawer) return;

  const open  = () => { drawer.classList.add('open'); overlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { drawer.classList.remove('open'); overlay.classList.remove('open'); document.body.style.overflow = ''; };

  toggle.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  overlay?.addEventListener('click', close);
  $$('#nav-drawer a').forEach(a => a.addEventListener('click', close));
}

/* ----------------------------------------------------------
   SCROLL REVEAL
   ---------------------------------------------------------- */
function initReveal() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } });
  }, { threshold: 0.07, rootMargin: '0px 0px -32px 0px' });
  $$('.rev').forEach(el => io.observe(el));
}

/* ----------------------------------------------------------
   PRODUCT / OCCASION TABS
   ---------------------------------------------------------- */
function initTabs() {
  $$('[data-tab-group]').forEach(group => {
    const groupId = group.dataset.tabGroup;
    const tabs    = $$(`[data-tab-group="${groupId}"] .tab-btn`);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
        // Re-query items each click so async-rendered cards (e.g. from Sanity) are picked up.
        const items = $$(`[data-tab-items="${groupId}"] [data-cat]`);
        items.forEach(item => {
          const cats = (item.dataset.cat || '').split(' ');
          item.classList.toggle('hidden', filter !== 'all' && !cats.includes(filter));
        });
      });
    });
  });
}

/* ----------------------------------------------------------
   FAQ ACCORDION
   ---------------------------------------------------------- */
function initFaq() {
  $$('.faq-q').forEach(q => {
    q.addEventListener('click', () => {
      const isOpen = q.classList.contains('open');
      $$('.faq-q').forEach(other => {
        other.classList.remove('open');
        other.nextElementSibling?.classList.remove('open');
        const ch = other.querySelector('.faq-chevron'); if (ch) ch.style.transform = '';
      });
      if (!isOpen) {
        q.classList.add('open');
        q.nextElementSibling?.classList.add('open');
        const chevron = q.querySelector('.faq-chevron');
        if (chevron) chevron.style.transform = 'rotate(180deg)';
      }
    });
  });
}

/* ----------------------------------------------------------
   STAT COUNTER ANIMATION
   ---------------------------------------------------------- */
function initCounters() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el  = e.target;
      const end = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      const dur  = 1800;
      const start = performance.now();
      const step  = (now) => {
        const t = Math.min((now - start) / dur, 1);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        const val  = end * ease;
        el.textContent = (Number.isInteger(end) ? Math.round(val) : val.toFixed(1)) + suffix;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.5 });
  $$('[data-count]').forEach(el => io.observe(el));
}

/* ----------------------------------------------------------
   NEWSLETTER FORM — posts to /api/newsletter-subscribe (Resend Audiences)
   ---------------------------------------------------------- */
function initNewsletter() {
  $$('.nl-form, .newsletter-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailEl = form.querySelector('input[type="email"]');
      const email = emailEl?.value?.trim();
      const btn = form.querySelector('button[type="submit"]');
      if (!email || !btn) return;

      const original = btn.textContent;
      btn.textContent = 'Subscribing…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/newsletter-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Subscribe failed (${res.status})`);
        btn.textContent = '✓ Check your email';
        btn.style.background = '#059669';
        if (emailEl) emailEl.value = '';
      } catch (err) {
        console.error('[newsletter]', err);
        btn.textContent = '⚠️ Try again';
        btn.style.background = '';
        showToast(err.message || 'Subscribe failed. Try again.');
      }

      setTimeout(() => {
        btn.textContent = original;
        btn.style.background = '';
        btn.disabled = false;
      }, 4000);
    });
  });
}

/* ----------------------------------------------------------
   WISHLIST (UI only — persistence in Round 2)
   ---------------------------------------------------------- */
function initWishlist() {
  document.addEventListener('click', (e) => {
    const wish = e.target.closest('.prod-wish');
    if (!wish) return;
    e.preventDefault();
    e.stopPropagation();
    const svg = wish.querySelector('svg');
    if (!svg) return;
    const active = wish.dataset.wishlisted === 'true';
    wish.dataset.wishlisted = String(!active);
    svg.style.fill = active ? 'none' : 'var(--cr)';
    showToast(active ? 'Removed from wishlist' : '♥ Added to wishlist');
  });
}

/* ----------------------------------------------------------
   SMOOTH SCROLL for anchor links
   ---------------------------------------------------------- */
function initSmoothScroll() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
}

/* ----------------------------------------------------------
   CART (count persisted in localStorage; real line-items in Phase 2)
   ---------------------------------------------------------- */
const Cart = {
  KEY: 'cadomalo_cart_count_v1',

  getCount() {
    const n = parseInt(localStorage.getItem(this.KEY) || '0', 10);
    return isNaN(n) ? 0 : n;
  },

  setCount(n) {
    localStorage.setItem(this.KEY, String(Math.max(0, n)));
    this.syncBadge();
  },

  bump(delta = 1) {
    const next = this.getCount() + delta;
    this.setCount(next);
    $$('.cart-count').forEach(el => {
      el.style.transform = 'scale(1.4)';
      setTimeout(() => el.style.transform = '', 250);
    });
    return next;
  },

  clear() { this.setCount(0); },

  syncBadge() {
    const n = this.getCount();
    $$('.cart-count').forEach(el => {
      el.textContent = n;
      el.setAttribute('aria-label', `${n} item${n === 1 ? '' : 's'} in cart`);
    });
  },
};
window.Cart = Cart;

/* ----------------------------------------------------------
   QUICK ADD BUTTON
   ---------------------------------------------------------- */
function initQuickAdd() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.prod-quick');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const card = btn.closest('.prod-card');
    const name = card?.querySelector('.prod-name')?.textContent.trim() || 'Item';
    Cart.bump();
    showToast(`🎁 "${name}" added to cart`);
  });
}

/* ----------------------------------------------------------
   READING PROGRESS BAR (blog articles)
   ---------------------------------------------------------- */
function initReadingBar() {
  const bar = $('#reading-bar');
  if (!bar) return;
  window.addEventListener('scroll', () => {
    const el = document.documentElement;
    bar.style.width = (el.scrollTop / (el.scrollHeight - el.clientHeight) * 100) + '%';
  }, { passive: true });
}

/* ----------------------------------------------------------
   BLOG CATEGORY FILTER
   ---------------------------------------------------------- */
function initBlogFilter() {
  const filterBtns = $$('.blog-filter-btn');
  const posts = $$('.blog-item');
  if (!filterBtns.length) return;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.cat;
      posts.forEach(post => {
        post.classList.toggle('hidden', cat !== 'all' && post.dataset.cat !== cat);
      });
    });
  });
}

/* ----------------------------------------------------------
   INIT ALL (reading bar called per-page on articles)
   ---------------------------------------------------------- */

/* ----------------------------------------------------------
   MOBILE MENU (new site chrome)
   Full-screen overlay behind the hamburger. Unlike the design
   prototype this traps focus, closes on Escape and restores
   focus to the trigger, so it behaves as a real dialog.
   No-ops on pages that do not have the markup.
   ---------------------------------------------------------- */
function initMobileMenu() {
  const toggle = document.getElementById('menu-toggle');
  const menu   = document.getElementById('mobile-menu');
  const close  = document.getElementById('menu-close');
  if (!toggle || !menu) return;

  let lastFocused = null;
  const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea';

  const openMenu = () => {
    lastFocused = document.activeElement;
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    const first = menu.querySelector(FOCUSABLE);
    if (first) first.focus();
  };

  const closeMenu = () => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  };

  toggle.addEventListener('click', openMenu);
  if (close) close.addEventListener('click', closeMenu);
  menu.querySelectorAll('nav a').forEach(a => a.addEventListener('click', closeMenu));

  document.addEventListener('keydown', (e) => {
    if (menu.hidden) return;

    if (e.key === 'Escape') { closeMenu(); return; }

    if (e.key === 'Tab') {
      const items = Array.from(menu.querySelectorAll(FOCUSABLE))
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last  = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  /* Desktop resize while open would strand the overlay over the page. */
  window.addEventListener('resize', () => {
    if (!menu.hidden && window.innerWidth >= 760) closeMenu();
  });
}

/* Footer "Cookie settings" link reopens the consent panel. */
function initCookieSettingsLink() {
  document.querySelectorAll('[data-cookie-settings]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const banner = document.getElementById('cookie-banner');
      const prefs  = document.getElementById('cookie-prefs');
      if (banner) banner.classList.add('is-visible');
      if (prefs)  prefs.classList.add('is-open');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  CookieConsent.init();
  LangSwitcher.init();
  initHeader();
  initMobileNav();
  initMobileMenu();
  initCookieSettingsLink();
  initReveal();
  initTabs();
  initFaq();
  initCounters();
  initNewsletter();
  initWishlist();
  initSmoothScroll();
  initQuickAdd();
  initBlogFilter();
  initReadingBar();
  Cart.syncBadge();
});

/* ==========================================================
   SHOP, PRODUCT PAGE + FUNNEL  (restructure, 2026-11)
   Cart lines / checkout stay in js/cart.js; this block adds the shop
   filters, the PDP gallery + sticky bar, pixel calls and the funnel pages.
   API contracts:
     POST /api/lead              {email, consent}            -> {ok, t}
     POST /api/funnel-checkout   {offerToken, product}       -> {url}
     POST /api/one-click-upsell  {session_id}                -> {ok} | {requiresAction, url}
     GET  /api/get-checkout-session?session_id=              -> {..., downloads:[{label,url}]}
     POST /api/submit-review     {productId, productSlug, author, rating, body, email, photo?}
   ========================================================== */
(function () {
  var OFFER_KEY = 'cadomalo_offer';
  var qs = new URLSearchParams(window.location.search);
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  function postJson(url, body) {
    return fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || ('Request failed (' + r.status + ')'));
          return d;
        });
      });
  }
  function setStatus(el, msg) { if (el) el.textContent = msg || ''; }
  /* Meta match data {consent, fbp, fbc} — ids only with marketing consent (js/pixels.js) */
  function tracking() {
    try { return window.cadomaloTracking ? window.cadomaloTracking() : {consent: false}; } catch (e) { return {consent: false}; }
  }

  /* ---------- offer token (signed by the server; we only read `exp`) ---------- */
  function tokenExp(token) {
    if (!token) return 0;
    var parts = String(token).split('.');
    for (var i = 0; i < parts.length; i++) {
      try {
        var b64 = parts[i].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var payload = JSON.parse(atob(b64));
        if (payload && payload.exp) return payload.exp < 1e12 ? payload.exp * 1000 : payload.exp;
      } catch (e) { /* not the payload part */ }
    }
    return 0;
  }
  function saveOffer(token) {
    var o = {token: token, exp: tokenExp(token)};
    try { localStorage.setItem(OFFER_KEY, JSON.stringify(o)); } catch (e) {}
    return o;
  }
  function readOffer() {
    try {
      var o = JSON.parse(localStorage.getItem(OFFER_KEY));
      if (o && o.token && (!o.exp || o.exp > Date.now())) return o;
    } catch (e) {}
    return null;
  }

  function funnelBuy(btn, product, status) {
    var offer = readOffer();
    if (!offer) { setStatus(status, 'This offer has expired.'); return; }
    var original = btn.innerHTML;
    var value = parseFloat((btn.textContent.match(/\$([\d.]+)/) || [])[1]) || 0;
    btn.disabled = true; btn.textContent = 'Taking you to secure checkout…';
    try { if (window.trackInitiateCheckout) window.trackInitiateCheckout({value: value, ids: [product]}); } catch (e) {}
    postJson('/api/funnel-checkout', {offerToken: offer.token, product: product, tracking: tracking()})
      .then(function (d) { if (d && d.url) { window.location.href = d.url; return; } throw new Error((d && d.error) || 'Checkout failed'); })
      .catch(function (err) { btn.disabled = false; btn.innerHTML = original; setStatus(status, err.message); });
  }

  /* ---------- shop filter chips + collection sections ---------- */
  function initShopFilter() {
    var chips = $$('[data-shop-filter]');
    if (!chips.length) return;
    var countEl = $('[data-shop-count]');
    var label = countEl ? countEl.getAttribute('data-label') : '';
    function apply(f) {
      var shown = 0;
      chips.forEach(function (c) {
        var on = c.getAttribute('data-shop-filter') === f;
        c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on));
      });
      $$('[data-shop-section]').forEach(function (sec) {
        var visible = 0;
        $$('.card[data-type]', sec).forEach(function (card) {
          var match = f === 'all' || card.getAttribute('data-type') === f;
          card.hidden = !match;
          if (match) visible++;
        });
        sec.hidden = visible === 0;
        shown += visible;
      });
      if (countEl) countEl.textContent = shown + ' ' + label;
    }
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () { apply(chip.getAttribute('data-shop-filter')); });
    });
  }

  /* ---------- PDP gallery: images + optional demo video ---------- */
  function initGallery() {
    var frame = $('[data-gallery-frame]');
    var thumbs = $$('[data-gallery-thumbs] .pdp-thumb');
    if (!frame || !thumbs.length) return;
    var alt = (($('.buy-box h1') || {}).textContent || '').trim();
    thumbs.forEach(function (b) {
      b.addEventListener('click', function () {
        var cur = $('[data-gallery-main]', frame);
        var kind = b.getAttribute('data-kind'), src = b.getAttribute('data-src');
        var el;
        if (kind === 'video') {
          el = document.createElement('video');
          el.muted = true; el.autoplay = true; el.loop = true; el.playsInline = true;
          el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
          if (b.getAttribute('data-poster')) el.poster = b.getAttribute('data-poster');
        } else {
          el = document.createElement('img');
          el.alt = alt; el.width = 800; el.height = 800;
        }
        el.setAttribute('data-gallery-main', '');
        el.src = src;
        if (cur) cur.replaceWith(el); else frame.appendChild(el);
        if (kind === 'video' && el.play) { var p = el.play(); if (p && p.catch) p.catch(function () {}); }
        thumbs.forEach(function (x) { x.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
    });
  }

  /* ---------- sticky mobile add-to-cart ---------- */
  function initStickyBuy() {
    var bar = $('[data-sticky-buy]'), main = $('[data-buy-main]');
    if (!bar || !main || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { bar.hidden = e.isIntersecting || e.boundingClientRect.top > 0; });
    }).observe(main);
  }

  /* ---------- ViewContent on product pages ---------- */
  function initViewContent() {
    var box = $('.buy-box[data-product]');
    if (!box) return;
    /* trackViewContent fires each platform once per page, so calling it
       again after consent only adds the pixels that just loaded. */
    var fire = function () {
      if (!window.trackViewContent) return;
      try {
        window.trackViewContent({
          id: box.getAttribute('data-product'), name: box.getAttribute('data-name'),
          price: parseFloat(box.getAttribute('data-value')) || 0, category: box.getAttribute('data-category') || ''
        });
      } catch (e) {}
    };
    fire();
    /* pixels load only after consent; fire once they exist */
    window.addEventListener('consentUpdated', function () { setTimeout(fire, 300); });
  }

  /* ---------- /free-routine-sample opt-in ---------- */
  function initOptin() {
    var form = $('[data-optin-form]');
    if (!form) return;
    var status = $('[data-optin-status]', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = (form.email.value || '').trim();
      if (!email || !form.email.checkValidity()) { setStatus(status, 'Please enter a valid email address.'); form.email.focus(); return; }
      if (!form.consent.checked) { setStatus(status, 'Please tick the box so we can email you the sample.'); return; }
      if (form.website && form.website.value) return;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; setStatus(status, 'Sending…');
      /* same id for the browser Lead and the server (CAPI) Lead → deduped */
      var eventId = window.cadomaloEventId ? window.cadomaloEventId() : String(Date.now());
      postJson('/api/lead', {email: email, consent: true, eventId: eventId, tracking: tracking()})
        .then(function (d) {
          var token = d.t || d.token || d.offerToken || '';
          if (token) saveOffer(token);
          try { if (window.trackLead) window.trackLead({source: 'routine-sample', eventID: eventId}); } catch (e2) {}
          window.location.href = '/thank-you-sample' + (token ? '?t=' + encodeURIComponent(token) : '');
        })
        .catch(function (err) { btn.disabled = false; setStatus(status, err.message || 'Something went wrong. Please try again.'); });
    });
  }

  /* ---------- /thank-you-sample one-time offer ---------- */
  function initOfferPage() {
    var page = $('[data-offer-page]');
    if (!page) return;
    var t = qs.get('t');
    if (t) saveOffer(t);
    var offer = readOffer();
    var timer = $('[data-offer-timer]', page), left = $('[data-offer-left]', page);
    var expired = $('[data-offer-expired]', page), status = $('[data-funnel-status]', page);
    var buyBtns = $$('[data-funnel-buy]', page);
    var iv = null;
    function expire() {
      if (iv) clearInterval(iv);
      if (timer) timer.hidden = true;
      if (expired) expired.hidden = false;
      buyBtns.forEach(function (b) { b.disabled = true; });
      $$('[data-needs-token]', page).forEach(function (el) { el.hidden = true; });
    }
    if (!offer) { expire(); return; }
    $$('[data-needs-token]', page).forEach(function (el) { el.hidden = false; });
    if (offer.exp && timer && left) {
      timer.hidden = false;
      var tick = function () {
        var s = Math.floor((offer.exp - Date.now()) / 1000);
        if (s <= 0) { expire(); return; }
        left.textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
      };
      iv = setInterval(tick, 1000); tick();
    }
    buyBtns.forEach(function (b) {
      b.addEventListener('click', function () { funnelBuy(b, b.getAttribute('data-funnel-buy'), status); });
    });
  }

  /* ---------- /offer/medical-heroes one-click upsell ---------- */
  function initUpsellPage() {
    var page = $('[data-upsell-page]');
    if (!page) return;
    var sid = qs.get('session_id') || '';
    var confirmUrl = '/order-confirmation' + (sid ? '?session_id=' + encodeURIComponent(sid) : '');
    var no = $('[data-no-thanks]', page);
    if (no) no.href = confirmUrl;
    var status = $('[data-funnel-status]', page);
    if (readOffer()) $$('[data-needs-token]', page).forEach(function (el) { el.hidden = false; });
    $$('[data-funnel-buy]', page).forEach(function (b) {
      b.addEventListener('click', function () { funnelBuy(b, b.getAttribute('data-funnel-buy'), status); });
    });
    /* This page is the Discovery Lab checkout's success_url: fire its
       Purchase here (eventID = session id; deduped on the confirmation page). */
    if (/^cs_(test|live)_/.test(sid) && window.trackOrder) {
      fetch('/api/get-checkout-session?session_id=' + encodeURIComponent(sid))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { try { if (d) window.trackOrder(d); } catch (e) {} })
        .catch(function () {});
    }
    var btn = $('[data-one-click]', page);
    if (!btn) return;
    if (!/^cs_(test|live)_/.test(sid)) { btn.disabled = true; setStatus(status, 'This offer is only available right after checkout.'); return; }
    btn.addEventListener('click', function () {
      var original = btn.innerHTML;
      var value = parseFloat((btn.textContent.match(/\$([\d.]+)/) || [])[1]) || 0;
      btn.disabled = true; btn.textContent = 'Adding to your order…';
      try { if (window.trackInitiateCheckout) window.trackInitiateCheckout({value: value, ids: ['mh-bundle']}); } catch (e) {}
      postJson('/api/one-click-upsell', {session_id: sid})
        .then(function (d) {
          if (d && d.requiresAction && d.url) { window.location.href = d.url; return; }
          if (d && (d.ok || d.success || d.paid)) { window.location.href = d.redirect || (confirmUrl + '&upsell=1'); return; }
          throw new Error((d && d.error) || 'We could not add it to your order.');
        })
        .catch(function (err) { btn.disabled = false; btn.innerHTML = original; setStatus(status, err.message); });
    });
  }

  /* ---------- order confirmation: downloads + next-best offer ---------- */
  function initConfirmationExtras() {
    var root = $('[data-confirmation]');
    if (!root) return;
    var box = $('[data-downloads]', root), list = $('[data-downloads-list]', root), st = $('[data-downloads-status]', root);
    var sid = qs.get('session_id') || '';
    function none() { if (st && box) st.textContent = box.getAttribute('data-none'); }
    if (box && /^cs_(test|live)_/.test(sid)) {
      var tries = 0;
      var load = function () {
        fetch('/api/get-checkout-session?session_id=' + encodeURIComponent(sid))
          .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
          .then(function (d) {
            var dl = (d && d.downloads) || [];
            if (!dl.length) {
              /* links may still be being prepared — retry briefly */
              if (d && d.payment_status === 'paid' && ++tries < 4) { setTimeout(load, 2500); return; }
              none(); return;
            }
            list.innerHTML = '';
            dl.forEach(function (f) {
              if (!f || !f.url) return;
              var a = document.createElement('a');
              a.className = 'btn btn-primary btn-full';
              a.href = f.url; a.rel = 'noopener';
              a.textContent = '⬇ ' + (f.label || 'Download');
              list.appendChild(a);
            });
            if (st) st.hidden = true;
          })
          .catch(none);
      };
      load();
    } else { none(); }

    var nbo = $('[data-nbo]', root);
    if (nbo && readOffer()) {
      var f = $('[data-nbo-funnel]', nbo), s = $('[data-nbo-store]', nbo);
      if (f) { f.hidden = false; if (s) s.hidden = true; }
      $$('[data-funnel-buy]', nbo).forEach(function (b) {
        b.addEventListener('click', function () { funnelBuy(b, b.getAttribute('data-funnel-buy'), null); });
      });
    }
  }

  /* ---------- /review form ---------- */
  function shrinkPhoto(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\//.test(file.type) || file.size > 15e6) return resolve(null);
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = Math.min(1, 1200 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function initReviewForm() {
    var form = $('[data-review-form]');
    if (!form) return;
    var status = $('[data-form-status]', form);
    var pre = qs.get('product');
    if (pre) {
      var match = $$('option', form.productId).filter(function (o) { return o.value === pre; })[0];
      if (match) form.productId.value = pre;
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.website && form.website.value) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var opt = form.productId.options[form.productId.selectedIndex];
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; setStatus(status, 'Sending…');
      shrinkPhoto(form.photo.files && form.photo.files[0]).then(function (photo) {
        return postJson('/api/submit-review', {
          productId: form.productId.value,
          productSlug: opt ? opt.getAttribute('data-slug') : '',
          author: form.author.value.trim(),
          rating: Number((form.querySelector('input[name="rating"]:checked') || {}).value || 0),
          body: form.body.value.trim(),
          email: form.email.value.trim(),
          photo: photo || undefined
        });
      }).then(function () {
        form.reset();
        setStatus(status, 'Thank you! Your review will appear once it has been checked. If we can match your order, your 15% code is on its way by email.');
      }).catch(function (err) {
        setStatus(status, err.message || 'Something went wrong. Please try again.');
      }).then(function () { btn.disabled = false; });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initShopFilter();
    initGallery();
    initStickyBuy();
    initViewContent();
    initOptin();
    initOfferPage();
    initUpsellPage();
    initConfirmationExtras();
    initReviewForm();
  });
})();
