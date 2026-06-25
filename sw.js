/* ════════════════════════════════════════════════════════════════════
   YARZ TURBO Service Worker v2.0
   ════════════════════════════════════════════════════════════════════
   Strategy matrix:
     • HTML pages              → Network-first, fallback cache (10s timeout)
     • CSS / JS / Fonts        → Stale-While-Revalidate (instant + update)
     • Images (product/banner) → Cache-First (1 year TTL)
     • Google Apps Script API  → Network-first with 6s timeout, fallback cache
     • Static assets / icons   → Cache-First

   Goals:
     1) Second visit: HTML + CSS + JS served from cache → <500ms paint
     2) API responses cached as a safety net (offline-friendly)
     3) Product images NEVER re-downloaded once cached
   ════════════════════════════════════════════════════════════════════ */

const VERSION       = 'yarz-turbo-v17.17-2026-06-06';
const STATIC_CACHE  = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
// ✅ v17.5 PHASE 5: API_CACHE removed. The CF Worker handles edge caching
// for ?action=... requests (with admin purge on every save), and the SW
// `isAPI(req)` handler returns early so it never even opens a cache. The
// constant + the CLEAR_API_CACHE message handler were dead code.
//
// ✅ v17.5 PHASE 5: RUNTIME_CACHE size cap. Without a cap, the runtime
// cache (image-first, SWR-everything-else) could grow unbounded — a heavy
// PDP-browsing visitor with hundreds of product images would pin ~500MB.
// We use FIFO (oldest entry first) since Cache.keys() returns insertion
// order. Bumped lazily on each put, not on every fetch.
const MAX_IMAGE_ENTRIES = 300;  // Product/banner images — generous but bounded
const MAX_STATIC_ENTRIES = 500; // CSS / JS / fonts — versioned, many distinct URLs
const MAX_SWR_ENTRIES = 200;    // Everything else that goes through SWR

// Critical assets to pre-cache on install
// v13.0: pixel.js, armor.js, shield.js are now lazy-loaded post-LCP, so they're
// fetched on-demand by the page (still cached via fetch handler).
// ✅ v15.97 CLEANUP: Removed the versioned JS/CSS entries (api.js, app.js,
// boot.js, turbo*, style.css). The page requests those with a `?v=` query
// (e.g. /js/api.js?v=15.97), but install stored them under a different
// `?_v=` busted key — so the precached copies NEVER matched a real request.
// Net effect was a wasted DOUBLE download on first visit (page fetched them
// anyway) for zero benefit. The runtime fetch handler (cacheFirst) already
// caches each versioned asset under its REAL url on first load, so repeat
// visits stay just as fast. We keep only the assets the browser requests
// WITHOUT a version query — these benefit from precache + power the offline
// navigation fallback (caches.match('/index.html') / '/404.html').
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/404.html'
];

// ──────────────────────────────────────────────────────────────────
// INSTALL — pre-cache critical shell
// ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // ✅ v15.97 FIX: Store each entry under its CLEAN url — the exact key the
      // page/navigation will request — while still using cache:'reload' to
      // bypass the browser HTTP cache during the install fetch. Previously we
      // did `cache.add('/index.html?_v=' + VERSION)`, which stored the response
      // under the busted key; a later `caches.match('/index.html')` could never
      // find it, so the offline fallback silently failed. Fetching with reload
      // then cache.put under the clean url fixes both freshness AND matchability.
      return Promise.allSettled(
        PRECACHE.map(url => {
          return fetch(new Request(url, { cache: 'reload' }))
            .then(res => (res && res.ok) ? cache.put(url, res) : null)
            .catch(() => null);
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// ──────────────────────────────────────────────────────────────────
// ACTIVATE — purge old versions
// ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Purge old version caches
      caches.keys().then((keys) => Promise.all(
        keys.map(k => k.startsWith('yarz-') && !k.startsWith(VERSION) ? caches.delete(k) : null)
      )),
      // ✅ v15.33 PERF: Enable navigationPreload — when SW handles a navigation,
      // browser starts the network fetch in PARALLEL with SW startup time.
      // Saves 50-150ms on returning customers (typical SW startup is 50-200ms).
      // Compatible with Chrome/Edge/Firefox/Samsung Internet — Safari ignores.
      self.registration.navigationPreload && self.registration.navigationPreload.enable().catch(() => {})
    ]).then(() => self.clients.claim())
  );
});

// ──────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────
function isImage(req) {
  if (req.destination === 'image') return true;
  const url = req.url.toLowerCase();
  return /\.(png|jpg|jpeg|webp|gif|svg|avif|ico)(\?|$)/.test(url) ||
         url.includes('lh3.googleusercontent.com') ||
         url.includes('drive.google.com') ||
         url.includes('i.ibb.co') ||
         url.includes('googleusercontent.com');
}

function isAPI(req) {
  // ✅ v15.37: After custom-domain migration, API calls go to same-origin
  // (yarzclothing.xyz/?action=...) instead of workers.dev. The SW must NOT
  // cache those — Worker already handles edge caching with admin purge,
  // and SW caching here would re-introduce the "stale data after publish"
  // bug we already fixed at the Worker layer.
  try {
    const u = new URL(req.url);
    if (u.origin === self.location.origin) {
      // Any same-origin request with ?action= is an API call → bypass SW
      if (u.searchParams.has('action')) return true;
      // Worker control endpoints (analytics, health, purge) → bypass SW
      if (u.pathname.startsWith('/__')) return true;
    }
  } catch (e) {}
  return req.url.includes('script.google.com') ||
         req.url.includes('/exec') ||
         req.url.includes('/macros/s/') ||
         req.url.includes('workers.dev');
}

function isStaticAsset(req) {
  const d = req.destination;
  return d === 'style' || d === 'script' || d === 'font' || d === 'manifest';
}

function isHTML(req) {
  return req.mode === 'navigate' ||
         (req.headers.get('accept') || '').includes('text/html');
}

// ──────────────────────────────────────────────────────────────────
// STRATEGIES
// ──────────────────────────────────────────────────────────────────

// Cache-First (for images & static immutable assets)
// v10.7: Don't background-refresh on every hit — only refresh when cache miss
async function cacheFirst(req, cacheName, maxEntries) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(()=>{});
      _trimCache_(cache, maxEntries || MAX_STATIC_ENTRIES);
    }
    return res;
  } catch (e) {
    return cached || new Response('', { status: 504 });
  }
}

// ✅ v17.5 PHASE 5: FIFO trim. Cache.keys() returns insertion order, so
// deleting from index 0 evicts the oldest entries. Cheap on small caches
// (a few hundred keys) — no need for a true LRU.
async function _trimCache_(cache, maxEntries) {
  try {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch (e) { /* ignore — best effort */ }
}

// Stale-While-Revalidate (for CSS/JS — instant + background update)
async function staleWhileRevalidate(req, cacheName, event) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(()=>{});
      _trimCache_(cache, MAX_SWR_ENTRIES);
    }
    return res;
  }).catch(() => cached);
  if(event && event.waitUntil) event.waitUntil(network.catch(()=>{})); return cached || network.catch(()=>new Response('Not found', {status: 504}));
}

// ──────────────────────────────────────────────────────────────────
// MAIN FETCH HANDLER
// ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  // Skip chrome-extension etc.
  if (!req.url.startsWith('http')) return;

  // Skip Google Fonts CSS (let browser handle — they have own caching)
  if (req.url.includes('fonts.googleapis.com/css')) return;

  // Google Fonts files — cache aggressively
  if (req.url.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(req, STATIC_CACHE, MAX_STATIC_ENTRIES));
    return;
  }

  // ✅ v17.5: Images → cache-first (1-year TTL). Returning visitors on slow 3G
  // get instant product/banner images. To force-refresh a specific image when
  // admin uploads a new one, the HTML just appends a `?v=<timestamp>` query
  // string (cache key is the full URL, so the new URL misses cache and re-fetches).
  // Only cacheable if response is OK; opaque/cross-origin 0-status responses
  // are not cached because we can't tell if they're fresh.
  if (isImage(req)) {
    event.respondWith((async () => {
      const cache  = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          cache.put(req, res.clone()).catch(()=>{});
          _trimCache_(cache, MAX_IMAGE_ENTRIES);
        }
        return res;
      } catch (e) {
        return cached || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // Google Apps Script API - Bypassed for real-time FB ads data
  if (isAPI(req)) {
    return;
  }

  // Static assets (CSS, JS) — version-tagged URLs, safe to cache forever
  if (isStaticAsset(req)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE, MAX_STATIC_ENTRIES));
    return;
  }

  // HTML pages — Network Only for real-time Cloudflare SSR data
  // Bypassed local caching completely to prevent customers from seeing stale products
  if (isHTML(req)) {
    event.respondWith((async () => {
      try {
        // ✅ v15.33 PERF: Use navigationPreload response if available.
        // This is the parallel network request the browser fired while
        // the SW was starting up — saves 50-150ms vs `fetch()`.
        const preloadResponse = event.preloadResponse ? await Promise.race([
          event.preloadResponse,
          new Promise(r => setTimeout(r, 3000))
        ]) : null;
        if (preloadResponse) return preloadResponse;
        return await fetch(req);
      } catch (e) {
        // ✅ v16.4: Offline fallback — prefer the precached homepage shell so a
        // returning visitor sees the real site (which then hydrates from cache),
        // and only fall back to the 404 page if even that isn't cached.
        return (await caches.match('/index.html')) ||
               (await caches.match('/')) ||
               (await caches.match('/404.html')) ||
               new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Everything else — SWR
  event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE, event));
});

// ──────────────────────────────────────────────────────────────────
// MESSAGE handler — allow page to force-refresh cache
// ──────────────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
    );
  }
  // ✅ v17.5 PHASE 5: CLEAR_API_CACHE message handler removed. The
  // API_CACHE constant is gone (CF Worker handles API edge caching);
  // this message would have done nothing useful even if any page still
  // sent it. The current admin "Clear cache" UI doesn't send it.
  if (msg.type === 'PURGE_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => {
        const prefix = msg.prefix || '';
        const toDelete = prefix ? keys.filter(k => k.includes(prefix)) : keys;
        return Promise.all(toDelete.map(k => caches.delete(k)));
      })
    );
  }
});

