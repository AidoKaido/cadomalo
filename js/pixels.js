/* ==========================================================
   CADOMALO – Tracking Pixels v1.0
   All pixels are GDPR-compliant: they ONLY fire after the
   user accepts marketing cookies via the cookie banner.
   Replace placeholder IDs with your real values.
   ========================================================== */

/* ----------------------------------------------------------
   PIXEL IDs — fill these in before going live
   ---------------------------------------------------------- */
const PIXEL_CONFIG = {
  facebook:  'YOUR_FB_PIXEL_ID',         // Meta Events Manager
  tiktok:    'YOUR_TIKTOK_PIXEL_ID',     // TikTok Ads Manager
  pinterest: 'YOUR_PINTEREST_TAG_ID',    // Pinterest Ads
  google:    'G-XXXXXXXXXX',             // Google Analytics 4 / Ads
  googleAds: 'AW-XXXXXXXXXX'             // Google Ads conversion ID (optional)
};

/* ----------------------------------------------------------
   FACEBOOK / META PIXEL
   ---------------------------------------------------------- */
function loadFacebookPixel() {
  if (window._fbPixelLoaded) return;
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

  // Standard e-commerce events — call these from product/cart pages
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
   GOOGLE ANALYTICS 4 + GOOGLE ADS
   ---------------------------------------------------------- */
function loadGoogleTag() {
  if (window._gaLoaded) return;
  window._gaLoaded = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${PIXEL_CONFIG.google}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', PIXEL_CONFIG.google, { anonymize_ip: true });

  // Optional: also load Google Ads
  if (PIXEL_CONFIG.googleAds && PIXEL_CONFIG.googleAds !== 'AW-XXXXXXXXXX') {
    gtag('config', PIXEL_CONFIG.googleAds);
  }

  window.gaTrack = {
    event:       (name, params) => gtag('event', name, params),
    purchase:    (data) => gtag('event', 'purchase', data),
    addToCart:   (data) => gtag('event', 'add_to_cart', data),
    viewItem:    (data) => gtag('event', 'view_item', data),
    beginCheckout:(data) => gtag('event', 'begin_checkout', data)
  };

  console.log('[Cadomalo] Google Tag loaded');
}

/* ----------------------------------------------------------
   ANALYTICS (non-marketing — fires on analytics consent)
   ---------------------------------------------------------- */
window.loadAnalytics = function () {
  // Analytics-tier tracking (no ad targeting) — extend as needed
  loadGoogleTag();
};

/* ----------------------------------------------------------
   MARKETING PIXELS — fires only on marketing consent
   ---------------------------------------------------------- */
window.loadMarketingPixels = function () {
  loadFacebookPixel();
  loadTikTokPixel();
  loadPinterestPixel();
  loadGoogleTag();
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
