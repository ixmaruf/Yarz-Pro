/* YARZ API v12.0 — Cloudflare Worker Edge Cache integration */

// ✅ v15.44 FIX: Capture FB / TikTok click IDs (fbclid / ttclid) ASAP — at the
// top of api.js (the FIRST script to run after HTML parse). Previously this
// only happened inside pixel.js which loads 200ms AFTER the `load` event.
// If the customer arrived via FB ad, opened a product, and clicked Buy Now
// within ~250ms of landing, pixel.js hadn't loaded yet → the click ID never
// got persisted to a cookie → the Purchase CAPI event was sent WITHOUT _fbc
// → FB couldn't attribute the conversion → silent ad-spend waste.
//
// Running this here at the very top guarantees the cookie is set before any
// order/lead form handler can fire.
(function _yarzCaptureClickIdsEarly() {
  try {
    var params = new URLSearchParams(window.location.search);
    var fbclid = params.get('fbclid');
    if (fbclid && !/_fbc=/.test(document.cookie || '')) {
      var fbcVal = 'fb.1.' + Date.now() + '.' + fbclid;
      document.cookie = '_fbc=' + fbcVal + '; max-age=' + (90 * 86400) + '; path=/; samesite=lax';
    }
    var ttclid = params.get('ttclid');
    if (ttclid && !/_yarz_ttclid=/.test(document.cookie || '')) {
      document.cookie = '_yarz_ttclid=' + encodeURIComponent(ttclid) + '; max-age=' + (90 * 86400) + '; path=/; samesite=lax';
    }
  } catch (e) {}
})();

var YARZ_API = (function() {
  // ✅ v16.12 STRICT SESSION CACHE: Detect manual page refresh to force fresh data
  try {
    var isReload = false;
    if (window.performance && window.performance.navigation) {
      if (window.performance.navigation.type === 1) isReload = true;
    }
    if (window.performance && window.performance.getEntriesByType) {
      var navEntries = window.performance.getEntriesByType("navigation");
      if (navEntries.length > 0 && navEntries[0].type === "reload") isReload = true;
    }
    if (isReload) {
      // Clear ONLY API session caches to get fresh data when customer hits refresh
      for (var i = sessionStorage.length - 1; i >= 0; i--) {
        var key = sessionStorage.key(i);
        if (key && key.indexOf('yarz_api_sess_') === 0) {
          sessionStorage.removeItem(key);
        }
      }
    }
  } catch(e) {}

  // ===== CONFIGURATION =====
  // ℹ️ Honest note about "client-side credentials":
  //   In ANY pure-frontend app (no server you control), these values WILL be
  //   visible to anyone who opens DevTools → Network tab. This is normal —
  //   Daraz, Pickaboo, Shopify storefronts all expose their API keys the same way.
  //
  //   Real security comes from THREE layers, NOT from hiding the key:
  //     1. Google Cloud Console: restrict API key to your domain (HTTP referrer).
  //        Without this, anyone can use your key from anywhere — WITH this,
  //        the key is useless outside yarzclothing.xyz / yourusername.github.io
  //     2. Cloudflare Worker: rate-limit per IP (already deployed) — stops abuse.
  //     3. Apps Script ADMIN_SECRET: ONLY needed for write operations (place_order,
  //        admin actions). It's stored ONLY in Apps Script + admin browser session,
  //        NEVER in this file. That's why google-apps-script.txt is gitignored.
  //
  // localStorage override lets you rotate the public key per-environment
  // (e.g., staging vs production) without code changes.
  
  // Cloudflare Worker reverse-proxy URL — public by design, required for
  // client-side fetches. Worker validates the API key and rate-limits requests.
  // ✅ v15.37: Smart base URL detection. When the website is served from
  // yarzclothing.xyz (Worker-bound custom domain), API requests should go
  // SAME-ORIGIN ('/') instead of cross-origin to workers.dev. This:
  //   • eliminates DNS lookup + TLS handshake to a 2nd origin (~80-150ms saved)
  //   • removes CORS preflight on every cacheable GET
  //   • keeps cookies in scope (visitor cookie set by Worker is accessible)
  //
  // Detection: if current page hostname is anything OTHER than the local
  // GitHub Pages preview (ixmaruf.github.io) or pure file://, assume the
  // Worker is bound to the same origin and use relative URLs. The
  // localStorage override `yarz_worker_url` still wins for staging/debug.
  function _detectWorkerUrl() {
    try {
      var override = localStorage.getItem('yarz_worker_url');
      if (override) return override;
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.__YARZ_WORKER_URL) return window.__YARZ_WORKER_URL;
    } catch (e) {}
    try {
      var host = (typeof location !== 'undefined' && location.hostname) || '';
      // Same-origin if running on a real domain (not a preview/dev domain).
      // Preview domains (GitHub Pages, Netlify, Vercel, etc.) cannot host
      // the Worker, so requests must go cross-origin to workers.dev.
      var isPreview = !host || host === 'localhost' || host === '127.0.0.1' ||
        host.indexOf('github.io') !== -1 || host.indexOf('githubpreview.dev') !== -1 ||
        host.indexOf('netlify.app') !== -1 || host.indexOf('vercel.app') !== -1 ||
        host.indexOf('pages.dev') !== -1 || host.indexOf('gitpod.io') !== -1 ||
        host.indexOf('csb.app') !== -1 || host.indexOf('stackblitz.io') !== -1 ||
        host.indexOf('glitch.me') !== -1 || host.indexOf('repl.co') !== -1;
      if (host && !isPreview) {
        return location.origin + '/';
      }
    } catch (e) {}
    return 'https://yarz.marufhasan80009.workers.dev/';
  }
  const CLOUDFLARE_WORKER_URL = _detectWorkerUrl();

  // Helper: read override from localStorage, fall back to default
  function _getStoredCredential(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Public API credentials (intentionally readable — see note above)
  const APPS_SCRIPT_URL = _getStoredCredential('yarz_gas_url', 'https://script.google.com/macros/s/AKfycbzLs9KDameNALSxN4ntZXHKs-st2V-4gN5ITFL38UnqKFw_s2yXFPcmLFB4KXzIVs7K/exec');
  const GOOGLE_API_KEY = _getStoredCredential('yarz_api_key', 'AIzaSyApMtjj2baO6u19AvppjLtJ1GT1G61qo9k');
  const SHEET_ID = _getStoredCredential('yarz_sheet_id', '1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q');

  // ════════════════════════════════════════════════════════════════
  // ✅ v10.3 TURBO LOAD — Google Sheets API v4 Direct Read
  // Fires IMMEDIATELY on script load (before DOM ready).
  // Bypasses Apps Script cold start (3-10s) → loads in ~300-500ms.
  // Falls back to Apps Script if direct read fails.
  // ════════════════════════════════════════════════════════════════

  // ✅ v15.84 ZERO-CACHE GUARANTEE: Owner explicitly requires that NOTHING
  //   product-related is saved to the customer's localStorage / IndexedDB.
  //   Every visit (1st, 2nd, 3rd) must show the LATEST data fetched live
  //   from Cloudflare Worker (which has its own server-side edge cache that
  //   admin Publish purges instantly).
  //
  //   The earlier v15.83 attempt used a localStorage snapshot for instant
  //   repeat-visit hydration — REVERTED because it contradicted the owner's
  //   policy (returning customers could see stale products until refresh).
  //
  //   Speed strategy now:
  //     1. Cloudflare Worker Edge SSR injects __YARZ_INITIAL_STATE on the
  //        SERVER (no client storage involved) — instant for SSR HITs.
  //     2. Inline <head> early-fetch script fires the products request in
  //        parallel with CSS/JS download — no caching, just earlier timing.
  //     3. Cloudflare Worker FRESH_TTL=30min serves from server-side edge
  //        cache; admin Publish purges it instantly.
  //   No customer-side persistence at any layer. ALWAYS LIVE.
  //
  //   If a customer somehow has a leftover snapshot from v15.83, clean it up.
  try { localStorage.removeItem('yarz_snapshot_v1'); } catch (e) {}

  var _turboStart = Date.now();
  var _turboData = null;
  var _turboPromise = (function _turboPreload() {
    try {
      // ✅ v15.34: Declare locally to prevent leaking onto window
      var fetchPromise;
      // ⚡ Edge SSR 0ms Load: Check if HTML was injected with state
      if (window.__YARZ_INITIAL_STATE) {
        fetchPromise = Promise.resolve(window.__YARZ_INITIAL_STATE);
      } else if (window.__YARZ_EARLY_FETCH) {
        // ✅ v15.83 PERF: Inline <head> early-fetch is in flight — reuse it
        //   instead of firing a duplicate. By the time _turboPreload runs
        //   (after api.js parse, ~50-150ms after HTML parse), the early
        //   fetch is usually already past TLS handshake and waiting on
        //   GAS — saves 100-300ms vs starting a fresh request here.
        fetchPromise = window.__YARZ_EARLY_FETCH.then(function (data) {
          return data || (function() {
            // Early fetch returned null (network error / 5xx) — fall back
            // to a fresh request so we still try once before giving up.
            // ✅ v15.97 CACHE-SLOT UNIFY: NO `cb=1` param. `cb=1` forked the
            // edge cache into `?action=products&cb=1` — a slot the Worker
            // NEVER prewarms/purges (it warms `?action=products`), so every
            // customer hit was a cold GAS upstream fetch (2-3s). Without cb,
            // the request normalizes to the SAME warm, prewarmed slot →
            // ~50ms edge HIT. `_t` is still stripped by buildCacheKey so it
            // only busts intermediate HTTP caches, never forks the edge slot.
            var url = CLOUDFLARE_WORKER_URL + '?key=' + GOOGLE_API_KEY + '&action=products&_t=' + Date.now();
            return fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); });
          })();
        });
      } else {
        // Fallback: fire fetch now
        // ✅ v15.97 CACHE-SLOT UNIFY: dropped `cb=1` (see note above) so this
        // hits the prewarmed edge slot instead of a perpetually-cold one.
        var url = CLOUDFLARE_WORKER_URL + '?key=' + GOOGLE_API_KEY + '&action=products&_t=' + Date.now();
        fetchPromise = fetch(url, { cache: 'no-store' }).then(function(r) { return r.json(); });
      }
      return fetchPromise
        .then(function(json) {
          if (!json || !json.success) return null;
          var data = json.data || json;
          var products = data.products || json.products || [];
          var storeInfo = data.storeInfo || json.storeInfo || {};
          var categories = data.categories || json.categories || [];
          if (!products.length) return null;

          // ⚡ v10.6 FIX: Normalize products so app.js can render them correctly.
          // GAS sends: regular, sale, stockM, image1 / app.js expects: regularPrice, salePrice, sizes.M, image1
          products = products.map(function(p) {
            if (!p || typeof p !== 'object') return p;
            // Price aliases
            if (p.regularPrice === undefined && p.regular !== undefined) p.regularPrice = p.regular;
            if (p.salePrice === undefined && p.sale !== undefined) p.salePrice = p.sale;
            if (p.discountPercent === undefined) {
              p.discountPercent = p.discPct !== undefined ? p.discPct :
                (p.regularPrice > 0 && p.salePrice >= 0 ?
                  Math.round(((p.regularPrice - p.salePrice) / p.regularPrice) * 100) : 0);
            }
            // Build sizes object from individual stock fields
            if (!p.sizes || typeof p.sizes !== 'object') {
              var sS = parseInt(p.stockS) || 0;
              var sM = parseInt(p.stockM) || 0;
              var sL = parseInt(p.stockL) || 0;
              var sXL = parseInt(p.stockXL) || 0;
              var sXXL = parseInt(p.stockXXL) || 0;
              var s3XL = parseInt(p.stock3XL) || 0;
              p.sizes = { S: sS, M: sM, L: sL, XL: sXL, XXL: sXXL, '3XL': s3XL };
            }
            if (p.inStock === undefined) {
              p.inStock = (p.sizes.S > 0 || p.sizes.M > 0 || p.sizes.L > 0 || p.sizes.XL > 0 || p.sizes.XXL > 0 || p.sizes['3XL'] > 0);
            }
            // Image aliases
            if (!p.image1 && p.img1) p.image1 = p.img1;
            if (!p.image2 && p.img2) p.image2 = p.img2;
            if (!p.image3 && p.img3) p.image3 = p.img3;
            if (!p.image4 && p.img4) p.image4 = p.img4;
            if (!p.image5 && p.img5) p.image5 = p.img5;
            if (!p.image6 && p.img6) p.image6 = p.img6;
            if (!p.description && p.desc) p.description = p.desc;
            return p;
          });

          // ⚡ v10.6 FIX: Compute category counts from actual products instead of using GAS list with 0 counts
          var counts = {};
          products.forEach(function(p) {
            var c = (p.category || '').trim();
            if (c) counts[c] = (counts[c] || 0) + 1;
          });
          // Build final category list — keep all GAS categories but fill in real counts
          var rawCatList = [];
          if (Array.isArray(categories) && categories.length) {
            categories.forEach(function(c) {
              var name = typeof c === 'string' ? c : (c && c.name ? c.name : '');
              if (name) rawCatList.push({ name: name, count: counts[name] || 0 });
            });
          } else {
            rawCatList = Object.keys(counts).map(function(n) { return { name: n, count: counts[n] }; });
          }
          // Filter to only categories that actually have active products
          categories = rawCatList.filter(function(c) { return c.count > 0; });

          _turboData = { products:products, storeInfo:storeInfo, categories:categories };
          _storeInfoFetchedAt = Date.now(); // Set this so getStoreInfo() doesn't fire duplicate background fetch
          if (window.__DEV__) console.log('⚡ TURBO: ' + products.length + ' products in ' + (Date.now()-_turboStart) + 'ms (CF Worker)');
          // ✅ v15.84: NO client-side snapshot. Owner policy requires every
          //   visit to fetch fresh data from Worker edge so admin updates
          //   show on the very next page load (not stuck behind a stale
          //   localStorage snapshot until customer hits refresh).
          return _turboData;
        })
        .catch(function(e) {
          // Fallback: try Google Sheets API direct if Worker fails
          console.warn('TURBO CF fallback, trying Sheets API:', e);
          var sheetUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' +
            SHEET_ID + '/values:batchGet?ranges=' +
            encodeURIComponent('INVENTORY!A1:AZ') + '&ranges=' +
            encodeURIComponent('SETTINGS!A:B') +
            '&key=' + GOOGLE_API_KEY +
            '&valueRenderOption=UNFORMATTED_VALUE';
          return fetch(sheetUrl, { cache: 'no-store' })
            .then(function(r) { return r.json(); })
            .then(function(json) {
              if (!json || !json.valueRanges || json.valueRanges.length < 2) return null;
              var invRows = json.valueRanges[0].values || [];
              var setRows = json.valueRanges[1].values || [];
              if (invRows.length < 2) return null;
              var products = [], cats = {};
              for (var i = 1; i < invRows.length; i++) {
                var r = invRows[i];
                if (!r || !r[0]) continue;
                var st = String(r[38] || '').trim();
                if (st !== 'Active') continue;
                var nm = String(r[0] || '').trim();
                if (!nm) continue;
                var reg = parseFloat(r[12]) || 0, sal = parseFloat(r[13]) || 0;
                var cat = String(r[6] || '').trim();
                if (cat) cats[cat] = (cats[cat] || 0) + 1;
                var sS=parseInt(r[45])||0, dS=parseInt(r[47])||0;
                var sM=parseInt(r[18])||0, dM=parseInt(r[22])||0;
                var sL=parseInt(r[19])||0, dL=parseInt(r[23])||0;
                var sXL=parseInt(r[20])||0, dXL=parseInt(r[24])||0;
                var sXXL=parseInt(r[21])||0, dXXL=parseInt(r[25])||0;
                var s3=parseInt(r[46])||0, d3=parseInt(r[48])||0;
                var lS=Math.max(0,sS-dS), lM=Math.max(0,sM-dM), lL=Math.max(0,sL-dL);
                var lXL=Math.max(0,sXL-dXL), lXXL=Math.max(0,sXXL-dXXL), l3=Math.max(0,s3-d3);
                products.push({
                  name:nm, image1:String(r[1]||''), image2:String(r[2]||''),
                  image3:String(r[3]||''), image4:String(r[39]||''),
                  image5:String(r[40]||''), image6:String(r[41]||''),
                  video:String(r[4]||''), description:String(r[5]||''),
                  category:cat, fabric:String(r[7]||''), badge:String(r[8]||''),
                  sizeChart:String(r[9]||''), deliveryDays:String(r[10]||''),
                  regularPrice:reg, salePrice:sal||reg,
                  discountPercent:parseFloat(r[14])||(reg>sal&&sal>0?Math.round(((reg-sal)/reg)*100):0),
                  discountType:String(r[15]||''),
                  deliveryDhaka:parseFloat(r[16])||70, deliveryOutside:parseFloat(r[17])||140,
                  stockS:lS, stockM:lM, stockL:lL, stockXL:lXL, stockXXL:lXXL, stock3XL:l3,
                  sizes:{S:lS,M:lM,L:lL,XL:lXL,XXL:lXXL,'3XL':l3},
                  inStock:(lS>0||lM>0||lL>0||lXL>0||lXXL>0||l3>0),
                  status:st, couponActive:String(r[42]||''),
                  couponCode:String(r[43]||''), couponDisc:parseFloat(r[44])||0,
                  hiddenSizes:String(r[49]||''),
                  sizeType:String(r[50]||''),
                  accessory:String(r[51]||'')
                });
              }
              var storeInfo = {};
              for (var j = 0; j < setRows.length; j++) {
                var row = setRows[j];
                if (row && row[0]) storeInfo[String(row[0]).trim()] = row[1] !== undefined ? row[1] : '';
              }
              var catList = Object.keys(cats).map(function(n) { return {name:n, count:cats[n]}; });
              _turboData = { products:products, storeInfo:storeInfo, categories:catList };
              if (window.__DEV__) console.log('⚡ TURBO: ' + products.length + ' products in ' + (Date.now()-_turboStart) + 'ms (Sheets fallback)');
              // ✅ v15.84: NO client-side snapshot — see policy note above.
              return _turboData;
            })
            .catch(function(e2) { console.warn('TURBO all failed:', e2); return null; });
        });
    } catch(e) { return Promise.resolve(null); }
  })();

  // Deployment version — when this changes, ALL caches are force-cleared
  const DEPLOY_VERSION = '2026-05-24-v15.0-zero-local-cache';

  const CONFIG = {
    API_KEY: GOOGLE_API_KEY,
    BASE_URL: APPS_SCRIPT_URL,
    // ✅ v16.11 SESSION CACHING: Re-enabled short-term caching (5 min) using 
    // ✅ v16.12 STRICT SESSION CACHE: Infinite cache within a single session.
    // Removes the 5-minute background refresh. Cache is only cleared if customer 
    // closes the tab or manually hits the refresh button.
    CACHE_TTL: 999999999,             // Infinite within session
    STALE_TTL: 999999999,             // Infinite within session
    PRODUCT_CACHE_TTL: 999999999,     // Infinite within session
    PRODUCT_STALE_TTL: 999999999,     // Infinite within session
    SETTINGS_CACHE_TTL: 999999999,    // Infinite within session
    SETTINGS_STALE_TTL: 999999999,    // Infinite within session
  };

  // ✅ v4.1: Action types that should NEVER be cached (real-time required)
  const NO_CACHE_ACTIONS = ['orders_by_phone', 'place_order', 'updatewebsiteorderstatus', 'deletewebsiteorder', 'health'];

  // ✅ v3.9: Tier resolver — picks the right TTL per action
  function _ttlFor(action) {
    if (action === 'products' || action === 'product' || action === 'categories') {
      return { fresh: CONFIG.PRODUCT_CACHE_TTL, stale: CONFIG.PRODUCT_STALE_TTL };
    }
    if (action === 'store_info') {
      return { fresh: CONFIG.SETTINGS_CACHE_TTL, stale: CONFIG.SETTINGS_STALE_TTL };
    }
    return { fresh: CONFIG.CACHE_TTL, stale: CONFIG.STALE_TTL };
  }

  // ✅ v3.9: In-memory cache (faster than localStorage — no JSON parse on every hit)
  const memCache = {};

  const DEFAULT_SOCIAL_LINKS = {
    facebook: 'https://www.facebook.com/Yarzbd',
    instagram: 'https://www.instagram.com/yarzclothing',
    whatsapp: 'https://wa.me/8801601743670',
    tiktok: 'https://tiktok.com/@yarzbd',
    messenger: 'https://m.me/Yarzbd',
    youtube: '',
    twitter: ''
  };

  const cache = {};

  // ✅ v11.9: URL version enforcement removed — no hardcoded URLs
  // All URLs now loaded from localStorage (configured via setup.html)
  const API_ENDPOINTS = [];
  // ✅ v4.5: DEPLOYMENT VERSION CHECK — force-clears ALL caches when new version detected
  // This is the MAIN fix for "incognito works but normal browser doesn't"
  (function _deployVersionCheck() {
    try {
      var lastDeploy = localStorage.getItem('yarz_deploy_version');
      if (lastDeploy !== DEPLOY_VERSION) {
        // 1. Clear localStorage caches
        Object.keys(localStorage).forEach(function(k) {
          if (k.startsWith('yarz_api_cache_') || k === 'yarz_api_url' ||
              k === 'yarz_storeinfo_cache' || k === 'yarz_prefetch_snapshot') {
            localStorage.removeItem(k);
          }
        });
        // 2. Force Service Worker to clear old caches
        if ('caches' in window) {
          caches.keys().then(function(keys) {
            keys.forEach(function(k) { if (k.startsWith('yarz-')) caches.delete(k); });
          });
        }
        // 3. ✅ v17.15: Don't blanket-unregister ALL service workers — this
        // raced with boot.js's registration in multi-tab scenarios, killing
        // the SW in the *other* tab and breaking offline for the next
        // navigation. Instead, just unregister the registrations whose
        // scriptURL doesn't match the current sw.js?v=17.15 (i.e., the
        // genuinely-old one). The new SW's own activate handler at
        // sw.js:83-85 already purges old `yarz-*` caches automatically.
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistrations().then(function(regs) {
            regs.forEach(function(r) {
              try {
                if (r.active && r.active.scriptURL &&
                    r.active.scriptURL.indexOf('sw.js') !== -1 &&
                    r.active.scriptURL.indexOf(DEPLOY_VERSION) === -1) {
                  r.unregister();
                }
              } catch (e) { /* registration gone, ignore */ }
            });
          });
        }
        // 4. Save new version
        localStorage.setItem('yarz_deploy_version', DEPLOY_VERSION);
      }
      // Ensure API URL points to the latest deployment
      var saved = localStorage.getItem('yarz_api_url');
      if (saved && saved !== APPS_SCRIPT_URL) {
        localStorage.removeItem('yarz_api_url');
      }
      // ✅ v9.7: Detect admin dirty flag — admin panel sets this after saving settings.
      // Clears prefetch snapshot so storefront fetches fresh data on next load.
      var dirty = localStorage.getItem('yarz_settings_dirty');
      if (dirty) {
        localStorage.removeItem('yarz_settings_dirty');
        localStorage.removeItem('yarz_prefetch_snapshot');
        Object.keys(localStorage).forEach(function(k) {
          if (k.startsWith('yarz_api_cache_') || k === 'yarz_storeinfo_cache') {
            localStorage.removeItem(k);
          }
        });
      }
    } catch(e) {}
  })();

  // ✅ v10.8: Safe localStorage wrappers — never throw in Safari private mode,
  // Telegram in-app, or any restricted environment
  function _lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function _lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function _lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function getBaseUrl() {
    return _lsGet('yarz_api_url') || APPS_SCRIPT_URL;
  }

  // ⚡ v6.0: Customer-facing READS go through Cloudflare Worker (cached at edge).
  // WRITES (POST) keep going to GAS directly — Worker also forwards them but
  // we want minimum hops on the order-placement path.
  function getReadUrl() {
    // Allow override from localStorage (e.g. for staging/debug)
    return _lsGet('yarz_worker_url') || CLOUDFLARE_WORKER_URL;
  }
  function getWriteUrl() {
    // POSTs (place_order, admin actions) — direct to GAS, no caching layer needed
    return getBaseUrl();
  }

  function setBaseUrl(url) {
    _lsSet('yarz_api_url', url);
  }

  function isConfigured() {
    return !!getBaseUrl();
  }


  function getCached(key, allowStale, action) {
    const ttl = _ttlFor(action || '');
    // ✅ v16.11: Use sessionStorage + memCache.
    // We read from memCache first (fastest, no JSON parse).
    const memItem = memCache[key];
    if (memItem) {
      const age = Date.now() - memItem.time;
      if (age <= ttl.fresh) return { data: memItem.data, fresh: true };
      if (allowStale && age <= ttl.stale) return { data: memItem.data, fresh: false };
    }
    
    // Fallback to sessionStorage
    try {
      const sessionItemStr = sessionStorage.getItem('yarz_api_sess_' + encodeURIComponent(key));
      if (sessionItemStr) {
        const sessionItem = JSON.parse(sessionItemStr);
        const age = Date.now() - sessionItem.time;
        if (age <= ttl.fresh) {
          memCache[key] = sessionItem; // Prime memCache
          return { data: sessionItem.data, fresh: true };
        }
        if (allowStale && age <= ttl.stale) {
          memCache[key] = sessionItem;
          return { data: sessionItem.data, fresh: false };
        }
      }
    } catch (e) { }

    return null;
  }

  function setCache(key, data) {
    // ✅ v16.11: Write to memCache AND sessionStorage.
    const time = Date.now();
    memCache[key] = { data, time };
    try {
      sessionStorage.setItem('yarz_api_sess_' + encodeURIComponent(key), JSON.stringify({ data, time }));
    } catch (e) { }
    try { if (window.TURBO) window.TURBO.set(key, data); } catch (e) {}
  }

  function clearCache() {
    Object.keys(memCache).forEach(k => delete memCache[k]);
    try {
      Object.keys(sessionStorage).forEach(k => {
        if (k.startsWith('yarz_api_sess_')) sessionStorage.removeItem(k);
      });
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('yarz_api_cache_')) localStorage.removeItem(k);
      });
    } catch (e) { }
    try { if (window.TURBO) window.TURBO.clear(); } catch (e) {}
  }

  function flushAllCaches() {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'PURGE_CACHE' });
      }
    } catch (e) { }
    clearCache();
    invalidateStoreInfo();
  }

  // ✅ v9.7: Targeted invalidation for store_info — used after admin saves settings.
  // Clears only settings-related caches so next getStoreInfo() / getGlobalControls()
  // fetch fresh data from server instead of serving stale cached values.
  // ✅ v15.32 FIX: Also breaks the _turboData.storeInfo short-circuit so the
  // very next getStoreInfo() call hits the network. Without this line, the
  // SWR refresh in app.js' _refreshProductsFromNetwork was completely dead
  // for store_info (turbo short-circuit always returned the page-load snapshot).
  function invalidateStoreInfo() {
    if (_turboData) _turboData.storeInfo = null;
    _storeInfoFetchedAt = 0;
    Object.keys(memCache).forEach(k => {
      if (k.indexOf('store_info') !== -1 || k.indexOf('delivery_charges') !== -1) {
        delete memCache[k];
      }
    });
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.indexOf('store_info') !== -1 || k.indexOf('delivery_charges') !== -1 || k === 'yarz_storeinfo_cache') {
          localStorage.removeItem(k);
        }
      });
    } catch (e) { }
  }

  const _revalidating = {};

  // ===== RESPONSE NORMALIZER (CRITICAL FIX) =====
  // Apps Script returns: { success, ok, data: { products, categories, storeInfo } }
  // Old apps may return: { success, products, categories, store }
  // This unifies both formats so app.js can safely use data.products / data.categories
  function _normalizeResponse(action, data) {
    if (!data || typeof data !== 'object') return data;

    // Pass-through if already in expected format
    if (action === 'products') {
      // Promote nested data.data.products → data.products
      if (data.data && typeof data.data === 'object') {
        if (Array.isArray(data.data)) {
          data.products = data.data;
        } else if (Array.isArray(data.data.products)) {
          data.products = data.data.products;
        }
        if (Array.isArray(data.data.categories) && !data.categories) {
          data.categories = data.data.categories;
        }
        if (data.data.storeInfo && !data.storeInfo) {
          data.storeInfo = data.data.storeInfo;
        }
        if (data.data.timestamp) data.timestamp = data.data.timestamp;
      }

      // ✅ v3.9 CRITICAL FIX: Normalize each product's field names so app.js renders correctly
      // Apps Script sends: stockM/stockL/stockXL/stockXXL, regular, sale, discPct, image1-6
      // app.js expects:    sizes.M/L/XL/XXL, regularPrice, salePrice, discountPercent, image1-6
      if (Array.isArray(data.products)) {
        data.products = data.products.map(function(p) {
          if (!p || typeof p !== 'object') return p;

          // Map price fields
          if (p.regularPrice === undefined && p.regular !== undefined) p.regularPrice = p.regular;
          if (p.salePrice === undefined && p.sale !== undefined) p.salePrice = p.sale;
          if (p.discountPercent === undefined) {
            p.discountPercent = p.discPct !== undefined ? p.discPct :
              (p.regularPrice > 0 && p.salePrice >= 0 ?
                Math.round(((p.regularPrice - p.salePrice) / p.regularPrice) * 100) : 0);
          }

          // Map sizes → { M: qty, L: qty, XL: qty, XXL: qty }
          if (!p.sizes || typeof p.sizes !== 'object') {
            var sS = parseInt(p.stockS) || 0;
            var sM = parseInt(p.stockM) || 0;
            var sL = parseInt(p.stockL) || 0;
            var sXL = parseInt(p.stockXL) || 0;
            var sXXL = parseInt(p.stockXXL) || 0;
            var s3XL = parseInt(p.stock3XL) || 0;
            p.sizes = { S: sS, M: sM, L: sL, XL: sXL, XXL: sXXL, '3XL': s3XL };
          }

          // inStock = true if ANY size has stock > 0
          if (p.inStock === undefined) {
            p.inStock = (p.sizes.S > 0 || p.sizes.M > 0 || p.sizes.L > 0 || p.sizes.XL > 0 || p.sizes.XXL > 0 || p.sizes['3XL'] > 0);
          }

          // Ensure image field aliases (Apps Script uses image1, website also image1 - ensure consistency)
          if (!p.image1 && p.img1) p.image1 = p.img1;
          if (!p.image2 && p.img2) p.image2 = p.img2;
          if (!p.image3 && p.img3) p.image3 = p.img3;
          if (!p.image4 && p.img4) p.image4 = p.img4;
          if (!p.image5 && p.img5) p.image5 = p.img5;
          if (!p.image6 && p.img6) p.image6 = p.img6;

          // description alias
          if (!p.description && p.desc) p.description = p.desc;

          return p;
        });
      }
    }

    if (action === 'categories') {
      // Apps Script: { success, data: [...] } or { success, data: { products, categories } }
      if (Array.isArray(data.data)) {
        data.categories = data.data.map(function (c) {
          // If just a string array, convert to object form
          if (typeof c === 'string') return { name: c, count: 0 };
          return c;
        });
      } else if (data.data && Array.isArray(data.data.categories)) {
        data.categories = data.data.categories;
      }
      // Compute counts if missing — needs products list
      if (Array.isArray(data.categories)) {
        data.categories = data.categories.map(function (c) {
          if (typeof c === 'string') return { name: c, count: 0 };
          return c;
        });
      }
    }

    if (action === 'store_info') {
      if (data.data && typeof data.data === 'object' && !data.store) {
        data.store = data.data;
      }
    }

    if (action === 'orders_by_phone') {
      if (Array.isArray(data.data) && !data.orders) {
        data.orders = data.data;
      }
    }

    return data;
  }

  const _inflight = {};

  // ===== GET REQUEST (with stale-while-revalidate) =====
  async function apiGet(action, params = {}, opts = {}) {
    // ⚡ v6.0: Reads now go through Cloudflare Worker for sub-100ms edge cache.
    const base = getReadUrl();
    if (!base) throw new Error('API URL not configured');

    const url = new URL(base);
    url.searchParams.set('key', CONFIG.API_KEY);
    url.searchParams.set('action', action);
    Object.keys(params).forEach(k => {
      if (params[k] !== undefined && params[k] !== '') {
        url.searchParams.set(k, params[k]);
      }
    });

    const cacheKey = url.toString();

    // ✅ v4.2: explicit skipCache option (used by stock checks)
    if (opts && opts.skipCache) {
      if (_inflight[cacheKey]) return _inflight[cacheKey];
      const p = _fetchFromNetwork(action, url.toString(), cacheKey, true).finally(() => {
        delete _inflight[cacheKey];
      });
      _inflight[cacheKey] = p;
      return p;
    }

    // ✅ v4.1: Real-time actions (order tracking) bypass cache entirely
    if (NO_CACHE_ACTIONS.indexOf(action) !== -1) {
      if (_inflight[cacheKey]) return _inflight[cacheKey];
      const p = _fetchFromNetwork(action, url.toString(), cacheKey, true).finally(() => {
        delete _inflight[cacheKey];
      });
      _inflight[cacheKey] = p;
      return p;
    }
    const cached = getCached(cacheKey, true, action);

    if (cached && cached.fresh) return cached.data;

    if (cached && !cached.fresh) {
      if (!_revalidating[cacheKey]) {
        _revalidating[cacheKey] = true;
        _fetchFromNetwork(action, url.toString(), cacheKey).finally(() => {
          delete _revalidating[cacheKey];
        });
      }
      return cached.data;
    }

    if (_inflight[cacheKey]) {
      return _inflight[cacheKey];
    }

    const p = _fetchFromNetwork(action, url.toString(), cacheKey).finally(() => {
      delete _inflight[cacheKey];
    });
    _inflight[cacheKey] = p;
    return p;
  }

  // ✅ v17.5: Fetch with AbortController timeout. Without this, a hung GAS /
  // Worker connection would make the customer wait the full 12s exponential
  // backoff chain (1.5s + 3s + 4.5s) on every retry — for `place_order` that
  // could mean 5 orders × 12s = 60 seconds of UI time.
  const _NETWORK_TIMEOUT_MS = 8000;
  function _fetchWithTimeout(url, opts) {
    opts = opts || {};
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (ctl) opts.signal = ctl.signal;
    const p = fetch(url, opts);
    if (!ctl) return p;
    const t = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, _NETWORK_TIMEOUT_MS);
    return p.finally(function () { clearTimeout(t); });
  }

  async function _fetchFromNetwork(action, urlStr, cacheKey, skipCache) {
    const maxRetries = 4; // Increased for high concurrency
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const bustUrl = urlStr + (urlStr.includes('?') ? '&' : '?') + '_t=' + Date.now();
        const response = await _fetchWithTimeout(bustUrl, {
          method: 'GET',
          redirect: 'follow',
          cache: 'no-store',
        });

        // If Google hits a rate limit, it might return 429 or 500
        if (!response.ok) {
           throw new Error(`HTTP Error: ${response.status}`);
        }

        let data = await response.json();

        // ✅ CRITICAL: Normalize response so app.js works regardless of API format
        data = _normalizeResponse(action, data);

        if ((data.success || data.ok) && !skipCache) {
          setCache(cacheKey, data);
          _notifyRefresh(cacheKey, data);
        }
        return data;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          throw err;
        }
        // Exponential backoff with full jitter: 2s, 4s, cap@8s
        const delay = Math.min(Math.pow(2, attempt) * 1000, _NETWORK_TIMEOUT_MS) + Math.floor(Math.random() * 1000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  const _refreshListeners = [];

  function onDataRefresh(callback) {
    _refreshListeners.push(callback);
  }

  function _notifyRefresh(cacheKey, data) {
    _refreshListeners.forEach(fn => {
      try { fn(cacheKey, data); } catch (e) { }
    });
  }

  // ===== POST REQUEST =====
  // Actions that benefit from going through the Cloudflare Worker so it can
  // inject `client_ip_address` + `client_user_agent` from real browser headers.
  // CAPI and TikTok server-side mirrors NEED this for high EMQ scores; place_order
  // benefits because the server-side Purchase event fired by GAS gets the IP too.
  const POST_VIA_WORKER = new Set(['place_order', 'capi', 'fbcapi', 'ttapi', 'ttevents']);

  async function apiPost(action, body = {}) {
    // ⚡ v11.7: CAPI / Lead / Purchase POSTs route through Cloudflare Worker so it
    // can inject the real client IP + UA into the request body. Other writes
    // (admin actions, status updates) keep going direct to GAS to save a hop.
    const lo = String(action || '').toLowerCase();
    let base;
    if (POST_VIA_WORKER.has(lo)) {
      base = localStorage.getItem('yarz_post_url') || getReadUrl(); // Worker URL
    } else {
      base = localStorage.getItem('yarz_post_url') || getWriteUrl(); // Direct GAS
    }
    if (!base) throw new Error('API URL not configured');

    const maxRetries = 4; // Increased for high concurrency
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        const response = await _fetchWithTimeout(base, {
          method: 'POST',
          redirect: 'follow',
          keepalive: true, // v10.6: Guarantees delivery even if user closes tab instantly
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            key: CONFIG.API_KEY,
            action,
            ...body
          })
        });
        
        // If Google hits a rate limit, it might return 429 or 500
        if (!response.ok) {
           throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        return data;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          throw err;
        }
        // Exponential backoff with full jitter: 2s, 4s, cap@8s
        const delay = Math.min(Math.pow(2, attempt) * 1000, _NETWORK_TIMEOUT_MS) + Math.floor(Math.random() * 1000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // ===== PUBLIC API METHODS =====
  async function getProducts(category, search) {
    // ✅ v10.3 TURBO: Try direct Sheets API data first (~300ms vs 3-10s)
    if (_turboPromise) {
      try {
        var turbo = await _turboPromise;
        _turboPromise = null; // consume once
        if (turbo && turbo.products && turbo.products.length > 0) {
          var result = {
            success: true, ok: true,
            products: turbo.products,
            categories: turbo.categories,
            storeInfo: turbo.storeInfo
          };
          result = _normalizeResponse('products', result);
          // Populate memory cache so subsequent calls are instant
          var ck = getReadUrl() + '?key=' + CONFIG.API_KEY + '&action=products';
          setCache(ck, result);
          return result;
        }
      } catch(e) { _turboPromise = null; }
    }
    return apiGet('products', { category, search });
  }

  async function getProduct(name) {
    return apiGet('product', { name });
  }

  // ✅ v4.2: Real-time stock check — fresh server data, never cached
  // Used silently in background while customer is on product page
  async function getProductStock(name) {
    try {
      const params = { name, _t: Date.now() };
      const res = await apiGet('product', params, { skipCache: true });
      if (res && (res.success || res.ok)) {
        const p = res.product || res.data || res;
        if (p && typeof p === 'object') {
          return {
            success: true,
            name: p.name || name,
            stock_S:   parseInt(p.stock_S   || p.stockS   || (p.sizes && p.sizes.S)   || 0) || 0,
            stock_M:   parseInt(p.stock_M   || p.stockM   || (p.sizes && p.sizes.M)   || 0) || 0,
            stock_L:   parseInt(p.stock_L   || p.stockL   || (p.sizes && p.sizes.L)   || 0) || 0,
            stock_XL:  parseInt(p.stock_XL  || p.stockXL  || (p.sizes && p.sizes.XL)  || 0) || 0,
            stock_XXL: parseInt(p.stock_XXL || p.stockXXL || (p.sizes && p.sizes.XXL) || 0) || 0,
            stock_3XL: parseInt(p.stock_3XL || p.stock3XL || (p.sizes && p.sizes['3XL']) || 0) || 0,
            inStock: !!(p.inStock !== false),
            updatedAt: Date.now()
          };
        }
      }
      return { success: false };
    } catch (err) {
      // Silent fail
      return { success: false, error: err.message };
    }
  }

  async function getCategories() {
    // ✅ Categories from products endpoint to get accurate counts
    // Falls back to the categories action if needed
    try {
      const productsRes = await getProducts();
      if (productsRes && productsRes.success && Array.isArray(productsRes.products)) {
        const counts = {};
        productsRes.products.forEach(function (p) {
          const c = p.category || '';
          if (!c) return;
          counts[c] = (counts[c] || 0) + 1;
        });
        // Use storeInfo categories if available, else from product list
        const cats = (productsRes.storeInfo && Array.isArray(productsRes.storeInfo.categories))
          ? productsRes.storeInfo.categories : Object.keys(counts);
        const finalList = cats.map(function (name) {
          if (typeof name === 'object' && name.name) {
            return { name: name.name, count: counts[name.name] || name.count || 0 };
          }
          return { name: name, count: counts[name] || 0 };
        }).filter(function (c) { return c.count > 0; });
        return { success: true, categories: finalList };
      }
    } catch (e) {
      // Fallback to categories endpoint
    }
    return apiGet('categories');
  }

  // ✅ v15.32 FIX: SWR-style getStoreInfo. Previously this was permanently
  // frozen at page-load — once `_turboData.storeInfo` was populated, it never
  // re-fetched even after hours of tab being open. That meant admin's
  // announcement/banner/theme/popup updates were invisible to returning
  // customers without a hard refresh.
  // 
  // New behavior:
  //   • If turbo data is present → return it instantly (zero latency)
  //   • In parallel (non-blocking) → fire a background fetch every 60s+
  //     and update _turboData.storeInfo in place
  //   • Next caller gets the fresh copy automatically
  //   • _notifyRefresh broadcast lets app.js trigger a re-apply pass
  // 
  // KV/quota: Worker edge cache has FRESH_TTL=30min, so this 60s client
  // poll mostly hits cache (~50ms) and only falls through to GAS once
  // every 30 minutes. Negligible quota use.
  var _storeInfoFetchedAt = 0;
  var _storeInfoInflight = null;
  const STORE_INFO_TTL_MS = 60 * 1000; // 60s — covers admin-update windows

  async function getStoreInfo() {
    // If _turboPromise is in flight, wait for it first to populate storeInfo from it
    if (_turboPromise) {
      try {
        await _turboPromise;
      } catch (e) {}
    }

    var now = Date.now();
    var hasTurbo = _turboData && _turboData.storeInfo && Object.keys(_turboData.storeInfo).length > 0;

    // Background revalidate if data is older than TTL
    if (now - _storeInfoFetchedAt > STORE_INFO_TTL_MS && !_storeInfoInflight) {
      _storeInfoInflight = apiGet('store_info', { _t: now }, { skipCache: true })
        .then(function (fresh) {
          if (fresh && (fresh.success || fresh.ok)) {
            var s = fresh.data || fresh.store || fresh.storeInfo;
            if (s && typeof s === 'object' && Object.keys(s).length > 0) {
              if (_turboData) _turboData.storeInfo = s;
              _storeInfoFetchedAt = Date.now();
              _notifyRefresh('store_info', { success: true, data: s, store: s });
            }
          }
          return fresh;
        })
        .catch(function () { return null; })
        .finally(function () { _storeInfoInflight = null; });
    }

    // Serve fast: turbo data first, network promise as fallback
    if (hasTurbo) {
      return { success: true, ok: true, data: _turboData.storeInfo, store: _turboData.storeInfo };
    }
    return _storeInfoInflight || apiGet('store_info');
  }

  async function getDeliveryCharges() {
    return apiGet('delivery_charges', { _t: Date.now() }, { skipCache: true });
  }

  async function healthCheck() {
    return apiGet('health');
  }

  async function placeOrder(orderData) {
    clearCache();
    return apiPost('place_order', { order: orderData });
  }

  async function getOrdersByPhone(phone, forceFresh) {
    try {
      // ✅ v4.1 FIX: bypass cache for real-time status sync (admin -> customer)
      if (forceFresh) {
        clearCache();
        const params = { phone, _t: Date.now() };
        return await apiGet('orders_by_phone', params, { skipCache: true });
      }
      return await apiGet('orders_by_phone', { phone });
    } catch (err) {
      return {
        success: false,
        message: 'Order tracking is temporarily unavailable. Please contact customer support.',
        fallback: true,
        orders: []
      };
    }
  }

  // ✅ Delete order — uses POST primary, GET fallback (for CORS issues)
  async function deleteOrder(orderId) {
    clearCache();
    try {
      const res = await apiPost('deletewebsiteorder', { orderId });
      if (res && (res.success || res.ok)) return res;
      // Fallback: try GET
      return await apiGet('deletewebsiteorder', { orderId });
    } catch (err) {
      try {
        return await apiGet('deletewebsiteorder', { orderId });
      } catch (e2) {
        return { success: false, error: e2.message };
      }
    }
  }

  // ✅ Archive completed orders
  async function archiveCompletedOrders() {
    clearCache();
    try {
      return await apiPost('archivecompletedorders', {});
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ✅ Update order status — for admin panel sync
  async function updateOrderStatus(orderId, status, courier) {
    clearCache();
    return apiPost('updatewebsiteorderstatus', { orderId, status, courier: courier || '' });
  }

  // ===== GLOBAL CONTROLS =====
  async function getGlobalControls() {
    try {
      const result = await getStoreInfo();
      if (!result || !result.success) return null;

      const s = result.data || result.store || {};
      if (!s || typeof s !== 'object') return null;

      const dynamicSections = [];

      const get = (key) => {
        if (s[key] !== undefined) return s[key];
        
        // Prioritize admin panel's Title Case keys
        var titleCase = key.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
        if (s[titleCase] !== undefined) return s[titleCase];
        
        // Fallback for case differences (e.g., 'Announcement Bg' vs 'Announcement BG')
        const targetTitle = titleCase.toLowerCase();
        for (let k in s) {
          if (k.toLowerCase() === targetTitle) return s[k];
        }

        // Legacy snake_case fallback
        const normalized = key.toLowerCase().replace(/[\s()]+/g, '_');
        if (s[normalized] !== undefined) return s[normalized];
        
        return '';
      };

      const parseBool = (val, defaultVal = false) => {
        if (val === '' || val === undefined || val === null) return defaultVal;
        if (typeof val === 'boolean') return val;
        const str = String(val).toLowerCase().trim();
        if (['true','yes','1','on','enabled','enable','chalu','চালু'].indexOf(str) !== -1) return true;
        if (['false','no','0','off','disabled','disable','bondho','bondh','বন্ধ'].indexOf(str) !== -1) return false;
        return defaultVal;
      };

      const storeStatus = String(get('store_status') || 'open').toLowerCase();
      const maintenanceMode = parseBool(get('maintenance_mode')) || storeStatus === 'maintenance';
      // ── v15.74: Holiday / Vacation Mode ──
      // Different from maintenance: shown when courier services pause for
      // Eid / Puja / festival / inventory etc. so customers don't place
      // orders that can't be fulfilled in time. Maintenance still wins if both ON.
      const holidayMode = parseBool(get('holiday_mode')) || storeStatus === 'holiday';
      const holidayReason = String(get('holiday_reason') || 'custom').toLowerCase();
      const holidayCustomMessage = String(get('holiday_custom_message') || '');
      const holidayReturnDate = String(get('holiday_return_date') || '');
      const announcementActive = parseBool(get('announcement_active'));
      const announcementText = String(get('announcement_text') || '');
      const paymentMethods = String(get('payment_methods') || 'COD, bKash, Nagad');
      
      const _codRaw = get('enable_cod') !== '' ? get('enable_cod')
                    : (s['Enable COD'] !== undefined ? s['Enable COD']
                    : (s['enable cod'] !== undefined ? s['enable cod'] : ''));
      let enableCOD = parseBool(_codRaw, true);

      // ✅ v3.8: Default zones → Narayanganj (Inside ৳70 / Outside ৳140)
      const zone1Name = String(get('zone_1_name') || 'Inside Narayanganj');
      const zone2Name = String(get('zone_2_name') || 'Outside Narayanganj');
      const zone1Charge = parseFloat(get('zone_1_charge')) || 70;
      const zone2Charge = parseFloat(get('zone_2_charge')) || 140;

      // ✅ Delivery locations — dynamic manager backed by the DELIVERY_CHARGES sheet tab.
      // Supports unlimited owner-defined locations while preserving legacy Zone 1/2 fields.
      let deliveryLocations = [];
      const rawDeliveryLocations = get('delivery_locations') || s.delivery_locations || s.deliveryLocations || '';
      if (Array.isArray(rawDeliveryLocations)) {
        deliveryLocations = rawDeliveryLocations;
      } else if (rawDeliveryLocations) {
        try { deliveryLocations = JSON.parse(String(rawDeliveryLocations)); } catch (e) { deliveryLocations = []; }
      }
      deliveryLocations = deliveryLocations
        .map((loc, idx) => ({
          id: String(loc.id || loc.key || ('zone_' + (idx + 1))).trim(),
          name: String(loc.name || loc.location || '').trim(),
          charge: parseFloat(loc.charge || loc.fee || loc.deliveryCharge || 0) || 0,
          active: loc.active === undefined ? true : parseBool(loc.active, true)
        }))
        .filter(loc => loc.name && loc.active);
      if (!deliveryLocations.length) {
        deliveryLocations = [
          { id: 'zone_1', name: zone1Name, charge: zone1Charge, active: true },
          { id: 'zone_2', name: zone2Name, charge: zone2Charge, active: true }
        ];
      }

      // ✅ Social Links — supports MULTIPLE key formats from sheet
      const socialLinks = {
        facebook: String(get('link_facebook') || get('facebook_page') || get('facebook') || s['facebook_url'] || DEFAULT_SOCIAL_LINKS.facebook),
        instagram: String(get('link_instagram') || get('instagram') || s['instagram_url'] || DEFAULT_SOCIAL_LINKS.instagram),
        whatsapp: String(get('link_whatsapp') || get('whatsapp') || s['whatsapp_url'] || DEFAULT_SOCIAL_LINKS.whatsapp),
        tiktok: String(get('link_tiktok') || get('tiktok') || s['tiktok_url'] || DEFAULT_SOCIAL_LINKS.tiktok),
        messenger: String(get('link_messenger') || get('messenger') || s['messenger_url'] || DEFAULT_SOCIAL_LINKS.messenger),
        youtube: String(get('link_youtube') || get('youtube') || s['youtube_url'] || DEFAULT_SOCIAL_LINKS.youtube),
        twitter: String(get('link_twitter') || get('twitter') || s['twitter_url'] || DEFAULT_SOCIAL_LINKS.twitter)
      };

      // ✅ Live Chat config
      // ✅ v15.6 FIX: Branding-tab `Live Chat` select saves "whatsapp"/"messenger"/etc.
      // — read it here so the dropdown actually controls anything.
      const liveChatChoice = String(get('live_chat') || '').toLowerCase();
      const liveChat = {
        whatsappBtn: liveChatChoice === 'whatsapp' || liveChatChoice === 'both' ||
                     parseBool(get('whatsapp_chat_active') || get('whatsapp_chat')),
        whatsappNumber: String(get('whatsapp_chat_number') || get('whatsapp_number') || ''),
        whatsappMsg: String(get('whatsapp_chat_msg') || get('whatsapp_default_msg') || 'Hi, I am interested in your products.'),
        messengerBtn: liveChatChoice === 'messenger' || liveChatChoice === 'both' ||
                      parseBool(get('messenger_chat_active') || get('messenger_chat')),
        messengerUrl: String(get('messenger_chat_url') || get('messenger_url') || socialLinks.messenger || ''),
        choice: liveChatChoice
      };

      const heroBanners = [];
      for (let i = 1; i <= 5; i++) {
        const img = s['hero_banner_' + i] || s['hero_banner ' + i] || '';
        if (img) {
          heroBanners.push({
            image: img,
            title: s['banner_title_' + i] || s['banner_title ' + i] || '',
            link: s['banner_link_' + i] || s['banner_link ' + i] || '',
            subtitle: ''
          });
        }
      }

      for (let i = 1; i <= 50; i++) {
        const title = String(get(`section_${i}_title`) || get(`section_${i}title`) || get(`Section ${i} Title`) || '');
        const active = parseBool(get(`section_${i}_active`) || get(`section_${i}active`) || get(`section_${i}_show`) || get(`Section ${i} Show`), true);
        if (title && active) {
          const rawLink = String(get(`section_${i}_link`) || get(`section_${i}link`) || get(`Section ${i} Link`) || '');
          let links = [];
          try {
            links = JSON.parse(rawLink);
            if (!Array.isArray(links)) links = rawLink ? [rawLink] : [];
          } catch(e) {
            links = rawLink ? [rawLink] : [];
          }
          dynamicSections.push({
            title: title,
            category: String(get(`section_${i}_category`) || get(`section_${i}category`) || get(`Section ${i} Category`) || ''),
            image: String(get(`section_${i}_image`) || get(`section_${i}image`) || get(`Section ${i} Image`) || ''),
            link: rawLink, // original string for backward compatibility
            links: links
          });
        }
      }

      const flashDate = String(get('flash_date') || '');
      const flashTitle = String(get('flash_title') || 'Flash Sale');
      const currency = String(get('currency') || '৳');
      const b2bMode = parseBool(get('b2b_mode'));
      const promoPopupActive = parseBool(get('promo_popup_active'));
      const promoPopupImage = String(get('promo_popup_image') || '');
      const promoPopupLink = String(get('promo_popup_link') || '');
      const freeShipAmt = parseFloat(String(get('free_ship_amt') || '').replace(/[,\s]/g, '')) || 0;

      return {
        maintenanceMode,
        holidayMode,
        holidayReason,
        holidayCustomMessage,
        holidayReturnDate,
        announcementActive,
        announcementText,
        announcementBg: String(get('announcement_bg') || '#634A8E'),
        announcementColor: String(get('announcement_text_color') || '#FFFFFF'),
        storeStatus,
        paymentMethods,
        enableCOD,
        zone1Name,
        zone2Name,
        zone1Charge,
        zone2Charge,
        deliveryLocations,
        heroBanners,
        dynamicSections,
        socialLinks,
        liveChat,
        flashDate,
        flashTitle,
        currency,
        b2bMode,
        promoPopupActive,
        promoPopupImage,
        promoPopupLink,
        freeShipAmt,
        // Product Page settings
        quickView: parseBool(get('quick_view')),
        stockBar: parseBool(get('stock_bar')),
        relatedProd: parseBool(get('related_prod'), true),
        liveSearch: parseBool(get('live_search'), true),
        hoverEffect: String(get('hover_effect') || 'zoom'),
        addCartText: String(get('add_cart_text') || ''),
        maxQty: parseInt(get('max_qty')) || 0,
        expDelivery: String(get('exp_delivery') || ''),
        // Cart & Checkout settings
        cartDrawer: parseBool(get('cart_drawer'), true),
        freeShipAdvance: parseBool(get('freeship_advance'), true),
        orderNotes: parseBool(get('order_notes')),
        checkoutMode: String(get('checkout_mode') || 'website'),
        customField: String(get('custom_field') || ''),
        minOrder: parseFloat(get('min_order')) || 0,
        // Marketing settings
        exitPopup: parseBool(get('exit_popup')),
        loyaltySystem: parseBool(get('loyalty_system')),
        trustBadges: parseBool(get('trust_badges')),
        abandonMsg: String(get('abandon_msg') || ''),
        // Branding settings
        websiteLogoUrl: String(get('website_logo_url') || ''),
        font: String(get('font') || ''),
        themeColor: String(get('theme_color') || ''),
        footerText: String(get('footer_text') || ''),
        // SEO settings
        metaTitle: String(get('meta_title') || ''),
        metaDesc: String(get('meta_desc') || ''),
        ogImage: String(get('og_image') || ''),

        // ✅ v11 EXTRAS — Premium controls
        // Theme palette (v11.3 expanded — 9 controls)
        themePrimary: String(get('theme_primary') || ''),
        themeAccent: String(get('theme_accent') || ''),
        themeBg: String(get('theme_bg') || ''),
        themeCardBg: String(get('theme_card_bg') || ''),
        themeText: String(get('theme_text') || ''),
        themeBorder: String(get('theme_border') || ''),
        themeLink: String(get('theme_link') || ''),
        themeSalePrice: String(get('theme_sale_price') || ''),
        themeFooterBg: String(get('theme_footer_bg') || ''),
        // Typography
        headingFont: String(get('heading_font') || ''),
        bodyFont: String(get('body_font') || ''),
        bengaliFont: String(get('bengali_font') || ''),
        // Card style
        cardStyle: String(get('card_style') || 'rounded'),
        cardHover: String(get('card_hover') || 'zoom'),
        // Sale countdown
        countdownActive: parseBool(get('countdown_active')),
        countdownEnd: String(get('countdown_end') || ''),
        countdownTitle: String(get('countdown_title') || 'Sale Ends In'),
        countdownStyle: String(get('countdown_style') || 'red'),
        // Free shipping bar
        freeShipBarActive: parseBool(get('free_ship_bar_active')),
        freeShipBarText: String(get('free_ship_bar_text') || 'Free shipping on orders over ৳{amount}'),
        // ✅ v11.8: Premium customization — color + thickness
        countdownBg:     String(get('countdown_bg') || ''),
        countdownText:   String(get('countdown_text') || ''),
        freeShipBarBg:        String(get('free_ship_bar_bg') || ''),
        freeShipBarTextColor: String(get('free_ship_bar_text_color') || ''),
        freeShipBarThickness: String(get('free_ship_bar_thickness') || 'slim'),

        // ✅ v11.8: Advanced (Royal) tab — 5 brand-new controls
        marqueeActive:    parseBool(get('marquee_active')),
        marqueeText:      String(get('marquee_text') || ''),
        marqueeBg:        String(get('marquee_bg') || ''),
        marqueeTextColor: String(get('marquee_text_color') || ''),
        marqueeSpeed:     String(get('marquee_speed') || 'slow'),
        trustStripActive: parseBool(get('trust_strip_active')),
        // ✅ v15.6 FIX: Renamed from `trustBadges` to `trustBadgeItems` to avoid
        // collision with the Marketing-tab `trustBadges` boolean (declared above).
        // Previously this overwrote the boolean → Marketing toggle silently dead.
        trustBadgeItems: (function(){
          var arr = [];
          for (var ti = 1; ti <= 4; ti++) {
            var icon  = String(get('trust_' + ti + '_icon')  || '').trim();
            var label = String(get('trust_' + ti + '_label') || '').trim();
            if (icon || label) arr.push({ icon: icon, label: label });
          }
          return arr;
        })(),
        royalFrameActive: parseBool(get('royal_frame_active')),
        royalAccent:      String(get('royal_accent') || '#D4910A'),
        royalFrameStyle:  String(get('royal_frame_style') || 'corners'),
        editorialActive:  parseBool(get('editorial_active')),
        editorialImage:   String(get('editorial_image') || ''),
        editorialTitle:   String(get('editorial_title') || ''),
        editorialBody:    String(get('editorial_body') || ''),
        editorialCta:     String(get('editorial_cta') || ''),
        editorialLink:    String(get('editorial_link') || ''),
        igGridActive:     parseBool(get('ig_grid_active')),
        igGridTitle:      String(get('ig_grid_title') || ''),
        igGridImages: (function(){
          var arr = [];
          for (var gi = 1; gi <= 6; gi++) {
            var url = String(get('ig_grid_image_' + gi) || '').trim();
            if (url) arr.push(url);
          }
          return arr;
        })(),
        igGridLink:       String(get('ig_grid_link') || ''),
        // ✅ v16.3: Men's Accessories showcase (separate world)
        accessoriesActive:   parseBool(get('accessories_active')),
        accessoriesTitle:    String(get('accessories_title') || "Men's Accessories"),
        accessoriesSubtitle: String(get('accessories_subtitle') || ''),
        accessoriesBanner:   String(get('accessories_banner') || ''),
        // Best sellers / new arrivals / recently viewed / wishlist
        bestSellersActive: parseBool(get('best_sellers_active')),
        bestSellersTitle: String(get('best_sellers_title') || 'Best Sellers'),
        bestSellersCount: parseInt(get('best_sellers_count')) || 8,
        newArrivalActive: parseBool(get('new_arrival_active')),
        newArrivalDays: parseInt(get('new_arrival_days')) || 7,
        // ✅ v15.82: Recently Viewed section default-on. Pre-fix the parseBool
        //   had no default — so sellers who never touched the toggle had Sheet
        //   value = empty → false → section never rendered. With default=true
        //   the homepage "Recently Viewed" rail shows automatically once the
        //   visitor has browsed at least 2 products. Admin can still turn it
        //   OFF explicitly via the toggle.
        recentlyViewed: parseBool(get('recently_viewed'), true),
        wishlistActive: parseBool(get('wishlist_active')),
        // Product page premium
        stickyAtcMobile: parseBool(get('sticky_atc_mobile')),
        videoAutoplay: parseBool(get('video_autoplay')),
        oosHide: parseBool(get('oos_hide')),
        quickViewActive: parseBool(get('quick_view_active')),
        // Size Visibility Control — per-size global on/off + OOS-size display mode
        // Default: every size ON (true) so existing sites don't break when admin
        // hasn't touched the new toggles. sizeOosHide defaults to FALSE (show
        // strikethrough), matching the user's expected default behavior.
        sizeOosHide:    parseBool(get('size_oos_hide'),    false),
        sizeShirtS:     parseBool(get('size_shirt_s'),     true),
        sizeShirtM:     parseBool(get('size_shirt_m'),     true),
        sizeShirtL:     parseBool(get('size_shirt_l'),     true),
        sizeShirtXL:    parseBool(get('size_shirt_xl'),    true),
        sizeShirtXXL:   parseBool(get('size_shirt_xxl'),   true),
        sizeShirt3XL:   parseBool(get('size_shirt_3xl'),   true),
        sizePant28:     parseBool(get('size_pant_28'),     true),
        sizePant30:     parseBool(get('size_pant_30'),     true),
        sizePant32:     parseBool(get('size_pant_32'),     true),
        sizePant34:     parseBool(get('size_pant_34'),     true),
        sizePant36:     parseBool(get('size_pant_36'),     true),
        sizePant38:     parseBool(get('size_pant_38'),     true),
        // Newsletter popup
        newsletterActive: parseBool(get('newsletter_active')),
        newsletterTitle: String(get('newsletter_title') || 'Get 10% off your first order!'),
        newsletterCode: String(get('newsletter_code') || ''),
        newsletterTrigger: String(get('newsletter_trigger') || '15'),
        // Store hours
        storeHoursActive: parseBool(get('store_hours_active')),
        storeHoursOpen: String(get('store_hours_open') || ''),
        storeHoursClose: String(get('store_hours_close') || ''),
        storeHoursMsg: String(get('store_hours_msg') || '🌙 Order will ship next business day'),
        // FAQ
        faqActive: parseBool(get('faq_active')),
        faqList: (function(){
          const arr = [];
          for(let i=1;i<=10;i++){
            const q = String(get('faq_q' + i) || s['FAQ Q' + i] || '');
            const a = String(get('faq_a' + i) || s['FAQ A' + i] || '');
            if(q || a) arr.push({ q: q, a: a });
          }
          return arr;
        })(),
        // Testimonials
        reviewsActive: parseBool(get('reviews_active')),
        reviewsList: (function(){
          const arr = [];
          for(let i=1;i<=10;i++){
            const n = String(s['Review ' + i + ' Name'] || get('review_' + i + '_name') || '');
            const p = String(s['Review ' + i + ' Photo'] || get('review_' + i + '_photo') || '');
            const st = parseInt(s['Review ' + i + ' Stars'] || get('review_' + i + '_stars') || 5);
            const t = String(s['Review ' + i + ' Text'] || get('review_' + i + '_text') || '');
            if(n || t) arr.push({ name: n, photo: p, stars: Math.max(1, Math.min(5, st)), text: t });
          }
          return arr;
        })(),
        // Float chat
        floatChatPosition: String(get('float_chat_position') || 'bottom-right'),
        floatChatOffset: parseInt(get('float_chat_offset')) || 20,
        // ✅ v11.7: Avg Order Value (BDT) — drives Lead/Subscribe bid value for FB optimization
        avgOrderValue: parseFloat(get('avg_order_value') || s['Avg Order Value']) || 0,
        // Promo popup slots (3)
        // ✅ v16.10 FIX: Read EVERY field through get() (which resolves Title-Case,
        // lowercase_underscore AND case-insensitive variants). The previous code
        // led with s['Popup N Image'] (Title Case) — but GAS's _getFullStoreInfoObj
        // normalizes all sheet keys to lowercase_underscore (popup_n_image), so the
        // Title-Case lookups were always undefined and the slot silently dropped.
        popupSlots: (function(){
          const arr = [];
          for(let i=1;i<=3;i++){
            const a = parseBool(get('popup_' + i + '_active'));
            if(!a) continue;
            const img = String(get('popup_' + i + '_image') || '');
            if(!img) continue;
            arr.push({
              image: img,
              link: String(get('popup_' + i + '_link') || ''),
              start: String(get('popup_' + i + '_start') || ''),
              end: String(get('popup_' + i + '_end') || ''),
              trigger: String(get('popup_' + i + '_trigger') || '10')
            });
          }
          return arr;
        })(),

        raw: s
      };
    } catch (e) {
      // Load error
      return null;
    }
  }

  // ✅ v9.7: PREFETCH — Optimized from 3 API calls to 1.
  // The 'products' endpoint returns { products, categories, storeInfo } in one response.
  // We fire ONLY 'products', then cross-populate store_info + categories caches
  // from the same response — eliminates 2 network requests entirely.
  // ✅ v15.33 FIX: Skip entirely when Worker SSR injected `__YARZ_INITIAL_STATE`.
  // Previously this fired 2 unconditional network requests on EVERY cold visit
  // even though the data was already inlined in the HTML — wasted 50-100ms.
  function prefetchAll() {
    try {
      // Skip if SSR data already in DOM or early fetch is in progress
      // _turboPreload above will populate `_turboData` from the inline state/early fetch.
      if (typeof window !== 'undefined' && (window.__YARZ_INITIAL_STATE || window.__YARZ_EARLY_FETCH)) {
        return;
      }
      // ✅ v10.2: Clear leftover snapshot from older versions
      try { localStorage.removeItem('yarz_prefetch_snapshot'); } catch(e) {}

      // ✅ Fire single network request that returns everything (always fresh)
      apiGet('products').then(function(res) {
        if (!res || !res.success) return;
        // Cross-populate store_info cache from the products response (in-memory only)
        if (res.storeInfo) {
          var storeInfoData = { success: true, ok: true, data: res.storeInfo, store: res.storeInfo };
          var siKey = getReadUrl() + '?key=' + CONFIG.API_KEY + '&action=store_info';
          setCache(siKey, storeInfoData);
        }
        // Cross-populate categories cache from the products response (in-memory only)
        if (res.categories || (res.products && Array.isArray(res.products))) {
          var cats = res.categories;
          if (!cats && Array.isArray(res.products)) {
            var counts = {};
            res.products.forEach(function(p) { var c = p.category || ''; if(c) counts[c] = (counts[c]||0)+1; });
            cats = Object.keys(counts).map(function(n) { return { name: n, count: counts[n] }; });
          }
          if (cats) {
            var catKey = getReadUrl() + '?key=' + CONFIG.API_KEY + '&action=categories';
            setCache(catKey, { success: true, ok: true, categories: cats });
          }
        }
        // ✅ v10.2: No localStorage snapshot — always fresh from server
      }).catch(function(){});
      // ✅ v15.33: Removed the redundant `apiGet('store_info')` backup call.
      // The `products` endpoint always returns storeInfo; the backup was just
      // a safety net that doubled GAS quota usage. SWR getStoreInfo handles
      // the rare case where products response lacks storeInfo.
    } catch (e) { /* fail silently */ }
  }

  // ✅ Error buffer flush — sends buffered errors to the health endpoint
  // every 50 errors or every 5 minutes as a background fire-and-forget request.
  function _flushErrorBuffer() {
    try {
      if (typeof window === 'undefined' || !window.__yarzErrBuf || !window.__yarzErrBuf.length) return;
      var entries = window.__yarzErrBuf.splice(0);
      var payload = JSON.stringify({ errors: entries, ts: Date.now(), url: location.href, ua: navigator.userAgent });
      var flushUrl = getReadUrl() + '?key=' + CONFIG.API_KEY + '&action=health';
      if (navigator.sendBeacon) {
        navigator.sendBeacon(flushUrl, payload);
      } else {
        var img = new Image();
        img.src = flushUrl + '&data=' + encodeURIComponent(payload.slice(0, 2048));
      }
    } catch (e) {}
  }

  // ✅ v4.1: Fire prefetch IMMEDIATELY (don't wait for DOMContentLoaded)
  // This runs in parallel with HTML/CSS/font parsing — saves 200-500ms.
  if (typeof window !== 'undefined') {
    if (!window.__yarzErrBuf) window.__yarzErrBuf = [];
    prefetchAll();
    setInterval(_flushErrorBuffer, 300000);
  }

  return {
    CONFIG,
    getBaseUrl,
    getReadUrl,    // ✅ v11.7: exposed so pixel.js _sendCapiMirror can route CAPI through the Worker (for client IP/UA injection)
    getWriteUrl,   // ✅ v11.7: exposed for symmetry / debugging
    setBaseUrl,
    isConfigured,
    clearCache,
    flushAllCaches,
    invalidateStoreInfo,
    getProducts,
    getProduct,
    getProductStock,
    getCategories,
    getStoreInfo,
    getDeliveryCharges,
    getGlobalControls,
    healthCheck,
    placeOrder,
    getOrdersByPhone,
    deleteOrder,
    archiveCompletedOrders,
    updateOrderStatus,
    onDataRefresh,
    prefetchAll,
    // ✅ v11: Newsletter subscription
    subscribeNewsletter: function(email, source) {
      try {
        return apiPost('subscribeNewsletter', { email: email, source: source || 'website-popup', userAgent: navigator.userAgent });
      } catch (e) { return Promise.resolve({ success: false }); }
    },
    // ⚡ v10.5: Expose turbo promise for instant first paint in app.js
    _getTurboPromise: function() { return _turboPromise || (_turboData ? Promise.resolve(_turboData) : null); },
  };
})();

