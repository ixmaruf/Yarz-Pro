/* ════════════════════════════════════════════════════════════════════
   YARZ API TURBO v2.0 — Event Bridge + Mutation Invalidation
   ════════════════════════════════════════════════════════════════════
   This file bridges YARZ_API (api.js) with TURBO CORE (turbo-core.js).
   
   It does NOT wrap API methods with caching — api.js has its own
   memCache + sessionStorage layer. Instead this provides:
   
     1. Mutation hooks   — invalidate turbo-core's cache after writes
     2. Event bridge     — forward turbo:update events as yarz:data-updated
     3. prefetchAll()    — delegates to api.js's own prefetch (no turbo duplication)
   
   Load order:
     <script src="js/turbo-core.js"></script>
     <script src="js/api.js"></script>
     <script src="js/api-turbo.js"></script>   ← thin integration
     <script src="js/app.js"></script>
   ════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  if (!window.TURBO) {
    console.warn('[API-TURBO] turbo-core.js not loaded — event bridge will use DOM fallback');
  }

  // Wait for api.js to define window.YARZ_API
  function waitForApi(cb, tries) {
    tries = tries || 0;
    var api = window.api || window.YARZ_API || window.API;
    if (!api && typeof YARZ_API !== 'undefined') api = YARZ_API;
    if (api) {
      try { if (!window.YARZ_API) window.YARZ_API = api; } catch (e) {}
      return cb(api);
    }
    if (tries > 50) {
      console.warn('[API-TURBO] window.api not found');
      return cb(null);
    }
    setTimeout(function () { waitForApi(cb, tries + 1); }, 50);
  }

  waitForApi(function (api) {
    if (!api) return;

    // ─────────────────────────────────────────────────────────────────
    // MUTATION HOOKS — invalidate turbo-core cache after write ops
    // (api.js already clears its own cache internally via clearCache())
    // ─────────────────────────────────────────────────────────────────
    var mutationMethods = [
      'placeOrder',
      'createOrder',
      'cancelOrder',
      'updateOrder',
      'updateOrderStatus',
      'deleteOrder',
      'submitReview',
      'applyCoupon'
    ];

    function getInvalidationKey(methodName) {
      if (methodName === 'applyCoupon') return null;
      if (methodName.indexOf('Order') !== -1) return 'orders*';
      if (methodName.indexOf('Review') !== -1) return 'reviews*';
      return null;
    }

    mutationMethods.forEach(function (methodName) {
      var original = api[methodName];
      if (typeof original !== 'function') return;
      api[methodName] = function () {
        var args = arguments;
        var self = api;
        try {
          var result = original.apply(self, args);
          var invalKey = getInvalidationKey(methodName);
          if (result && typeof result.then === 'function') {
            return result.then(function (val) {
              if (invalKey && window.TURBO) window.TURBO.invalidate(invalKey);
              return val;
            });
          }
          if (invalKey && window.TURBO) window.TURBO.invalidate(invalKey);
          return result;
        } catch (e) {
          throw e;
        }
      };
    });

    // ─────────────────────────────────────────────────────────────────
    // EVENT BRIDGE — forward turbo:update events → yarz:data-updated
    // ─────────────────────────────────────────────────────────────────
    if (window.TURBO && typeof window.TURBO.on === 'function') {
      window.TURBO.on('update', function (data) {
        window.dispatchEvent(new CustomEvent('yarz:data-updated', {
          detail: { key: data.key, source: 'turbo', value: data.value }
        }));
      });
    } else {
      // Fallback: listen via DOM event
      window.addEventListener('turbo:update', function (e) {
        var detail = e.detail || {};
        if (!detail.changed) return;
        window.dispatchEvent(new CustomEvent('yarz:data-updated', {
          detail: { key: detail.key, source: 'turbo' }
        }));
      });
    }

    // ─────────────────────────────────────────────────────────────────
    // PREFETCH — delegates to api.js's own prefetch (no turbo dup)
    // ─────────────────────────────────────────────────────────────────
    function prefetchAll() {
      if (typeof api.prefetchAll === 'function') {
        return;
      }
      // Fallback: call key endpoints so api.js populates its cache
      var toPrefetch = ['getProducts', 'getCategories', 'getSettings', 'getBanners'];
      toPrefetch.forEach(function (methodName) {
        if (typeof api[methodName] === 'function') {
          api[methodName]().catch(function () {});
        }
      });
    }

    // Defer to after DOM ready (api.js already runs prefetchAll immediately)
    if (document.readyState === 'complete') {
      setTimeout(prefetchAll, 100);
    } else {
      window.addEventListener('load', function () { setTimeout(prefetchAll, 100); });
    }

    if (window.__DEV__) console.log('%c[API-TURBO] ⚡ Event bridge + mutation hooks active', 'color:#634A8E;font-weight:bold');
  });
})();
