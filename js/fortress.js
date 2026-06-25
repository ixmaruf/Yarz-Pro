/* ============================================================
   YARZ FORTRESS — Anti-Fraud Device Fingerprint + Scoring v1.0
   ✅ Primary block lever: device_id (not phone, not IP)
   ✅ 13 risk signals → 0-100 score
   ✅ local-first blocklist (works offline)
   ✅ Shadow ban: fake success for blocked devices
   ✅ Server-side blocklist via GAS (cross-device)
   ✅ Pairs with shield.js (behavior) — does NOT replace it
   ============================================================ */
const YARZ_FORTRESS = (() => {
  'use strict';

  // ===== CONFIG =====
  const CFG = {
    VERSION: '1.0',
    SOFT_BLOCK_THRESHOLD: 70,
    HARD_BLOCK_THRESHOLD: 90,
    TELEGRAM_ALERT_THRESHOLD: 70,

    MAX_ORDERS_PER_DEVICE_5MIN: 2,
    MAX_ORDERS_PER_DEVICE_1H:   4,
    MAX_ORDERS_PER_DEVICE_24H:  5,
    BURST_WINDOW_MS:            60_000,   // 1 min
    BURST_THRESHOLD:            3,        // 3 orders in 1 min = attack

    MIN_FORM_TIME_MS: 2500,

    PHONE_VELOCITY_24H:    10,           // same hashed phone in 24h
    PHONE_MISMATCH_1H:     3,            // same device, N phones in 1h
    ADDRESS_SIMILARITY_24H: 3,           // same landmark on same device

    KEYS: {
      BLOCKLIST:  'yarz_fortress_blocked',
      EVENTS:     'yarz_fortress_events',
      SALT:       'yarz_fortress_salt',
      DEVICE:     'yarz_fortress_device',
      PROFILE:    'yarz_fortress_profile',
    },
  };

  // ===== MODULE STATE =====
  let _initialized = false;
  let _deviceId = null;
  let _profile = null;
  let _salt = null;
  let _localBlocklist = null;   // Set<deviceId> — fast lookup
  let _eventLog = [];           // rolling 24h
  let _serverBlocklist = null;  // Set<deviceId> synced from server

  // ===== LOCALSTORAGE HELPERS (mirror app.js pattern, no deps) =====
  function _readLS(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function _writeLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function _readLSValidate(key, fallback, validator) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var parsed = JSON.parse(raw);
      if (validator && !validator(parsed)) return fallback;
      return parsed;
    } catch (e) { return fallback; }
  }

  // ===== HASH HELPERS =====
  function _fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  function _hashPhone(phone) {
    if (!phone) return '';
    var norm = String(phone).replace(/\D/g, '');
    if (!_salt) _salt = _readLS(CFG.KEYS.SALT, null) || _initSalt();
    return 'ph_' + _fnv1a(norm + _salt);
  }
  function _initSalt() {
    var s = '';
    try {
      var a = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(a);
      s = Array.from(a, function(b){ return b.toString(16).padStart(2,'0'); }).join('');
    } catch (e) {
      s = Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
    _writeLS(CFG.KEYS.SALT, s);
    _salt = s;
    return s;
  }
  function _randHex(n) {
    var s = '';
    while (s.length < n) s += Math.random().toString(16).slice(2);
    return s.slice(0, n);
  }

  // ===== DEVICE FINGERPRINT =====
  function _captureDeviceFingerprint() {
    try {
      var n = navigator || {};
      var s = screen || {};
      var tz = (Intl && Intl.DateTimeFormat) ?
        Intl.DateTimeFormat().resolvedOptions().timeZone || '' : '';
      var lang = (n.languages && n.languages[0]) || n.language || '';
      var conn = n.connection || n.mozConnection || n.webkitConnection || {};

      // Canvas hash (entropy-rich in modern browsers, weak in headless)
      var canvasHash = 'n/a';
      try {
        var c = document.createElement('canvas');
        c.width = 240; c.height = 60;
        var ctx = c.getContext('2d');
        if (ctx) {
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillStyle = '#f60';
          ctx.fillRect(0, 0, 100, 30);
          ctx.fillStyle = '#069';
          ctx.fillText('YARZ-fp-' + (Date.now()%100000), 4, 8);
          canvasHash = _fnv1a(c.toDataURL());
        }
      } catch (e) { /* canvas blocked */ }

      // WebGL renderer
      var webglRenderer = 'unknown';
      var webglVendor = 'unknown';
      try {
        var gl = document.createElement('canvas').getContext('webgl') ||
                  document.createElement('canvas').getContext('experimental-webgl');
        if (gl) {
          var ext = gl.getExtension('WEBGL_debug_renderer_info');
          if (ext) {
            webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
            webglVendor   = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   || 'unknown';
          }
        }
      } catch (e) { /* webgl blocked */ }

      var raw = [
        n.userAgent || '',
        n.platform || '',
        s.width + 'x' + s.height,
        s.colorDepth || '',
        (window.devicePixelRatio || 1),
        n.hardwareConcurrency || '',
        n.deviceMemory || '',
        (n.maxTouchPoints || 0),
        tz,
        lang,
        canvasHash,
        webglRenderer
      ].join('|');

      var deviceId = 'd_' + _fnv1a(raw) + _fnv1a(raw + _salt);

      // Device name (UA-parsed) — best-effort
      var ua = n.userAgent || '';
      var deviceName = 'Unknown';
      // Samsung (most common in BD) — Galaxy A/M/S/Note/Z series
      if (/SM-[A-Z]\d+/i.test(ua))       deviceName = 'Samsung ' + (ua.match(/SM-[A-Z]\d+[A-Z]*/i) || [])[0];
      else if (/SAMSUNG/i.test(ua))      deviceName = 'Samsung Device';
      // Apple
      else if (/iPhone/i.test(ua))       deviceName = 'iPhone';
      else if (/iPad/i.test(ua))         deviceName = 'iPad';
      // Xiaomi / Redmi / POCO
      else if (/Redmi/i.test(ua))        deviceName = 'Redmi ' + (ua.match(/Redmi[\s_]?(\S+)/i) || [,''])[1];
      else if (/POCO/i.test(ua))         deviceName = 'POCO ' + (ua.match(/POCO[\s_]?(\S+)/i) || [,''])[1];
      else if (/Mi\s?\d/i.test(ua))      deviceName = 'Xiaomi ' + (ua.match(/Mi[\s_]?(\d\S*)/i) || [,''])[1];
      else if (/M200[67]\w+/i.test(ua))  deviceName = 'Redmi ' + (ua.match(/M200[67]\w+/i) || [])[0];
      // Realme
      else if (/RMX\d+/i.test(ua))       deviceName = 'Realme ' + (ua.match(/RMX\d+/i) || [])[0];
      // Oppo
      else if (/CPH\d+/i.test(ua))       deviceName = 'Oppo ' + (ua.match(/CPH\d+/i) || [])[0];
      // Vivo
      else if (/V\d{4}\b/i.test(ua))     deviceName = 'Vivo ' + (ua.match(/V\d{4}\w*/i) || [])[0];
      else if (/vivo/i.test(ua))         deviceName = 'Vivo ' + (ua.match(/vivo[\s_]?(\S+)/i) || [,''])[1];
      // Tecno
      else if (/TECNO/i.test(ua))        deviceName = 'Tecno ' + (ua.match(/TECNO[\s_]?(\S+)/i) || [,''])[1];
      // Infinix
      else if (/Infinix/i.test(ua))      deviceName = 'Infinix ' + (ua.match(/Infinix[\s_]?(\S+)/i) || [,''])[1];
      // Huawei / Honor
      else if (/HUAWEI/i.test(ua))       deviceName = 'Huawei ' + (ua.match(/HUAWEI[\s_]?(\S+)/i) || [,''])[1];
      else if (/Honor/i.test(ua))        deviceName = 'Honor ' + (ua.match(/Honor[\s_]?(\S+)/i) || [,''])[1];
      // Nokia
      else if (/Nokia/i.test(ua))        deviceName = 'Nokia ' + (ua.match(/Nokia[\s_]?(\S+)/i) || [,''])[1];
      // OnePlus
      else if (/OnePlus/i.test(ua))      deviceName = 'OnePlus ' + (ua.match(/OnePlus[\s_]?(\S+)/i) || [,''])[1];
      // Google Pixel
      else if (/Pixel/i.test(ua))        deviceName = 'Google Pixel ' + (ua.match(/Pixel[\s_]?(\S+)/i) || [,''])[1];
      // Motorola
      else if (/moto/i.test(ua))         deviceName = 'Motorola ' + (ua.match(/moto[\s_]?(\S+)/i) || [,''])[1];
      // Desktop / Laptop
      else if (/Windows NT 10/i.test(ua)) deviceName = 'Windows 10/11 PC';
      else if (/Windows NT/i.test(ua))   deviceName = 'Windows PC';
      else if (/Macintosh|Mac OS X/i.test(ua)) deviceName = 'Mac';
      else if (/CrOS/i.test(ua))         deviceName = 'Chromebook';
      else if (/Linux/i.test(ua) && !/Android/i.test(ua)) deviceName = 'Linux PC';
      // Generic Android
      else if (/Android/i.test(ua))      deviceName = 'Android Device';

      return {
        deviceId: deviceId,
        deviceName: deviceName,
        os: (n.platform || 'unknown') + ' / ' + (n.userAgent.match(/(Android|iPhone OS|Mac OS X|Windows NT|Linux) ?[\d._]+/) || ['unknown'])[0],
        browser: (function(){
          if (/Edg\//i.test(ua))     return 'Edge ' + (ua.match(/Edg\/([\d.]+)/) || [,'?'])[1];
          if (/Chrome\//i.test(ua))  return 'Chrome ' + (ua.match(/Chrome\/([\d.]+)/) || [,'?'])[1];
          if (/Firefox\//i.test(ua)) return 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/) || [,'?'])[1];
          if (/Safari\//i.test(ua))  return 'Safari ' + (ua.match(/Version\/([\d.]+)/) || [,'?'])[1];
          return 'Unknown';
        })(),
        screen: s.width + 'x' + s.height + ' @' + (window.devicePixelRatio || 1) + 'x',
        hwCores: n.hardwareConcurrency || 0,
        deviceMemoryGb: n.deviceMemory || 0,
        pixelRatio: window.devicePixelRatio || 1,
        canvasHash: canvasHash,
        webglRenderer: webglRenderer,
        webglVendor: webglVendor,
        timezone: tz,
        timezoneOffset: new Date().getTimezoneOffset(),
        language: lang,
        networkType: conn.effectiveType || conn.type || 'unknown',
        firstSeenAt: new Date().toISOString(),
      };
    } catch (e) {
      // Catastrophic failure — fall back to a stable random ID
      return {
        deviceId: 'd_fallback_' + _randHex(12),
        deviceName: 'Unknown (fp-failed)',
        os: 'unknown', browser: 'unknown', screen: 'unknown',
        hwCores: 0, deviceMemoryGb: 0, pixelRatio: 1,
        canvasHash: 'n/a', webglRenderer: 'unknown', webglVendor: 'unknown',
        timezone: '', timezoneOffset: 0, language: '',
        networkType: 'unknown', firstSeenAt: new Date().toISOString(),
      };
    }
  }

  // ===== EVENT LOG (rolling 24h, capped 200) =====
  function _loadEventLog() {
    var data = _readLSValidate(CFG.KEYS.EVENTS, [], function(v){ return Array.isArray(v); });
    var cutoff = Date.now() - 24 * 60 * 60 * 1000;
    var filtered = data.filter(function(e){ return e && e.ts && e.ts >= cutoff; });
    if (filtered.length !== data.length) _writeLS(CFG.KEYS.EVENTS, filtered);
    return filtered;
  }
  function _recordEvent(type, extra) {
    if (!_eventLog.length) _eventLog = _loadEventLog();
    var ev = Object.assign({
      ts: Date.now(),
      type: type,
      deviceId: _deviceId,
    }, extra || {});
    _eventLog.push(ev);
    if (_eventLog.length > 200) _eventLog = _eventLog.slice(-200);
    _writeLS(CFG.KEYS.EVENTS, _eventLog);
    return ev;
  }

  // ===== BLOCKLIST =====
  function _loadLocalBlocklist() {
    var data = _readLSValidate(CFG.KEYS.BLOCKLIST, [], function(v){ return Array.isArray(v); });
    return new Set(data);
  }
  function _saveLocalBlocklist() {
    _writeLS(CFG.KEYS.BLOCKLIST, Array.from(_localBlocklist));
  }
  function _isLocallyBlocked(id) {
    if (!_localBlocklist) _localBlocklist = _loadLocalBlocklist();
    return _localBlocklist.has(id);
  }
  function _isServerBlocked(id) {
    return _serverBlocklist && _serverBlocklist.has(id);
  }
  function isBlocked(id) {
    id = id || _deviceId;
    return _isLocallyBlocked(id) || _isServerBlocked(id);
  }

  // ===== SIGNAL FUNCTIONS (each returns 0-100 contribution) =====
  function _signalDeviceVelocity() {
    if (!_eventLog.length) _eventLog = _loadEventLog();
    var now = Date.now();
    var c5 = 0, c1h = 0, c24 = 0;
    for (var i = 0; i < _eventLog.length; i++) {
      var e = _eventLog[i];
      if (e.type !== 'order_attempt') continue;
      var age = now - e.ts;
      if (age < 5*60*1000) c5++;
      if (age < 60*60*1000) c1h++;
      if (age < 24*60*60*1000) c24++;
    }
    // Burst: 3+ in 1 min = instant
    var c1min = 0;
    for (var j = 0; j < _eventLog.length; j++) {
      var e2 = _eventLog[j];
      if (e2.type === 'order_attempt' && (now - e2.ts) < CFG.BURST_WINDOW_MS) c1min++;
    }
    if (c1min >= CFG.BURST_THRESHOLD) return 95;
    if (c5 > CFG.MAX_ORDERS_PER_DEVICE_5MIN) return 70;
    if (c1h > CFG.MAX_ORDERS_PER_DEVICE_1H) return 50;
    if (c24 > CFG.MAX_ORDERS_PER_DEVICE_24H) return 30;
    return 0;
  }

  function _signalPhoneVelocity(phone) {
    if (!phone) return 0;
    var ph = _hashPhone(phone);
    var now = Date.now();
    var c = 0;
    if (!_eventLog.length) _eventLog = _loadEventLog();
    for (var i = 0; i < _eventLog.length; i++) {
      var e = _eventLog[i];
      if (e.type === 'order_attempt' && e.phoneHash === ph && (now - e.ts) < 24*60*60*1000) c++;
    }
    if (c > CFG.PHONE_VELOCITY_24H) return 60;
    if (c > 5) return 25;
    return 0;
  }

  function _signalPhoneMismatch(phone) {
    if (!phone) return 0;
    var ph = _hashPhone(phone);
    if (!_eventLog.length) _eventLog = _loadEventLog();
    var now = Date.now();
    var phones = {};
    for (var i = 0; i < _eventLog.length; i++) {
      var e = _eventLog[i];
      if (e.type === 'order_attempt' && e.phoneHash && (now - e.ts) < 60*60*1000) {
        phones[e.phoneHash] = (phones[e.phoneHash] || 0) + 1;
      }
    }
    var distinct = Object.keys(phones).length;
    if (distinct >= CFG.PHONE_MISMATCH_1H) return 60;
    if (distinct >= 2) return 20;
    return 0;
  }

  function _signalAddressShape(address) {
    if (!address) return 30;
    var a = String(address).trim();
    var words = a.split(/\s+/).filter(Boolean);
    if (words.length < 3) return 30;
    // Gibberish: no vowels
    var hasVowel = /[aeiouAEIOUঅ-ৌ]/.test(a);
    if (!hasVowel && a.length > 12) return 40;
    // "test" / "fake" / "asdf"
    if (/\b(test|fake|asdf|qwerty|xxx)\b/i.test(a)) return 50;
    return 0;
  }

  function _signalAddressSimilarity(phone, address) {
    if (!address) return 0;
    if (!_eventLog.length) _eventLog = _loadEventLog();
    var now = Date.now();
    var norm = String(address).toLowerCase().replace(/[^a-z0-9অ-ৌ]+/g,' ').trim();
    var first12 = norm.split(' ').slice(0,3).join(' ');
    var c = 0;
    for (var i = 0; i < _eventLog.length; i++) {
      var e = _eventLog[i];
      if (e.type === 'order_attempt' && e.addressSig && (now - e.ts) < 24*60*60*1000) {
        if (e.addressSig === first12) c++;
      }
    }
    if (c >= CFG.ADDRESS_SIMILARITY_24H) return 35;
    if (c >= 2) return 15;
    return 0;
  }

  function _signalFormTiming(formOpenTime) {
    if (!formOpenTime) return 0;
    var elapsed = Date.now() - formOpenTime;
    if (elapsed < 1500) return 50;      // sub-1.5s = bot
    if (elapsed < CFG.MIN_FORM_TIME_MS) return 25;
    return 0;
  }

  function _signalUA() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (/(headless|phantom|puppeteer|playwright|curl|python-requests|node-fetch|wget|httpie)/.test(ua)) return 95;
    if (!ua) return 30;
    return 0;
  }

  function _signalWebGL() {
    if (!_profile) return 0;
    var r = String(_profile.webglRenderer || '').toLowerCase();
    if (/swiftshader|llvmpipe|software/.test(r)) return 50;
    if (/google inc\. \(google\)/.test(r)) return 40;
    return 0;
  }

  function _signalTimezone() {
    if (!_profile) return 0;
    var tz = _profile.timezone || '';
    if (!tz) return 10;
    if (tz !== 'Asia/Dhaka' && tz.indexOf('Dhaka') === -1) return 20;
    return 0;
  }

  function _signalCanvasTamper() {
    if (!_profile) return 0;
    if (_profile.canvasHash === 'n/a') return 15;  // canvas blocked = suspicious
    return 0;
  }

  function _signalTimeOfDay() {
    var h = new Date().getHours();
    // 2-5 AM BDT = unusual for real buyers
    if (h >= 2 && h < 5) return 15;
    return 0;
  }

  function _signalIsLocalBlocked() {
    if (_isLocallyBlocked(_deviceId)) return 100;  // instant hard block
    return 0;
  }

  function _signalIsServerBlocked() {
    if (_isServerBlocked(_deviceId)) return 100;   // instant hard block
    return 0;
  }

  // ===== SCORE ORDER =====
  function scoreOrder(orderData) {
    if (!_initialized) init();
    orderData = orderData || {};
    var name = orderData.name || '';
    var phone = orderData.phone || '';
    var address = orderData.address || '';
    var formOpenTime = orderData._formOpenTime || 0;

    // First, record this attempt (for velocity signals)
    var ph = _hashPhone(phone);
    var addrSig = String(address).toLowerCase().replace(/[^a-z0-9অ-ৌ]+/g,' ').trim().split(' ').slice(0,3).join(' ');
    _recordEvent('order_attempt', { phoneHash: ph, addressSig: addrSig, name: name });

    // Compute all signals
    var signals = [
      ['local_blocked',  _signalIsLocalBlocked()],
      ['server_blocked', _signalIsServerBlocked()],
      ['burst',          _signalDeviceVelocity()],
      ['phone_velocity', _signalPhoneVelocity(phone)],
      ['phone_mismatch', _signalPhoneMismatch(phone)],
      ['address_shape',  _signalAddressShape(address)],
      ['address_sim',    _signalAddressSimilarity(phone, address)],
      ['form_too_fast',  _signalFormTiming(formOpenTime)],
      ['ua_suspicious',  _signalUA()],
      ['webgl_bot',      _signalWebGL()],
      ['timezone',       _signalTimezone()],
      ['canvas_blocked', _signalCanvasTamper()],
      ['time_of_day',    _signalTimeOfDay()],
    ];

    var total = 0;
    for (var i = 0; i < signals.length; i++) total += signals[i][1];

    // Hard-block override: any signal at 100 → hard block
    var action = 'allow';
    var reason = '';
    if (total >= CFG.HARD_BLOCK_THRESHOLD) {
      action = 'hard';
      reason = 'fortress_hard_block';
    } else if (total >= CFG.SOFT_BLOCK_THRESHOLD) {
      action = 'soft';
      reason = 'fortress_soft_flag';
    } else {
      action = 'allow';
      reason = 'ok';
    }

    _recordEvent('score', { total: total, action: action, phoneHash: ph });

    return {
      score: total,
      action: action,
      reason: reason,
      deviceId: _deviceId,
      signals: signals,
      silent: action === 'hard'  // silent = show fake success
    };
  }

  // ===== ADMIN-FACING BLOCK/UNBLOCK =====
  function blockDevice(deviceId, opts) {
    opts = opts || {};
    deviceId = deviceId || _deviceId;
    if (!_localBlocklist) _localBlocklist = _loadLocalBlocklist();
    _localBlocklist.add(deviceId);
    _saveLocalBlocklist();
    _recordEvent('local_block', { target: deviceId, reason: opts.reason || 'admin_manual' });
    return { ok: true, deviceId: deviceId };
  }

  function unblockDevice(deviceId) {
    deviceId = deviceId || _deviceId;
    if (!_localBlocklist) _localBlocklist = _loadLocalBlocklist();
    _localBlocklist.delete(deviceId);
    _saveLocalBlocklist();
    _recordEvent('local_unblock', { target: deviceId });
    return { ok: true, deviceId: deviceId };
  }

  function clearAllLocalBlocks() {
    _localBlocklist = new Set();
    _saveLocalBlocklist();
    _recordEvent('local_clear_all', {});
    return { ok: true };
  }

  // ===== SERVER SYNC (best-effort, with timeout + retry) =====
  var _syncFailed = false;
  var _syncRetries = 0;
  var _syncMaxRetries = 2;
  function _syncFromServer() {
    if (_syncFailed) return;
    if (!window.YARZ_API) return;
    try {
      var baseUrl = (typeof window.YARZ_API.getReadUrl === 'function') ? window.YARZ_API.getReadUrl() : '';
      if (!baseUrl) return;
      var url = baseUrl + '?action=__fortress_public_blocklist';
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var opts = { method: 'GET' };
      if (ctl) { opts.signal = ctl.signal; setTimeout(function(){ try { ctl.abort(); } catch(e){} }, 5000); }
      fetch(url, opts)
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(data){
          if (data && Array.isArray(data.devices)) {
            _serverBlocklist = new Set(data.devices);
            _syncRetries = 0;
          } else {
            throw new Error('unexpected response');
          }
        }).catch(function(){
          _syncRetries++;
          if (_syncRetries <= _syncMaxRetries) {
            setTimeout(_syncFromServer, _syncRetries * 3000);
          } else {
            _syncFailed = true;
          }
        });
    } catch (e) { _syncFailed = true; }
  }

  // ===== ADMIN-FACING READ API =====
  function getDeviceProfile() {
    return _profile;
  }
  function getEventLog() {
    if (!_eventLog.length) _eventLog = _loadEventLog();
    return _eventLog.slice();
  }
  function getLocalBlocklist() {
    if (!_localBlocklist) _localBlocklist = _loadLocalBlocklist();
    return Array.from(_localBlocklist);
  }
  function getDeviceId() {
    return _deviceId;
  }

  // ===== INIT =====
  function init() {
    if (_initialized) return;
    _initialized = true;
    try {
      _salt = _readLS(CFG.KEYS.SALT, null);
      if (!_salt) _initSalt();
      // Reuse device_id if fingerprint is stable enough
      _deviceId = _readLS(CFG.KEYS.DEVICE, null);
      _profile = _captureDeviceFingerprint();
      if (!_deviceId) {
        _deviceId = _profile.deviceId;
        _writeLS(CFG.KEYS.DEVICE, _deviceId);
      }
      _writeLS(CFG.KEYS.PROFILE, _profile);
      _localBlocklist = _loadLocalBlocklist();
      _eventLog = _loadEventLog();
      _syncFromServer();
      if (typeof console !== 'undefined' && console.log) {
        //console.log('YARZ Fortress: device ' + _deviceId.slice(0,12) + '… active');
      }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('YARZ Fortress init failed:', e);
      }
    }
  }

  // ===== PUBLIC API =====
  var publicApi = {
    init: init,
    scoreOrder: scoreOrder,
    isBlocked: isBlocked,
    blockDevice: blockDevice,
    unblockDevice: unblockDevice,
    clearAllLocalBlocks: clearAllLocalBlocks,
    getDeviceId: getDeviceId,
    getDeviceProfile: getDeviceProfile,
    getEventLog: getEventLog,
    getLocalBlocklist: getLocalBlocklist,
    getCFG: function(){ return JSON.parse(JSON.stringify(CFG)); },
  };

  // Auto-init when script loads
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  return publicApi;
})();

window.YARZ_FORTRESS = YARZ_FORTRESS;
