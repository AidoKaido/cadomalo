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
    const items   = $$(`[data-tab-items="${groupId}"] [data-cat]`);

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
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
   NEWSLETTER FORM — posts to /api/klaviyo-subscribe
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
        const res = await fetch('/api/klaviyo-subscribe', {
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
document.addEventListener('DOMContentLoaded', () => {
  CookieConsent.init();
  LangSwitcher.init();
  initHeader();
  initMobileNav();
  initReveal();
  initTabs();
  initFaq();
  initCounters();
  initNewsletter();
  initWishlist();
  initSmoothScroll();
  initQuickAdd();
  initBlogFilter();
  Cart.syncBadge();
});
