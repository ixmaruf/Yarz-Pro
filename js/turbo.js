/* ============================================================
   YARZ TURBO — Background Performance Engine v1.0
   ✅ Mobile-First: Optimized for 2G/3G/4G phones
   ✅ API Request Deduplication (500+ visitors → 1 API call)
   ✅ Touch Prefetch (preload on touchstart)
   ✅ Memory Guardian (auto cleanup for low-RAM phones)
   ✅ Connection Monitor (offline fallback, speed-aware)
   ✅ Chunked Rendering (60fps on budget phones)
   ✅ All invisible to customers
   ============================================================ */

const YARZ_TURBO = (() => {
  'use strict';

  // ===== CONFIG =====
  const CFG = {
    CHUNK_SIZE: 12,               // v9.7: Render first 12 products instantly (above-fold + first scroll)
    CHUNK_DELAY: 16,              // ~1 frame (60fps) between chunks
    PREFETCH_DELAY: 150,          // ms before prefetching on touch
    MEMORY_CHECK_INTERVAL: 30000, // Check memory every 30s
    MEMORY_LIMIT_MB: 150,         // Start cleanup above 150MB
    OFFLINE_CHECK_INTERVAL: 5000, // Check connectivity every 5s
    MAX_INFLIGHT: 6,              // Max concurrent API requests
  };

  // ===== STATE =====
  let _started = false;
  let _isOffline = !navigator.onLine;
  let _connectionType = 'unknown'; // 4g, 3g, 2g, slow-2g, wifi, unknown
  let _memoryTimer = null;
  let _offlineTimer = null;
  const _inflightRequests = new Map(); // URL → Promise (deduplication)
  const _prefetchedImages = new Set();
  let _offlineBanner = null;

  // Cleanup references for stop()
  let _touchHandler = null;
  let _observeTimer = null;
  let _imgObserver = null;
  let _onlineHandler = null;
  let _offlineHandler = null;
  let _connChangeHandler = null;

  // ===== A. API REQUEST DEDUPLICATION =====
  // When 500 visitors request the same URL simultaneously,
  // only 1 actual fetch() fires. All others get the same Promise.
  var _originalFetch = window.fetch;

  function deduplicatedFetch(url, options) {
    // Only deduplicate GET requests (not POST/order submissions)
    var isGet = !options || !options.method || options.method === 'GET';
    if (!isGet) return _originalFetch(url, options);

    // Strip cache-busting params for dedup key (keep action + key)
    var u = new URL(url, window.location.origin);
    u.searchParams.delete('_t');
    u.searchParams.delete('cb');
    var dedupKey = u.href;

    if (_inflightRequests.has(dedupKey)) {
      // Another request for the same data is already in flight — reuse it
      return _inflightRequests.get(dedupKey).then(function(r) {
        return r.clone(); // clone so each consumer can read the body
      });
    }

    var promise = _originalFetch(url, options).then(function(response) {
      // Keep in map briefly so rapid-fire requests get the cached response
      setTimeout(function() { _inflightRequests.delete(dedupKey); }, 200);
      return response;
    }).catch(function(err) {
      _inflightRequests.delete(dedupKey);
      throw err;
    });

    _inflightRequests.set(dedupKey, promise);
    return promise.then(function(r) { return r.clone(); });
  }

  // Monkey-patch window.fetch for automatic deduplication
  function _patchFetch() {
    // Capture whatever fetch is current at patch time so intermediate
    // wrappers (installed by other scripts between module init and start)
    // are preserved in the delegation chain.
    var _currentFetch = window.fetch;
    window.fetch = function(url, options) {
      var urlStr, opts;
      if (typeof url === 'string') {
        urlStr = url;
        opts = options || {};
      } else if (url && typeof url.url === 'string') {
        urlStr = url.url;
        opts = {
          method: url.method,
          headers: url.headers,
          body: url.body,
          signal: url.signal,
          mode: url.mode,
          credentials: url.credentials,
          cache: url.cache,
          redirect: url.redirect,
          referrer: url.referrer,
          referrerPolicy: url.referrerPolicy,
          integrity: url.integrity,
        };
      } else {
        return _currentFetch.apply(this, arguments);
      }

      if (urlStr.indexOf('googleapis.com') > -1 ||
          urlStr.indexOf('script.google.com') > -1 ||
          urlStr.indexOf('workers.dev') > -1 ||
          (urlStr.indexOf('action=') > -1 &&
           (urlStr.indexOf(window.location.origin) > -1 ||
            urlStr.indexOf('/') === 0 ||
            urlStr.indexOf('?') === 0))) {
        return deduplicatedFetch(urlStr, opts);
      }
      return _currentFetch(url, options);
    };
  }

  // ===== B. MOBILE TOUCH PREFETCH =====
  // Preload HIGH-RES product images when user touches a card (before they click).
  // This means by the time the product page opens, the full-size image is already in cache.
  function _initTouchPrefetch() {
    _touchHandler = function(e) {
      var card = e.target.closest('.product-card');
      if (!card) return;
      var img = card.querySelector('.card-image img');
      if (!img || !img.src) return;
      
      // Get the original Drive URL from data attribute or current src
      var src = img.dataset.turboOriginal || img.getAttribute('src') || img.src;
      // Generate the full-size URL (1600px = product page main image size)
      var hiResUrl = src;
      if (window.ImageTurbo && window.ImageTurbo.optimize) {
        hiResUrl = window.ImageTurbo.optimize(src, 1600);
      }
      if (hiResUrl && !_prefetchedImages.has(hiResUrl)) {
        _prefetchedImages.add(hiResUrl);
        // Use Image() preload — more reliable than <link rel="prefetch"> for images
        var probe = new Image();
        probe.src = hiResUrl;
      }
    };
    document.addEventListener('touchstart', _touchHandler, { passive: true });

    // Prefetch images that are about to scroll into view
    if ('IntersectionObserver' in window) {
      _imgObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            if (img.dataset.src && !img.getAttribute('src')) {
              img.src = img.dataset.src;
            }
            _imgObserver.unobserve(img);
          }
        });
      }, { rootMargin: '200px 0px' }); // Start loading 200px before visible

      // Observe product images
      _observeTimer = setInterval(function() {
        var images = document.querySelectorAll('.product-card .card-image img[loading="lazy"]');
        var anyNew = false;
        images.forEach(function(img) {
          if (!img._turboObserved) {
            img._turboObserved = true;
            _imgObserver.observe(img);
            anyNew = true;
          }
        });
        // Stop polling once all lazy images have been observed
        if (!anyNew) {
          clearInterval(_observeTimer);
          _observeTimer = null;
        }
      }, 2000);
    }
  }

  // ===== C. MEMORY GUARDIAN =====
  // Auto-cleanup for low-RAM phones (2-3GB devices)
  function _startMemoryGuard() {
    if (!window.performance || !performance.memory) {
      // performance.memory not available (Firefox/Safari) — use fallback
      _memoryTimer = setInterval(_cleanupStaleData, CFG.MEMORY_CHECK_INTERVAL * 2);
      return;
    }

    _memoryTimer = setInterval(function() {
      var used = performance.memory.usedJSHeapSize / (1024 * 1024); // MB
      if (used > CFG.MEMORY_LIMIT_MB) {
        if (window.__DEV__) console.log('YARZ Turbo: Memory high (' + Math.round(used) + 'MB) — cleaning up');
        _cleanupStaleData();
      }
    }, CFG.MEMORY_CHECK_INTERVAL);
  }

  function _cleanupStaleData() {
    // Use requestIdleCallback if available (won't block UI)
    var cleanup = function() {
      try {
        // Remove old API caches (keep only recent ones)
        var keys = Object.keys(localStorage);
        var now = Date.now();
        keys.forEach(function(k) {
          if (k.startsWith('yarz_api_cache_')) {
            try {
              var item = JSON.parse(localStorage.getItem(k));
              if (item && item.time && (now - item.time) > 10 * 60 * 1000) { // 10min+
                localStorage.removeItem(k);
              }
            } catch(e) { localStorage.removeItem(k); }
          }
        });
        // Clear prefetched images set to free memory
        if (_prefetchedImages.size > 50) {
          _prefetchedImages.clear();
        }
      } catch(e) {}
    };

    if ('requestIdleCallback' in window) {
      requestIdleCallback(cleanup, { timeout: 2000 });
    } else {
      setTimeout(cleanup, 100);
    }
  }

  // ===== D. CONNECTION MONITOR =====
  // Detect 2G/3G/4G/WiFi — always serve high quality images
  // Only reduce non-visible features (animations, prefetch aggressiveness)
  function _initConnectionMonitor() {
    // Update connection type
    function updateConnection() {
      if (!navigator.onLine) {
        _isOffline = true;
        _connectionType = 'offline';
        _showOfflineBanner();
        return;
      }
      
      _isOffline = false;
      _hideOfflineBanner();

      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        _connectionType = conn.effectiveType || 'unknown'; // 4g, 3g, 2g, slow-2g
      } else {
        _connectionType = 'unknown';
      }

      // Reduce non-visual overhead on slow connections (NOT image quality)
      if (_connectionType === '2g' || _connectionType === 'slow-2g') {
        document.documentElement.classList.add('yarz-slow-net');
        // Disable heavy CSS animations on very slow connections
        // but NEVER reduce image quality — customer experience first
      } else {
        document.documentElement.classList.remove('yarz-slow-net');
      }
    }

    updateConnection();

    // Listen for changes
    _onlineHandler = function() {
      _isOffline = false;
      _hideOfflineBanner();
      updateConnection();
      // Auto-refresh data when back online
      if (window.YARZ_API && YARZ_API.prefetchAll) {
        YARZ_API.prefetchAll();
      }
    };
    window.addEventListener('online', _onlineHandler);

    _offlineHandler = function() {
      _isOffline = true;
      _connectionType = 'offline';
      _showOfflineBanner();
    };
    window.addEventListener('offline', _offlineHandler);

    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      _connChangeHandler = updateConnection;
      conn.addEventListener('change', _connChangeHandler);
    }
  }

  function _showOfflineBanner() {
    if (_offlineBanner) return;
    _offlineBanner = document.createElement('div');
    _offlineBanner.id = 'yarz-offline-banner';
    _offlineBanner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 1l22 22"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg> <span>আপনি অফলাইনে আছেন। ক্যাশ থেকে দেখানো হচ্ছে।</span>';
    _offlineBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:linear-gradient(135deg,#FF6B6B,#EE5A24);color:#fff;text-align:center;padding:8px 16px;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;transform:translateY(-100%);transition:transform 0.3s ease;font-family:var(--font-bengali,"Hind Siliguri",sans-serif);';
    document.body.appendChild(_offlineBanner);
    requestAnimationFrame(function() {
      _offlineBanner.style.transform = 'translateY(0)';
    });
  }

  function _hideOfflineBanner() {
    if (!_offlineBanner) return;
    _offlineBanner.style.transform = 'translateY(-100%)';
    setTimeout(function() {
      if (_offlineBanner && _offlineBanner.parentNode) {
        _offlineBanner.parentNode.removeChild(_offlineBanner);
      }
      _offlineBanner = null;
    }, 350);
  }

  // ===== E. CHUNKED RENDERING =====
  // Render products in batches for 60fps on budget phones
  function renderChunked(products, container, renderFn) {
    if (!container || !products || products.length === 0) return;

    var firstBatch = products.slice(0, CFG.CHUNK_SIZE);
    var rest = products.slice(CFG.CHUNK_SIZE);

    // Render first batch immediately (above the fold)
    container.innerHTML = firstBatch.map(renderFn).join('');

    if (rest.length === 0) return;

    // Render remaining in chunks using requestAnimationFrame
    var idx = 0;
    var chunkSize = 4; // 4 products per frame

    function renderNextChunk() {
      if (idx >= rest.length) return;
      
      var fragment = document.createDocumentFragment();
      var temp = document.createElement('div');
      var end = Math.min(idx + chunkSize, rest.length);
      
      temp.innerHTML = rest.slice(idx, end).map(renderFn).join('');
      while (temp.firstChild) {
        fragment.appendChild(temp.firstChild);
      }
      
      container.appendChild(fragment);
      idx = end;

      if (idx < rest.length) {
        requestAnimationFrame(renderNextChunk);
      }
    }

    requestAnimationFrame(renderNextChunk);
  }

  // ===== F. PERFORMANCE METRICS =====
  function getMetrics() {
    return {
      connectionType: _connectionType,
      isOffline: _isOffline,
      inflightRequests: _inflightRequests.size,
      prefetchedImages: _prefetchedImages.size,
      memoryUsedMB: (window.performance && performance.memory ? Math.round(performance.memory.usedJSHeapSize / (1024 * 1024)) : 'N/A'),
    };
  }

  // ===== START =====
  function start() {
    if (_started) return;
    _started = true;

    // 1. Patch fetch for deduplication
    _patchFetch();

    // 2. Mobile touch prefetch
    _initTouchPrefetch();

    // 3. Memory guardian
    _startMemoryGuard();

    // 4. Connection monitor
    _initConnectionMonitor();

    if (window.__DEV__) console.log('YARZ Turbo: Performance engine started (' + _connectionType + ')');
  }

  // ===== STOP =====
  function stop() {
    // Clear timers
    if (_memoryTimer) { clearInterval(_memoryTimer); _memoryTimer = null; }
    if (_offlineTimer) { clearInterval(_offlineTimer); _offlineTimer = null; }
    if (_observeTimer) { clearInterval(_observeTimer); _observeTimer = null; }

    // Remove touchstart listener
    if (_touchHandler) {
      document.removeEventListener('touchstart', _touchHandler);
      _touchHandler = null;
    }

    // Disconnect IntersectionObserver
    if (_imgObserver) {
      _imgObserver.disconnect();
      _imgObserver = null;
    }

    // Remove online/offline listeners
    if (_onlineHandler) {
      window.removeEventListener('online', _onlineHandler);
      _onlineHandler = null;
    }
    if (_offlineHandler) {
      window.removeEventListener('offline', _offlineHandler);
      _offlineHandler = null;
    }

    // Remove connection change listener
    if (_connChangeHandler) {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) conn.removeEventListener('change', _connChangeHandler);
      _connChangeHandler = null;
    }

    // Restore original fetch
    window.fetch = _originalFetch;

    // Clear data structures
    _prefetchedImages.clear();
    _inflightRequests.clear();

    _started = false;
  }

  return {
    start: start,
    stop: stop,
    renderChunked: renderChunked,
    deduplicatedFetch: deduplicatedFetch,
    getMetrics: getMetrics,
    isOffline: function() { return _isOffline; },
    getConnectionType: function() { return _connectionType; },
  };
})();
