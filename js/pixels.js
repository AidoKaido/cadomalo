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
  if (_isPlaceholder(PIXEL_CONFIG.facebook)) return;
  window._fbPixelLoaded = true;

  !function(f,b,e,v,n,t,s){
    if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)
  }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_CONFIG.facebook);
  fbq('track', 'PageView');

  window.fbTrack = {
    viewContent:    (data) => fbq('track', 'ViewContent', data),
    addToCart:      (data) => fbq('track', 'AddToCart', data),
    initiateCheckout:(data) => fbq('track', 'InitiateCheckout', data),
    purchase:       (data) => fbq('track', 'Purchase', data),
    search:         (data) => fbq('track', 'Search', data),
    lead:           (data) => fbq('track', 'Lead', data)
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
    completePayment:(data) => ttq.track('CompletePayment', data)
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
   HELPER — track e-commerce events across all platforms
   ---------------------------------------------------------- */
window.trackAddToCart = function({ id, name, price, currency = 'USD', quantity = 1 }) {
  const data = { content_ids: [id], content_name: name, value: price, currency, num_items: quantity };
  window.fbTrack?.addToCart(data);
  window.ttTrack?.addToCart({ content_id: id, content_name: name, price, quantity });
  window.pinTrack?.addToCart({ product_id: id, product_name: name, value: price });
  window.gaTrack?.addToCart({ currency, value: price, items: [{ item_id: id, item_name: name, price, quantity }] });
};

window.trackPurchase = function({ orderId, value, currency = 'USD', items = [] }) {
  window.fbTrack?.purchase({ value, currency });
  window.ttTrack?.completePayment({ value, currency });
  window.pinTrack?.checkout({ order_id: orderId, value, currency });
  window.gaTrack?.purchase({ transaction_id: orderId, value, currency, items });
};
