/* ============================================================
   YARZ ARMOR — Security Shield v2.0
   ✅ DevTools detection (DESKTOP ONLY — never triggers on mobile)
   ✅ Console method neutralization (production)
   ✅ Right-click & keyboard shortcut interception (desktop)
   ✅ Script injection monitoring (all platforms)
   ✅ ZERO customer-facing popups on mobile/tablet
   ✅ DOES NOT affect: Meta Pixel, GA4, TikTok, normal browsing
   ============================================================ */

;(function() {
  'use strict';

  // ===== CONFIG =====
  var _cfg = {
    TRACKING_DOMAINS: [
      'facebook', 'fbq', 'fb.com', 'fbcdn',
      'google', 'gtag', 'analytics', 'googletagmanager',
      'tiktok', 'ttq', 'bytedance', 'tiktokcdn', 'tiktokv',
      'snapchat', 'sc-static', 'sentry', 'hotjar',
      'pinterest', 'pinimg', 'clarity', 'fonts.googleapis'
    ],
    CHECK_INTERVAL: 3000,
  };

  var _warningShown = false;

  // ===== MOBILE DETECTION (ultra-conservative — if ANY mobile signal, skip) =====
  function _isMobileOrTablet() {
    // Check 1: User agent
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle/i.test(navigator.userAgent)) {
      return true;
    }
    // Check 2: Touch capability
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      return true;
    }
    // Check 3: Screen width (anything under 1200px could be tablet)
    if (window.screen && window.screen.width <= 1200) {
      return true;
    }
    // Check 4: Mobile-specific APIs
    if (navigator.userAgentData && navigator.userAgentData.mobile) {
      return true;
    }
    return false;
  }

  // ===== A. CONSOLE NEUTRALIZATION (instant — runs on script load) =====
  function _neutralizeConsole() {
    if (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.search.indexOf('debug=1') > -1) {
      return;
    }
    try {
      window.__yc = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console)
      };
      var noop = function() {};
      console.log = noop;
      console.warn = noop;
      console.info = noop;
      console.debug = noop;
      console.dir = noop;
      console.dirxml = noop;
      console.table = noop;
      console.trace = noop;
      console.group = noop;
      console.groupCollapsed = noop;
      console.groupEnd = noop;
      console.count = noop;
      console.countReset = noop;
      console.time = noop;
      console.timeEnd = noop;
      console.timeLog = noop;
      console.profile = noop;
      console.profileEnd = noop;
    } catch (e) {}
  }

  // ===== B. DEVTOOLS DETECTION (DESKTOP ONLY) =====
  function _checkDevTools() {
    // ✅ v2.0: ABSOLUTE RULE — NEVER check on mobile/tablet
    if (_isMobileOrTablet()) return;
    if (_warningShown) return;

    var threshold = 200; // Increased from 160 to reduce false positives
    var widthDiff = window.outerWidth - window.innerWidth;
    var heightDiff = window.outerHeight - window.innerHeight;

    if (widthDiff > threshold || heightDiff > threshold) {
      _warningShown = true;
      // Just log — NO popup, NO overlay, NO customer interruption
      // The console is already neutralized, so this is just internal
      if (window.__yc) window.__yc.warn('DevTools detected');
    }
  }

  // ===== C. KEYBOARD SHORTCUT INTERCEPTION (DESKTOP ONLY) =====
  function _blockShortcuts() {
    if (_isMobileOrTablet()) return; // Don't block on mobile

    document.addEventListener('keydown', function(e) {
      // F12
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        return false;
      }
      // Ctrl+Shift+I, J, C (DevTools shortcuts)
      if (e.ctrlKey && e.shiftKey && (
        e.key === 'I' || e.key === 'i' ||
        e.key === 'J' || e.key === 'j' ||
        e.key === 'C' || e.key === 'c'
      )) {
        e.preventDefault();
        return false;
      }
      // Ctrl+U (View Source)
      if (e.ctrlKey && !e.shiftKey && (e.key === 'U' || e.key === 'u')) {
        e.preventDefault();
        return false;
      }
    }, true);
  }

  // ===== D. RIGHT-CLICK PROTECTION (DESKTOP ONLY) =====
  function _blockContextMenu() {
    if (_isMobileOrTablet()) return; // Don't interfere with mobile long-press

    document.addEventListener('contextmenu', function(e) {
      var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'a') {
        return true;
      }
      e.preventDefault();
      return false;
    });
  }

  // ===== E. ANTI-IFRAME (ALL PLATFORMS) =====
  function _antiIframe() {
    try {
      if (window.self !== window.top) {
        window.top.location = window.self.location;
      }
    } catch (e) {}
  }

  // ===== F. SCRIPT INJECTION MONITOR (ALL PLATFORMS) =====
  function _monitorScripts() {
    if (typeof MutationObserver === 'undefined') return;

    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.type !== 'childList') return;
        m.addedNodes.forEach(function(node) {
          if (!node.tagName || node.tagName !== 'SCRIPT') return;
          var src = node.src || '';
          if (!src) return; // Inline scripts are OK

          var isAllowed = _cfg.TRACKING_DOMAINS.some(function(d) {
            return src.toLowerCase().indexOf(d) > -1;
          });
          var isOwn = src.indexOf(window.location.hostname) > -1 ||
                      src.indexOf('./js/') > -1 ||
                      src.indexOf('/js/') > -1;

          if (!isAllowed && !isOwn) {
            try { node.remove(); } catch (e) {}
          }
        });
      });
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ===== H. GLOBAL PROTECTION =====
  function _protectGlobals() {
    setTimeout(function() {
      try {
        if (window.YARZ_API && window.YARZ_API.CONFIG) {
          Object.freeze(window.YARZ_API.CONFIG);
        }
      } catch (e) {}
    }, 2000);
  }

  // ===== INIT =====
  function init() {
    if (window.location.pathname.indexOf('admin') > -1) return;
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') return;

    // Console already neutralized at script load (see IIFE level)
    _blockShortcuts();
    _blockContextMenu();
    _antiIframe();
    _monitorScripts();
    _protectGlobals();
    // _preventDrag removed — no longer needed

    // DevTools check — DESKTOP ONLY, no popup
    if (!_isMobileOrTablet()) {
      setInterval(_checkDevTools, _cfg.CHECK_INTERVAL);
    }
  }

  // Console neutralization runs IMMEDIATELY — before any other script can log
  _neutralizeConsole();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
