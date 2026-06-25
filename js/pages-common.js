/* ============================================================
   YARZ — Common Page Enhancements v3.5
   For: about.html, privacy.html, terms.html,
        return-policy.html, shipping.html
   Adds:
     ✅ Floating Messenger button (auto-link from admin panel)
     ✅ In-app browser warning (Chrome redirect)
     ✅ Footer / Contact social-link auto-sync
   ============================================================ */

(function () {
  'use strict';

  // ---------- Helpers ----------
  function escHtml(s) {
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function _normalizeWaLink(input) {
    if (!input) return '';
    var s = String(input).trim();
    if (/^https?:\/\//i.test(s)) return s;
    var digits = s.replace(/[^0-9]/g, '');
    if (digits.length >= 8) return 'https://wa.me/' + digits;
    return s;
  }

  function _normalizeMsgrLink(input) {
    if (!input) return '';
    var s = String(input).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (s.indexOf('m.me/') === 0) return 'https://' + s;
    return 'https://m.me/' + s.replace(/^@/, '');
  }

  // ---------- 1) FLOATING WHATSAPP BUTTON (v5.0) ----------
  function injectFloatingWhatsApp(waUrl) {
    if (!waUrl) return;
    if (document.getElementById('floating-whatsapp-btn')) {
      var existing = document.getElementById('floating-whatsapp-btn');
      existing.href = waUrl;
      existing.style.display = 'flex';
      return;
    }

    // Hide old messenger button if exists
    var oldMsgr = document.getElementById('floating-messenger-btn');
    if (oldMsgr) oldMsgr.style.display = 'none';

    var btn = document.createElement('a');
    btn.id = 'floating-whatsapp-btn';
    btn.className = 'floating-whatsapp-btn';
    btn.href = waUrl;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.title = 'Chat on WhatsApp';
    btn.setAttribute('aria-label', 'WhatsApp Chat');
    btn.innerHTML =
      '<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
        '<circle cx="16" cy="16" r="16" fill="#25D366"/>' +
        '<path fill="#FFFFFF" d="M23.3 8.7C21.4 6.8 18.8 5.7 16 5.7c-5.5 0-10 4.5-10 10 0 1.8.5 3.5 1.3 5L6 26.3l5.8-1.5c1.4.8 3.1 1.2 4.8 1.2h0c5.5 0 10-4.5 10-10 0-2.7-1-5.2-2.9-7.1l-.4-.2zM16 24.4c-1.5 0-3-.4-4.3-1.2l-.3-.2-3.2.8.8-3.1-.2-.3c-.8-1.3-1.3-2.9-1.3-4.5 0-4.6 3.7-8.3 8.3-8.3 2.2 0 4.3.9 5.9 2.4 1.5 1.6 2.4 3.6 2.4 5.9 0 4.6-3.7 8.3-8.3 8.3l.2.2zm4.6-6.2c-.3-.1-1.5-.8-1.8-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.2-1.4-.8-.7-1.4-1.6-1.5-1.9-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2.1-.3 0-.5-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.1 4.9 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3z"/>' +
      '</svg>';
    document.body.appendChild(btn);
  }

  // ---------- 2) IN-APP BROWSER WARNING — DISABLED v10.5 ----------
  // Order history is stored in Google Sheets (not browser localStorage),
  // so customers can use ANY browser. Chrome-switch banner removed.
  function initInAppBrowserWarning() {
    return; // No-op
  }

  // ---------- 3) APPLY GLOBAL CONTROLS (Social Links + Theme) ----------
  function applyGlobalControls() {
    if (typeof YARZ_API === 'undefined') return;
    YARZ_API.getGlobalControls().then(function (controls) {
      if (!controls) return;
      // ✅ Apply subpage theme palette + custom CSS from the SAME controls
      // object to eliminate a duplicate API call (the old wrapper at line 276
      // fired two separate getGlobalControls() fetches).
      applySubpageTheme(controls);
      var s = controls.socialLinks || {};

      // ✅ v11.7: Init YARZ_PIXEL on static pages (about/privacy/terms/...)
      // so PageView is fired with proper CAPI mirror + advanced matching from prior sessions.
      // ✅ v15.44 FIX: Pass full `controls.raw` so pixel.js `_loadToggles()`
      // sees the per-event `pixel_evt_*` keys. Previously we passed only the
      // 5 pixel IDs in a hand-built object → every toggle defaulted to ON,
      // ignoring admin's preferences on subpages.
      try {
        if (window.YARZ_PIXEL && typeof YARZ_PIXEL.init === 'function' && controls.raw) {
          var raw = controls.raw;
          function pix(k1, k2) {
            var v = raw[k1] || raw[k2];
            return v ? String(v).trim() : '';
          }
          // Build a merged init payload: keep the legacy normalized keys for
          // backward-compat with older _storeInfo lookups, AND spread `raw`
          // so toggles + Sheet keys are visible to _loadToggles().
          var pixelInitPayload = Object.assign({}, raw, {
            fbPixel:        pix('FB Pixel', 'fb_pixel'),
            ga4Id:          pix('GA4', 'ga4'),
            tiktokPixel:    pix('TT Pixel', 'tt_pixel'),
            snapchatPixel:  pix('Snapchat Pixel', 'snap_pixel') || pix('Snapchat Pixel', 'snapchat_pixel'),
            pinterestPixel: pix('Pinterest Pixel', 'pinterest_pixel')
          });
          YARZ_PIXEL.init(pixelInitPayload);
          // Inject FB domain verification meta (required for AEM 8-event priority)
          var fbDomVer = (raw['FB Domain Verify'] || raw['fb_domain_verify'] || '').toString().trim();
          if (fbDomVer && !document.querySelector('meta[name="facebook-domain-verification"]')) {
            var dvm = document.createElement('meta');
            dvm.name = 'facebook-domain-verification';
            dvm.content = fbDomVer;
            document.head.appendChild(dvm);
          }
        }
      } catch (e) {}
      // ✅ v5.0: Floating WhatsApp button (replaces Messenger)
      var waUrl = '';
      if (controls.liveChat && controls.liveChat.whatsappNumber) {
        waUrl = _normalizeWaLink(controls.liveChat.whatsappNumber);
      } else if (s.whatsapp) {
        waUrl = _normalizeWaLink(s.whatsapp);
      }
      if (waUrl) injectFloatingWhatsApp(waUrl);

      // Update contact-page social cards if present
      var idMap = {
        'contact-wa': s.whatsapp ? _normalizeWaLink(s.whatsapp) : '',
        'contact-fb': s.facebook || '',
        'contact-ms': s.messenger ? _normalizeMsgrLink(s.messenger) : '',
        'contact-ig': s.instagram || '',
        'contact-tt': s.tiktok || '',
        'contact-yt': s.youtube || ''
      };
      Object.keys(idMap).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          if (idMap[id]) {
            el.href = idMap[id];
            el.style.display = 'flex';
          } else {
            el.style.display = 'none';
          }
        }
      });

      // Footer social-icon container (if present)
      var footerSocial = document.getElementById('footer-social-container');
      if (footerSocial) {
        var SVG = {
          facebook:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
          instagram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
          whatsapp:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a1.1 1.1 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347"/></svg>',
          messenger: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.915 1.487 5.503 3.791 7.21v3.532c0 .351.378.566.685.391l3.411-1.87c.683.188 1.393.287 2.113.287 5.523 0 10-4.145 10-9.258S17.523 2 12 2zm1.092 12.44l-2.451-2.617-4.78 2.617 5.253-5.56 2.451 2.618 4.78-2.618-5.253 5.56z"/></svg>',
          tiktok:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z"/></svg>',
          youtube:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>'
        };
        var entries = [
          { key: 'facebook' }, { key: 'instagram' },
          { key: 'whatsapp', normalize: _normalizeWaLink },
          { key: 'messenger', normalize: _normalizeMsgrLink },
          { key: 'tiktok' }, { key: 'youtube' }
        ];
        var html = '';
        entries.forEach(function (e) {
          var url = s[e.key];
          if (!url) return;
          if (e.normalize) url = e.normalize(url);
          html += '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" aria-label="' + e.key + '">' + (SVG[e.key] || '') + '</a>';
        });
        if (html) footerSocial.innerHTML = html;
      }
    }).catch(function () {});
  }

  // ✅ v15.6: Apply theme palette + custom CSS to subpages too.
  // Previously subpages (about/contact/privacy/etc.) only got social links —
  // they ignored the entire theme palette + custom CSS, making them look
  // disconnected from the main storefront.
  function applySubpageTheme(controls) {
    if (!controls) return;
    var root = document.documentElement;
    try {
      // Theme palette (matches app.js applyExtrasControls)
      if (controls.themePrimary) {
        root.style.setProperty('--accent', controls.themePrimary);
        root.style.setProperty('--accent-hover', controls.themePrimary);
        root.style.setProperty('--brand', controls.themePrimary);
        root.style.setProperty('--brand-dark', controls.themePrimary);
        root.style.setProperty('--purple-600', controls.themePrimary);
      }
      if (controls.themeAccent) {
        root.style.setProperty('--accent', controls.themeAccent);
        root.style.setProperty('--accent-hover', controls.themeAccent);
      }
      if (controls.themeBg) {
        root.style.setProperty('--bg-primary', controls.themeBg);
        root.style.setProperty('--bg-body', controls.themeBg);
      }
      if (controls.themeCardBg) {
        root.style.setProperty('--bg-card', controls.themeCardBg);
        root.style.setProperty('--bg-secondary', controls.themeCardBg);
      }
      if (controls.themeText) {
        // ✅ v15.87 contrast safety (mirrors app.js applyExtrasControls).
        // Admin's chosen text color is auto-corrected to a readable
        // alternative if it would fade into the chosen body bg.
        var _bgForText = controls.themeBg || '#FBF8F1';
        var _hex2rgb = function(hex){ var h=String(hex||'').trim().replace('#',''); if(h.length===3) h=h.split('').map(function(c){return c+c;}).join(''); return /^[0-9a-f]{6}$/i.test(h) ? {r:parseInt(h.slice(0,2),16),g:parseInt(h.slice(2,4),16),b:parseInt(h.slice(4,6),16)} : null; };
        var _lum = function(c){ var rgb=_hex2rgb(c); if(!rgb) return null; var f=function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(rgb.r)+0.7152*f(rgb.g)+0.0722*f(rgb.b); };
        var _ratio = function(a,b){ var la=_lum(a),lb=_lum(b); if(la===null||lb===null) return null; return (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05); };
        var _safe = controls.themeText;
        var _r = _ratio(controls.themeText, _bgForText);
        if (_r !== null && _r < 4.5) {
          var rDark  = _ratio('#1A1411', _bgForText) || 0;
          var rCream = _ratio('#FBF8F1', _bgForText) || 0;
          _safe = rDark >= rCream ? '#1A1411' : '#FBF8F1';
        }
        root.style.setProperty('--text-primary', _safe);
        root.style.setProperty('--text-main', _safe);
      }
      if (controls.themeBorder) {
        root.style.setProperty('--border-color', controls.themeBorder);
        root.style.setProperty('--border-light', controls.themeBorder);
      }
      if (controls.themeLink) root.style.setProperty('--link-color', controls.themeLink);
      if (controls.themeFooterBg) {
        // ✅ v15.89: Footer text decoupled — only the bg follows admin's
        // theme; heading/link/text colors are hardcoded pure white in CSS
        // with !important. See app.js applyExtrasControls for rationale.
        root.style.setProperty('--footer-bg', controls.themeFooterBg);
      }
      // ✅ v15.34 FIX: Announcement bar color CSS vars — admin's chosen
      // background/text color must apply on subpages too. Without these,
      // the subpages' announcement bar showed default dark text on
      // whatever color the admin picked, looking broken.
      if (controls.announcementBg) root.style.setProperty('--yarz-ann-bg', controls.announcementBg);
      if (controls.announcementColor) root.style.setProperty('--yarz-ann-color', controls.announcementColor);
      // Theme color (Branding tab)
      if (controls.themeColor) {
        root.style.setProperty('--accent', controls.themeColor);
        root.style.setProperty('--accent-hover', controls.themeColor);
        root.style.setProperty('--brand', controls.themeColor);
      }
      // Custom CSS injection
      var raw = controls.raw || {};
      var customCss = raw['Custom CSS'] || raw['custom_css'];
      if (customCss && !document.getElementById('yarz-custom-css')) {
        var s = document.createElement('style');
        s.id = 'yarz-custom-css';
        s.textContent = String(customCss);
        document.head.appendChild(s);
      }
      // Footer text
      if (controls.footerText) {
        var footerCol = document.querySelector('.footer-col p');
        if (footerCol) footerCol.textContent = controls.footerText;
      }
      // Logo
      if (controls.websiteLogoUrl) {
        var logoEl = document.querySelector('.brand-logo');
        if (logoEl && logoEl.tagName !== 'IMG') {
          var imgUrl = String(controls.websiteLogoUrl);
          // Lightweight inline image — pages-common.js doesn't have getImgSrc
          if (imgUrl.indexOf('drive.google.com') !== -1) {
            var m = imgUrl.match(/d\/([a-zA-Z0-9_-]+)/) || imgUrl.match(/id=([a-zA-Z0-9_-]+)/);
            if (m) imgUrl = 'https://lh3.googleusercontent.com/d/' + m[1] + '=s400-rw';
          }
          logoEl.innerHTML = '<img src="' + imgUrl.replace(/"/g, '&quot;') + '" alt="Logo" decoding="async" style="max-height:32px;">';
        }
      }
    } catch(e) { /* silent */ }
  }

  // ---------- 4) BROWSER ADDRESS BAR COLOR SYNC — v14.5 ----------
  // Lightweight version of app.js's chrome-sync — keeps the address bar
  // tinted to match whatever's at the top of the viewport (header bg by
  // default; announcement bar bg if it's showing). Prevents the visible
  // "seam" between browser chrome and page header.
  function initChromeColorSync() {
    // ✅ v15.57 FIX: This subpage helper used to dynamically sample the
    // top-most visible element's bg color and stamp it into theme-color.
    // Same problem as the main app.js sync — when the announcement bar
    // is at the viewport top with a red/pink/dark gradient, its sampled
    // hex got written into theme-color and stuck the address bar dark.
    // Site is cream-only on every subpage, so just hard-write cream.
    function sync() {
      try {
        var CREAM = '#FFFDF8';
        var metas = document.querySelectorAll('meta[name="theme-color"]');
        metas.forEach(function (m) { m.setAttribute('content', CREAM); });
      } catch (e) {}
    }
    // Initial sync after stylesheets resolve
    setTimeout(sync, 100);
    // Re-sync on scroll (header may add .scrolled class) — passive
    window.addEventListener('scroll', sync, { passive: true });
    // Re-sync on bfcache restore
    window.addEventListener('pageshow', sync);
    // Re-sync when system theme flips
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', sync);
      else if (mq.addListener) mq.addListener(sync);
    }
  }

  // ---------- INIT ----------
  document.addEventListener('DOMContentLoaded', function () {
    initInAppBrowserWarning();
    applyGlobalControls();
    initChromeColorSync();
  });
})();
