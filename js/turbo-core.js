/* ════════════════════════════════════════════════════════════════════
   YARZ TURBO CORE v1.0 — Multi-Layer Cache Engine
   ════════════════════════════════════════════════════════════════════
   Architecture:
     L1: In-memory Map      → 0ms reads
     L2: (removed — persistent caching disabled by owner preference)
     L3: localStorage       → fallback for tiny config
     L4: Service Worker     → network-level cache

   Pattern: Stale-While-Revalidate (SWR)
     1. Return cached data INSTANTLY (UI renders in <100ms)
     2. Fetch fresh data in background
     3. If changed → emit 'turbo:update' event → UI patches silently

   Exposed globals:
     window.TURBO          → main API
     window.TURBO.get(key, fetcher, opts)
     window.TURBO.set(key, value, ttlMs)
     window.TURBO.invalidate(keyOrPrefix)
     window.TURBO.on(event, handler)
   ════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // Default TTLs (Time-To-Live) in milliseconds
  const TTL = {
    products:   60 * 1000,        // 60 sec — but show stale instantly via SWR
    categories: 10 * 60 * 1000,   // 10 min
    settings:   5  * 60 * 1000,   // 5 min
    banner:     5  * 60 * 1000,   // 5 min
    orders:     30 * 1000,        // 30 sec (more dynamic)
    coupon:     5  * 60 * 1000,
    default:    2  * 60 * 1000
  };

  // ─────────────────────────────────────────────────────────────────
  // L1: In-Memory Cache (fastest)
  // ─────────────────────────────────────────────────────────────────
  const memCache = new Map();

  // ─────────────────────────────────────────────────────────────────
  // Event Emitter (for 'turbo:update' notifications)
  // ─────────────────────────────────────────────────────────────────
  const listeners = {};
  function on(event, fn) {
    const arr = (listeners[event] = listeners[event] || []);
    if (arr.length >= 20) {
      console.warn('[TURBO] Warning: "' + event + '" has ' + arr.length + ' listeners (possible leak)');
    }
    arr.push(fn);
  }
  function off(event, fn) { listeners[event] = (listeners[event]||[]).filter(x => x !== fn); }
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => {
      try { fn(data); } catch (e) { console.error('[TURBO event]', e); }
    });
    try { global.dispatchEvent(new CustomEvent('turbo:' + event, { detail: data })); } catch(e){}
  }

  // ─────────────────────────────────────────────────────────────────
  // In-flight request deduplication
  // ─────────────────────────────────────────────────────────────────
  const inflight = new Map();

  // ─────────────────────────────────────────────────────────────────
  // Hash helper — detect data change (for silent updates)
  // ─────────────────────────────────────────────────────────────────
  function fastHash(s) {
    if (typeof s !== 'string') s = JSON.stringify(s);
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  // ─────────────────────────────────────────────────────────────────
  // CORE API: get(key, fetcher, opts)
  //   - opts.ttl       : custom TTL in ms
  //   - opts.swr       : stale-while-revalidate (default true)
  //   - opts.forceFresh: bypass cache
  //   - opts.type      : 'products'|'orders'|... for default TTL
  // ─────────────────────────────────────────────────────────────────
  async function get(key, fetcher, opts) {
    opts = opts || {};
    const now = Date.now();
    const ttl = opts.ttl || TTL[opts.type] || TTL.default;
    const swr = opts.swr !== false;

    // L1: Memory
    if (!opts.forceFresh && memCache.has(key)) {
      const m = memCache.get(key);
      if (now - m.ts < ttl) {
        return m.value;
      }
      if (swr) {
        revalidateBg(key, fetcher, opts, m.hash);
        return m.value;
      }
    }

    return doFetch(key, fetcher, opts);
  }

  async function doFetch(key, fetcher, opts) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const value = await fetcher();
        const hash  = fastHash(value);
        const ts    = Date.now();
        memCache.set(key, { value, ts, hash });
        emit('update', { key, value, fresh: true });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  function revalidateBg(key, fetcher, opts, oldHash) {
    if (inflight.has(key)) return;
    const p = (async () => {
      try {
        const value = await fetcher();
        const hash  = fastHash(value);
        const ts    = Date.now();
        memCache.set(key, { value, ts, hash });
        if (hash !== oldHash) {
          emit('update', { key, value, fresh: true, changed: true });
        }
      } catch (e) {
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }

  // ─────────────────────────────────────────────────────────────────
  // Manual set / invalidate
  // ─────────────────────────────────────────────────────────────────
  async function set(key, value, ttl) {
    const hash = fastHash(value);
    const ts   = Date.now();
    memCache.set(key, { value, ts, hash, ttl });
    emit('update', { key, value, fresh: true });
  }

  async function invalidate(keyOrPrefix) {
    if (keyOrPrefix.endsWith('*')) {
      const prefix = keyOrPrefix.slice(0, -1);
      for (const k of Array.from(memCache.keys())) {
        if (k.startsWith(prefix)) memCache.delete(k);
      }
    } else {
      memCache.delete(keyOrPrefix);
    }
  }

  async function clear() {
    memCache.clear();
  }

  // ─────────────────────────────────────────────────────────────────
  // Prefetch — load data into cache before user needs it
  // ─────────────────────────────────────────────────────────────────
  function prefetch(key, fetcher, opts) {
    if (memCache.has(key) || inflight.has(key)) return;
    const run = () => doFetch(key, fetcher, opts || {}).catch(()=>{});
    if (global.requestIdleCallback) {
      requestIdleCallback(run, { timeout: 2000 });
    } else {
      setTimeout(run, 50);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Performance Monitor
  // ─────────────────────────────────────────────────────────────────
  const perf = {
    marks: {},
    mark(name) {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        this.marks[name] = performance.now();
      }
    },
    measure(name, fromMark) {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        const t = performance.now() - (this.marks[fromMark] || 0);
        if (window.__DEV__) console.log('%c[TURBO] ' + name + ': ' + t.toFixed(1) + 'ms', 'color:#634A8E;font-weight:bold');
        return t;
      }
      return 0;
    }
  };

  // Public API
  global.TURBO = {
    get, set, invalidate, clear, prefetch,
    on, off, emit,
    perf,
    _memCache: memCache,
    version: '1.0.0'
  };

})(window);
