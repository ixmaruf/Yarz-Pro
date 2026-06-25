/* ============================================================
   YARZ PIXEL — Pro v3 (Phase 5 — CAPI-bridged + AEM-ready)
   ✅ ViewContent, AddToCart, InitiateCheckout, AddPaymentInfo, Purchase
   ✅ AddToWishlist, Search, Lead, ViewedManyProducts, AbandonedCheckout
   ✅ SHA-256 hashed Advanced Matching (em, ph, fn, ln, ge, db, ct, st, zp, country, external_id)
   ✅ event_id on EVERY event → full Conversions API deduplication
   ✅ Server-side CAPI mirror via beacon (recovers iOS-blocked / adblocked signal)
   ✅ Captures _fbp, _fbc, _ttp, ttclid → server forwards hashed user_data
   ✅ Auto-injects FB / GA4 / TikTok / Snapchat / Pinterest from admin settings
   ✅ Stable content_ids (slug-based) for catalog matching → DABA dynamic ads
   ✅ Lower CPA, better attribution, real-customer matching for sales objective
   ============================================================ */

const YARZ_PIXEL = (() => {
  'use strict';

  let _initialized = false;
  let _storeInfo = {};
  let _userMatchHashed = null;   // hashed advanced-matching object (cached for the session)
  let _externalId = null;        // anonymous external_id (UUID-like) per browser

  // ✅ v14.0: Toggle System — per-event ON/OFF control from admin panel.
  //   Loaded once during init() from storeInfo (which reads from Google Sheet SETTINGS).
  //   Default: ALL events ON unless explicitly disabled.
  //   CRITICAL events (Purchase, ViewContent, AddToCart, InitiateCheckout, PageView)
  //   are LOCKED ON — admin panel won't allow disabling them.
  let _toggles = {
    networks: {
      fb: true, ga4: true, tiktok: true, snap: true, pinterest: true,
      fb_capi: true
    },
    events: {
      // Standard (CRITICAL — should never be off)
      pageview: true, view_content: true, add_to_cart: true,
      initiate_checkout: true, purchase: true,
      // Standard (safe to disable)
      add_payment_info: true, add_to_wishlist: true, search: true, lead: true,
      // Custom
      whatsapp_click: true, time_on_page: true, size_selected: true,
      viewed_many_products: true, abandoned_checkout: true,
      // Engagement milestones
      time_on_site_15s: true, time_on_site_30s: true, time_on_site_60s: true,
      time_on_site_120s: true, time_on_site_180s: true, time_on_site_300s: true,
      scroll_depth_25: true, scroll_depth_50: true, scroll_depth_75: true,
      scroll_depth_100: true, engaged_session: true, session_end: true,
      // Server-side delivery flow
      order_delivered: false,   // OPT-IN — affects ROAS reporting (default off)
      order_cancelled: false,
      order_returned: false
    }
  };
  // Events the admin panel locks ON — disabling these breaks core functionality
  const LOCKED_EVENTS = ['pageview', 'view_content', 'add_to_cart',
                          'initiate_checkout', 'purchase'];

  // ✅ v14.0 SAFETY: Force locked events ON immediately at module load.
  //   Runs even if init() never gets called or storeInfo is missing.
  //   Belt-and-suspenders defense against accidental misconfiguration.
  LOCKED_EVENTS.forEach(function(k) { _toggles.events[k] = true; });

  // Convert truthy-ish values to boolean. Accepts 'true','1','yes','on','y' as true.
  function _truthy(v) {
    if (v === undefined || v === null) return null; // distinguish "unset" from "false"
    if (typeof v === 'boolean') return v;
    var s = String(v).toLowerCase().trim();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'n' || s === '') return false;
    return true;
  }

  // Load toggle settings from storeInfo. Default: keep current value (ON for most).
  // Admin Sheet keys: pixel_net_fb (1/0), pixel_evt_purchase (1/0), etc.
  function _loadToggles(storeInfo) {
    if (!storeInfo) return;
    function setIfPresent(group, key, sheetKey) {
      var v = _truthy(storeInfo[sheetKey]);
      if (v !== null) _toggles[group][key] = v;
    }
    // Networks
    setIfPresent('networks', 'fb',        'pixel_net_fb');
    setIfPresent('networks', 'ga4',       'pixel_net_ga4');
    setIfPresent('networks', 'tiktok',    'pixel_net_tiktok');
    setIfPresent('networks', 'snap',      'pixel_net_snap');
    setIfPresent('networks', 'pinterest', 'pixel_net_pinterest');
    setIfPresent('networks', 'fb_capi',   'pixel_net_fb_capi');
    // ✅ v14.0: Removed orphan keys (ig, tt_capi) — no UI controls + no consumers
    // Events — standard
    setIfPresent('events', 'pageview',           'pixel_evt_pageview');
    setIfPresent('events', 'view_content',       'pixel_evt_view_content');
    setIfPresent('events', 'add_to_cart',        'pixel_evt_add_to_cart');
    setIfPresent('events', 'initiate_checkout',  'pixel_evt_initiate_checkout');
    setIfPresent('events', 'purchase',           'pixel_evt_purchase');
    setIfPresent('events', 'add_payment_info',   'pixel_evt_add_payment_info');
    setIfPresent('events', 'add_to_wishlist',    'pixel_evt_add_to_wishlist');
    setIfPresent('events', 'search',             'pixel_evt_search');
    setIfPresent('events', 'lead',               'pixel_evt_lead');
    // Events — custom
    setIfPresent('events', 'whatsapp_click',     'pixel_evt_whatsapp_click');
    setIfPresent('events', 'time_on_page',       'pixel_evt_time_on_page');
    setIfPresent('events', 'size_selected',      'pixel_evt_size_selected');
    setIfPresent('events', 'viewed_many_products','pixel_evt_viewed_many_products');
    setIfPresent('events', 'abandoned_checkout', 'pixel_evt_abandoned_checkout');
    // Engagement milestones
    setIfPresent('events', 'time_on_site_15s',   'pixel_evt_tos_15');
    setIfPresent('events', 'time_on_site_30s',   'pixel_evt_tos_30');
    setIfPresent('events', 'time_on_site_60s',   'pixel_evt_tos_60');
    setIfPresent('events', 'time_on_site_120s',  'pixel_evt_tos_120');
    setIfPresent('events', 'time_on_site_180s',  'pixel_evt_tos_180');
    setIfPresent('events', 'time_on_site_300s',  'pixel_evt_tos_300');
    setIfPresent('events', 'scroll_depth_25',    'pixel_evt_scroll_25');
    setIfPresent('events', 'scroll_depth_50',    'pixel_evt_scroll_50');
    setIfPresent('events', 'scroll_depth_75',    'pixel_evt_scroll_75');
    setIfPresent('events', 'scroll_depth_100',   'pixel_evt_scroll_100');
    setIfPresent('events', 'engaged_session',    'pixel_evt_engaged_session');
    setIfPresent('events', 'session_end',        'pixel_evt_session_end');
    // Server-side delivery (default OFF — opt-in)
    setIfPresent('events', 'order_delivered',    'pixel_evt_order_delivered');
    setIfPresent('events', 'order_cancelled',    'pixel_evt_order_cancelled');
    setIfPresent('events', 'order_returned',     'pixel_evt_order_returned');

    // SAFETY: Lock CRITICAL events ON regardless of admin setting.
    // (UI also prevents disabling them, but enforce server-side too.)
    LOCKED_EVENTS.forEach(function(k) { _toggles.events[k] = true; });
  }

  function _isEventEnabled(eventKey) {
    return _toggles.events[eventKey] !== false;
  }

  // Network gating — check this BEFORE injection (master toggle off = no script load)
  function _isNetworkEnabled(networkKey) {
    return _toggles.networks[networkKey] !== false;
  }

  // Per-network capability checks — combine "is loaded" with "is toggle on"
  // Existing code uses _hasFbq / _hasTtq etc.; v14.0 we wrap them with toggle gate.

  // ===== Helpers =====
  // ✅ v14.0: All network capability checks now respect toggle gates.
  //   _hasFbq() returns false if EITHER: fbq is undefined, OR network toggle is off.
  //   This makes existing event code (50+ call sites) automatically toggle-aware
  //   without modifying every single line.
  function _hasFbq()  { return _isNetworkEnabled('fb')        && typeof window.fbq === 'function'; }
  function _hasTtq()  { return _isNetworkEnabled('tiktok')    && typeof window.ttq !== 'undefined' && typeof window.ttq.track === 'function'; }
  function _hasGtag() { return _isNetworkEnabled('ga4')       && typeof window.gtag === 'function'; }
  function _hasSnap() { return _isNetworkEnabled('snap')      && typeof window.snaptr === 'function'; }
  function _hasPin()  { return _isNetworkEnabled('pinterest') && typeof window.pintrk === 'function'; }

  function _safeNum(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  // Stable product identifier — used as content_ids for catalog matching.
  // Falls back to slug(name) so FB/TikTok dynamic ads can match feed entries.
  // ⚠️ MUST stay aligned with: app.js `slugify`, gas `_slugForCapi`, gas feed `slug()`.
  // We strip Bengali characters to match the existing storefront router behaviour
  // (backward-compat with bookmarked URLs). Pure-Bengali names will produce an
  // empty slug → skipped from the feed, but Latin-leaning product names still
  // route correctly across browser pixel ↔ server CAPI ↔ catalog feed ↔ deep-link.
  function _slug(s) {
    return String(s || '').toLowerCase().trim()
      .replace(/[\u0600-\u06FF]+/g, '')        // strip Arabic
      .replace(/[^a-z0-9\u0980-\u09FF\s-]/g, '')  // keep Bengali + Latin
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 80);
  }
  function _productId(p) {
    if (!p) return '';
    if (p.sku)  return String(p.sku);
    if (p.id != null && p.id !== '') return String(p.id);
    return _slug(p.name || '');
  }

  // ✅ v11.7: Read browser cookies (used for fbp/fbc/ttp click ID matching)
  function _readCookie(name) {
    try {
      var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
      return match ? decodeURIComponent(match[1]) : '';
    } catch (e) { return ''; }
  }

  // ✅ v11.7: Capture fbclid → _fbc cookie (90d) per FB spec, ttclid → _yarz_ttclid
  // ✅ v15.75 P1-5: subdomainIndex computed from actual hostname (was hardcoded 1).
  //   For `yarzclothing.xyz` index=1, for `www.yarzclothing.xyz` index=2.
  //   Wrong index makes _fbc unmatchable across www↔apex sessions.
  function _fbcSubdomainIndex() {
    try {
      var host = String(location.hostname || '').replace(/^\.+|\.+$/g, '');
      if (!host) return 1;
      // IP / localhost → safe default
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost') return 1;
      var parts = host.split('.');
      // Per Meta spec: subdomainIndex = number of dots in cookie's effective domain
      // For yarzclothing.xyz (2 parts, 1 dot) → 1
      // For www.yarzclothing.xyz (3 parts, 2 dots) → 2
      return Math.max(1, parts.length - 1);
    } catch (e) { return 1; }
  }
  function _captureClickIds() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fbclid = params.get('fbclid');
      if (fbclid && !_readCookie('_fbc')) {
        var idx = _fbcSubdomainIndex();
        document.cookie = '_fbc=fb.' + idx + '.' + Date.now() + '.' + fbclid + '; max-age=' + (90*86400) + '; path=/; samesite=lax';
      }
      var ttclid = params.get('ttclid');
      if (ttclid && !_readCookie('_yarz_ttclid')) {
        document.cookie = '_yarz_ttclid=' + encodeURIComponent(ttclid) + '; max-age=' + (90*86400) + '; path=/; samesite=lax';
      }
      // ✅ v15.75 P2-2: Pinterest (epik) + Snapchat (sccid) click IDs for parity
      var epik = params.get('epik');
      if (epik && !_readCookie('_yarz_epik')) {
        document.cookie = '_yarz_epik=' + encodeURIComponent(epik) + '; max-age=' + (90*86400) + '; path=/; samesite=lax';
      }
      var sccid = params.get('sccid') || params.get('ScCid');
      if (sccid && !_readCookie('_yarz_sccid')) {
        document.cookie = '_yarz_sccid=' + encodeURIComponent(sccid) + '; max-age=' + (90*86400) + '; path=/; samesite=lax';
      }
    } catch (e) {}
  }

  // ✅ v11.7: Send CAPI mirror event to GAS via Beacon (non-blocking, ATT-resistant)
  // ✅ v14.0: Gated on `pixel_net_fb_capi` toggle — admin can disable server mirroring
  //   (e.g. if GAS quota gets hot) while keeping browser pixels firing.
  function _sendCapiMirror(eventName, eventId, customData, userExtras) {
    if (!_isNetworkEnabled('fb_capi')) return;  // CAPI master toggle off → skip silently
    try {
      // Route through Cloudflare Worker so it can inject client IP + UA before forwarding
      // (GAS cannot read the remote IP itself; Worker reads `cf-connecting-ip` and rewrites
      //  the body). Falls back to direct GAS if Worker URL unavailable.
      var url = null;
      if (window.YARZ_API) {
        if (typeof window.YARZ_API.getReadUrl === 'function') {
          url = window.YARZ_API.getReadUrl();          // Worker URL (preferred)
        }
        if (!url && typeof window.YARZ_API.getBaseUrl === 'function') {
          url = window.YARZ_API.getBaseUrl();          // Direct GAS (fallback)
        }
      }
      if (!url) return;
      var apiKey = (window.YARZ_API && window.YARZ_API.CONFIG && window.YARZ_API.CONFIG.API_KEY) || '';
      if (!apiKey) return;
      var ud = {
        fbp: _readCookie('_fbp'),
        fbc: _readCookie('_fbc'),
        ttp: _readCookie('_ttp'),
        ttclid: _readCookie('_yarz_ttclid'),
        externalId: _getOrCreateExternalId(),
        userAgent: navigator.userAgent || ''
      };
      // Layer in any cached identity (email/phone/name/city/state/zip/country/gender/dob)
      // from prior checkout — this is what lifts top-of-funnel EMQ from ~5 to 8+.
      // ✅ v15.75 P1-1: Extended from name/phone/email to the full hashable set
      // so PageView / ViewContent / AddToCart on returning visitors carry the
      // same Andromeda-grade identity the browser pixel's Advanced Matching has.
      try {
        var cachedRaw = localStorage.getItem('yarz_user');
        if (cachedRaw) {
          // ✅ v17.15: Unwrap TTL envelope ({v, t, d}) if present, fall back to raw.
          var c = JSON.parse(cachedRaw) || {};
          if (c && typeof c === 'object' && 'v' in c && 't' in c) c = c.v || {};
          if (c.name)    ud.name    = c.name;
          if (c.phone)   ud.phone   = c.phone;
          if (c.email)   ud.email   = c.email;
          if (c.city)    ud.city    = c.city;
          if (c.state)   ud.state   = c.state;
          if (c.zip)     ud.zip     = c.zip;
          if (c.country) ud.country = c.country;
          if (c.gender)  ud.gender  = c.gender;
          if (c.dob)     ud.dob     = c.dob;
        }
      } catch (e) {}
      if (userExtras) Object.keys(userExtras).forEach(function(k){ if(userExtras[k]) ud[k] = userExtras[k]; });
      var payload = {
        key: apiKey,
        action: 'capi',
        eventName: eventName,
        eventId: eventId,
        // ✅ v15.75 P0-1: Forward the ACTUAL page URL so Andromeda gets the
        //   real content-context signal. Previously GAS hardcoded the homepage
        //   for every event → ViewContent / AddToCart looked like they happened
        //   on `/` which crippled URL-keyed catalog matching and EMQ.
        eventSourceUrl: (function(){
          try { return String(window.location.href || ''); } catch(e){ return ''; }
        })(),
        customData: customData || {},
        userData: ud,
        actionSource: 'website'
      };
      var body = JSON.stringify(payload);
      // Prefer sendBeacon — survives page unload (abandonment events!)
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain' });
        navigator.sendBeacon(url, blob);
      } else {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true }).catch(function(){});
      }
    } catch (e) {}
  }

  // Run once at module load — captures click IDs from URL
  _captureClickIds();

  function _isFiredOnce(key) {
    try {
      if (sessionStorage.getItem(key)) return true;
      sessionStorage.setItem(key, '1');
      return false;
    } catch (e) { return false; }
  }

  function _genEventId(prefix) {
    return (prefix || 'evt') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
  }

  function _getOrCreateExternalId() {
    if (_externalId) return _externalId;
    try {
      var v = localStorage.getItem('yarz_ext_id');
      if (!v) {
        v = 'yz_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem('yarz_ext_id', v);
      }
      _externalId = v;
      return v;
    } catch (e) { return null; }
  }

  // ----- SHA-256 (uses native crypto.subtle when available; sync fallback otherwise) -----
  function _toHex(buf) {
    var bytes = new Uint8Array(buf);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var b = bytes[i].toString(16);
      hex += (b.length === 1 ? '0' : '') + b;
    }
    return hex;
  }
  async function _sha256(value) {
    if (!value) return '';
    var v = String(value).trim().toLowerCase();
    try {
      if (window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined') {
        var enc = new TextEncoder().encode(v);
        var buf = await window.crypto.subtle.digest('SHA-256', enc);
        return _toHex(buf);
      }
    } catch (e) { /* fall through */ }
    // ✅ v15.75 P0-3: PII LEAK GUARD. If crypto.subtle is unavailable
    // (insecure context / very old browser), DO NOT return plaintext PII.
    // Returning empty drops that field from the CAPI payload — which is far
    // better than emailing/phone-number leaking through unhashed. Meta would
    // reject unhashed em/ph anyway, so this is also correctness-preserving.
    try { console.warn('[YARZ_PIXEL] crypto.subtle unavailable — PII field dropped to avoid leak'); } catch(_e){}
    return '';
  }

  function _normalizePhone(p) {
    if (!p) return '';
    var d = String(p).replace(/[^\d]/g, '');
    if (!d) return '';
    // Bangladesh default — strip leading 0 and prepend country code if 11 digits
    if (d.length === 11 && d.charAt(0) === '0') d = '88' + d;
    if (d.length === 10) d = '880' + d;
    return d;
  }

  function _splitName(full) {
    if (!full) return { first: '', last: '' };
    var parts = String(full).trim().split(/\s+/);
    return { first: parts[0] || '', last: parts.slice(1).join(' ') };
  }

  // Build hashed advanced-matching object for fbq('init', pixel, am)
  async function _buildAdvancedMatch(userData) {
    if (!userData) return null;
    var n = _splitName(userData.name || '');
    var phone = _normalizePhone(userData.phone || '');
    var email = (userData.email || '').trim().toLowerCase();
    var city  = (userData.city  || '').trim().toLowerCase();
    var state = (userData.state || '').trim().toLowerCase();
    var zip   = (userData.zip   || '').trim().toLowerCase();
    var country = (userData.country || 'bd').trim().toLowerCase();
    var ge    = (userData.gender || '').trim().toLowerCase().charAt(0); // f/m
    var db    = (userData.dob   || '').replace(/[^\d]/g, ''); // YYYYMMDD
    var extId = _getOrCreateExternalId();

    var promises = [];
    var keys = [];
    function add(key, val) {
      if (!val) return;
      keys.push(key);
      promises.push(_sha256(val));
    }
    if (email)   add('em', email);
    if (phone)   add('ph', phone);
    if (n.first) add('fn', n.first);
    if (n.last)  add('ln', n.last);
    if (city)    add('ct', city.replace(/\s+/g, ''));
    if (state)   add('st', state.replace(/\s+/g, ''));
    if (zip)     add('zp', zip);
    if (country) add('country', country);
    if (ge)      add('ge', ge);
    if (db)      add('db', db);
    if (extId)   add('external_id', extId);

    var hashed = await Promise.all(promises);
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = hashed[i];
    return out;
  }

  // Cache hashed user data for the session (set on InitiateCheckout / Purchase)
  async function _setUserData(userData) {
    if (!userData) return;
    try {
      // Persist plaintext-ish identity for cross-page enrichment (used by _sendCapiMirror)
      try {
        // ✅ v17.15: Use TTL envelope so app.js's _safeReadLSWithTTL honours
        // the 90-day PII auto-expire. Before this, pixel.js wrote raw JSON,
        // which app.js parsed as malformed and treated the entry as missing
        // — silently breaking pre-fill AND the 90-day TTL.
        var stored = {};
        try {
          var raw = localStorage.getItem('yarz_user');
          if (raw) {
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && 'v' in parsed && 't' in parsed) {
              stored = parsed.v || {};
            } else {
              stored = parsed || {};
            }
          }
        } catch (e) {}
        ['name','phone','email','city','state','zip','country'].forEach(function(k){
          if (userData[k]) stored[k] = userData[k];
        });
        localStorage.setItem('yarz_user', JSON.stringify({v: stored, t: Date.now()}));
      } catch (e) {}

      var am = await _buildAdvancedMatch(userData);
      if (am && Object.keys(am).length) {
        _userMatchHashed = am;
        // ✅ v17.15: Wrap hashed PII in TTL envelope too (was raw JSON).
        try { localStorage.setItem('yarz_pixel_user', JSON.stringify({v: am, t: Date.now()})); } catch (e) {}
        // Re-init pixel with advanced matching (FB allows re-init)
        var pixelId = _storeInfo && _storeInfo.fbPixel;
        if (pixelId && _hasFbq()) {
          try { fbq('init', pixelId, am); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  function _getCachedUserMatch() {
    if (_userMatchHashed) return _userMatchHashed;
    try {
      var raw = localStorage.getItem('yarz_pixel_user');
      if (raw) {
        // ✅ v17.15: Unwrap TTL envelope ({v, t}) if present, fall back to raw.
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && 'v' in parsed && 't' in parsed) {
          _userMatchHashed = parsed.v;
        } else {
          _userMatchHashed = parsed;
        }
        return _userMatchHashed;
      }
    } catch (e) {}
    return null;
  }

  // ----- ViewedManyProducts session counter -----
  function _bumpViewCounter() {
    if (!_isEventEnabled('viewed_many_products')) return;  // ✅ v14.0 toggle gate
    try {
      var n = parseInt(sessionStorage.getItem('yarz_vc_count') || '0', 10) + 1;
      sessionStorage.setItem('yarz_vc_count', String(n));
      if (n === 3 && !sessionStorage.getItem('yarz_vmp_fired')) {
        sessionStorage.setItem('yarz_vmp_fired', '1');
        var _vmpEid = _genEventId('vmp');
        trackCustom('ViewedManyProducts', { count: n }, _vmpEid);
        // ✅ v15.45: Server-side mirror so iOS-blocked browser pixels still attribute
        _sendCapiMirror('ViewedManyProducts', _vmpEid, { count: n });
      }
    } catch (e) {}
  }

  // ===== EVENTS =====

  // 1. ViewContent
  function viewContent(product) {
    if (!_isEventEnabled('view_content')) return;  // ✅ v14.0 toggle gate
    if (!product || !product.name) return;
    var pid = _productId(product);
    if (_isFiredOnce('yarz_vc_' + pid)) return;
    _bumpViewCounter();

    var price = _safeNum(product.salePrice || product.sale || product.price);
    var data = {
      content_name: product.name,
      content_category: product.category || '',
      content_type: 'product',
      content_ids: [pid],
      value: price,
      currency: 'BDT'
    };
    var eventId = _genEventId('vc');

    if (_hasFbq()) { try { fbq('track', 'ViewContent', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('ViewContent', { content_id: pid, content_name: product.name, value: price, currency: 'BDT' }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'view_item', { items: [{ item_id: pid, item_name: product.name, item_category: product.category || '', price: price }], currency: 'BDT', value: price }); } catch (e) {} }
    if (_hasSnap()){ try { snaptr('track', 'VIEW_CONTENT', { item_ids: [pid], price: price, currency: 'BDT' }); } catch (e) {} }
    if (_hasPin()) { try { pintrk('track', 'pagevisit', { product_name: product.name, value: price, currency: 'BDT' }); } catch (e) {} }
    // ✅ v11.7: Server-side CAPI mirror (recovers iOS-blocked signal)
    _sendCapiMirror('ViewContent', eventId, data);
  }

  // 2. AddToCart
  function addToCart(product, size, qty) {
    if (!_isEventEnabled('add_to_cart')) return;  // ✅ v14.0 toggle gate
    if (!product) return;
    var pid = _productId(product);
    var price = _safeNum(product.salePrice || product.sale || product.price);
    var value = price * (qty || 1);
    var eventId = _genEventId('atc');
    var data = {
      content_name: product.name,
      content_category: product.category || '',
      content_ids: [pid],
      content_type: 'product',
      value: value,
      currency: 'BDT',
      contents: [{ id: pid, quantity: qty || 1, item_price: price }]
    };
    if (_hasFbq()) { try { fbq('track', 'AddToCart', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('AddToCart', { content_id: pid, content_name: product.name, value: value, currency: 'BDT', quantity: qty || 1 }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'add_to_cart', { items: [{ item_id: pid, item_name: product.name, item_category: product.category || '', price: price, quantity: qty || 1 }], currency: 'BDT', value: value }); } catch (e) {} }
    if (_hasSnap()){ try { snaptr('track', 'ADD_CART', { item_ids: [pid], price: value, currency: 'BDT' }); } catch (e) {} }
    if (_hasPin()) { try { pintrk('track', 'addtocart', { value: value, currency: 'BDT', line_items: [{ product_name: product.name, product_quantity: qty || 1, product_price: price }] }); } catch (e) {} }
    // ✅ v11.7: Server-side CAPI mirror
    _sendCapiMirror('AddToCart', eventId, data);

    // ✅ v11.7: Schedule abandoned-checkout via beacon — fires on tab close, not just timer
    // ✅ v14.0: Skip entirely if abandoned_checkout toggle is off
    if (!_isEventEnabled('abandoned_checkout')) return;
    // ✅ v15.75 P1-3: Capture cart context so AbandonedCheckout carries product
    // identity. Without content_ids/contents, dynamic abandoned-cart retargeting
    // can't show the SAME product back to the user → wasted intent signal.
    var _abandonContents = [{ id: pid, quantity: qty || 1, item_price: price }];
    var _abandonIds = [pid];
    var _abandonNumItems = qty || 1;
    try {
      if (window._yarzAbandonTimer) clearTimeout(window._yarzAbandonTimer);
      window._yarzAbandonTimer = setTimeout(function () {
        if (sessionStorage.getItem('yarz_purchased') === '1') return;
        if (sessionStorage.getItem('yarz_abandon_fired') === '1') return;
        sessionStorage.setItem('yarz_abandon_fired', '1');
        var _abcEid = _genEventId('abc');
        var _abcData = {
          content_ids: _abandonIds,
          content_type: 'product',
          contents: _abandonContents,
          num_items: _abandonNumItems,
          value: value,
          currency: 'BDT'
        };
        trackCustom('AbandonedCheckout', _abcData, _abcEid);
        // ✅ v15.45: Server-side mirror — recovers iOS-blocked timer-based abandon signal
        _sendCapiMirror('AbandonedCheckout', _abcEid, _abcData);
      }, 5 * 60 * 1000);
      // Also fire on visibility change (tab close / navigate away)
      if (!window._yarzVisibilityHooked) {
        window._yarzVisibilityHooked = true;
        window.addEventListener('pagehide', function () {
          // ✅ v14.0: Re-check toggle at fire time (admin may have disabled
          //   between this listener registering and the actual page-hide event)
          if (!_isEventEnabled('abandoned_checkout')) return;
          if (sessionStorage.getItem('yarz_purchased') === '1') return;
          if (sessionStorage.getItem('yarz_abandon_fired') === '1') return;
          if (sessionStorage.getItem('yarz_atc_pending') !== '1') return;
          sessionStorage.setItem('yarz_abandon_fired', '1');
          var eid = _genEventId('abc');
          var ehData = {
            content_ids: _abandonIds,
            content_type: 'product',
            contents: _abandonContents,
            num_items: _abandonNumItems,
            value: value,
            currency: 'BDT'
          };
          if (_hasFbq()) try { fbq('trackCustom', 'AbandonedCheckout', ehData, { eventID: eid }); } catch(e){}
          _sendCapiMirror('AbandonedCheckout', eid, ehData);
        });
      }
      sessionStorage.setItem('yarz_atc_pending', '1');
    } catch (e) {}
  }

  // 3. InitiateCheckout
  async function initiateCheckout(cart, total, userData) {
    if (!_isEventEnabled('initiate_checkout')) return;  // ✅ v14.0 toggle gate
    if (!cart || cart.length === 0) return;
    if (userData) await _setUserData(userData);
    var value = _safeNum(total);
    var ids = cart.map(function (c) { return _productId(c); });
    var contents = cart.map(function (c) {
      return { id: _productId(c), quantity: c.qty || 1, item_price: _safeNum(c.price) };
    });
    var eventId = _genEventId('ic');
    var data = {
      content_ids: ids,
      content_type: 'product',
      contents: contents,
      num_items: cart.length,
      value: value,
      currency: 'BDT'
    };
    if (_hasFbq()) { try { fbq('track', 'InitiateCheckout', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('InitiateCheckout', { value: value, currency: 'BDT', quantity: cart.length, contents: contents.map(function(c){ return { content_id:c.id, quantity:c.quantity, price:c.item_price }; }) }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'begin_checkout', { items: cart.map(function (c) { return { item_id: _productId(c), item_name: c.name, price: _safeNum(c.price), quantity: c.qty || 1 }; }), currency: 'BDT', value: value }); } catch (e) {} }
    if (_hasSnap()){ try { snaptr('track', 'START_CHECKOUT', { item_ids: ids, price: value, currency: 'BDT', number_items: cart.length }); } catch (e) {} }
    if (_hasPin()) { try { pintrk('track', 'checkout', { value: value, currency: 'BDT', order_quantity: cart.length, line_items: contents.map(function(c){ return { product_name:c.id, product_quantity:c.quantity, product_price:c.item_price }; }) }); } catch (e) {} }
    // ✅ v11.7: CAPI mirror
    _sendCapiMirror('InitiateCheckout', eventId, data);
  }

  // 3b. AddPaymentInfo — fires when buyer picks bKash/Nagad/etc.
  async function addPaymentInfo(method, cart, total, userData) {
    if (!_isEventEnabled('add_payment_info')) return;  // ✅ v14.0 toggle gate
    if (!cart || cart.length === 0) return;
    if (userData) await _setUserData(userData);
    var value = _safeNum(total);
    var ids = (cart || []).map(function (c) { return _productId(c); });
    var contents = (cart || []).map(function (c) {
      return { id: _productId(c), quantity: c.qty || 1, item_price: _safeNum(c.price) };
    });
    var eventId = _genEventId('api');
    var data = {
      content_ids: ids,
      content_type: 'product',
      contents: contents,
      num_items: cart.length,
      value: value,
      currency: 'BDT',
      payment_method: method || 'cod'
    };
    if (_hasFbq()) { try { fbq('track', 'AddPaymentInfo', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('AddPaymentInfo', { value: value, currency: 'BDT', quantity: cart.length }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'add_payment_info', { payment_type: method || 'cod', items: cart.map(function (c) { return { item_id: _productId(c), item_name: c.name, price: _safeNum(c.price), quantity: c.qty || 1 }; }), currency: 'BDT', value: value }); } catch (e) {} }
    // ✅ v11.7: CAPI mirror
    _sendCapiMirror('AddPaymentInfo', eventId, data);
  }

  // 4. Purchase
  var _firedPurchaseIds = {};
  // ✅ v13.2: 5th param `paymentMethod` (e.g., 'COD', 'bKash', 'Nagad') sends
  //   Bangladesh-specific advance-payment signal to Facebook for value-based optimization.
  //   Customers who pay bKash/Nagad ADVANCE are objectively higher LTV than COD customers
  //   (no fake orders, no return-on-delivery). Facebook builds Lookalike audiences from
  //   "is_prepaid=1" buyers and finds more high-quality customers.
  async function purchase(orderId, cart, total, userData, paymentMethod) {
    if (!_isEventEnabled('purchase')) return;  // ✅ v14.0 toggle gate (locked ON by default)
    if (!cart || cart.length === 0) return;
    if (userData) await _setUserData(userData);
    var value = _safeNum(total);
    if (_firedPurchaseIds[orderId]) return;
    _firedPurchaseIds[orderId] = true;

    if (value <= 0) {
      value = cart.reduce(function (sum, c) { return sum + (_safeNum(c.price) * (c.qty || 1)); }, 0);
      if (value <= 0) return;
    }

    try { sessionStorage.setItem('yarz_purchased', '1'); } catch (e) {}
    try { if (window._yarzAbandonTimer) clearTimeout(window._yarzAbandonTimer); } catch (e) {}

    var ids = cart.map(function (c) { return _productId(c); });
    var contents = cart.map(function (c) {
      return { id: _productId(c), quantity: c.qty || 1, item_price: _safeNum(c.price) };
    });
    var eventId = orderId; // Use orderId as the canonical event_id for CAPI dedup

    // ✅ v13.2: Bangladesh advance-payment signal
    // Normalize payment method to lowercase + decide if it's prepaid (gold customer)
    var pmRaw = String(paymentMethod || 'cod').toLowerCase().trim();
    var isPrepaid = /^(bkash|nagad|rocket|bank|paid|prepaid|sslcommerz)/.test(pmRaw) ? 1 : 0;

    var data = {
      content_ids: ids,
      content_type: 'product',
      contents: contents,
      num_items: cart.length,
      value: value,
      currency: 'BDT',
      order_id: orderId,
      // ✅ v13.2: Custom data for Bangladesh value-based optimization
      payment_method: pmRaw,
      is_prepaid: isPrepaid
    };
    if (_hasFbq()) { try { fbq('track', 'Purchase', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('PlaceAnOrder', { value: value, currency: 'BDT', quantity: cart.length, contents: contents.map(function(c){ return { content_id:c.id, quantity:c.quantity, price:c.item_price }; }) }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'purchase', { transaction_id: orderId, items: cart.map(function (c) { return { item_id: _productId(c), item_name: c.name, price: _safeNum(c.price), quantity: c.qty || 1 }; }), currency: 'BDT', value: value, payment_type: pmRaw }); } catch (e) {} }
    if (_hasSnap()){ try { snaptr('track', 'PURCHASE', { transaction_id: orderId, item_ids: ids, price: value, currency: 'BDT', number_items: cart.length }); } catch (e) {} }
    if (_hasPin()) { try { pintrk('track', 'checkout', { value: value, currency: 'BDT', order_id: orderId, order_quantity: cart.length, line_items: contents.map(function(c){ return { product_name:c.id, product_quantity:c.quantity, product_price:c.item_price }; }) }); } catch (e) {} }
    // ✅ v15.75 P0-2: Browser-side Purchase MIRROR via beacon as belt-and-suspenders.
    // Why: GAS server-side Purchase already fires (with full hashed user_data + same
    // eventID=orderId), but if GAS is mid-deploy / quota-exceeded / FB Pixel-or-Token
    // unset, server signal silently drops. On iOS the browser pixel may also be ITP-blocked.
    // Sending from BOTH sources with identical eventID lets FB dedup safely (48h window)
    // while guaranteeing at least one path lands. This is the standard 2026 dual-stream
    // CAPI pattern. Userdata payload picks up cached identity + click IDs in _sendCapiMirror.
    try {
      _sendCapiMirror('Purchase', eventId, data, {
        name:    (userData && userData.name)    || '',
        phone:   (userData && userData.phone)   || '',
        email:   (userData && userData.email)   || '',
        city:    (userData && userData.city)    || '',
        state:   (userData && userData.state)   || '',
        zip:     (userData && userData.zip)     || '',
        country: (userData && userData.country) || 'bd'
      });
    } catch (e) {}
  }

  // 5. AddToWishlist
  function addToWishlist(product) {
    if (!_isEventEnabled('add_to_wishlist')) return;  // ✅ v14.0 toggle gate
    if (!product) return;
    var pid = _productId(product);
    var price = _safeNum(product.salePrice || product.sale || product.price);
    var eventId = _genEventId('wl');
    var data = {
      content_name: product.name,
      content_category: product.category || '',
      content_ids: [pid],
      content_type: 'product',
      value: price,
      currency: 'BDT'
    };
    if (_hasFbq()) { try { fbq('track', 'AddToWishlist', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('AddToWishlist', { content_id: pid, content_name: product.name, value: price, currency: 'BDT' }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'add_to_wishlist', { items: [{ item_id: pid, item_name: product.name, price: price }], currency: 'BDT', value: price }); } catch (e) {} }
    // ✅ v11.7: CAPI mirror
    _sendCapiMirror('AddToWishlist', eventId, data);
  }

  // 6. Search
  function search(query) {
    if (!_isEventEnabled('search')) return;  // ✅ v14.0 toggle gate
    if (!query) return;
    var eventId = _genEventId('sr');
    var data = { search_string: String(query) };
    if (_hasFbq()) { try { fbq('track', 'Search', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('Search', { query: String(query) }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'search', { search_term: query }); } catch (e) {} }
    // ✅ v11.7: CAPI mirror
    _sendCapiMirror('Search', eventId, data);
  }

  // 7. Custom (allows passing eventId for CAPI dedup)
  function trackCustom(eventName, data, eventId) {
    if (_hasFbq()) {
      try { fbq('trackCustom', eventName, data || {}, eventId ? { eventID: eventId } : undefined); } catch (e) {}
    }
  }

  // 7b. Lead — newsletter, contact form, ask-for-callback, etc.
  // High-intent signal for FB optimization. value = average order value (helps FB bid).
  // ✅ v15.75 P1-6: Added value_to_match (Andromeda value-based bidding) and
  //   content_category so Lead-objective campaigns can optimize against expected
  //   value rather than raw volume.
  async function lead(source, value, formData) {
    if (!_isEventEnabled('lead')) return;  // ✅ v14.0 toggle gate
    if (formData) await _setUserData(formData);
    var eventId = _genEventId('ld');
    var leadValue = _safeNum(value);
    var data = {
      content_category: source || 'general',
      content_name: source || 'lead',
      lead_source: source || 'general',
      value: leadValue,
      value_to_match: leadValue,         // Andromeda value-based bidding signal
      predicted_ltv: leadValue,          // optional but supported in 2026
      currency: 'BDT'
    };
    if (_hasFbq()) { try { fbq('track', 'Lead', data, { eventID: eventId }); } catch (e) {} }
    if (_hasTtq()) { try { ttq.track('SubmitForm', { content_name: source || 'lead', value: leadValue, currency: 'BDT' }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'generate_lead', { value: leadValue, currency: 'BDT' }); } catch (e) {} }
    // ✅ v11.7: CAPI mirror
    _sendCapiMirror('Lead', eventId, data);
  }

  // 8. WhatsAppClick → standard Contact event (2026 best practice)
  function whatsAppClick(product, size) {
    if (!_isEventEnabled('whatsapp_click')) return;  // ✅ v14.0 toggle gate
    var pid = product ? _productId(product) : '';
    var data = {
      page_type: product ? 'product' : 'home',
      content_name: product ? (product.name || '') : '',
      content_category: product ? (product.category || '') : '',
      content_ids: pid ? [pid] : undefined,
      size: size || '',
      value: product ? (_safeNum(product.salePrice || product.sale || product.price)) : 0,
      currency: 'BDT'
    };
    var eventId = _genEventId('wa');
    // ✅ v15.75 P1-4: Promote WhatsApp click to FB STANDARD `Contact` event so
    // Messaging-objective campaigns can optimize against it directly. Custom
    // events are invisible to those objectives. Keep a custom WhatsAppClick
    // mirror for legacy reporting workflows.
    if (_hasFbq()) {
      try { fbq('track',       'Contact',       data, { eventID: eventId }); } catch (e) {}
      try { fbq('trackCustom', 'WhatsAppClick', data, { eventID: eventId }); } catch (e) {}
    }
    if (_hasTtq()) { try { ttq.track('Contact', { content_name: data.content_name || 'WhatsApp', value: data.value, currency: 'BDT' }, { event_id: eventId }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'contact', { method: 'whatsapp', item_name: data.content_name, item_category: data.content_category, value: data.value }); } catch (e) {} }
    // ✅ v15.75 P1-4: Server-side CAPI mirror so iOS-blocked / ITP-restricted
    // sessions still attribute the WhatsApp lead to the right campaign.
    _sendCapiMirror('Contact', eventId, data);
  }

  // 9. TimeOnPage_30s
  var _timeOnPageFired = {};
  function timeOnPage(product) {
    if (!_isEventEnabled('time_on_page')) return;  // ✅ v14.0 toggle gate
    if (!product || !product.name) return;
    var pid = _productId(product);
    if (_timeOnPageFired[pid]) return;
    _timeOnPageFired[pid] = true;
    var data = {
      content_name: product.name,
      content_category: product.category || '',
      content_ids: [pid],
      value: _safeNum(product.salePrice || product.sale || product.price),
      currency: 'BDT',
      duration_seconds: 30
    };
    if (_hasFbq()) { try { fbq('trackCustom', 'TimeOnPage_30s', data, { eventID: _genEventId('top') }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'engaged_view', { item_name: data.content_name, engagement_time_msec: 30000 }); } catch (e) {} }
  }

  // 10. SizeSelected
  var _lastSizeEvent = '';
  function sizeSelected(product, size) {
    if (!_isEventEnabled('size_selected')) return;  // ✅ v14.0 toggle gate
    if (!product || !size) return;
    var pid = _productId(product);
    var key = pid + '_' + size;
    if (_lastSizeEvent === key) return;
    _lastSizeEvent = key;
    var data = {
      content_name: product.name,
      content_category: product.category || '',
      content_ids: [pid],
      size: size,
      value: _safeNum(product.salePrice || product.sale || product.price),
      currency: 'BDT'
    };
    if (_hasFbq()) { try { fbq('trackCustom', 'SizeSelected', data, { eventID: _genEventId('ss') }); } catch (e) {} }
    if (_hasGtag()){ try { gtag('event', 'select_item', { item_name: data.content_name, item_variant: size }); } catch (e) {} }
  }

  // ===== Auto-Inject helpers =====
  function _injectFbPixel(pixelId, am, pvEventId) {
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    if (am && Object.keys(am).length) fbq('init', pixelId, am);
    else fbq('init', pixelId);
    // Disable autoConfig — prevents FB from auto-firing buttons that pollute the pixel.
    try { fbq('set', 'autoConfig', 'false', pixelId); } catch (e) {}
    // ✅ v14.0: PageView gated by toggle (locked ON by default — disabling breaks all campaigns)
    // ✅ v15.45 DEDUP FIX: Share the same eventID with CAPI mirror so FB
    // counts ONE PageView (browser+server merged) instead of two.
    if (_isEventEnabled('pageview')) {
      if (pvEventId) fbq('track', 'PageView', {}, { eventID: pvEventId });
      else fbq('track', 'PageView');
    }
  }
  function _injectGa4(gaId) {
    if (!gaId || _hasGtag()) return;
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(gaId);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', gaId);
  }
  function _injectTikTok(ttId) {
    if (!ttId || _hasTtq()) return;
    !function (w, d, t) {
      w.TiktokAnalyticsObject = t; var ttq = w[t] = w[t] || [];
      ttq.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
      ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); }; };
      for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
      ttq.load = function (e, n) {
        var i = 'https://analytics.tiktok.com/i18n/pixel/events.js';
        ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = i;
        ttq._t = ttq._t || {}; ttq._t[e] = +new Date(); ttq._o = ttq._o || {}; ttq._o[e] = n || {};
        var o = document.createElement('script'); o.type = 'text/javascript'; o.async = !0; o.src = i + '?sdkid=' + e + '&lib=' + t;
        var a = document.getElementsByTagName('script')[0]; a.parentNode.insertBefore(o, a);
      };
      ttq.load(ttId); ttq.page();
    }(window, document, 'ttq');
  }
  function _injectSnap(snapId) {
    if (!snapId || _hasSnap()) return;
    (function (e, t, n) {
      if (e.snaptr) return; var a = e.snaptr = function () { a.handleRequest ? a.handleRequest.apply(a, arguments) : a.queue.push(arguments); };
      a.queue = []; var s = 'script'; var r = t.createElement(s); r.async = !0; r.src = 'https://sc-static.net/scevent.min.js';
      var u = t.getElementsByTagName(s)[0]; u.parentNode.insertBefore(r, u);
    })(window, document);
    snaptr('init', snapId); snaptr('track', 'PAGE_VIEW');
  }
  function _injectPinterest(pinId) {
    if (!pinId || _hasPin()) return;
    !function (e) {
      if (!window.pintrk) {
        window.pintrk = function () { window.pintrk.queue.push(Array.prototype.slice.call(arguments)); };
        var n = window.pintrk; n.queue = []; n.version = '3.0';
        var t = document.createElement('script'); t.async = !0; t.src = e;
        var r = document.getElementsByTagName('script')[0]; r.parentNode.insertBefore(t, r);
      }
    }('https://s.pinimg.com/ct/core.js');
    pintrk('load', pinId); pintrk('page');
  }

  // ===== INIT (with retry if storeInfo not loaded) =====
  var _initRetries = 0;
  var _initMaxRetries = 5;
  var _initQueue = [];
  function _flushInitQueue() {
    var q = _initQueue.slice();
    _initQueue = [];
    for (var i = 0; i < q.length; i++) {
      try { q[i](); } catch (e) {}
    }
  }

  // Normalize: accept multiple admin key formats
  function _pick() {
    for (var i = 0; i < arguments.length; i++) {
      var v = _storeInfo[arguments[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  function init(storeInfo) {
    if (_initialized && storeInfo) return;
    _storeInfo = storeInfo || _storeInfo || {};

    // Check if we have enough data to proceed
    var hasData = !!(_pick('fbPixel', 'FB Pixel', 'fb_pixel') ||
                     _pick('ga4Id', 'GA4', 'ga4') ||
                     _pick('tiktokPixel', 'TT Pixel', 'tt_pixel', 'tiktok_pixel'));
    if (!hasData && _initRetries < _initMaxRetries) {
      _initRetries++;
      setTimeout(function(){ init(); }, _initRetries * 1000);
      return;
    }
    if (!hasData) return; // give up after max retries
    if (_initialized) return;
    _initialized = true;

    // ✅ v14.0: Load toggle states FIRST (before any pixel inject), so disabled
    //   networks never even load their script tags. Saves bandwidth + DevTools clean.
    _loadToggles(_storeInfo);

    var fbPixelId   = _pick('fbPixel', 'FB Pixel', 'fb_pixel');
    var ga4Id       = _pick('ga4Id', 'GA4', 'ga4');
    var tiktokId    = _pick('tiktokPixel', 'TT Pixel', 'tt_pixel', 'tiktok_pixel');
    var snapId      = _pick('snapchatPixel', 'Snapchat Pixel', 'snap_pixel', 'snapchat_pixel');
    var pinId       = _pick('pinterestPixel', 'Pinterest Pixel', 'pinterest_pixel');
    if (fbPixelId) _storeInfo.fbPixel = fbPixelId; // keep cached id

    // Restore any cached advanced-matching from a previous session before pixel init
    var cachedAm = _getCachedUserMatch();
    // ✅ v15.75 P1-2: If no cached AM (first-ever visit), still seed Advanced
    //   Matching with hashed external_id so anonymous sessions are tied to a
    //   stable identity from event #1. Lifts entry-event EMQ from ~3 to ~5+.
    if (!cachedAm) {
      try {
        var extId = _getOrCreateExternalId();
        if (extId) {
          // Hash externally so we don't block the first paint on async crypto
          (async function(){
            try {
              var hashed = await _sha256(extId);
              if (hashed && _hasFbq() && _storeInfo && _storeInfo.fbPixel) {
                fbq('init', _storeInfo.fbPixel, { external_id: hashed });
              }
            } catch(_e){}
          })();
        }
      } catch (_e) {}
    }

    // --- Auto-inject pixels from admin settings ---
    // ✅ v14.0: Each network injection now respects its master toggle.
    //   When toggle=OFF, the script never loads at all (clean DevTools, no requests).
    // ✅ v15.45 DEDUP: Generate the PageView eventID up-front so both
    //   browser fbq AND CAPI mirror use the same ID → FB merges into one.
    var pvEventId = _genEventId('pv');
    if (fbPixelId  && _isNetworkEnabled('fb'))        _injectFbPixel(fbPixelId, cachedAm, pvEventId);
    if (ga4Id      && _isNetworkEnabled('ga4'))       _injectGa4(ga4Id);
    if (tiktokId   && _isNetworkEnabled('tiktok'))    _injectTikTok(tiktokId);
    if (snapId     && _isNetworkEnabled('snap'))      _injectSnap(snapId);
    if (pinId      && _isNetworkEnabled('pinterest')) _injectPinterest(pinId);

    // ✅ v11.7: Enrich first PageView with advanced matching when prior session has identity.
    // This re-fires PageView server-side with hashed user_data so the visit is attributed.
    // ✅ v15.7 FIX: Always send server-side PageView (not just when prior identity exists).
    // This guarantees attribution even if the user closes the tab before browser fbq loads.
    try {
      // Server-side PageView — fires once per session, ensures attribution
      // even on slow networks where browser fbq might not load before bounce.
      if (_isEventEnabled('pageview') && !sessionStorage.getItem('yarz_pv_capi_fired')) {
        sessionStorage.setItem('yarz_pv_capi_fired', '1');
        // ✅ v15.45: Same pvEventId as browser fbq — true CAPI dedup
        _sendCapiMirror('PageView', pvEventId, {
          content_name: document.title || '',
          source_url: window.location.href
        });
      }
      // Also enrich with cached identity from prior session if available
      var cachedRaw = localStorage.getItem('yarz_user');
      if (cachedRaw) {
        // ✅ v17.15: Unwrap TTL envelope ({v, t}) if present, fall back to raw.
        var u = JSON.parse(cachedRaw) || {};
        if (u && typeof u === 'object' && 'v' in u && 't' in u) u = u.v || {};
        if (u && (u.email || u.phone || u.name)) {
          _setUserData(u); // re-inits FB pixel with AM, no duplicate PageView
        }
      }
    } catch (e) {}

    // ✅ v11.8: Pro-grade engagement tracking — tells FB/TikTok/GA4 EXACTLY how
    // engaged each visitor was. Replaces the old fire-and-forget timed events.
    //   • TimeOnSite milestones: 15s, 30s, 60s, 120s, 180s, 300s — each fires
    //     ONLY if the tab was actually visible/active during that window
    //     (background tab idle time is excluded — accurate "real" engagement).
    //   • ScrollDepth milestones: 25%, 50%, 75%, 100% — fires when the user
    //     actually scrolls that far down the page.
    //   • EngagedSession: fires once a visitor crosses 30s active + 50% scroll
    //     OR has clicked anything — this is the "real customer" quality signal.
    //   • SessionEnd: fires on tab close with the FINAL active duration so FB
    //     can score session quality even if all milestones haven't fired.
    //   • Bounce signal: if user leaves before 15s with no interaction → no
    //     positive engagement event fires (lets FB downrank these profiles).
    if (fbPixelId) _initEngagementTracking();
  }

  // ===== ENGAGEMENT TRACKING (active time + scroll depth) =====
  function _initEngagementTracking() {
    var activeMs = 0;
    var lastTick = Date.now();
    var visible = (document.visibilityState !== 'hidden');
    var hasInteracted = false;
    var firedTimeMilestones = {};
    var firedScrollMilestones = {};
    var engagedFired = false;
    var maxScrollPct = 0;
    var sessionEnded = false;

    // Stop counting active time when the tab is backgrounded — this is what
    // makes the "active seconds" count accurate (vs raw wall-clock time which
    // would include 10 minutes of idle minimized tabs).
    function tick() {
      var now = Date.now();
      if (visible) activeMs += (now - lastTick);
      lastTick = now;
    }
    document.addEventListener('visibilitychange', function () {
      tick();
      visible = (document.visibilityState !== 'hidden');
    });

    // Mark ANY interaction (click / scroll / key) — separates real visitors
    // from bots and accidental clicks
    function markInteract() { hasInteracted = true; }
    ['click', 'keydown', 'touchstart'].forEach(function (ev) {
      window.addEventListener(ev, markInteract, { passive: true, once: false });
    });

    // ---- Time-on-site milestones (active seconds, not wall clock) ----
    var TIME_MILESTONES = [15, 30, 60, 120, 180, 300]; // seconds
    function _fireTimeMilestone(seconds) {
      // ✅ v14.0: Per-milestone toggle (e.g., user can disable just 15s but keep 30s+)
      if (!_isEventEnabled('time_on_site_' + seconds + 's')) return;
      if (firedTimeMilestones[seconds]) return;
      firedTimeMilestones[seconds] = true;
      var eventId = _genEventId('tos' + seconds);
      var data = {
        active_seconds: seconds,
        max_scroll_pct: maxScrollPct,
        page_path: location.pathname || '/',
        currency: 'BDT'
      };
      // FB custom event — usable as Custom Audience trigger
      // ("People who spent 60s+ on site" → high-intent retargeting pool)
      if (_hasFbq()) {
        try { fbq('trackCustom', 'TimeOnSite_' + seconds + 's', data, { eventID: eventId }); } catch (e) {}
      }
      // TikTok counterpart
      if (_hasTtq()) {
        try { ttq.track('ViewContent', { content_id: 'engagement_' + seconds + 's', content_name: 'TimeOnSite_' + seconds + 's' }, { event_id: eventId }); } catch (e) {}
      }
      // GA4 standard engaged_view
      if (_hasGtag()) {
        try { gtag('event', 'user_engagement', { engagement_time_msec: seconds * 1000 }); } catch (e) {}
      }
      // ✅ v11.8: CAPI mirror — recovers iOS-blocked engagement signal
      _sendCapiMirror('TimeOnSite_' + seconds + 's', eventId, data);
    }

    // Poll every second, fire milestones when active time crosses each threshold
    setInterval(function () {
      tick();
      var seconds = Math.floor(activeMs / 1000);
      TIME_MILESTONES.forEach(function (m) {
        if (seconds >= m) _fireTimeMilestone(m);
      });
      _maybeFireEngagedSession(seconds);
    }, 1000);

    // ---- Scroll depth milestones ----
    var SCROLL_MILESTONES = [25, 50, 75, 100]; // percent
    function _calcScrollPct() {
      var doc = document.documentElement;
      var body = document.body;
      var scrollTop = window.pageYOffset || doc.scrollTop || body.scrollTop || 0;
      var scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight) - window.innerHeight;
      if (scrollHeight <= 0) return 100; // page fits in viewport
      return Math.min(100, Math.round((scrollTop / scrollHeight) * 100));
    }
    function _onScroll() {
      markInteract();
      var pct = _calcScrollPct();
      if (pct > maxScrollPct) maxScrollPct = pct;
      SCROLL_MILESTONES.forEach(function (m) {
        if (maxScrollPct >= m && !firedScrollMilestones[m]) {
          // ✅ v14.0: Per-depth toggle (admin can disable just 25% but keep 50%+)
          if (!_isEventEnabled('scroll_depth_' + m)) return;
          firedScrollMilestones[m] = true;
          var eventId = _genEventId('sd' + m);
          var data = { scroll_depth: m, page_path: location.pathname || '/', currency: 'BDT' };
          if (_hasFbq()) try { fbq('trackCustom', 'ScrollDepth_' + m, data, { eventID: eventId }); } catch (e) {}
          if (_hasGtag()) try { gtag('event', 'scroll', { percent_scrolled: m }); } catch (e) {}
          _sendCapiMirror('ScrollDepth_' + m, eventId, data);
        }
      });
      _maybeFireEngagedSession(Math.floor(activeMs / 1000));
    }
    window.addEventListener('scroll', _onScroll, { passive: true });

    // ---- EngagedSession (single high-quality signal) ----
    // Fires ONCE when visitor proves they're real:
    //   30+ active seconds AND 50%+ scroll OR any genuine interaction
    function _maybeFireEngagedSession(seconds) {
      if (!_isEventEnabled('engaged_session')) return;  // ✅ v14.0 toggle gate
      if (engagedFired) return;
      var qualified = (seconds >= 30 && (maxScrollPct >= 50 || hasInteracted));
      if (!qualified) return;
      engagedFired = true;
      var eventId = _genEventId('engaged');
      var data = {
        active_seconds: seconds,
        max_scroll_pct: maxScrollPct,
        interacted: hasInteracted,
        page_path: location.pathname || '/',
        currency: 'BDT'
      };
      // ✅ This is the GOLDEN signal — use as Custom Audience source for
      // FB/TikTok Lookalike. "People who actually engaged with my site."
      if (_hasFbq()) try { fbq('trackCustom', 'EngagedSession', data, { eventID: eventId }); } catch (e) {}
      if (_hasTtq()) try { ttq.track('ViewContent', { content_id: 'engaged_session', content_name: 'EngagedSession' }, { event_id: eventId }); } catch (e) {}
      if (_hasGtag()) try { gtag('event', 'engaged_session', data); } catch (e) {}
      _sendCapiMirror('EngagedSession', eventId, data);
    }

    // ---- SessionEnd: fires final stats on tab close / navigate away ----
    function _fireSessionEnd() {
      if (!_isEventEnabled('session_end')) return;  // ✅ v14.0 toggle gate
      if (sessionEnded) return;
      sessionEnded = true;
      tick();
      var seconds = Math.floor(activeMs / 1000);
      var eventId = _genEventId('send');
      var data = {
        active_seconds: seconds,
        max_scroll_pct: maxScrollPct,
        interacted: hasInteracted,
        bounced: (seconds < 10 && !hasInteracted), // <10s + no click = bounce
        page_path: location.pathname || '/',
        currency: 'BDT'
      };
      // Browser pixel may not flush in time on close — CAPI via Beacon WILL flush.
      if (_hasFbq()) try { fbq('trackCustom', 'SessionEnd', data, { eventID: eventId }); } catch (e) {}
      _sendCapiMirror('SessionEnd', eventId, data);
    }
    window.addEventListener('pagehide', _fireSessionEnd);
    // Fallback for browsers that don't fire pagehide reliably
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        // Only fire SessionEnd on actual close — small delay to avoid firing on
        // tab-switch where user comes right back
        setTimeout(function () {
          if (document.visibilityState === 'hidden') _fireSessionEnd();
        }, 5000);
      }
    });
  }

  return {
    init: init,
    setUserData: _setUserData,
    viewContent: viewContent,
    addToCart: addToCart,
    initiateCheckout: initiateCheckout,
    addPaymentInfo: addPaymentInfo,
    purchase: purchase,
    addToWishlist: addToWishlist,
    search: search,
    lead: lead,
    trackCustom: trackCustom,
    whatsAppClick: whatsAppClick,
    timeOnPage: timeOnPage,
    sizeSelected: sizeSelected,
    // ✅ v14.0: Expose toggle inspection helpers for admin panel diagnostics
    isEventEnabled: _isEventEnabled,
    isNetworkEnabled: _isNetworkEnabled,
    getToggles: function () { return JSON.parse(JSON.stringify(_toggles)); },
    LOCKED_EVENTS: LOCKED_EVENTS.slice()
  };
})();
