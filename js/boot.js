/* ════════════════════════════════════════════════════════════════════
   YARZ BOOT v1.0 — Critical-Path Loader
   ════════════════════════════════════════════════════════════════════
   This is the FIRST JS to run. It:
     1) Registers Service Worker IMMEDIATELY
     2) Reads cached products/categories/banners from IndexedDB
     3) Renders a SKELETON UI right away (perceived speed: <300ms)
     4) Hydrates UI from cache the moment data is available
     5) Triggers prefetch of GAS API in parallel

   Must be loaded as a regular <script> at top of <body> (not deferred).
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const T0 = performance.now();
  window.__YARZ_BOOT_T0 = T0;

  // ─── 1. REGISTER SERVICE WORKER (non-blocking) ─────────────────
  // ✅ v10.8: Universal compatibility
  //   - Skip in-app browsers (FB/IG/Telegram) — they often have buggy SW support
  //   - Use idle callback so SW registration never blocks first paint
  //   - Auto-update + auto-reload when new version detected
  if ('serviceWorker' in navigator) {
    var ua = (navigator.userAgent || '');
    // ✅ v14.4: Expanded detection — covers ALL major in-app browsers globally.
    // Bangladesh users mostly come from Facebook + Messenger ads, but the same
    // page can be shared anywhere, so we cover TikTok, WeChat, LINE etc. too.
    //   FBAN/FBAV/FBIOS/FB_IAB → Facebook + Facebook Lite
    //   Instagram              → Instagram in-app browser
    //   MessengerLite          → Messenger Lite (not full Messenger which uses FBAV)
    //   Twitter                → X / Twitter in-app
    //   TelegramBot            → (kept for completeness)
    //   musical_ly|Bytedance|TikTok → TikTok
    //   MicroMessenger         → WeChat
    //   Line                   → LINE
    //   KAKAOTALK              → KakaoTalk
    //   Snapchat               → Snapchat
    //   Pinterest              → Pinterest
    var IN_APP_RE = /FBAN|FBAV|FBIOS|FB_IAB|Instagram|MessengerLite|Twitter|TelegramBot|musical_ly|Bytedance|TikTok|MicroMessenger|Line\/|KAKAOTALK|Snapchat|Pinterest/i;
    var isInAppBrowser = IN_APP_RE.test(ua);
    // Tag <html> so CSS / app.js can react to in-app context
    if (isInAppBrowser) {
      try {
        document.documentElement.classList.add('in-app-browser');
        // Specific tag — useful for FB-only tweaks (e.g., copy-paste fallback)
        if (/FBAN|FBAV|FBIOS|FB_IAB/i.test(ua)) document.documentElement.classList.add('iab-fb');
        else if (/Instagram/i.test(ua))         document.documentElement.classList.add('iab-ig');
        else if (/musical_ly|Bytedance|TikTok/i.test(ua)) document.documentElement.classList.add('iab-tt');
      } catch(e) {}
    }
    // In-app browsers: don't register SW (too many compatibility issues)
    // Everything else (Chrome, Edge, Firefox, Safari, Brave, Samsung Internet): full SW support
    if (!isInAppBrowser) {
      var registerSW = function() {
        // ✅ v17.15: ?v=17.15 stamp forces the browser to re-fetch sw.js on
        // version bump (otherwise the browser's SW update check is capped at
        // ~24h, delaying the new yarz-turbo-v17.15 cache from activating).
        navigator.serviceWorker.register('/sw.js?v=17.15', { scope: '/' })
          .then(function(reg) {
            try { reg.update(); } catch(e) {}
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            reg.addEventListener('updatefound', function() {
              var nw = reg.installing;
              if (!nw) return;
              nw.addEventListener('statechange', function() {
                if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                  nw.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            });
            var _refreshed = false;
            var _swStartTime = Date.now();
            navigator.serviceWorker.addEventListener('controllerchange', function() {
              if (_refreshed) return;
              _refreshed = true;
              // ✅ v12.1: Only force-reload if user has been on the page > 30s.
              //   Prevents the "double load" race during first-visit when the SW
              //   takes over right after first paint (was destroying LCP).
              var pageAge = Date.now() - _swStartTime;
              if (pageAge > 30000) {
                setTimeout(function() { window.location.reload(); }, 50);
              }
              // For fresh visits: silently let new SW take over. Next navigation
              // will use the updated cache automatically — no visible disruption.
            });
          })
          .catch(function(err) { console.warn('[BOOT] SW register failed:', err); });
      };
      // Use requestIdleCallback if available (Chrome/Edge/Firefox), else setTimeout
      if ('requestIdleCallback' in window) {
        window.addEventListener('load', function() {
          requestIdleCallback(registerSW, { timeout: 2000 });
        });
      } else {
        window.addEventListener('load', function() {
          setTimeout(registerSW, 1000);
        });
      }
    }
  }

  // ─── 2. (REMOVED v15.97) EARLY IndexedDB PRELOAD ───────────────
  // Previously this block opened IndexedDB 5× on every page load to read
  // cached products/categories/banners/settings/featured. But the site runs
  // in ZERO-CACHE MODE (owner policy: customers must ALWAYS get live data
  // from the Cloudflare Worker edge, never a client-side snapshot). Those
  // reads ALWAYS returned null (turbo-core never writes to IDB) and nothing
  // ever consumed `window.__YARZ_CACHE_PRELOAD` — so it was pure dead weight
  // that spun up an IndexedDB connection on the critical path for no benefit.
  // Removed entirely. Real-time speed now comes from:
  //   1. Cloudflare Worker Edge SSR injecting __YARZ_INITIAL_STATE (0 round-trips)
  //   2. Inline <head> early-fetch firing the products request in parallel
  //   3. Worker server-side edge cache (FRESH_TTL=30min, purged on Publish)
  // No customer-side persistence at any layer. ALWAYS LIVE.

  // ─── 3. SKELETON RENDER — DISABLED (v16.14 ZERO-CACHE mode) ─────
  // ✅ v16.14: Skeleton injection completely disabled.
  // In ZERO-CACHE mode, the Cloudflare Worker SSR injects
  // __YARZ_INITIAL_STATE into the HTML <head>, and the inline
  // _yarzInstantPaint() script (in index.html) renders REAL products
  // synchronously during HTML parse — before boot.js even loads.
  // The skeleton was never visible long enough to help and only added
  // ~2KB of CSS + DOM manipulation to the critical rendering path.
  // Kept as no-op stubs so any code referencing them doesn't break.
  function showSkeleton() { /* no-op */ }
  function injectSkeletonCSS() { /* no-op */ }

  // ─── 4. Performance reporting ───────────────────────────────────
  if (window.__DEV__) {
    window.addEventListener('load', () => {
      setTimeout(() => {
        const T = performance.now() - T0;
        const nav = performance.getEntriesByType('navigation')[0];
        console.log(
          `%c[BOOT] ⚡ Total: ${T.toFixed(0)}ms | DCL: ${nav ? nav.domContentLoadedEventEnd.toFixed(0) : '?'}ms | Load: ${nav ? nav.loadEventEnd.toFixed(0) : '?'}ms`,
          'color:#634A8E;font-weight:bold;font-size:13px'
        );
      }, 100);
    });
  }

  // ─── 5. visualViewport sync (in-app browser + iOS Safari fix) ───
  // ✅ v14.4: Why this matters —
  //   In Facebook / Instagram / TikTok in-app browsers (and iOS Safari),
  //   the address bar / nav chrome shows on scroll-up and hides on scroll-down.
  //   Each toggle fires a viewport resize → 100vh elements jump 60-90px.
  //
  //   We expose three CSS custom properties:
  //     --vh    → 1% of the visible viewport height (use as `calc(var(--vh) * 100)` instead of 100vh)
  //     --vw    → 1% of the visible viewport width
  //     --kb    → keyboard offset (visualViewport bottom inset) — useful when input focused
  //
  //   Modern Chrome/Safari support `100dvh` natively, but FB/IG webviews
  //   are based on older WebKit and don't always honor it. This polyfills it.
  (function setupViewportSync() {
    if (typeof window === 'undefined') return;
    var root = document.documentElement;

    function update() {
      try {
        var vv = window.visualViewport;
        var h = vv ? vv.height : (window.innerHeight || 0);
        var w = vv ? vv.width  : (window.innerWidth  || 0);
        var winH = window.innerHeight || h;
        // Keyboard offset = layout viewport - visual viewport (when keyboard up)
        var kb = vv ? Math.max(0, winH - vv.height - (vv.offsetTop || 0)) : 0;
        root.style.setProperty('--vh', (h * 0.01) + 'px');
        root.style.setProperty('--vw', (w * 0.01) + 'px');
        root.style.setProperty('--kb', kb + 'px');
      } catch (e) {}
    }
    update();
    if (window.visualViewport) {
      // Throttle via rAF so we never block scroll
      var pending = false;
      var onChange = function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; update(); });
      };
      window.visualViewport.addEventListener('resize', onChange);
      window.visualViewport.addEventListener('scroll', onChange);
    } else {
      window.addEventListener('resize',           update, { passive: true });
      window.addEventListener('orientationchange', update, { passive: true });
    }
  })();

})();
