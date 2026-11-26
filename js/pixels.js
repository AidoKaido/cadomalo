/* ==========================================================
   CADOMALO – Tracking Pixels v2.0
   Google Consent Mode v2: gtag loads immediately with denied
   defaults (cookieless pings only). Marketing/analytics pixels
   for other networks still gate on cookie banner acceptance.
   Replace placeholder IDs with your real values.
   ========================================================== */

/* ----------------------------------------------------------
   PIXEL IDs — fill these in before going live
   ---------------------------------------------------------- */
const PIXEL_CONFIG = {
  facebook:  'YOUR_FB_PIXEL_ID',         // Meta Events Manager
  tiktok:    'YOUR_TIKTOK_PIXEL_ID',     // TikTok Ads Manager
  pinterest: 'YOUR_PINTEREST_TAG_ID',    // Pinterest Ads
  google:    'G-XXXXXXXXXX',             // Google Analytics 4 (placeholder until GA4 is set up)
  googleAds: 'AW-18203955415'            // Google Ads conversion ID
};

/* ----------------------------------------------------------
   GOOGLE CONSENT MODE v2 — runs IMMEDIATELY on every page.
   gtag.js loads with all consent denied by default. When the
   user accepts cookies, updateGoogleConsent() promotes the
   relevant signals. This lets Google still receive cookieless
   pings + model conversions for declined users (DMA-compliant).
   ---------------------------------------------------------- */
// Build-safe placeholder check: scripts/inject-pixel-ids.js replaces every
// occurrence of the literal placeholder strings, including ones inside
// comparison guards. We check by regex against the X-run/YOUR_ shape
// instead of equating to the literal — regex source survives the build.
function _isPlaceholder(v) {
  return !v || /X{4,}|YOUR_[A-Z_]+/.test(v);
}

(function initGoogleConsentMode() {
  const hasGA4 = !_isPlaceholder(PIXEL_CONFIG.google);
  const hasAds = !_isPlaceholder(PIXEL_CONFIG.googleAds);
  if (!hasGA4 && !hasAds) return; // nothing real to load

  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Set consent defaults BEFORE loading gtag.js. All denied; gtag
  // will send anonymous pings until updateGoogleConsent() upgrades them.
  gtag('consent', 'default', {
    'ad_storage': 'denied',
    'ad_user_data': 'denied',
    'ad_personalization': 'denied',
    'analytics_storage': 'denied',
    'wait_for_update': 500
  });

  // Load the actual gtag.js library (use whichever ID we have).
  const loaderId = hasGA4 ? PIXEL_CONFIG.google : PIXEL_CONFIG.googleAds;
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${loaderId}`;
  document.head.appendChild(script);

  gtag('js', new Date());
  if (hasGA4) gtag('config', PIXEL_CONFIG.google, { anonymize_ip: true });
  if (hasAds) gtag('config', PIXEL_CONFIG.googleAds);

  // Expose the events API immediately — events queue in dataLayer
  // until gtag.js finishes loading.
  window.gaTrack = {
    event:        (name, params) => gtag('event', name, params),
    purchase:     (data) => gtag('event', 'purchase', data),
    addToCart:    (data) => gtag('event', 'add_to_cart', data),
    viewItem:     (data) => gtag('event', 'view_item', data),
    beginCheckout:(data) => gtag('event', 'begin_checkout', data)
  };

  console.log('[Cadomalo] Google Consent Mode v2 initialized (' + (hasGA4 ? 'GA4 + Ads' : 'Ads only') + ', default: denied)');
})();

/* ----------------------------------------------------------
   updateGoogleConsent — call when consent state changes.
   Called from main.js CookieConsent.apply().
   ---------------------------------------------------------- */
window.updateGoogleConsent = function (prefs) {
  if (typeof window.gtag !== 'function') return;
  const update = {
    'analytics_storage': prefs?.analytics ? 'granted' : 'denied',
    'ad_storage':        prefs?.marketing ? 'granted' : 'denied',
    'ad_user_data':      prefs?.marketing ? 'granted' : 'denied',
    'ad_personalization':prefs?.marketing ? 'granted' : 'denied'
  };
  window.gtag('consent', 'update', update);
  console.log('[Cadomalo] Google consent updated:', update);
};

/* ----------------------------------------------------------
   FACEBOOK / META PIXEL
   ---------------------------------------------------------- */
function loadFacebookPixel() {
  if (window._fbPixelLoaded) return;
  // Build injects FB_PIXEL_ID; fall back to the live pixel (an id, not a secret).
  const fbPixelId = _isPlaceholder(PIXEL_CONFIG.facebook) ? '954704759459704' : PIXEL_CONFIG.facebook;
  window._fbPixelLoaded = true;

  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', fbPixelId);
  fbq('track', 'PageView');

  // Second argument {eventID} lets Meta deduplicate against the server
  // (Conversions API) event with the same event_id — see api/_meta.js.
  const t = (name) => (data, opts) => (opts && opts.eventID ? fbq('track', name, data, { eventID: opts.eventID }) : fbq('track', name, data));
  window.fbTrack = {
    viewContent:     t('ViewContent'),
    addToCart:       t('AddToCart'),
    initiateCheckout:t('InitiateCheckout'),
    purchase:        t('Purchase'),
    search:          t('Search'),
    lead:            t('Lead')
  };

  console.log('[Cadomalo] Facebook Pixel loaded');
}

/* ----------------------------------------------------------
   TIKTOK PIXEL
   ---------------------------------------------------------- */
function loadTikTokPixel() {
  if (window._ttPixelLoaded) return;
  if (_isPlaceholder(PIXEL_CONFIG.tiktok)) return;
  window._ttPixelLoaded = true;

  !function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
  ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
  ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
  ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
  ttq.load=function(e,n){var i='https://analytics.tiktok.com/i18n/pixel/events.js';
  ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;
  ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement('script');
  o.type='text/javascript';o.async=!0;o.src=i+'?sdkid='+e+'&lib='+t;
  var a=document.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};
  ttq.load(PIXEL_CONFIG.tiktok);ttq.page();}(window,document,'ttq');

  window.ttTrack = {
    viewContent:    (data) => ttq.track('ViewContent', data),
    addToCart:      (data) => ttq.track('AddToCart', data),
    initiateCheckout:(data) => ttq.track('InitiateCheckout', data),
    completePayment:(data) => ttq.track('CompletePayment', data),
    submitForm:     (data) => ttq.track('SubmitForm', data)
  };

  console.log('[Cadomalo] TikTok Pixel loaded');
}

/* ----------------------------------------------------------
   PINTEREST TAG
   ---------------------------------------------------------- */
function loadPinterestPixel() {
  if (window._pinPixelLoaded) return;
  if (_isPlaceholder(PIXEL_CONFIG.pinterest)) return;
  window._pinPixelLoaded = true;

  !function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(
  Array.prototype.slice.call(arguments))};var n=window.pintrk;
  n.queue=[];n.version='3.0';var t=document.createElement('script');
  t.async=!0;t.src=e;var r=document.getElementsByTagName('script')[0];
  r.parentNode.insertBefore(t,r)}}('https://s.pinimg.com/ct/core.js');

  pintrk('load', PIXEL_CONFIG.pinterest, { em: '' });
  pintrk('page');

  window.pinTrack = {
    viewCategory: (data) => pintrk('track', 'viewcategory', data),
    search:       (data) => pintrk('track', 'search', data),
    addToCart:    (data) => pintrk('track', 'addtocart', data),
    checkout:     (data) => pintrk('track', 'checkout', data)
  };

  console.log('[Cadomalo] Pinterest Tag loaded');
}

/* ----------------------------------------------------------
   ANALYTICS (fires on analytics consent)
   Promotes Google consent for analytics_storage.
   ---------------------------------------------------------- */
window.loadAnalytics = function () {
  window.updateGoogleConsent?.({ analytics: true, marketing: window._marketingGranted === true });
};

/* ----------------------------------------------------------
   MARKETING PIXELS — fires only on marketing consent.
   Promotes Google ad consent + loads FB/TT/Pin (no Consent Mode support).
   ---------------------------------------------------------- */
window.loadMarketingPixels = function () {
  window._marketingGranted = true;
  _rememberFbclid();
  window.updateGoogleConsent?.({ analytics: window._analyticsGranted === true, marketing: true });
  loadFacebookPixel();
  loadTikTokPixel();
  loadPinterestPixel();
};

/* ----------------------------------------------------------
   REJECT — explicitly signal denied (already default, but
   clean to call when user clicks Reject All).
   ---------------------------------------------------------- */
window.rejectAllConsent = function () {
  window._marketingGranted = false;
  window._analyticsGranted = false;
  window.updateGoogleConsent?.({ analytics: false, marketing: false });
};

/* ----------------------------------------------------------
   META MATCH DATA — sent with checkout / opt-in requests so the
   server (Conversions API) can match and dedupe. Only with
   marketing consent; otherwise just {consent:false}.
   ---------------------------------------------------------- */
const FBCLID_KEY = 'cadomalo_fbclid';
const FBCLID_DAYS = 90;

function _cookie(name) {
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (let i = 0; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0 && parts[i].slice(0, eq) === name) {
      try { return decodeURIComponent(parts[i].slice(eq + 1)); } catch (e) { return parts[i].slice(eq + 1); }
    }
  }
  return '';
}

function _marketingConsent() {
  if (window._marketingGranted === true) return true;
  try {
    const c = JSON.parse(localStorage.getItem('cadomalo_consent_v1'));
    return !!(c && c.marketing);
  } catch (e) { return false; }
}

/* Store an ad click id only after marketing consent (called from
   loadMarketingPixels). The pixel also sets _fbc itself. */
function _rememberFbclid() {
  try {
    const id = new URLSearchParams(window.location.search).get('fbclid');
    if (id && /^[\w-]{10,400}$/.test(id)) localStorage.setItem(FBCLID_KEY, JSON.stringify({ id: id, ts: Date.now() }));
  } catch (e) {}
}

function _fbc() {
  const c = _cookie('_fbc');
  if (c) return c;
  try {
    let id = new URLSearchParams(window.location.search).get('fbclid');
    let ts = Date.now();
    if (!id) {
      const s = JSON.parse(localStorage.getItem(FBCLID_KEY));
      if (s && s.id && Date.now() - s.ts < FBCLID_DAYS * 864e5) { id = s.id; ts = s.ts; }
    }
    return id && /^[\w-]{10,400}$/.test(id) ? 'fb.1.' + ts + '.' + id : '';
  } catch (e) { return ''; }
}

window.cadomaloTracking = function () {
  if (!_marketingConsent()) return { consent: false };
  return { consent: true, fbp: _cookie('_fbp'), fbc: _fbc() };
};

/* Consent withdrawn: forget the Meta ids we can reach from JS. */
window.clearMarketingIds = function () {
  try { localStorage.removeItem(FBCLID_KEY); } catch (e) {}
  const host = location.hostname;
  const parts = host.split('.');
  const domains = ['', host, '.' + host];
  if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
  ['_fbp', '_fbc'].forEach(function (n) {
    if (!_cookie(n)) return;
    domains.forEach(function (d) {
      document.cookie = n + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : '');
    });
  });
};

window.cadomaloEventId = function () {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
};

/* Once-per-key guard per platform. persist=true survives reloads in the
   tab (sessionStorage) — used for Purchase so a refresh never re-fires. */
const _firedMem = {};
function _once(key, persist, fn) {
  if (_firedMem[key]) return;
  if (persist) {
    try { if (sessionStorage.getItem('cad_px_' + key) === '1') { _firedMem[key] = 1; return; } } catch (e) {}
  }
  fn();
  _firedMem[key] = 1;
  if (persist) { try { sessionStorage.setItem('cad_px_' + key, '1'); } catch (e) {} }
}

/* Pixels only exist after consent. Re-run a tracker once consent arrives
   (the per-platform guards stop anything firing twice). */
function _retryOnConsent(fn) {
  if (window.fbTrack) return;
  const h = function (e) {
    if (!(e && e.detail && e.detail.marketing)) return;
    window.removeEventListener('consentUpdated', h);
    setTimeout(fn, 300);
  };
  window.addEventListener('consentUpdated', h);
}

/* ----------------------------------------------------------
   HELPER — track e-commerce events across all platforms.
   Meta standard params everywhere: content_type 'product',
   content_ids (catalog ids), value, currency.
   ---------------------------------------------------------- */
window.trackAddToCart = function({ id, name, price, currency = 'USD', quantity = 1 }) {
  const value = Math.round(price * quantity * 100) / 100;
  const data = { content_type: 'product', content_ids: [id], contents: [{ id: id, quantity: quantity, item_price: price }], content_name: name, value, currency, num_items: quantity };
  window.fbTrack?.addToCart(data);
  window.ttTrack?.addToCart({ content_id: id, content_name: name, price, quantity, value, currency });
  window.pinTrack?.addToCart({ product_id: id, product_name: name, value: price });
  window.gaTrack?.addToCart({ currency, value, items: [{ item_id: id, item_name: name, price, quantity }] });
};

/* Purchase — eventID is the Stripe Checkout Session id (cs_…) or the
   one-click upsell PaymentIntent id (pi_…): the same event_id the webhook
   sends to the Conversions API. Each platform fires once per eventID per
   tab (sessionStorage), so reloading the confirmation page is safe. */
window.trackPurchase = function({ eventID, orderId, value, currency = 'USD', contents = [], items = [] }) {
  const id = String(eventID || orderId || '');
  if (!id) return;
  value = Math.round((Number(value) || 0) * 100) / 100;
  const content_ids = contents.map((c) => c.id);
  const num_items = contents.reduce((a, c) => a + (c.quantity || 1), 0) || 1;
  if (!items.length) items = contents.map((c) => ({ item_id: c.id, price: c.item_price, quantity: c.quantity }));
  if (window.fbTrack) _once('fb:' + id, true, () => window.fbTrack.purchase({ value, currency, content_type: 'product', content_ids, contents, num_items, order_id: id }, { eventID: id }));
  if (window.ttTrack) _once('tt:' + id, true, () => window.ttTrack.completePayment({ value, currency, content_type: 'product', contents: contents.map((c) => ({ content_id: c.id, quantity: c.quantity, price: c.item_price })) }));
  if (window.pinTrack) _once('pin:' + id, true, () => window.pinTrack.checkout({ order_id: id, value, currency, order_quantity: num_items }));
  if (window.gaTrack) _once('ga:' + id, true, () => window.gaTrack.purchase({ transaction_id: id, value, currency, items }));
  _retryOnConsent(() => window.trackPurchase({ eventID: id, value, currency, contents, items }));
};

/* Purchase(s) from an /api/get-checkout-session response: the order itself
   and, when present, the one-click upsell as its own Purchase. */
window.trackOrder = function (d) {
  if (!d || d.payment_status !== 'paid') return;
  const px = d.pixel;
  if (!px || !px.session) {
    window.trackPurchase({ eventID: d.id, value: (d.amount_total || 0) / 100, currency: String(d.currency || 'usd').toUpperCase(),
      contents: (d.products || []).map((p) => ({ id: p, quantity: 1 })) });
    return;
  }
  [px.session, px.upsell].forEach(function (e) {
    if (e && e.event_id) window.trackPurchase({ eventID: e.event_id, value: e.value, currency: e.currency, contents: e.contents || [] });
  });
};

/* ViewContent — product pages (called from js/main.js). Each platform
   fires once per page view, also when consent is given after load. */
window.trackViewContent = function({ id, name, price, currency = 'USD', category = '' }) {
  const key = 'vc:' + id + ':';
  if (window.fbTrack) _once(key + 'fb', false, () => window.fbTrack.viewContent({ content_ids: [id], contents: [{ id: id, quantity: 1, item_price: price }], content_name: name, content_category: category, content_type: 'product', value: price, currency }));
  if (window.ttTrack) _once(key + 'tt', false, () => window.ttTrack.viewContent({ content_id: id, content_name: name, content_type: 'product', price, value: price, currency }));
  if (window.gaTrack) _once(key + 'ga', false, () => window.gaTrack.viewItem({ currency, value: price, items: [{ item_id: id, item_name: name, item_category: category, price }] }));
};

/* InitiateCheckout — call right before asking the server for a checkout.
   Accepts {ids, numItems} or Meta-style {content_ids, num_items}. */
window.trackInitiateCheckout = function(opts) {
  opts = opts || {};
  const currency = opts.currency || 'USD';
  const ids = opts.ids || opts.content_ids || [];
  const numItems = opts.numItems || opts.num_items || ids.length || 1;
  const value = Math.round((Number(opts.value) || 0) * 100) / 100;
  const contents = opts.contents || ids.map((id) => ({ id: id, quantity: 1 }));
  window.fbTrack?.initiateCheckout({ content_type: 'product', content_ids: ids, contents, value, currency, num_items: numItems });
  window.ttTrack?.initiateCheckout({ content_id: ids[0], value, currency, quantity: numItems });
  window.pinTrack?.checkout({ value, currency, order_quantity: numItems });
  window.gaTrack?.beginCheckout({ currency, value, items: ids.map((id) => ({ item_id: id })) });
};

/* Lead — free sample opt-in success (no PII is passed). eventID is the
   uuid also sent to /api/lead as body.eventId (server Lead dedupe). */
window.trackLead = function({ source = 'routine-sample', value = 0, currency = 'USD', eventID } = {}) {
  window.fbTrack?.lead({ content_name: source, content_type: 'product', content_ids: [source], value, currency }, eventID ? { eventID } : undefined);
  window.ttTrack?.submitForm?.({ content_name: source });
  window.gaTrack?.event('generate_lead', { currency, value, lead_source: source });
};
