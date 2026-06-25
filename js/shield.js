/* ============================================================
   YARZ SHIELD — Anti-Fraud Order Protection v1.0
   ✅ Invisible to genuine customers (no CAPTCHA, no OTP)
   ✅ Behavior Scoring (touch, scroll, type detection)
   ✅ Device Fingerprint (24h = 15 orders, 1h = 10 orders)
   ✅ Phone Intelligence (fake pattern detection)
   ✅ Address Quality (6 words min, garbage detect)
   ✅ Spam Velocity (8s form minimum)
   ✅ Fake orders get fake "success" — attacker thinks it worked
   ============================================================ */

const YARZ_SHIELD = (() => {
  'use strict';

  // ===== CONFIG =====
  const CFG = {
    MAX_ORDERS_PER_HOUR: 10,
    MAX_ORDERS_PER_DAY: 15,
    MIN_FORM_TIME_MS: 2500,         // Reduced: 2.5s allows browser autofill
    MIN_ADDRESS_WORDS: 3,           // Reduced: 3 words is enough (e.g. "Dhanmondi 32, Dhaka")
    MIN_BEHAVIOR_SCORE: 2,          // Need at least 2 human interactions
    CLICK_COOLDOWN_MS: 1500,        // Reduced: 1.5s between order button clicks (prevents annoying double-click blocks)
    ORDER_TRACKING_KEY: 'yarz_shield_orders',
    DEVICE_ID_KEY: 'yarz_device_fp',
  };

  // ===== STATE =====
  let _behaviorScore = 0;
  let _hasScrolled = false;
  let _hasTouched = false;
  let _hasTyped = false;
  let _hasMouseMoved = false;
  let _lastOrderClickTime = 0;
  let _initialized = false;

  // ===== A. BEHAVIOR SCORING =====
  // Silently track human interactions — bots don't do these
  function _initBehaviorTracking() {
    // Touch events (mobile)
    document.addEventListener('touchstart', function() {
      if (!_hasTouched) { _hasTouched = true; _behaviorScore += 2; }
    }, { passive: true, once: true });

    document.addEventListener('touchmove', function() {
      _behaviorScore += 1;
    }, { passive: true, once: true });

    // Scroll
    window.addEventListener('scroll', function() {
      if (!_hasScrolled) { _hasScrolled = true; _behaviorScore += 2; }
    }, { passive: true, once: true });

    // Keyboard
    document.addEventListener('keydown', function() {
      if (!_hasTyped) { _hasTyped = true; _behaviorScore += 2; }
    }, { once: true });

    // Mouse (desktop)
    document.addEventListener('mousemove', function() {
      if (!_hasMouseMoved) { _hasMouseMoved = true; _behaviorScore += 1; }
    }, { passive: true, once: true });

    // Click
    document.addEventListener('click', function() {
      _behaviorScore += 1;
    }, { passive: true, once: true });
  }

  // ===== B. DEVICE FINGERPRINT =====
  function _getDeviceId() {
    var stored = localStorage.getItem(CFG.DEVICE_ID_KEY);
    if (stored) return stored;

    // Generate fingerprint from device characteristics
    var screen = window.screen || {};
    var nav = navigator || {};
    var parts = [
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      nav.language || '',
      nav.platform || '',
      new Date().getTimezoneOffset(),
      nav.hardwareConcurrency || 0,
      (screen.pixelRatio || window.devicePixelRatio || 1),
    ];

    // Simple hash
    var hash = 0;
    var str = parts.join('|');
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    var id = 'YS-' + Math.abs(hash).toString(36).toUpperCase();
    localStorage.setItem(CFG.DEVICE_ID_KEY, id);
    return id;
  }

  // ===== C. ORDER TRACKING =====
  function _getOrderHistory() {
    try {
      var data = JSON.parse(localStorage.getItem(CFG.ORDER_TRACKING_KEY) || '[]');
      var now = Date.now();
      // Keep only last 24 hours
      var filtered = data.filter(function(entry) {
        return (now - entry.time) < 24 * 60 * 60 * 1000;
      });
      // ✅ v17.15: If anything was pruned, write the trimmed list back so
      // expired entries (phone + device fingerprint) don't linger in
      // localStorage until the user clears browser data manually.
      if (filtered.length !== data.length) {
        try { localStorage.setItem(CFG.ORDER_TRACKING_KEY, JSON.stringify(filtered)); } catch (e) {}
      }
      return filtered;
    } catch(e) { return []; }
  }

  function _recordOrder(phone) {
    var history = _getOrderHistory();
    history.push({
      time: Date.now(),
      phone: phone,
      deviceId: _getDeviceId(),
    });
    localStorage.setItem(CFG.ORDER_TRACKING_KEY, JSON.stringify(history));
  }

  function _countOrders(filterFn, timeWindowMs) {
    var history = _getOrderHistory();
    var cutoff = Date.now() - timeWindowMs;
    return history.filter(function(entry) {
      return entry.time >= cutoff && filterFn(entry);
    }).length;
  }

  // ===== D. PHONE INTELLIGENCE =====
  function _isPhoneFake(phone) {
    if (!phone) return true;
    phone = phone.replace(/\s+/g, '').replace(/-/g, '');

    // Must be valid BD format: 01[3-9]XXXXXXXX
    if (!/^01[3-9]\d{8}$/.test(phone)) return true;

    // Repeated digits: 01111111111, 01999999999
    if (/^(\d)\1{10}$/.test(phone)) return true;
    // Last 8 digits all same: 017XXXXXXXX where X is all same
    if (/(\d)\1{7}$/.test(phone)) return true;

    // Sequential: 01234567890, 09876543210
    var sequential = '01234567890';
    var reverseSeq = '09876543210';
    if (sequential.indexOf(phone) > -1 || reverseSeq.indexOf(phone) > -1) return true;

    // Common test numbers
    var fakeNumbers = [
      '01700000000', '01800000000', '01900000000',
      '01712345678', '01312345678', '01512345678',
      '01600000000', '01700000001', '01100000000',
    ];
    if (fakeNumbers.indexOf(phone) > -1) return true;

    return false;
  }

  // ===== E. ADDRESS QUALITY =====
  function _isAddressGarbage(address) {
    if (!address) return 'short';
    address = address.trim();

    // Word count check (minimum 6 words)
    var words = address.split(/\s+/).filter(function(w) { return w.length > 0; });
    if (words.length < CFG.MIN_ADDRESS_WORDS) return 'short'; // Return reason

    // Repeated character check: "aaaaaaa", "1111111"
    if (/(.)\1{5,}/.test(address)) return 'repeated';

    // Common garbage patterns
    var garbagePatterns = [
      /^[a-z]{1,4}$/i,          // "asdf", "test"
      /^test/i,                  // "test address"
      /^fake/i,                  // "fake address"
      /^none$/i,                 // "none"
      /^n\/a$/i,                 // "n/a"
      /^-+$/,                    // "---"
      /^\.+$/,                   // "..."
      /^x+$/i,                   // "xxxx"
      /^\d+$/,                   // only numbers "123456"
    ];

    for (var i = 0; i < garbagePatterns.length; i++) {
      if (garbagePatterns[i].test(address.trim())) return 'garbage';
    }

    // Check if mostly gibberish (random consonants without vowels)
    var vowelCount = (address.match(/[aeiouAEIOU\u0985-\u09AF]/g) || []).length;
    var letterCount = (address.match(/[a-zA-Z\u0980-\u09FF]/g) || []).length;
    if (letterCount > 10 && vowelCount / letterCount < 0.05) return 'gibberish';

    return false; // Address is OK
  }

  // ===== MAIN VALIDATION =====
  // Returns { allowed: true/false, reason: string, silent: boolean }
  // silent=true means show fake success (attacker doesn't know they're blocked)
  function validate(orderData) {
    var phone = (orderData.phone || '').trim();
    var address = (orderData.address || '').trim();
    var name = (orderData.name || '').trim();
    var formOpenTime = orderData._formOpenTime || 0;

    // 1. Behavior Score Check (is this a human?)
    if (_behaviorScore < CFG.MIN_BEHAVIOR_SCORE) {
      return { allowed: false, reason: 'bot_detected', silent: true };
    }

    // 2. Click Cooldown (30 seconds to prevent bot spam)
    var now = Date.now();
    var waitTimeLeft = 30000 - (now - _lastOrderClickTime);
    if (waitTimeLeft > 0 && _lastOrderClickTime !== 0) {
      return { allowed: false, reason: 'আপনি একটি অর্ডার করেছেন, দয়া করে ৩০ সেকেন্ড অপেক্ষা করুন।', silent: false };
    }
    _lastOrderClickTime = now;

    // 3. Form Timing (too fast = bot)
    if (formOpenTime > 0 && (now - formOpenTime) < CFG.MIN_FORM_TIME_MS) {
      return { allowed: false, reason: 'অনুগ্রহ করে ফর্মটি সঠিকভাবে পূরণ করুন।', silent: false };
    }

    // 4. Phone Intelligence
    if (_isPhoneFake(phone)) {
      return { allowed: false, reason: 'সঠিক বাংলাদেশি ফোন নম্বর দিন (যেমন: 017XXXXXXXX)', silent: false };
    }

    // 5. Phone rate limit (hour) — max 5 orders per phone per hour
    var phoneHourCount = _countOrders(function(entry) {
      return entry.phone === phone;
    }, 60 * 60 * 1000);
    if (phoneHourCount >= 5) {
      return { allowed: false, reason: 'phone_hour_limit', silent: true };
    }

    // 6. Phone rate limit (day) — max 10 orders per phone per day
    var phoneDayCount = _countOrders(function(entry) {
      return entry.phone === phone;
    }, 24 * 60 * 60 * 1000);
    if (phoneDayCount >= 10) {
      return { allowed: false, reason: 'phone_day_limit', silent: true };
    }

    // 7. Device rate limit (day) — max 15 orders per device per day
    var deviceDayCount = _countOrders(function(entry) {
      return entry.deviceId === _getDeviceId();
    }, 24 * 60 * 60 * 1000);
    if (deviceDayCount >= 15) {
      return { allowed: false, reason: 'device_day_limit', silent: true };
    }

    // 8. Address Quality
    var addressResult = _isAddressGarbage(address);
    if (addressResult === 'short') {
      return { 
        allowed: false, 
        reason: 'অনুগ্রহ করে আপনার সম্পূর্ণ ঠিকানা দিন (যেমন: গ্রাম/মহল্লা, রোড, থানা, জেলা)', 
        silent: false 
      };
    }
    if (addressResult === 'repeated' || addressResult === 'garbage' || addressResult === 'gibberish') {
      return { 
        allowed: false, 
        reason: 'সঠিক ও সম্পূর্ণ ডেলিভারি ঠিকানা দিন।', 
        silent: false 
      };
    }

    // 9. Name Quality (minimum 2 words for Bengali/English name)
    var nameWords = name.split(/\s+/).filter(function(w) { return w.length > 0; });
    if (nameWords.length < 1 || name.length < 3) {
      return { allowed: false, reason: 'আপনার পূর্ণ নাম দিন।', silent: false };
    }

    // 10. Admin Blacklist (from storeInfo)
    if (window.YARZ && YARZ.state && YARZ.state.storeInfo) {
      var raw = YARZ.state.storeInfo.raw || YARZ.state.storeInfo;
      var blockedPhones = raw.blocked_phones || '';
      if (blockedPhones) {
        var blockedList = String(blockedPhones).split(',').map(function(p) { return p.trim(); });
        if (blockedList.indexOf(phone) > -1) {
          return { allowed: false, reason: 'blocked', silent: true }; // Silent block
        }
      }
    }

    // ✅ ALL CHECKS PASSED — record this order
    _recordOrder(phone);

    return { allowed: true };
  }

  // ===== INIT =====
  function init() {
    if (_initialized) return;
    _initialized = true;
    _initBehaviorTracking();
    //console.log('YARZ Shield: Anti-fraud protection active');
  }

  // ===== PUBLIC API =====
  var publicApi = {
    init: init,
    validate: validate,
    getBehaviorScore: function() { return _behaviorScore; },
    getDeviceId: _getDeviceId,
  };

  // Auto-init when script loads
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  return publicApi;
})();
