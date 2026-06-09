/* =====================================================
 YARZ PRO — Business Dashboard
 Single-file app. Connects to Google Sheets REST API (read)
 and Apps Script Web App (write).
===================================================== */

(function(){

// ============ CONFIG ============
// Credentials stored as SHA-256 hashes (NOT plaintext) — harder to read even if source leaks.
// To change password: update ADMIN_SECRET in your Apps Script backend AND the hash below.
// Generate new hash: open browser console → crypto.subtle.digest('SHA-256', new TextEncoder().encode('your-password')).then(b=>console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')))
// AUTH_HASHES removed for security.
// Default values used as fallbacks when admin hasn't configured custom ones.
// These are inherently public (any browser making API calls will expose them in network tab).
// Real security is in Google Cloud Console: API key MUST be restricted to your domain.
const DEFAULT_SHEET_ID = '1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q';
const DEFAULT_API_KEY = 'AIzaSyApMtjj2baO6u19AvppjLtJ1GT1G61qo9k';
// Settings version — bump to force-refresh stale localStorage on all visitors
const SETTINGS_VERSION = 'v12.0-2026-05-22';
// Default Apps Script URL — same reasoning as above (inherently public for client-side apps)
const DEFAULT_APPS_URL = 'https://script.google.com/macros/s/AKfycbzLs9KDameNALSxN4ntZXHKs-st2V-4gN5ITFL38UnqKFw_s2yXFPcmLFB4KXzIVs7K/exec';
const TZ = 'Asia/Dhaka';
const WORKER = 'https://yarz.marufhasan80009.workers.dev';

// ============ STORAGE HELPERS (safe try/catch wrappers) ============
function _ls(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){}}
function _ss(k,v){try{if(v===undefined)return sessionStorage.getItem(k);sessionStorage.setItem(k,v)}catch(e){}}

// ============ CRYPTO UTIL ============
async function sha256(text){
 try {
 const buf = new TextEncoder().encode(text);
 const hash = await crypto.subtle.digest('SHA-256', buf);
 return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
 } catch(e){
 return null; // fallback
 }
}

// Rate limit: track failed login attempts
const LOGIN_LOCK = {
 attempts: 0,
 lockedUntil: 0,
 MAX_ATTEMPTS: 5,
 LOCK_DURATION: 60 * 1000 // 60 seconds
};

// Column constants (matches Apps Script)
const COL = {
 NAME:1, IMG:2, IMG2:3, IMG3:4, VIDEO:5,
 DESC:6, CATEGORY:7, FABRIC:8, BADGE:9,
 SIZE_CHART:10, DELIVERY_DAYS:11,
 COST:12, REG:13, SALE:14, DISC_PCT:15, DISC_TYPE:16,
 DELIVERY_IN:17, DELIVERY_OUT:18,
 STK_M:19, STK_L:20, STK_XL:21, STK_XXL:22,
 SOLD_M:23, SOLD_L:24, SOLD_XL:25, SOLD_XXL:26,
 TOT_SOLD:27, RETURNS:28, REMAINING:29, TOT_STOCK:30, TOT_INVEST:31,
 REVENUE:32, TO_RECOVER:33, GROSS:34, FB_AD:35, NET:36, DISC_IMPACT:37,
 UPDATED:38, STATUS:39,
 IMG4:40, IMG5:41, IMG6:42,
 C_ACT:43, C_CODE:44, C_DISC:45,
 STK_S:46, STK_3XL:47, SOLD_S:48, SOLD_3XL:49,
 HIDDEN_SIZES:50,
 // ✅ v16.2: Per-product Size Type override (spreadsheet column AY = 51).
 // ""/"auto" → detect from category · "shirt" → S/M/L/XL/XXL/3XL · "pant" → 28-38
 SIZE_TYPE:51,
 // ✅ v16.3: Per-product Accessory flag (spreadsheet column AZ = 52).
 // "Yes" → product lives in the separate Men's Accessories showcase.
 ACCESSORY:52,
 TOTAL:52
};

const DEFAULT_CATEGORIES = ["Shirt","T-Shirt","Polo","Formal","Casual","Panjabi","Kurta","Pant","Formal Pant","Jeans","Chinos","Cargo Pant","Trouser","Hoodie","Sweater","Jacket","Blazer","Coat","Waistcoat","Tracksuit","Shorts","Three Quarter","Shoes","Sneakers","Sandals","Belt","Cap","Hat","Watch","Wallet","Sunglasses","Accessories","Other"];
const DEFAULT_FABRICS = ["Oxford Cotton","Poplin Cotton","Premium Cotton","Cotton","China Fabric","Twill Cotton","Linen","Silk","Denim","Polyester","Rayon","Viscose","Chiffon","Georgette","Khadi","Jersey","Fleece","Wool","Corduroy","Satin","Velvet","Nylon","Spandex","Mixed","Other"];
const DEFAULT_BADGES = ["","New Arrival","Hot Sale","Best Seller","Limited Edition","Trending","Premium","Sold Out Soon"];
const DISC_TYPES = ["Normal","Serious","Special","Clearance","Seasonal"];
const PAYMENT_METHODS = ["COD","bKash","Nagad","Rocket","Bank","Paid"];
const COURIERS = ["SteadFast","Pathao","Redex","PaperFly","ParcelDex","CarryBee","Self Delivery","Other"];

// ===== IMAGE URL CONVERTER v3.7 — HIGH-QUALITY (Original-Resolution) =====
// ✅ Returns the ORIGINAL high-resolution image (no scaling, no compression).
// ✅ FIX v3.7: When user pastes an i.ibb.co direct link with extension
// (.webp / .png / .gif / .avif), we KEEP it untouched. Previously the
// share-page regex over-matched and rewrote every imgbb URL to ".jpg",
// which broke webp uploads — that was the blur/quality issue.
// ✅ FIX v3.7: Google Drive uses =s0 → original-resolution (no thumbnail).
function getImgSrc(url) {
 if (!url) return '';
 url = String(url).trim();
 if (!url) return '';
 if (!url.startsWith('http') && !url.startsWith('data:')) url = 'https://' + url;
 // ── Direct image link with extension → return UNTOUCHED (full quality) ──
 if (/\.(jpe?g|png|webp|avif|gif|bmp|svg)(\?.*)?$/i.test(url)) return url;
 // Google Drive share/view → original-size direct image
 if (url.indexOf('drive.google.com') !== -1) {
 var m = url.match(/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
 if (m) return 'https://lh3.googleusercontent.com/d/' + m[1];
 }
 // ibb.co SHARE page (no extension) → direct i.ibb.co image
 // ✅ FIX v4.2: Preserve filename and extension if provided, otherwise default to .webp instead of .jpg
 var ibbMatch = url.match(/^https?:\/\/(?:www\.)?ibb\.co(?:\.com)?\/([a-zA-Z0-9]+)(?:\/([\w\-\.]+\.(?:jpe?g|png|webp|avif|gif|bmp|svg)))?\/?$/i);
 if (ibbMatch) {
 var id = ibbMatch[1];
 var filename = ibbMatch[2] || (id + '.webp');
 return 'https://i.ibb.co/' + id + '/' + filename;
 }
 // postimg.cc share → direct
 var postimgMatch = url.match(/^https?:\/\/postimg\.cc\/([a-zA-Z0-9]+)\/?$/i);
 if (postimgMatch) return 'https://i.postimg.cc/' + postimgMatch[1] + '/image.jpg';
 // imgur share → direct
 var imgurMatch = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)\/?$/i);
 if (imgurMatch) return 'https://i.imgur.com/' + imgurMatch[1] + '.jpg';
 return url;
}

const STATUS_FLOW = ["Pending","Picked Up","Ready for Delivery","Handed to Courier","Delivered"];
const STATUS_COLORS = {
 "Pending":"chip-amber",
 "Picked Up":"chip-blue",
 "Ready for Delivery":"chip-purple",
 "Handed to Courier":"chip-purple",
 "Processing":"chip-blue","Shipped":"chip-blue","Confirmed":"chip-blue",
 "Delivered":"chip-green",
 "Cancelled":"chip-red","Returned":"chip-red"
};

const BN_MONTHS = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const BN_DIGITS = ["০","১","২","৩","৪","৫","৬","৭","৮","৯"];
function toBn(n){ return String(n).replace(/\d/g, d=>BN_DIGITS[d]); }
// ✅ v16.1 ONE-SIZE: friendly label for the canonical "ONE" size token used by
// sizeless products (caps/watches/etc.). Everything else passes through as-is.
function _ordSize(s){ return (String(s||'').trim().toUpperCase()==='ONE') ? 'One Size' : s; }
// ✅ v16.1 ONE-SIZE: true when an inventory product object is sizeless.
function _isOneSizeP(p){ return p && String(p.hiddenSizes||'').trim().toUpperCase()==='__ONESIZE__'; }

/* ============================================================
 ✅ TRACKING / COURIER PARSING HELPERS
 The Apps Script stores combined string in column O ("🚀 Courier"):
  "CourierName - TrackingID" e.g. "SteadFast - 12345678"
 We parse it client-side into { courier, tracking } so the UI can
 display the tracking ID prominently AND let the search bar match it.
 No Google Sheet column changes required → existing data stays SAFE.
============================================================ */
function parseCourierField(raw){
 const s = String(raw||'').trim();
 if(!s) return { courier:'', tracking:'', raw:'' };
 // Try " - " separator first (the format that editCourierId saves)
 let idx = s.indexOf(' - ');
 if(idx === -1){
 // Sometimes user typed without spaces: "SteadFast-12345" or just "12345"
 // If the string is one of the known courier names → only courier
 if(COURIERS.includes(s)) return { courier:s, tracking:'', raw:s };
 // If contains a known courier prefix, split on first dash
 for(const c of COURIERS){
 if(s.toLowerCase().startsWith(c.toLowerCase())){
  const rest = s.slice(c.length).replace(/^\s*[-:|/]\s*/,'').trim();
  if(rest) return { courier:c, tracking:rest, raw:s };
  return { courier:c, tracking:'', raw:s };
 }
 }
 // Otherwise treat the whole value as a tracking ID
 return { courier:'', tracking:s, raw:s };
 }
 const courier = s.slice(0, idx).trim();
 const tracking = s.slice(idx+3).trim();
 return { courier, tracking, raw:s };
}

/* Highlight the part of the tracking ID that matches the current search query */
function highlightTracking(tid, query){
 const safe = esc(tid);
 if(!query) return safe;
 const q = String(query).trim();
 if(!q) return safe;
 // Case-insensitive match
 const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'ig');
 return safe.replace(re, m=>`<span class="tr-hi">${m}</span>`);
}

/* Build the prominent Tracking ID block. Returns '' if no tracking & no courier. */
function renderTrackingBlock(courierRaw, orderId, searchQuery){
 const p = parseCourierField(courierRaw);
 if(!p.tracking && !p.courier) return '';
 // If we only have courier (no tracking), show a small chip
 if(!p.tracking){
 return `<div style="margin-top:6px"><span class="tracking-courier-tag"><i class="ri-truck-line"></i> ${esc(p.courier)}</span></div>`;
 }
 const tHtml = highlightTracking(p.tracking, searchQuery);
 const courierTag = p.courier ? `<span class="tracking-courier-tag"><i class="ri-truck-line"></i> ${esc(p.courier)}</span>` : '';
 return `
 <div class="tracking-row" onclick="event.stopPropagation()">
 <span class="tracking-label"><i class="ri-barcode-line"></i> Tracking</span>
 ${courierTag}
 <span class="tracking-id bn-num" title="Click to copy" onclick="YARZ.ord.copyTracking('${esc(p.tracking)}', this)">${tHtml}</span>
 <button class="tracking-copy-btn" title="Copy Tracking ID" onclick="event.stopPropagation();YARZ.ord.copyTracking('${esc(p.tracking)}', this)"><i class="ri-file-copy-line"></i></button>
 <button class="tracking-copy-btn" title="Edit / Change" onclick="event.stopPropagation();YARZ.ord.editCourierId('${esc(orderId)}')"><i class="ri-edit-2-line"></i></button>
 </div>
 `;
}

// ============ STATE ============
const state = {
 sheetId: DEFAULT_SHEET_ID,
 apiKey: DEFAULT_API_KEY,
 appsUrl: DEFAULT_APPS_URL,
 data: {
 inventory: [],
 orders: [],
 websiteOrders: [],
 transactions: [],
 adTracker: [],
 expenses: [],
 deliveryCharges: [],
 settings: {}
 },
 loaded: false,
 currentPage: 'home'
};

// ============ UTILS ============
function $(id){ return document.getElementById(id); }
function qs(sel, ctx){ return (ctx||document).querySelector(sel); }
function qsa(sel, ctx){ return Array.from((ctx||document).querySelectorAll(sel)); }
function num(v){ const n = parseFloat(v); return isNaN(n)?0:n; }
function int(v){ const n = parseInt(v,10); return isNaN(n)?0:n; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// ✅ v17.5: URL-context sanitizer. esc() alone is not enough for href / src —
// javascript:, vbscript:, data:text/html, file: etc. would survive HTML escaping
// and still execute. Only allow safe schemes. Use this for EVERY URL-bearing
// interpolation (img src, link href, background-image url()).
function safeUrl(url){
 if(!url) return '';
 var s = String(url).trim();
 if(!s) return '';
 if(/^(https?:|data:image\/|blob:|\/\/|\/)/i.test(s)) return esc(s);
 return '';
}
function safeStr(s){ return String(s==null?'':s); }
function fmtBDT(n){ return ''+Math.round(num(n)).toLocaleString('en-IN'); }
function getImgSrc(url){
 // ✅ v3.7 HIGH-QUALITY (Original-Resolution) — same logic as website
 // Direct image links with extensions are returned UNTOUCHED so webp/png/gif
 // keep their original format and resolution (this was the blur fix).
 if(!url) return '';
 url = String(url).trim();
 if(!url) return '';
 if(!url.startsWith('http') && !url.startsWith('data:')) url = 'https://' + url;
 // Direct image link with extension → return UNTOUCHED (full quality)
 if(/\.(jpe?g|png|webp|avif|gif|bmp|svg)(\?.*)?$/i.test(url)) return url;
 if(url.includes('drive.google.com')){
 const m = url.match(/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
 if(m) return 'https://lh3.googleusercontent.com/d/' + m[1];
 }
 // ibb.co SHARE page (no extension) → direct image
 // FIX v4.2: Preserve filename and extension if provided, otherwise default to .webp
 const ibbMatch = url.match(/^https?:\/\/(?:www\.)?ibb\.co(?:\.com)?\/([a-zA-Z0-9]+)(?:\/([\w\-\.]+\.(?:jpe?g|png|webp|avif|gif|bmp|svg)))?\/?$/i);
 if (ibbMatch) {
 const id = ibbMatch[1];
 const filename = ibbMatch[2] || (id + '.webp');
 return 'https://i.ibb.co/' + id + '/' + filename;
 }
 // postimg share → direct
 const postimgMatch = url.match(/^https?:\/\/postimg\.cc\/([a-zA-Z0-9]+)\/?$/i);
 if(postimgMatch) return 'https://i.postimg.cc/' + postimgMatch[1] + '/image.jpg';
 // imgur share → direct
 const imgurMatch = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)\/?$/i);
 if(imgurMatch) return 'https://i.imgur.com/' + imgurMatch[1] + '.jpg';
 return url;
}

async function resolveImageLinks(d) {
 // ✅ FIX v3.1: Now resolves ALL 6 image fields (img1-img6) with auto-format detection
 // Supports: imgbb (ibb.co share + i.ibb.co direct), Google Drive, postimg, imgur,
 // direct image links, and any non-direct URL via microlink fallback
 for (let k of ['img1','img2','img3','img4','img5','img6']) {
 let url = d[k];
 if(!url || typeof url !== 'string') continue;
 url = url.trim();
 if(!url) continue;
 // Add https:// prefix if missing
 if(!url.startsWith('http') && !url.startsWith('data:')){
 url = 'https://' + url;
 d[k] = url;
 }
 if(!url.startsWith('http')) continue;

 // ── Already a direct image link → no resolve needed ──
 if(/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|tiff?)(\?.*)?$/i.test(url)) continue;
 // ── i.ibb.co direct (sometimes no extension) ──
 if(/^https?:\/\/i\.ibb\.co\//i.test(url)) continue;
 // ── lh3.googleusercontent.com direct ──
 if(/^https?:\/\/lh\d\.googleusercontent\.com\//i.test(url)) continue;
 // ── i.postimg.cc / i.imgur.com direct ──
 if(/^https?:\/\/i\.(postimg\.cc|imgur\.com)\//i.test(url)) continue;

 // ── Handle ibb.co share page → direct ──
 // ✅ FIX v4.2: Preserve original filename if present, default to .webp instead of .jpg
 const ibbMatch = url.match(/^https?:\/\/(?:www\.)?ibb\.co(?:\.com)?\/([a-zA-Z0-9]+)(?:\/([\w\-\.]+\.(?:jpe?g|png|webp|avif|gif|bmp|svg)))?\/?$/i);
 if (ibbMatch) {
 const id = ibbMatch[1];
 const filename = ibbMatch[2] || (id + '.webp');
 d[k] = 'https://i.ibb.co/' + id + '/' + filename;
 continue;
 }
 // ── Google Drive ──
 if(url.includes('drive.google.com')){
 const m = url.match(/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
 if(m) d[k] = 'https://lh3.googleusercontent.com/d/' + m[1];
 continue;
 }
 // ── postimg share → direct ──
 const postimgMatch = url.match(/^https?:\/\/postimg\.cc\/([a-zA-Z0-9]+)\/?$/i);
 if(postimgMatch){
 d[k] = 'https://i.postimg.cc/' + postimgMatch[1] + '/image.jpg';
 continue;
 }
 // ── imgur share → direct ──
 const imgurMatch = url.match(/^https?:\/\/(?:www\.)?imgur\.com\/([a-zA-Z0-9]+)\/?$/i);
 if(imgurMatch){
 d[k] = 'https://i.imgur.com/' + imgurMatch[1] + '.jpg';
 continue;
 }

 // ── Unknown CDN → microlink fallback ──
 try {
 const p = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
 const j = await p.json();
 if(j.data && j.data.image && j.data.image.url) {
  d[k] = j.data.image.url;
 }
 } catch(e) { console.warn('Img resolve err for '+k+':', e); }
 }
}

function fmtDateBn(d){
 if(!d) return '';
 const dt = d instanceof Date ? d : new Date(d);
 if(isNaN(dt.getTime())) return '';
 const day = dt.getDate(), m = dt.getMonth(), y = dt.getFullYear();
 return toBn(String(day).padStart(2,'0'))+'/'+toBn(String(m+1).padStart(2,'0'))+'/'+toBn(y);
}
function fmtTimeBn(d){
 if(!d) return '';
 const dt = d instanceof Date ? d : new Date(d);
 if(isNaN(dt.getTime())) return '';
 let h = dt.getHours(), mi = dt.getMinutes();
 const ampm = h>=12 ? 'PM' : 'AM';
 h = h%12 || 12;
 return toBn(String(h).padStart(2,'0'))+':'+toBn(String(mi).padStart(2,'0'))+' '+ampm;
}
function fmtDateTime(d){
 if(!d) return '';
 return fmtDateBn(d)+' '+fmtTimeBn(d);
}
function fmtBnMonth(ym){ // "2026-04" -> "April 2026"
 if(!ym) return '';
 const [y,m] = ym.split('-');
 return (BN_MONTHS[parseInt(m)-1]||m)+' '+toBn(y);
}

// Relative time: "2 minutes ago", "3 hours ago", "Yesterday", "3 days ago"
function relativeTime(d){
 if(!d) return '';
 const dt = d instanceof Date ? d : new Date(d);
 if(isNaN(dt.getTime())) return '';
 const now = new Date();
 const diff = Math.floor((now - dt) / 1000); // seconds
 if(diff < 60) return 'Just now';
 if(diff < 3600) return toBn(Math.floor(diff/60)) + ' minutes ago';
 if(diff < 86400) return toBn(Math.floor(diff/3600)) + ' hours ago · ' + fmtTimeBn(dt);
 if(diff < 172800) return 'Yesterday · ' + fmtTimeBn(dt);
 const days = Math.floor(diff / 86400);
 if(days < 7) return toBn(days) + ' days ago';
 return fmtDateBn(dt) + ' · ' + fmtTimeBn(dt);
}

// Date bucket label for grouping: Today / Yesterday / Date
function dateBucketLabel(d){
 if(!d) return { key:'unknown', label:'No date', isToday:false, date:null };
 const dt = d instanceof Date ? d : new Date(d);
 if(isNaN(dt.getTime())) return { key:'unknown', label:'No date', isToday:false, date:null };
 const today = new Date(); today.setHours(0,0,0,0);
 const yest = new Date(today); yest.setDate(today.getDate()-1);
 const target = new Date(dt); target.setHours(0,0,0,0);
 const key = target.getFullYear() + '-' + String(target.getMonth()+1).padStart(2,'0') + '-' + String(target.getDate()).padStart(2,'0');
  const BN_DAYS = ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
  if(target.getTime() === today.getTime()) return { key, label:'আজ', isToday:true, date:target, dayName:BN_DAYS[target.getDay()] };
  if(target.getTime() === yest.getTime()) return { key, label:'গতকাল', isToday:false, date:target, dayName:BN_DAYS[target.getDay()] };
  return { key, label:BN_DAYS[target.getDay()], isToday:false, date:target, dayName:BN_DAYS[target.getDay()] };
}

function toast(msg, type){
 const t = $('toast');
 t.className = 'toast '+(type||'success')+' show';
 let icon = 'check-circle';
 if(type==='error') icon = 'exclamation-circle';
 if(type==='info') icon = 'info-circle';
 t.innerHTML = '<i class="fas fa-'+icon+'"></i> '+esc(msg);
 clearTimeout(toast._t);
 toast._t = setTimeout(()=>t.classList.remove('show'), 2800);
}

function showLoader(text){
 $('load-text').textContent = text || 'Loading...';
 $('load-overlay').classList.add('show');
}
function hideLoader(){ $('load-overlay').classList.remove('show'); }

function parseSheetDate(v){
 if(!v) return null;
 if(v instanceof Date) return v;
 // Try ISO first
 let d = new Date(v);
 if(!isNaN(d.getTime())) return d;
 // dd/mm/yy hh:mm pattern
 const m = String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
 if(m){
 let yr = parseInt(m[3]);
 if(yr<100) yr+=2000;
 d = new Date(yr, parseInt(m[2])-1, parseInt(m[1]), parseInt(m[5]||'0'), parseInt(m[5]?m[5]:'0'));
 if(!isNaN(d.getTime())) return d;
 }
 return null;
}

// ============ SHEETS API ============
async function sheetRead(range){
 const res = await appsPost('sheet_read', { range: range });
 if (res && res.success && res.data) return res.data;
 throw new Error(res.msg || 'Sheet read failed');
}

async function sheetReadFormatted(range){
 const res = await appsPost('sheet_read', { range: range });
 if (res && res.success && res.data) return res.data;
 throw new Error(res.msg || 'Sheet read failed');
}

// Write via Apps Script
// ★ Fixed v4.1: proper response parsing + error feedback + fallback URL
// ✅ v17.5 PHASE 3: Now sends sessionToken + ts instead of adminKey. The
// password never travels with every request — only the login call. The
// token is server-issued, time-bound (30 min), revocable, and rate-limited.
async function appsPost(action, payload){
  // CSRF check: verify token matches before sending
  var _csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var _csrfTok = _csrfMeta ? _csrfMeta.getAttribute('content') : '';
  var _lAction = String(action).toLowerCase().trim();
  var _isAuthAction = (_lAction === 'adminlogin' || _lAction === 'adminlogout');
  if(!_csrfTok || _csrfTok !== window._csrfToken){
    if(!_isAuthAction){
      console.warn('[CSRF] Token mismatch — blocking request');
      throw new Error('Security: CSRF token mismatch. Page may be stale — refresh and try again.');
    }
  }
  // fallback: if state.appsUrl any Reason happens, DEFAULT_APPS_URL use will be
  const targetUrl = state.appsUrl || DEFAULT_APPS_URL;
  if(!targetUrl){
  toast('Settings from Apps Script URL Days', 'error');
  YARZ.goPage('settings');
  throw new Error('No Apps Script URL');
  }

  // Ensure the action string matches backend routing (lowercase)
  const normalizedAction = (action || '').toString().trim().toLowerCase();
  // Login / logout are the only admin actions that DON'T need a token.
  var isAuthAction = (normalizedAction === 'adminlogin' || normalizedAction === 'adminlogout');
  var body = Object.assign({
    action: normalizedAction,
    key: state.apiKey,
    ts: Date.now()
  }, payload || {});
  if (!isAuthAction) {
    // Attach the current session token (if any). Server will 401 if
    // missing/expired/revoked.
    body.sessionToken = window._adminToken || '';
  }
  // Attach CSRF token to every request
  body._csrf = window._csrfToken || _csrfTok;

  try {
 // ✅ v15.99: 30s timeout via AbortController. Previously a hung Apps Script
 // request never rejected → the login button sat on "Processing..." forever
 // and loadAll's spinner hung indefinitely. Now it fails cleanly after 30s.
 const _ctrl = new AbortController();
 const _tid = setTimeout(()=>{ try{ _ctrl.abort(); }catch(e){} }, 30000);
 let res;
 try {
 res = await fetch(targetUrl, {
 method:'POST',
 // text/plain → CORS preflight (OPTIONS) for; Apps Script JSON parse to can
 headers: {'Content-Type':'text/plain;charset=utf-8'},
 body: JSON.stringify(body),
 redirect:'follow',
 signal: _ctrl.signal
 });
 } finally {
 clearTimeout(_tid);
 }
 const txt = await res.text();
 let parsed;
 try { parsed = JSON.parse(txt); }
 catch(e){
 // if HTML return (Google login page), means deployment correct is not
 if(txt.indexOf('<!DOCTYPE')!==-1 || txt.indexOf('<html')!==-1){
 console.error('Apps Script returned HTML instead of JSON. Check deployment access = "Anyone"', txt.slice(0,200));
 throw new Error('Apps Script deployment correct is not — Deploy → Manage deployments → Who has access: Anyone ');
 }
 return { success:true, ok:true, raw:txt };
 }
 // ✅ v17.5: 401 → session expired/revoked. Drop the dead token and
 // bounce to the login screen. Only do this for non-auth actions,
 // because adminLogin returns 401 on bad password and we don't want
 // to wipe the login form on every wrong password.
 if (!isAuthAction && parsed && (parsed.code === 401 || /Unauthorized|invalid|expired|revoked/i.test(parsed.error || parsed.msg || ''))) {
   try { _adminClearSession(); } catch (e) {}
   try { showLoginScreen(); } catch (e) {}
   throw new Error('Session expired. Please sign in again.');
 }
 // success:false or ok:false if error throw
 if(parsed && parsed.success===false && parsed.ok!==true){
 const msg = parsed.error || parsed.msg || 'Apps Script error';
 console.error('Apps Script error for action='+action, parsed);
 throw new Error(msg);
 }
 return parsed;
 } catch(e){
 if(e && e.name === 'AbortError'){
 console.error('appsPost timed out for action='+action);
 throw new Error('Request timed out — check your internet / Apps Script and try again.');
 }
 console.error('appsPost failed for action='+action, e);
 throw e;
 }
}

// ============ DATA LOADERS ============
async function loadInventory(){
 try {
 // INVENTORY is large. Read A2:AZ1000 (52 columns — incl. Hidden Sizes + Size Type + Accessory)
 const rows = await sheetRead('INVENTORY!A2:AZ1000');
 const items = [];
 for(const r of rows){
 if(!r[0]) continue;
 items.push({
  name: safeStr(r[0]),
  img1: safeStr(r[1]), img2: safeStr(r[2]), img3: safeStr(r[3]),
  video: safeStr(r[4]),
  desc: safeStr(r[5]),
  category: safeStr(r[6]), fabric: safeStr(r[7]), badge: safeStr(r[8]),
  sizeChart: safeStr(r[9]), deliveryDays: safeStr(r[10]),
  cost: num(r[11]), regular: num(r[12]), sale: num(r[13]),
  discPct: num(r[14]), discType: safeStr(r[15])||'Normal',
  deliveryDhaka: num(r[16])||60, deliveryOutside: num(r[17])||120,
  stkS: int(r[COL.STK_S-1]), stkM: int(r[COL.STK_M-1]), stkL: int(r[COL.STK_L-1]), stkXL: int(r[COL.STK_XL-1]), stkXXL: int(r[COL.STK_XXL-1]), stk3XL: int(r[COL.STK_3XL-1]),
  soldS: int(r[COL.SOLD_S-1]), soldM: int(r[COL.SOLD_M-1]), soldL: int(r[COL.SOLD_L-1]), soldXL: int(r[COL.SOLD_XL-1]), soldXXL: int(r[COL.SOLD_XXL-1]), sold3XL: int(r[COL.SOLD_3XL-1]),
  totalSold: num(r[COL.TOT_SOLD-1]), returns: num(r[COL.RETURNS-1]), remaining: num(r[COL.REMAINING-1]), totalStock: num(r[COL.TOT_STOCK-1]),
  invest: num(r[COL.TOT_INVEST-1]), revenue: num(r[COL.REVENUE-1]), toRecover: num(r[COL.TO_RECOVER-1]),
  gross: num(r[COL.GROSS-1]), fbAd: num(r[COL.FB_AD-1]), net: num(r[COL.NET-1]), discImpact: num(r[COL.DISC_IMPACT-1]),
  updated: r[COL.UPDATED-1], status: safeStr(r[COL.STATUS-1])||'Draft',
  img4: safeStr(r[COL.IMG4-1]), img5: safeStr(r[COL.IMG5-1]), img6: safeStr(r[COL.IMG6-1]),
  couponActive: safeStr(r[COL.C_ACT-1])||'No', couponCode: safeStr(r[COL.C_CODE-1]), couponDisc: num(r[COL.C_DISC-1]),
  hiddenSizes: safeStr(r[COL.HIDDEN_SIZES-1])||'',
  sizeType: safeStr(r[COL.SIZE_TYPE-1])||'',
  accessory: safeStr(r[COL.ACCESSORY-1])||''
 });
 }
 state.data.rawInventoryStr = JSON.stringify(items);
   state.data.inventory = items;
   } catch(e) {
 console.error('loadInventory error:', e);
 state.data.inventory = [];
 // ✅ v15.99: No longer rethrows. With loadAll() using Promise.allSettled,
 // a failed inventory read just yields an empty list for this cycle while
 // every other sheet (orders/finance/settings) still loads and renders.
 }
}

async function loadOrders(){
 try {
 const rows = await sheetReadFormatted('ORDERS!A2:P2000');
 state.data.orders = rows.filter(r=>r[1]).map(r=>({
 date: parseSheetDate(r[0]),
 orderId: safeStr(r[1]), customer: safeStr(r[2]), phone: safeStr(r[3]),
 address: safeStr(r[4]), location: safeStr(r[5]),
 product: safeStr(r[6]), size: safeStr(r[7]), qty: int(r[8]),
 price: num(r[9]), delivery: num(r[10]), total: num(r[11]),
 payment: safeStr(r[12]), status: safeStr(r[13])||'Pending',
 courier: safeStr(r[14]), notes: safeStr(r[15])
 }));
 } catch(e){ state.data.orders = []; }
}

async function loadWebsiteOrders(){
 try {
 const rows = await sheetReadFormatted('Website_Orders!A2:T2000');
 // ✅ v4.6 CRITICAL FIX — Column mapping matches the actual sheet:
 // A=OrderID(0) B=Date(1) C=Customer(2) D=Phone(3) E=Address(4) F=Location(5)
 // G=Product(6) H=Size(7) I=Qty(8) J=Price(9) K=Delivery(10) L=Total(11)
 // M=Payment(12) N=Notes(13) O=Coupon(14) P=Status(15) Q=Courier(16)
 // R=Updated(17) S=Activity(18)
 // (Previous v4.5 mapping was wrong — had phantom Email & City columns
 // causing a 4-column shift that displayed qty=70, total=50,330.)
 state.data.websiteOrders = rows.filter(r=>r[0]).map(r=>{
 const qty = int(r[8]) || 1;
 const price = num(r[9]);
 const delivery = num(r[10]);
 let total = num(r[11]);
 // Fallback: if total is 0 or clearly wrong, recalculate.
 if (!total || total < (qty*price)) {
  total = (qty * price) + delivery;
 }
 // Email may be stored inside Notes as "Email: xxx@yyy"
 const notesRaw = safeStr(r[13]);
 let email = '';
 let cleanNotes = notesRaw;
 const emailMatch = notesRaw.match(/Email:\s*([^\s|]+)/i);
 if (emailMatch) {
  email = emailMatch[1];
  cleanNotes = notesRaw.replace(/\s*\|?\s*Email:\s*[^\s|]+/i, '').trim();
  cleanNotes = cleanNotes.replace(/^\|\s*/, '').replace(/\s*\|$/, '');
 }
 // City may be appended into Address as "... | City: xxx"
 const addrRaw = safeStr(r[4]);
 let city = '';
 let cleanAddr = addrRaw;
 const cityMatch = addrRaw.match(/City:\s*([^|]+)/i);
 if (cityMatch) {
  city = cityMatch[1].trim();
  cleanAddr = addrRaw.replace(/\s*\|?\s*City:\s*[^|]+/i, '').trim();
  cleanAddr = cleanAddr.replace(/^\|\s*/, '').replace(/\s*\|$/, '');
 }
 return {
  orderId: safeStr(r[0]),
  date:  parseSheetDate(r[1]),
  customer: safeStr(r[2]),
  phone: safeStr(r[3]),
  address: cleanAddr,
  location: safeStr(r[5]),
  product: safeStr(r[6]),
  size:  safeStr(r[7]),
  qty: qty,
  price: price,
  delivery: delivery,
  total: total,
  payment: safeStr(r[12]),
  notes: cleanNotes,
  coupon: safeStr(r[14]),
  status: safeStr(r[15]) || 'Pending',
  courier: safeStr(r[16]),
  updated: safeStr(r[17]),
  activity: safeStr(r[18]),
  // Backwards-compat aliases (some older render code uses these names)
  email: email,
  city:  city,
  source: safeStr(r[18])
 };
 });
 } catch(e){ state.data.websiteOrders = []; }
}

async function loadTransactions(){
 try {
 const rows = await sheetReadFormatted('TRANSACTIONS!A2:H5000');
 let txs = rows.filter(r=>r[0]).map(r=>({
 date: parseSheetDate(r[0]), product: safeStr(r[1]),
 type: safeStr(r[2]), size: safeStr(r[3]), qty: int(r[4]),
 revenue: num(r[5]), cost: num(r[6]), profit: num(r[7])
 }));
 
 // Process Returns: Erase the matched Sale and neutralize the Return's negative numbers
 let sales = txs.filter(t => t.type === 'Sale');
 let returns = txs.filter(t => t.type === 'Return');
 
 returns.forEach(ret => {
 let qToCancel = ret.qty;
 for (let i = sales.length - 1; i >= 0; i--) {
  let s = sales[i];
  if (qToCancel <= 0) break;
  if (s.product === ret.product && s.size === ret.size && s.qty > 0 && s.date <= ret.date) {
  let cancelQty = Math.min(qToCancel, s.qty);
  let ratio = cancelQty / s.qty;
  s.qty -= cancelQty;
  s.revenue -= (s.revenue * ratio);
  s.cost -= (s.cost * ratio);
  s.profit -= (s.profit * ratio);
  qToCancel -= cancelQty;
  }
 }
 // Zero out the return so it doesn't show as negative on the Dashboard
 ret.revenue = 0;
 ret.cost = 0;
 ret.profit = 0;
 });
 
 // Remove fully cancelled sales
 state.data.transactions = txs.filter(t => t.type !== 'Sale' || t.qty > 0);
 } catch(e){ state.data.transactions = []; }
}

async function loadAdTracker(){
 try {
 // ✅ v10 FIX: AD_TRACKER has 7 columns A-G, not 5.
 // A=Date B=Product C=Spend D=Reach E=Impressions F=Clicks G=Notes
 const rows = await sheetReadFormatted('AD_TRACKER!A2:G2000');
 state.data.adTracker = rows.filter(r=>r[0]).map(r=>({
 date: parseSheetDate(r[0]), product: safeStr(r[1]),
 spend: num(r[2]),
 // alias kept for legacy renderers reading `.amount`
 amount: num(r[2]),
 reach: int(r[3]), impressions: int(r[4]),
 clicks: int(r[5]), notes: safeStr(r[6])
 }));
 } catch(e){ state.data.adTracker = []; }
}

async function loadExpenses(){
 try {
 const rows = await sheetReadFormatted('EXPENSES!A2:E2000');
 // ✅ v10 FIX: Sheet column order is A=Date B=Category C=Description D=Amount E=Notes.
 // Previous code swapped Description and Amount (read description as amount → NaN→0).
 state.data.expenses = rows.filter(r=>r[0]).map(r=>({
 date: parseSheetDate(r[0]), category: safeStr(r[1]),
 description: safeStr(r[2]), amount: num(r[3]),
 notes: safeStr(r[4]),
 // alias kept for legacy renderers reading `.paidTo`
 paidTo: safeStr(r[4])
 }));
 } catch(e){ state.data.expenses = []; }
}

async function loadSettings(){
 try {
 const rows = await sheetReadFormatted('SETTINGS!A2:B2000');
 const map = {};
 rows.forEach(r=>{ if(r[0]) map[String(r[0]).trim()] = r[1]; });
 state.data.settings = map;
 } catch(e){ state.data.settings = {}; }
}

async function loadDeliveryCharges(){
 try {
 const rows = await sheetReadFormatted('DELIVERY_CHARGES!A2:D200');
 state.data.deliveryCharges = rows.filter(r=>r[0] || r[1]).map((r, idx)=>({
 id: safeStr(r[0] || ('zone_' + (idx + 1))),
 name: safeStr(r[1]),
 charge: num(r[2]),
 active: String(r[3] || 'TRUE').toLowerCase() !== 'false'
 })).filter(x=>x.name);
 } catch(e){
 const s = state.data.settings || {};
 // ✅ v3.8: Default → Narayanganj (Inside 70 / Outside 140)
 state.data.deliveryCharges = [
 { id:'inside_narayanganj', name:s['Zone 1 Name'] || 'Inside Narayanganj', charge:num(s['Zone 1 Charge'] || 70), active:true },
 { id:'outside_narayanganj', name:s['Zone 2 Name'] || 'Outside Narayanganj', charge:num(s['Zone 2 Charge'] || 140), active:true }
 ];
 }
}

window.slideImg = function(elId, dir) {
  const el = document.getElementById(elId);
  if(!el) return;
  let imgs;
  try { imgs = JSON.parse(el.getAttribute('data-imgs')||'[]'); } catch(e) { imgs = []; }
  if(imgs.length < 2) return;
  let idx = parseInt(el.getAttribute('data-idx')||'0') + dir;
 if(idx < 0) idx = imgs.length - 1;
 if(idx >= imgs.length) idx = 0;
 el.setAttribute('data-idx', idx);
 el.style.backgroundImage = `url('${imgs[idx]}')`;
};

// ============ MAIN YARZ OBJECT ============
const YARZ = window.YARZ = {
 state,

 // ----- Init / Load -----
  _patchInventoryPendingOrders: function() {
    // ✅ NEW LOGIC: Backend no longer deducts stock for Pending orders, 
    // so we no longer need to manually patch/revert them here.
    return;
  },
 async loadAll(showMsg){
 showLoader('Google Sheets from Loading...');
 try {
 // ✅ v15.99 RESILIENCE: Promise.allSettled (was Promise.all). Previously, if
 // ANY single sheet read failed (e.g. INVENTORY rethrew on a transient 5xx /
 // quota / auth hiccup), Promise.all rejected, render() never ran, and the
 // WHOLE panel showed empty — even the sheets that loaded fine. allSettled
 // lets every loader finish independently; each loader already defaults its
 // own state.data.* to [] on failure, so the panel renders with whatever
 // loaded and the owner is never staring at a blank dashboard.
 await Promise.allSettled([
  loadInventory(),
  loadOrders(),
  loadWebsiteOrders(),
  loadTransactions(),
  loadAdTracker(),
  loadExpenses(),
  loadSettings()
 ]);
 await loadDeliveryCharges().catch(()=>{});
   if(typeof YARZ._patchInventoryPendingOrders === 'function') YARZ._patchInventoryPendingOrders();
   state.loaded = true;
 this.render();
 // Detect new orders (for notification)
 this.detectNewOrders();
 if(showMsg) toast('Data refreshed', 'success');

 // ✅ FIX v3.1: Async resolve ALL 6 image fields (img1-img6) with auto-format detection
 setTimeout(async () => {
  let changed = false;
  for(let p of state.data.inventory) {
  // Check if ANY of the 6 image fields needs resolving
  let needsResolve = false;
  for(const k of ['img1','img2','img3','img4','img5','img6']){
  const u = p[k];
  if(!u || typeof u !== 'string') continue;
  const url = u.trim();
  if(!url) continue;
  if(!url.startsWith('http')) { needsResolve = true; break; }
  if(/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|tiff?)(\?.*)?$/i.test(url)) continue;
  if(/^https?:\/\/i\.ibb\.co\//i.test(url)) continue;
  if(/^https?:\/\/lh\d\.googleusercontent\.com\//i.test(url)) continue;
  if(/^https?:\/\/i\.(postimg\.cc|imgur\.com)\//i.test(url)) continue;
  // Anything else (share page, drive share, unknown CDN) → resolve
  needsResolve = true;
  break;
  }
  if(!needsResolve) continue;

  const olds = {
  img1:p.img1, img2:p.img2, img3:p.img3,
  img4:p.img4, img5:p.img5, img6:p.img6
  };
  await resolveImageLinks(p);
  for(const k of ['img1','img2','img3','img4','img5','img6']){
  if(p[k] !== olds[k]) { changed = true; break; }
  }
  }
  if(changed && state.loaded) this.render();
 }, 500);

 } catch(e){
 console.error(e);
 toast('Error loading data: '+e.message, 'error');
 } finally {
 hideLoader();
 }
 },

 _updateStkBadge: function(prefix){
 const pName = $(prefix+'-product').value;
 let size = $(prefix+'-size').value;
 const badge = $(prefix+'-stk-badge');
 if(!badge) return;
 if(!pName || !size) { badge.style.display = 'none'; return; }
 const p = state.data.inventory.find(x=>x.name===pName);
 if(!p) { badge.style.display = 'none'; return; }
 // ✅ v16.1 ONE-SIZE: the "ONE" token's stock lives in the M slot.
 if(String(size).toUpperCase() === 'ONE') size = 'M';
 const stk = (p['stk'+size]||0) - (p['sold'+size]||0);
 badge.style.display = 'inline-block';
 badge.innerHTML = `Stock: ${stk}`;
 badge.className = `chip ${stk>0?'chip-green':'chip-red'}`;
 },

 // Silent background refresh (polling every 60s for new orders)
 async silentRefresh(){
 try {
 await loadWebsiteOrders();
   if(typeof YARZ._patchInventoryPendingOrders === 'function') YARZ._patchInventoryPendingOrders();
   this.updateBadges();
 this.detectNewOrders();
 } catch(e){ /* silent */ }
 },

 render(){
 this.home.render();
 this.inv.render();
 this.ord.render();
 this.finance.render();
 this.rep.render();
 this.preview.render();
 this.webControl.render();
 this.settings.render();
 this.updateBadges();
 },

 updateBadges(){
 let pendingOrders = state.data.websiteOrders.filter(o=>!o.status || o.status==='Pending' || o.status==='Processing' || o.status==='Confirmed');
 const pendingCount = new Set(pendingOrders.map(o => o.orderId)).size;
 
 const b = $('nav-orders-badge');
 if(pendingCount>0){ b.textContent = toBn(pendingCount); b.classList.remove('hidden'); }
 else b.classList.add('hidden');
 
 const woc = $('web-orders-count');
 if (woc) woc.textContent = pendingCount>0 ? toBn(pendingCount)+' Pending' : 'All Clear';

 // Calculate unread notifications based on clearedTime
 const clearedTime = parseInt(_ls('yarz_notif_cleared') || '0', 10);
 const unreadItems = pendingOrders.filter(o => !o.date || o.date.getTime() > clearedTime);
 const unreadCount = new Set(unreadItems.map(o => o.orderId)).size;

 // Notification bell indicator
 const notifBtn = $('notif-btn');
 if(notifBtn){
 if(unreadCount>0) notifBtn.classList.add('has-notif');
 else notifBtn.classList.remove('has-notif');
 }
 // Notification count badge inside panel
 const npc = $('np-count');
 if(npc){
 if(unreadCount>0){ npc.textContent = toBn(unreadCount); npc.classList.remove('hidden'); }
 else npc.classList.add('hidden');
 }

 const threshold = int(state.data.settings['Low Stock Threshold']||5);
 let low = 0;
 state.data.inventory.forEach(p=>{
 if(p.status!=='Active') return;
 // ✅ v16.1 ONE-SIZE: only check the M slot for sizeless products, else the
 // 5 always-zero size slots count every one-size product as "low" (matches
 // the showLowStock modal guard so the badge and modal agree).
 if(_isOneSizeP(p)){ if((p.stkM-p.soldM) <= threshold) low++; return; }
 const sizes = [p.stkS-p.soldS, p.stkM-p.soldM, p.stkL-p.soldL, p.stkXL-p.soldXL, p.stkXXL-p.soldXXL, p.stk3XL-p.sold3XL];
 if(sizes.some(s=>s<=threshold)) low++;
 });
 $('lowstock-count').textContent = low>0 ? toBn(low)+' Items' : 'All good';

 // If notification panel is open, re-render it
 if($('notif-panel') && $('notif-panel').classList.contains('show')){
 this.renderNotifications();
 }
 },

 // New-order detection (polling will call this)
 _lastOrderIds: new Set(),
 detectNewOrders(){
 const ws = state.data.websiteOrders;
 const currentIds = new Set(ws.map(o=>o.orderId));
 if(this._lastOrderIds.size === 0){
 this._lastOrderIds = currentIds;
 return;
 }
 const newOnes = [...currentIds].filter(id => !this._lastOrderIds.has(id));
 if(newOnes.length > 0){
 // Play subtle beep (optional) + toast
 toast(`🔔 ${toBn(newOnes.length)} items New Order !`, 'success');
 // Browser notification (if permission)
 if(typeof Notification !== 'undefined' && Notification.permission === 'granted'){
  new Notification('YARZ PRO — New Order', {
  body: `${newOnes.length} items new Website Orders `,
  icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Crect width='120' height='120' rx='24' fill='%23111827'/%3E%3Ccircle cx='60' cy='60' r='50' fill='%23C8102E' stroke='%23E8D9B8' stroke-width='3'/%3E%3Ccircle cx='60' cy='60' r='31' fill='none' stroke='%23FBF8F1' stroke-width='3.5' opacity='0.85'/%3E%3Ccircle cx='49' cy='49' r='6' fill='%23FBF8F1'/%3E%3Ccircle cx='71' cy='49' r='6' fill='%23FBF8F1'/%3E%3Ccircle cx='49' cy='71' r='6' fill='%23FBF8F1'/%3E%3Ccircle cx='71' cy='71' r='6' fill='%23FBF8F1'/%3E%3C/svg%3E"
  });
 }
 }
 this._lastOrderIds = currentIds;
 },

 // ----- Navigation -----
 goPage(page){
 state.currentPage = page;
 qsa('.page').forEach(el=>el.classList.remove('active'));
 const target = qs(`.page[data-page="${page}"]`);
 if(target) target.classList.add('active');
 qsa('.nav-item').forEach(n=>n.classList.remove('active'));
 qsa(`.nav-item[data-page="${page}"]`).forEach(n=>n.classList.add('active'));
 qsa('.bn-item').forEach(n=>n.classList.remove('active'));
 qsa(`.bn-item[data-page="${page}"]`).forEach(n=>n.classList.add('active'));
 const titles = {
 home: ['Dashboard','Today\'s overview'],
 inventory:['Inventory','Products no/not'],
 orders:['Orders','Orders which'],
 finance:['Finance','and/more '],
 reports:['Reports','Monthly Yearly'],
 preview:['Website preview','buyer '],
 settings:['Settings',' config']
 };
 const t = titles[page]||[page,''];
 $('topbar-title').textContent = t[0];
 $('topbar-sub').textContent = t[1];
 window.scrollTo({top:0,behavior:'smooth'});
 },

 // ----- Theme (Default: Light CoachPro mint) -----
 toggleTheme(){
 document.body.classList.toggle('dark');
 const isDark = document.body.classList.contains('dark');
 _ls('yarz_theme', isDark?'dark':'light');
 const cls = isDark ? 'ri-sun-line' : 'ri-moon-line';
 const t1 = $('theme-icon'); if(t1) t1.className = cls;
 const t2 = $('theme-icon-side'); if(t2) t2.className = cls;
  // ✅ v17.4 FIX: Use querySelectorAll + loop to update BOTH theme-color metas
  // (light + dark media variants). Old single-querySelector() only updated the
  // first match — in dark mode the dark-variant meta stayed cream and the
  // address bar showed the wrong color when system was in dark mode.
  document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){ m.setAttribute('content', isDark ? '#0D1117' : '#E8EEE8'); });
 },

 // ----- Notification Panel Toggle -----
 toggleNotif(){
 const panel = $('notif-panel');
 panel.classList.toggle('show');
 if(panel.classList.contains('show')) this.renderNotifications();
 },

 closeNotif(){
 $('notif-panel').classList.remove('show');
 },

 clearNotifications() {
 _ls('yarz_notif_cleared', Date.now().toString());
 this.renderNotifications();
 this.updateBadges(); // ✅ v10.5 Fix: Clear red dot immediately
 toast('All Notifications ', 'success');
 },

 renderNotifications(){
 const ws = state.data.websiteOrders;
 let pending = ws.filter(o=>!o.status || o.status==='Pending' || o.status==='Processing' || o.status==='Confirmed');
 
 // ✅ v10.5: Respect cleared time
 const clearedTime = parseInt(_ls('yarz_notif_cleared') || '0', 10);
 pending = pending.filter(o => !o.date || o.date.getTime() > clearedTime);

 // ✅ v10.5: Group by orderId to prevent multiple notifications for same checkout
 const orderGroups = new Map();
 pending.forEach(o => {
 let g = orderGroups.get(o.orderId);
 if (!g) {
  g = { ...o, itemsCount: 0, totalAmount: 0, products: [] };
  orderGroups.set(o.orderId, g);
 }
 g.itemsCount++;
 g.totalAmount += parseFloat(o.total) || ((parseFloat(o.price)||0) * parseInt(o.qty||1));
 g.products.push(o);
 });
 pending = Array.from(orderGroups.values());

 // Sort newest first
 pending.sort((a,b)=> (b.date?b.date.getTime():0) - (a.date?a.date.getTime():0));
 
 const list = $('notif-list');
 const header = document.querySelector('.notif-panel-header');
 
 // Add Clear Button to header if not exists
 if (header && !header.querySelector('.notif-clear-btn')) {
 header.innerHTML += `<button class="notif-clear-btn" onclick="YARZ.clearNotifications()" style="background:transparent;border:none;color:var(--ink-3);cursor:pointer;font-size:12px;margin-left:auto;padding:4px 8px;border-radius:4px;"><i class="ri-check-double-line"></i> Clear All</button>`;
 header.style.display = 'flex';
 header.style.alignItems = 'center';
 }

 if(!pending.length){
 list.innerHTML = '<div class="notif-empty"><i class="ri-notification-off-line" style="font-size:24px;opacity:0.4"></i><p style="margin-top:8px">No new notifications</p></div>';
 $('np-count').classList.add('hidden');
 return;
 }
 
 $('np-count').textContent = toBn(pending.length);
 $('np-count').classList.remove('hidden');

 // ✅ v10.5: Group by Date (Today, Yesterday, Older)
 const groups = { today: [], yesterday: [], older: [] };
 const todayStr = new Date().toDateString();
 const yestDate = new Date(); yestDate.setDate(yestDate.getDate()-1);
 const yestStr = yestDate.toDateString();

 pending.forEach(o => {
 if (!o.date) { groups.older.push(o); return; }
 const dStr = o.date.toDateString();
 if (dStr === todayStr) groups.today.push(o);
 else if (dStr === yestStr) groups.yesterday.push(o);
 else groups.older.push(o);
 });

 let html = '';
 const renderGroup = (title, items) => {
 if (!items.length) return '';
 let grpHtml = `<div style="padding:8px 16px;font-size:11px;font-weight:700;color:var(--ink-3);background:var(--surface-1);border-top:1px solid var(--line);border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:0.5px">${title}</div>`;
 grpHtml += items.map(o=>`
  <div class="notif-item" onclick="YARZ.closeNotif();YARZ.goPage('orders');YARZ.ord.setTab('website');YARZ.ord.setStage('new');setTimeout(()=>{const el=document.getElementById('ord-${esc(o.orderId)}');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.outline='2px solid var(--accent)';setTimeout(()=>el.style.outline='',1500);}},200)">
  <div class="ni-dot"></div>
  <div class="ni-body" style="width:100%">
  <div class="ni-title" style="display:flex;justify-content:space-between;align-items:center">
   <span>🛍️ Order #${esc(o.orderId)}</span>
   <span style="font-weight:400;color:var(--ink-3);font-size:10.5px">${esc(o.customer||'Customer')}</span>
  </div>
  
  <div style="margin:6px 0; background:rgba(0,0,0,0.02); padding:6px; border-radius:6px; border:1px solid rgba(0,0,0,0.04)">
   ${o.products.map(p => `
   <div style="display:flex; justify-content:space-between; font-size:11.5px; margin-bottom:3px; color:var(--ink-2); line-height:1.4;">
   <span style="flex:1; padding-right:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
    <b style="color:var(--ink-1)">${toBn(p.qty||1)}x</b> ${esc(p.product)} <span style="opacity:0.7">${p.size ? `(${esc(_ordSize(p.size))})` : ''}</span>
   </span>
   <span style="font-weight:600; flex-shrink:0;">${fmtBDT((parseFloat(p.price)||0)*(parseInt(p.qty)||1))}</span>
   </div>
   `).join('')}
   <div style="border-top:1px dashed var(--line); margin-top:4px; padding-top:4px; display:flex; justify-content:space-between; font-size:11px;">
   <span style="color:var(--ink-3)">Delivery Charge</span>
   <span style="font-weight:600; color:var(--ink-2)">${fmtBDT(o.delivery||0)}</span>
   </div>
  </div>

  <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
   <span style="font-size:12.5px; font-weight:700; color:var(--accent)">Total: ${fmtBDT(o.totalAmount)}</span>
   <span style="font-size:10px; color:var(--ink-3);"><i class="ri-phone-line"></i> ${esc(o.phone||'')}</span>
  </div>
  <div class="ni-meta" style="margin-top:2px; font-size:10px; opacity:0.7;">${o.date?relativeTime(o.date):''}</div>
  </div>
  </div>
 `).join('');
 return grpHtml;
 };

 html += renderGroup('Today (Today)', groups.today);
 html += renderGroup('Yesterday (Yesterday)', groups.yesterday);
 html += renderGroup('Old (Older)', groups.older);

 // Remove top border from first group
 html = html.replace('border-top:1px solid var(--line);', '');
 
 list.innerHTML = html;
 },

  // ----- Logout -----
  // ✅ v17.5 PHASE 3: Route to the new adminLogout() that wipes the
  // session token both client-side (sessionStorage) and server-side
  // (appsPost 'adminLogout') and shows the login screen. Falls back to
  // a hard reload if the helper hasn't loaded yet (defensive).
  logout(){
   try { adminLogout(); }
   catch(e){
    try { sessionStorage.removeItem('yarz_auth'); } catch(e) {}
    location.reload();
   }
  },

 // ----- Modal -----
 modalStack: [],
 openModal(type, data){
 const overlay = $('modal-overlay');
 const content = $('modal-content');
 content.innerHTML = modalBuilders[type] ? modalBuilders[type](data||{}) : '<p>Not found</p>';
 overlay.classList.add('show');
 // Setup size on large modals
 if(type==='add-product' || type==='edit-product') content.style.maxWidth='640px';
 else content.style.maxWidth='560px';
 // ✅ v16.1 ONE-SIZE: a programmatically-prefilled product <select> does NOT
 // fire its onchange, so the size dropdown + stock preview never refresh —
 // a one-size product (e.g. opening "Sales" from a Cap's details) would show
 // the static 6-size list and a false "S out of stock". Fire the preview
 // manually for the sale/order/return modals so the size UI collapses to
 // "One Size" when the prefilled product is sizeless.
 try {
 const pfxMap = { 'sale-entry':'se', 'new-order':'o', 'return':'rt' };
 const pfx = pfxMap[type];
 if(pfx && $(pfx+'-product') && $(pfx+'-product').value){
  if(typeof YARZ._showProductPreview === 'function') YARZ._showProductPreview(pfx);
  if(typeof YARZ._updateStkBadge === 'function') YARZ._updateStkBadge(pfx);
 }
 } catch(e){}
 // Autofocus
 setTimeout(()=>{ const f = content.querySelector('input,select,textarea'); if(f) f.focus(); }, 100);
 },
 closeModal(){
 $('modal-overlay').classList.remove('show');
 }
};

// ============ LOGIN ============
function setupLogin(){
  // CSRF token generation
  (function(){
    var mt = document.querySelector('meta[name="csrf-token"]');
    if(mt && !mt.getAttribute('content')){
      var tok = Math.random().toString(36).substring(2,10)+'_'+Date.now().toString(36);
      mt.setAttribute('content', tok);
      window._csrfToken = tok;
    }
  })();
  // Apply theme to login screen too
  if(_ls('yarz_theme')==='dark'){
  document.body.classList.add('dark');
  // ✅ v17.4 FIX: update ALL theme-color metas (light + dark variants)
  document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){ m.setAttribute('content','#0E0E0E'); });
  }
  // ✅ v17.5 PHASE 3: Session-token restore. The old code round-tripped
  // the actual password (base64 in sessionStorage) so write operations
  // could work after refresh. That meant the plaintext password sat in
  // devtools AND in sessionStorage. Now we only persist the opaque
  // session token + its expiry. The server will reject expired tokens
  // with 401 → client auto-redirects to login.
  const _sessToken = _ss('yarz_session_token');
  const _sessExp  = parseInt(_ss('yarz_session_expiresAt')||'0', 10);
  if(_sessToken && _sessExp && Date.now() < _sessExp){
   window._adminToken = _sessToken;
   // Auto-refresh the expiry 5 minutes before the real expiry so the
   // user doesn't get kicked out mid-edit. The server still enforces
   // its own TTL — this is purely a UX hint.
   _adminScheduleRefresh();
   showApp();
   return;
  } else if(_sessToken){
   // Expired — clean up
   _adminClearSession();
  }

  const doLogin = async (e)=>{
  if(e) e.preventDefault();
  // Check lock
  const now = Date.now();
  if(LOGIN_LOCK.lockedUntil > now){
  const secs = Math.ceil((LOGIN_LOCK.lockedUntil - now)/1000);
  const err = $('login-error');
  err.innerHTML = '<i class="ri-lock-line"></i> many wrong/incorrect attempt! '+secs+' ';
  err.classList.add('show');
  return;
  }

  const u = $('login-user').value.trim();
  const p = $('login-pass').value.trim(); // Trim password to prevent copy-paste space issues

  // Compute SHA-256 of both, also fall back to direct compare
  const btn = $('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i> which Processing...';

  let ok = false;
  let _serverLock = 0;
  try {
  if(p) {
   // ✅ v17.5: Call adminLogin instead of verify_auth. Server validates
   // the password with a constant-time compare, checks IP-based rate
   // limit, and on success returns a 64-char hex session token.
   const res = await appsPost('adminLogin', { adminUser: u, adminPass: p, userAgent: navigator.userAgent });
   if(res && res.success && res.token){
     window._adminToken = res.token;
     sessionStorage.setItem('yarz_session_token', res.token);
     sessionStorage.setItem('yarz_session_expiresAt', String(res.expiresAt || (Date.now() + (res.ttlMs || 30*60*1000))));
     ok = true;
   }
   if(res && res.locked) {
     _serverLock = res.retryAfter || 60;
   }
  }
  } catch(e){
  console.error("Login verification failed", e);
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ri-login-box-line"></i> Sign In';

  if(ok){
  LOGIN_LOCK.attempts = 0;
  _adminScheduleRefresh();
  showApp();
  } else {
  LOGIN_LOCK.attempts++;
  if(LOGIN_LOCK.attempts >= LOGIN_LOCK.MAX_ATTEMPTS){
   LOGIN_LOCK.lockedUntil = Date.now() + LOGIN_LOCK.LOCK_DURATION;
   LOGIN_LOCK.attempts = 0;
  }
  const err = $('login-error');
  let msg;
  if (_serverLock > 0) {
   msg = '<i class="ri-lock-line"></i> Server locked. Try again in ' + _serverLock + 's.';
   LOGIN_LOCK.lockedUntil = Date.now() + (_serverLock * 1000);
  } else {
   msg = '<i class="ri-error-warning-line"></i> Incorrect username or password '+
   (LOGIN_LOCK.attempts>0 ? ' ('+(LOGIN_LOCK.MAX_ATTEMPTS-LOGIN_LOCK.attempts)+' items attempt remaining)' : '');
  }
  err.innerHTML = msg;
  err.classList.add('show');
  setTimeout(()=>err.classList.remove('show'), 4000);
  $('login-pass').value = '';
  $('login-pass').focus();
  }
  };
  $('login-btn').onclick = doLogin;
  $('login-pass').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(e); });
  $('login-user').addEventListener('keydown', e=>{ if(e.key==='Enter') { e.preventDefault(); $('login-pass').focus(); } });
  $('login-user').focus();
}

// ✅ v17.5 PHASE 3: Session helpers.
function _adminClearSession(){
  try {
    if (window._adminToken) {
      // Fire-and-forget logout so the server-side session is marked
      // revoked immediately. Don't await — we still want the local
      // clear to be instant.
      try { appsPost('adminLogout', { sessionToken: window._adminToken }); } catch(e) {}
    }
  } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem('yarz_session_token'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_session_expiresAt'); } catch (e) {}
  // Wipe legacy v15.99 keys (just in case an old browser profile
  // migrated from a previous version still has them).
  try { sessionStorage.removeItem('yarz_auth'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_auth_time'); } catch (e) {}
  try { sessionStorage.removeItem('yarz_ak'); } catch (e) {}
  window._adminToken = '';
}

// Auto-refresh the session 5 minutes before its expiry. The server TTL
// is the real authority; this is just UX — without it the user gets
// kicked out mid-edit when the token naturally expires. We poll the
// verify endpoint silently; if the server says the token is bad we
// drop to the login screen.
var _adminRefreshTimer = null;
function _adminScheduleRefresh(){
  try { if (_adminRefreshTimer) clearTimeout(_adminRefreshTimer); } catch(e) {}
  try {
    var exp = parseInt(sessionStorage.getItem('yarz_session_expiresAt')||'0', 10);
    if (!exp) return;
    var msUntilRefresh = Math.max(60 * 1000, exp - Date.now() - 5 * 60 * 1000);
    _adminRefreshTimer = setTimeout(function(){
      appsPost('verify_auth', { sessionToken: window._adminToken })
        .then(function(res){
          if (res && res.success) {
            // Server still happy. Push expiry out by another 30 min so
            // the next refresh is also 5 min before that.
            var newExp = Date.now() + 30 * 60 * 1000;
            _ss('yarz_session_expiresAt', String(newExp));
            _adminScheduleRefresh();
          } else {
            _adminClearSession();
            try { showLoginScreen(); } catch(e) {}
          }
        })
        .catch(function(){ _adminScheduleRefresh(); }); // network blip, try again
    }, msUntilRefresh);
  } catch (e) { /* ignore */ }
}

// ✅ v17.5 PHASE 3: Public logout function. Wipes the session both
// client-side and (best-effort) server-side. Bound to the existing
// "Sign out" UI in the admin header.
function adminLogout(){
  _adminClearSession();
  try { showLoginScreen(); } catch(e) {}
  try { toast('Signed out.', 'info'); } catch(e) {}
}

// ✅ v17.5 PHASE 3: Inverse of showApp. Used when the session token is
// rejected (401) by the server, when the user clicks "Logout", and when
// the auto-refresh fails. Idempotent — safe to call multiple times.
function showLoginScreen(){
 try { $('app').classList.add('hidden'); } catch (e) {}
 try { $('login-screen').style.display = 'flex'; } catch (e) {}
 try { $('login-pass').value = ''; } catch (e) {}
 try { $('login-pass').focus(); } catch (e) {}
 try { if (_adminRefreshTimer) { clearTimeout(_adminRefreshTimer); _adminRefreshTimer = null; } } catch (e) {}
}

function showApp(){
 $('login-screen').style.display = 'none';
 $('app').classList.remove('hidden');

 // Theme restore (default: light; saved 'dark' enables dark mode)
  if(_ls('yarz_theme')==='dark'){
  document.body.classList.add('dark');
  const cls = 'fas fa-sun';
  const t1 = $('theme-icon'); if(t1) t1.className = cls;
  const t2 = $('theme-icon-side'); if(t2) t2.className = cls;
  // ✅ v17.4 FIX: update ALL theme-color metas (light + dark variants)
  document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){ m.setAttribute('content','#0E0E0E'); });
  }

 // Load settings from localStorage
 // ✅ v3.8: SETTINGS_VERSION check — if version mismatch , credentials
 // ( API key/URL/Sheet ID) auto-reset will be new DEFAULTS । this "Invalid API Key"
 // Error backend key after happens।
  let sav;
  try { sav = JSON.parse(_ls('yarz_settings')||'{}'); } catch(e) { sav = {}; }
  if(sav.__v !== SETTINGS_VERSION){
 console.log('[YARZ] Settings version mismatch — auto-resetting to new defaults');
 sav = { appsUrl: DEFAULT_APPS_URL, sheetId: DEFAULT_SHEET_ID, apiKey: DEFAULT_API_KEY, __v: SETTINGS_VERSION };
_ls('yarz_settings', JSON.stringify(sav));
  }
  state.sheetId = sav.sheetId || DEFAULT_SHEET_ID;
 state.apiKey = sav.apiKey || DEFAULT_API_KEY;
 // ★ if localStorage- URL no/not remains, code URL use will be
 state.appsUrl = sav.appsUrl || DEFAULT_APPS_URL;

 // Wire nav
 qsa('.nav-item[data-page], .bn-item[data-page]').forEach(el=>{
 el.addEventListener('click', ()=> YARZ.goPage(el.dataset.page));
 });

 // Click outside modal to close disabled to prevent accidental data loss
 $('modal-overlay').addEventListener('click', (e)=>{
 // if(e.target.id === 'modal-overlay') YARZ.closeModal();
 });

 // Today's date in topbar
 const now = new Date();
 const tdEl = $('today-date'); if(tdEl) tdEl.textContent = fmtDateBn(now)+' • '+fmtTimeBn(now);

 // Ask browser for notification permission (optional)
 if(typeof Notification !== 'undefined' && Notification.permission === 'default'){
 setTimeout(()=>{ try{ Notification.requestPermission(); }catch(e){} }, 3000);
 }

 // Click outside notification panel to close
 document.addEventListener('click', (e)=>{
 const panel = $('notif-panel');
 const btn = $('notif-btn');
 if(!panel || !btn) return;
 if(panel.classList.contains('show') && !panel.contains(e.target) && !btn.contains(e.target)){
 panel.classList.remove('show');
 }
 });

 // Initial data load
 YARZ.loadAll();

 // Auto-refresh every 60 seconds to catch new website orders
 setInterval(()=>{
 if(document.visibilityState === 'visible'){
 YARZ.silentRefresh();
 }
 }, 60000);

 // Refresh when tab becomes visible again
 document.addEventListener('visibilitychange', ()=>{
 if(document.visibilityState === 'visible' && state.loaded){
 YARZ.silentRefresh();
 // ✅ v15.28: Also refresh visitor stats when tab becomes visible.
 try {
  const homePage = document.querySelector('.page[data-page="home"]');
  if (homePage && homePage.classList.contains('active') && YARZ.home && YARZ.home.loadVisitorStats) {
  YARZ.home.loadVisitorStats();
  }
 } catch(e) {}
 }
 });
}

/* ============================================================
 ============ HOME MODULE ============
============================================================ */
YARZ.home = {
 render(){
 const inv = state.data.inventory;
 const activeItems = inv.filter(p=>p.status==='Active');
 const draftItems = inv.filter(p=>p.status==='Draft');
 const totalRev = inv.reduce((s,p)=>s+p.revenue, 0);
 const totalNet = inv.reduce((s,p)=>s+p.net, 0);

   // ✅ v2.0: replace lifetime cards with "This Month" cards
  let thisMonth = state.data.currentMonthSnapshot || null;
  let lastMonth = state.data.lastMonthSnapshot || null;
  const pad = m => String(m).padStart(2,'0');
  const ym = (d) => d.getFullYear() + '-' + pad(d.getMonth()+1);

  if (!thisMonth) {
    // Lazy fetch on first render
    fetch(WORKER + '/__currentMonthSnapshot', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': window._adminToken || ''
      },
      body: JSON.stringify({})
    })
    .then(r => r.json())
    .then(j => {
      if (j && j.success) {
        state.data.currentMonthSnapshot = j;
        YARZ.home.render();
      }
    })
    .catch(() => {});
  }

  // Also fetch last month for comparison
  if (!lastMonth) {
    const lmDate = new Date();
    lmDate.setMonth(lmDate.getMonth() - 1);
    fetch(WORKER + '/__currentMonthSnapshot', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': window._adminToken || ''
      },
      body: JSON.stringify({
        year: lmDate.getFullYear(),
        month: lmDate.getMonth() + 1
      })
    })
    .then(r => r.json())
    .then(j => {
      if (j && j.success) {
        state.data.lastMonthSnapshot = j;
        YARZ.home.render();
      }
    })
    .catch(() => {});
  }

  // Build the "This Month" stats array
  const tmRev = thisMonth ? thisMonth.revenue : 0;
  const tmNet = thisMonth ? thisMonth.net_profit : 0;
  const lmRev = lastMonth ? lastMonth.revenue : 0;
  const lmNet = lastMonth ? lastMonth.net_profit : 0;
  const revChange = lmRev > 0
    ? (((tmRev - lmRev) / lmRev) * 100).toFixed(1) : null;
  const netChange = lmNet > 0
    ? (((tmNet - lmNet) / lmNet) * 100).toFixed(1) : null;

  const stats = [
    { icon:'green', ic:'ri-shopping-bag-3-line', label:'Active Products', val:toBn(activeItems.length), sub:'Click to view', onClick:"YARZ.home.showList('active')" },
    { icon:'amber', ic:'ri-draft-line', label:'Draft Products', val:toBn(draftItems.length), sub:'Click to view', onClick:"YARZ.home.showList('draft')" },
    { icon:'blue', ic:'ri-money-dollar-circle-line', label:'This Month Revenue', val:fmtBDT(tmRev), sub: revChange !== null ? (revChange >= 0 ? '↑ ' : '↓ ') + toBn(Math.abs(revChange)) + '% vs last month' : 'No prior month' },
    { icon: tmNet >= 0 ? 'purple' : 'red', ic:'ri-line-chart-line', label:'This Month Profit', val:fmtBDT(tmNet), sub: netChange !== null ? (netChange >= 0 ? '↑ ' : '↓ ') + toBn(Math.abs(netChange)) + '% vs last month' : (tmNet >= 0 ? 'Profit' : 'Loss') }
  ];

 $('home-stats').innerHTML = stats.map(s=>`
 <div class="stat-card ${s.onClick?'clickable':''}" ${s.onClick?`onclick="${s.onClick}"`:''}>
  <div class="stat-icon ${s.icon}"><i class="${s.ic}"></i></div>
  <div class="stat-label">${s.label}</div>
  <div class="stat-value">${s.val}</div>
  <div class="stat-sub">${s.sub}</div>
 </div>
 `).join('');

 // Today's summary
 const today = new Date(); today.setHours(0,0,0,0);
 const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
 const todayTx = state.data.transactions.filter(t=>t.date && t.date>=today && t.date<tomorrow);
 const todayAd = state.data.adTracker.filter(t=>t.date && t.date>=today && t.date<tomorrow);
 const todayExp = state.data.expenses.filter(t=>t.date && t.date>=today && t.date<tomorrow);
 const todayRev = todayTx.filter(t=>t.type!=='Return').reduce((s,t)=>s+t.revenue,0);
 const todayCost= todayTx.filter(t=>t.type!=='Return').reduce((s,t)=>s+t.cost,0);
 const todaySpend = todayAd.reduce((s,t)=>s+t.amount,0) + todayExp.reduce((s,t)=>s+t.amount,0);
 const todayProfit = todayRev-todayCost-todaySpend;

 $('today-summary').innerHTML = `
 <div class="stat-card">
  <div class="stat-icon blue"><i class="ri-shopping-cart-2-line"></i></div>
  <div class="stat-label">Today's sales</div>
  <div class="stat-value">${fmtBDT(todayRev)}</div>
  <div class="stat-sub">${toBn(todayTx.length)} items give</div>
 </div>
 <div class="stat-card">
  <div class="stat-icon red"><i class="ri-money-dollar-box-line"></i></div>
  <div class="stat-label">Today's expenses</div>
  <div class="stat-value">${fmtBDT(todaySpend)}</div>
  <div class="stat-sub">Ad + Expense</div>
 </div>
 <div class="stat-card">
  <div class="stat-icon ${todayProfit>=0?'green':'red'}"><i class="ri-coin-line"></i></div>
  <div class="stat-label">Today's profit</div>
  <div class="stat-value">${fmtBDT(todayProfit)}</div>
  <div class="stat-sub">Net</div>
 </div>
 `;

 // Top sellers
 const sorted = [...inv].filter(p=>p.totalSold>0).sort((a,b)=>b.totalSold-a.totalSold).slice(0,3);
 $('top-sellers').innerHTML = sorted.length ? sorted.map(p=>`
 <div class="list-item" onclick="YARZ.inv.showDetails('${esc(p.name)}')">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"ri-shopping-bag-3-line\"></i>'}</div>
  <div class="li-body">
  <div class="li-title">${esc(p.name)}</div>
  <div class="li-sub">${esc(p.category||'')} • ${fmtBDT(p.sale)}</div>
  </div>
  <div class="li-right">
  <span class="chip chip-green"><i class="ri-fire-line"></i> ${toBn(p.totalSold)}</span>
  <div style="font-size:10px;opacity:0.6">${fmtBDT(p.revenue)}</div>
  </div>
 </div>
 `).join('') : '<div class="empty-state"><i class="ri-trophy-line" style="font-size:32px;opacity:0.4"></i><p style="margin-top:10px">No sales yet</p></div>';

 // ✅ v15.28: Fire visitor stats fetch in background — non-blocking.
 // Errors are silenced so the home page never breaks if KV is missing.
 try { this.loadVisitorStats(); } catch(e) {}
 },

 // ─── Website Visitor Analytics (Cloudflare KV) ────────────────────
 // Endpoint: GET https://yarz.marufhasan80009.workers.dev/__analytics
 // Returns: { success, today, yesterday, total, last7, pending }
 // Auto-refresh: every 30s while admin is on Home page (visibility-aware).
 _vis: { timer: null, lastFetch: 0 },
 async loadVisitorStats(){
  const upd = $('visitor-updated');
 try {
 // 6-second timeout so a slow Worker never freezes the dashboard.
 const ctrl = new AbortController();
 const tid = setTimeout(() => { try { ctrl.abort(); } catch(e){} }, 6000);

  const resp = await fetch(WORKER + '/__analytics', { signal: ctrl.signal, cache: 'no-store' });
 clearTimeout(tid);

 if (!resp.ok) throw new Error('HTTP ' + resp.status);
 const j = await resp.json();
 if (!j || !j.success) throw new Error(j && j.error || 'Bad payload');

 const today = Number(j.today || 0);
 const yest = Number(j.yesterday || 0);
 const total = Number(j.total || 0);
 $('vis-today').textContent  = toBn(today);
 $('vis-yesterday').textContent = toBn(yest);
 $('vis-total').textContent  = toBn(total);

 const now = new Date();
 const hh = String(now.getHours()).padStart(2,'0');
 const mm = String(now.getMinutes()).padStart(2,'0');
 const ss = String(now.getSeconds()).padStart(2,'0');
 if (upd) upd.textContent = 'Update: ' + hh + ':' + mm + ':' + ss;
 this._vis.lastFetch = Date.now();
 } catch (e) {
 // Distinguish KV-not-configured from network/timeout errors.
 const msg = String(e && e.message || e);
 if (upd) {
  if (msg.indexOf('500') !== -1 || msg.indexOf('KV not') !== -1) {
  upd.textContent = '⚠️ KV namespace Not configured';
  } else if (msg.indexOf('aborted') !== -1) {
  upd.textContent = '⏱️ Timeout — Will retry later';
  } else {
  upd.textContent = '⚠️ load happens — ' + msg.slice(0, 40);
  }
 }
 $('vis-today').textContent  = $('vis-today').textContent  === '—' ? '—' : $('vis-today').textContent;
 $('vis-yesterday').textContent = $('vis-yesterday').textContent === '—' ? '—' : $('vis-yesterday').textContent;
 $('vis-total').textContent  = $('vis-total').textContent  === '—' ? '—' : $('vis-total').textContent;
 }

 // Schedule next refresh — only while Home is visible & tab active.
 if (this._vis.timer) clearTimeout(this._vis.timer);
 this._vis.timer = setTimeout(() => {
 // Re-render only if user is still on Home and tab is active
 const homePage = document.querySelector('.page[data-page="home"]');
 if (homePage && homePage.classList.contains('active') && document.visibilityState === 'visible') {
  this.loadVisitorStats();
 } else {
  // Tab hidden / page changed → stop polling, restart on visibility
  this._vis.timer = null;
 }
 }, 30000);
 },

 showList(kind){
 const items = state.data.inventory.filter(p=> kind==='active' ? p.status==='Active' : p.status==='Draft');
 const title = kind==='active' ? '🟢 Active Products' : '🟡 Draft Products';
 const html = `
 <div class="modal-header">
  <h3>${title}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div style="font-size:12px;opacity:0.7;margin-bottom:10px">${toBn(items.length)} items Products</div>
 <div class="list" style="max-height:60vh;overflow-y:auto">
  ${items.length ? items.map(p=>`
  <div class="list-item">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"fas fa-box\"></i>'}</div>
  <div class="li-body">
   <div class="li-title">${esc(p.name)}</div>
   <div class="li-sub">${fmtBDT(p.sale)} • Stock: ${toBn(Math.max(0,p.remaining))}</div>
  </div>
  <div class="li-right">
   <div class="li-actions">
   <button class="btn btn-blue btn-xs" onclick="YARZ.closeModal();YARZ.inv.showDetails('${esc(p.name)}')">👁 View</button>
   <button class="btn btn-ghost btn-xs" onclick="YARZ.closeModal();YARZ.inv.editProduct('${esc(p.name)}')">✏ Edit</button>
   ${kind==='draft' ? `
   <button class="btn btn-primary btn-xs" onclick="YARZ.inv.changeStatus('${esc(p.name)}','Active',true)">Activate</button>
   <button class="btn btn-ghost btn-xs" onclick="YARZ.inv.changeStatus('${esc(p.name)}','Archived',true)">Archive</button>
   ` : ''}
   </div>
  </div>
  </div>
  `).join('') : '<div class="empty-state"><i class="fas fa-inbox"></i><p>No products</p></div>'}
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 }
};

/* ============================================================
 ============ INVENTORY MODULE ============
============================================================ */
YARZ.inv = {
 render(){
 // Populate filters
 const cats = [...new Set(state.data.inventory.map(p=>p.category).filter(Boolean))].sort();
 const fabs = [...new Set(state.data.inventory.map(p=>p.fabric).filter(Boolean))].sort();
 const fc = $('inv-filter-cat'), ff = $('inv-filter-fab');
 const curC = fc.value, curF = ff.value;
 fc.innerHTML = '<option value="">All Category</option>'+cats.map(c=>`<option ${c===curC?'selected':''}>${esc(c)}</option>`).join('');
 ff.innerHTML = '<option value="">All Fabric</option>'+fabs.map(f=>`<option ${f===curF?'selected':''}>${esc(f)}</option>`).join('');

 // ✅ v11.1: Render top summary widget (per-category counts + stock)
 this.renderSummary();

 const q = ($('inv-search').value||'').toLowerCase().trim();
 const st = $('inv-filter-status').value;
 const c = $('inv-filter-cat').value;
 const f = $('inv-filter-fab').value;

 let items = state.data.inventory.slice();
 if(st) items = items.filter(p=>p.status===st);
 if(c) items = items.filter(p=>p.category===c);
 if(f) items = items.filter(p=>p.fabric===f);
 if(q) items = items.filter(p=>(p.name+' '+p.category+' '+p.fabric).toLowerCase().includes(q));

 $('inv-list').innerHTML = items.length ? items.map(p=>{
 const stockLeft = Math.max(0, p.remaining);
 const lowStock = stockLeft<5;
 return `
 <div class="list-item">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"ri-shopping-bag-3-line\"></i>'}</div>
  <div class="li-body">
  <div class="li-title">${esc(p.name)}</div>
  <div class="li-sub">
  <span class="chip ${p.status==='Active'?'chip-green':p.status==='Draft'?'chip-amber':'chip-gray'}">${esc(p.status)}</span>
  ${p.badge?`<span class="chip chip-purple">${esc(p.badge)}</span>`:''}
  ${lowStock?`<span class="chip chip-red">Low</span>`:''}
  <span style="opacity:0.7">${esc(p.category||'—')}</span>
  </div>
  <div class="li-sub">${_isOneSizeP(p)?('One Size: '+toBn(p.stkM-p.soldM)):('S:'+toBn(p.stkS-p.soldS)+' M:'+toBn(p.stkM-p.soldM)+' L:'+toBn(p.stkL-p.soldL)+' XL:'+toBn(p.stkXL-p.soldXL)+' XXL:'+toBn(p.stkXXL-p.soldXXL)+' 3XL:'+toBn(p.stk3XL-p.sold3XL))} • Sold: ${toBn(p.totalSold)}</div>
  </div>
  <div class="li-right">
  <div class="price">${fmtBDT(p.sale)}</div>
  <div style="font-size:10px;opacity:0.5;text-decoration:line-through">${p.regular>p.sale?fmtBDT(p.regular):''}</div>
  <div class="li-actions">
  <button class="btn btn-primary btn-xs" onclick="YARZ.inv.showDetails('${esc(p.name)}')"><i class="ri-eye-line"></i></button>
  <button class="btn btn-blue btn-xs" onclick="YARZ.inv.editProduct('${esc(p.name)}')"><i class="ri-pencil-line"></i></button>
  <button class="btn btn-red btn-xs" onclick="YARZ.inv.deleteProduct('${esc(p.name)}')"><i class="ri-delete-bin-6-line"></i></button>
  </div>
  </div>
 </div>`;
 }).join('') : '<div class="empty-state"><i class="ri-archive-line" style="font-size:32px;opacity:0.4"></i><p style="margin-top:10px">No products found</p></div>';
 },

 // ✅ v11.1: Per-category inventory summary widget
 renderSummary(){
 const grid = $('inv-summary-grid');
 if(!grid) return;
 const inv = state.data.inventory || [];
 if(!inv.length){
 grid.innerHTML = '<div style="grid-column:1/-1;padding:14px;text-align:center;color:var(--ink-3);font-size:12px">No products</div>';
 return;
 }

 // Helpers — one product's total left & total sold across all 6 sizes
 const stockOf = (p) =>
 Math.max(0, (p.stkS||0)-(p.soldS||0)) +
 Math.max(0, (p.stkM||0)-(p.soldM||0)) +
 Math.max(0, (p.stkL||0)-(p.soldL||0)) +
 Math.max(0, (p.stkXL||0)-(p.soldXL||0)) +
 Math.max(0, (p.stkXXL||0)-(p.soldXXL||0)) +
 Math.max(0, (p.stk3XL||0)-(p.sold3XL||0));
 const soldOf = (p) =>
 (p.totalSold != null ? Number(p.totalSold) :
  ((p.soldS||0)+(p.soldM||0)+(p.soldL||0)+(p.soldXL||0)+(p.soldXXL||0)+(p.sold3XL||0)));

 // Group by category — count active+draft+archived separately + stock totals
 const groups = {};
 inv.forEach(p => {
 const cat = (p.category || '').trim() || 'Uncategorized';
 if(!groups[cat]) groups[cat] = { count:0, active:0, draft:0, archived:0, stock:0, sold:0, lowStock:0 };
 const g = groups[cat];
 g.count++;
 const s = String(p.status||'').toLowerCase();
 if(s === 'active') g.active++;
 else if(s === 'draft') g.draft++;
 else if(s === 'archived') g.archived++;
 const left = stockOf(p);
 g.stock += left;
 g.sold += soldOf(p);
 if(left > 0 && left < 5) g.lowStock++;
 });

 // Totals
 const total = { count:inv.length, active:0, draft:0, archived:0, stock:0, sold:0, lowStock:0 };
 Object.values(groups).forEach(g => {
 total.active += g.active; total.draft += g.draft; total.archived += g.archived;
 total.stock += g.stock; total.sold += g.sold; total.lowStock += g.lowStock;
 });

 // Build HTML — Total tile first (purple), then per-category tiles
 const tile = (label, g, isTotal) => {
 const accent = isTotal ? 'linear-gradient(135deg,#7C3AED,#A855F7)' : 'var(--surface-2)';
 const fg = isTotal ? '#fff' : 'var(--ink)';
 const fg2 = isTotal ? 'rgba(255,255,255,0.85)' : 'var(--ink-3)';
 const subStock = g.stock === 0 ? 'No stock' : (g.lowStock ? `${toBn(g.lowStock)} low stock` : 'OK');
 return `
  <div class="inv-summary-tile" style="background:${accent};color:${fg};${isTotal?'box-shadow:0 6px 18px rgba(124,58,237,0.25)':''}">
  <div class="ist-label" style="color:${fg2}">${esc(label)}</div>
  <div class="ist-main">
  <div class="ist-num">${toBn(g.count)}</div>
  <div class="ist-sub" style="color:${fg2}">Product</div>
  </div>
  <div class="ist-row">
  <span class="ist-pill" style="background:${isTotal?'rgba(255,255,255,0.18)':'var(--surface-1)'};color:${fg}">📦 Stock: ${toBn(g.stock)}</span>
  <span class="ist-pill" style="background:${isTotal?'rgba(255,255,255,0.18)':'var(--surface-1)'};color:${fg}">💰 Sold: ${toBn(g.sold)}</span>
  </div>
  <div class="ist-status" style="color:${fg2}">
  🟢 ${toBn(g.active)} • 📝 ${toBn(g.draft)} • 📦 ${toBn(g.archived)}${g.lowStock?` • ⚠ ${toBn(g.lowStock)} low`:''}
  </div>
  </div>`;
 };

 const sortedCats = Object.keys(groups).sort((a,b)=> groups[b].count - groups[a].count);
 let html = tile('In total (Total)', total, true);
 sortedCats.forEach(c => { html += tile(c, groups[c], false); });
 grid.innerHTML = html;
 },

 showDetails(name){
 const p = state.data.inventory.find(x=>x.name===name);
 if(!p){ toast('Not found','error'); return; }
 const totalLeft = (p.stkS-p.soldS)+(p.stkM-p.soldM)+(p.stkL-p.soldL)+(p.stkXL-p.soldXL)+(p.stkXXL-p.soldXXL)+(p.stk3XL-p.sold3XL);
 const html = `
 <div class="modal-header">
  <h3><i class="fas fa-box"></i> ${esc(p.name)}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="flex-gap mb-3" style="align-items:flex-start">
  ${(()=>{
  const imgs = [p.img1, p.img2, p.img3].map(x=>x?getImgSrc(x):'').filter(Boolean);
  const imgArrStr = esc(JSON.stringify(imgs));
  return `
  <div id="pd-slider" class="thumb" data-imgs="${imgArrStr}" data-idx="0" style="position:relative;width:90px;height:90px;${imgs.length?`background-image:url('${esc(imgs[0])}')`:''}">
  ${imgs.length>1 ? `
   <div style="position:absolute;top:50%;left:2px;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="event.stopPropagation(); window.slideImg('pd-slider', -1)"><i class="ri-arrow-left-s-line"></i></div>
   <div style="position:absolute;top:50%;right:2px;transform:translateY(-50%);background:rgba(0,0,0,0.5);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="event.stopPropagation(); window.slideImg('pd-slider', 1)"><i class="ri-arrow-right-s-line"></i></div>
  ` : ''}
  ${imgs.length?'':'<i class=\"fas fa-box\"></i>'}
  </div>`;
  })()}
  <div style="flex:1">
  <div class="flex-gap mb-2" style="flex-wrap:wrap">
  <span class="chip ${p.status==='Active'?'chip-green':p.status==='Draft'?'chip-amber':'chip-gray'}">${esc(p.status)}</span>
  ${p.badge?`<span class="chip chip-purple">${esc(p.badge)}</span>`:''}
  <span class="chip chip-blue">${esc(p.category||'')}</span>
  </div>
  <div style="font-size:13px;opacity:0.7">${esc(p.fabric||'')}</div>
  <div class="mt-2">
  <span class="price" style="font-size:20px">${fmtBDT(p.sale)}</span>
  ${p.regular>p.sale?`<span style="text-decoration:line-through;opacity:0.5;margin-left:8px">${fmtBDT(p.regular)}</span>`:''}
  ${p.discPct>0?`<span class="chip chip-red" style="margin-left:4px">-${toBn(Math.round(p.discPct))}%</span>`:''}
  </div>
  </div>
 </div>
 <div class="grid grid-3" style="margin-bottom:10px">
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Initial Stock</div><div class="stat-value text-ink" style="font-size:16px">${toBn(p.totalStock)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Sold</div><div class="stat-value text-green" style="font-size:16px">${toBn(p.totalSold)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Remaining</div><div class="stat-value text-amber" style="font-size:16px">${toBn(Math.max(0,p.remaining))}</div></div>
 </div>
 <div class="grid grid-3" style="margin-bottom:14px">
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Purchase</div><div class="stat-value text-ink" style="font-size:16px">${fmtBDT(p.invest || (p.cost * p.totalStock))}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Revenue</div><div class="stat-value text-blue" style="font-size:16px">${fmtBDT(p.revenue || (p.sale * p.totalSold))}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Profit</div><div class="stat-value ${p.net>=0?'text-green':'text-red'}" style="font-size:16px">${fmtBDT(p.net || ((p.sale - p.cost) * p.totalSold))}</div></div>
 </div>
 <div class="glass" style="padding:10px;margin-bottom:12px">
  <table style="width:100%;font-size:12.5px">
  <thead><tr style="opacity:0.7"><th style="text-align:left;padding:4px">Size</th><th style="padding:4px">Stock</th><th style="padding:4px">Sold</th><th style="padding:4px">Left</th></tr></thead>
  <tbody>
  ${(_isOneSizeP(p)?['M']:['S','M','L','XL','XXL','3XL']).map(sz=>{
   const s=p['stk'+sz], so=p['sold'+sz], l=s-so;
   const lbl=_isOneSizeP(p)?'One Size':sz;
   return `<tr><td style="padding:5px"><b>${lbl}</b></td><td style="text-align:center">${toBn(s)}</td><td style="text-align:center">${toBn(so)}</td><td style="text-align:center;color:${l<=0?'#F87171':'#34D399'};font-weight:700">${toBn(l)}</td></tr>`;
  }).join('')}
  </tbody>
  </table>
 </div>
 ${p.desc?`<div class="glass mt-3" style="padding:10px"><div class="modal-section-title">Description</div><div style="font-size:13px">${esc(p.desc).replace(/\n/g,'<br>')}</div></div>`:''}
 ${p.sizeChart?`<div class="glass mt-3" style="padding:10px"><div class="modal-section-title">Size Chart</div><div style="font-size:13px">${esc(p.sizeChart).replace(/\n/g,'<br>')}</div></div>`:''}
 <div class="modal-section-title">🚚 Delivery</div>
 <div class="flex-gap" style="font-size:12px;opacity:0.85">
  <span>Inside Narayanganj: ${fmtBDT(p.deliveryDhaka)}</span>
  <span>•</span>
  <span>Outside Narayanganj: ${fmtBDT(p.deliveryOutside)}</span>
  <span>•</span>
  <span>${esc(p.deliveryDays||'—')}</span>
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Off</button>
  <button class="btn btn-blue" onclick="YARZ.closeModal();YARZ.inv.editProduct('${esc(p.name)}')"><i class="fas fa-pen"></i> Edit</button>
  <button class="btn btn-primary" onclick="YARZ.closeModal();YARZ.openModal('sale-entry',{product:'${esc(p.name)}'})"><i class="fas fa-cash-register"></i> Sales</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 editProduct(name){
 const p = state.data.inventory.find(x=>x.name===name);
 if(!p){ toast('Not found','error'); return; }
 YARZ.openModal('edit-product', p);
 },

 deleteProduct(name){
 YARZ.openModal('delete-confirm', {
 name: `Product: ${name}`,
 onArchive: `YARZ.inv.changeStatus('${esc(name)}', 'Archived')`,
 onDeleteKeepFin: `YARZ.inv._permanentlyDeleteProduct('${esc(name)}', true)`,
 onDelete: `YARZ.inv._permanentlyDeleteProduct('${esc(name)}', false)`
 });
 },

 async _permanentlyDeleteProduct(name, keepFin = false){
 showLoader('Deleting...');
 try {
 const res = await appsPost('deleteProduct', { name, keepFinancials: keepFin });
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 state.data.inventory = state.data.inventory.filter(x=>x.name!==name);
 YARZ.render();
  toast('Permanently deleted', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  async changeStatus(name, newStatus, showToast){
 showLoader('Updating status...');
 try {
 const res = await appsPost('updateProductStatus', { name, status: newStatus });
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 // Optimistic local update
 const p = state.data.inventory.find(x=>x.name===name);
 if(p) p.status = newStatus;
 YARZ.render();
  if(showToast!==false) toast(`${name} → ${newStatus}`, 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  YARZ.closeModal();
  } catch(e){
  toast('Error: '+e.message,'error');
  } finally { hideLoader(); }
 },

 showLowStock(){
 YARZ.goPage('inventory');
 const threshold = int(state.data.settings['Low Stock Threshold']||5);
 const items = state.data.inventory.filter(p=>{
 if(p.status!=='Active') return false;
 // ✅ v16.1 ONE-SIZE: sizeless products only have the M slot — check just
 // that one, otherwise the 5 always-zero size slots falsely flag every
 // one-size product as "low stock".
 if(_isOneSizeP(p)) return (p.stkM-p.soldM) <= threshold;
 const sizes = [p.stkS-p.soldS, p.stkM-p.soldM, p.stkL-p.soldL, p.stkXL-p.soldXL, p.stkXXL-p.soldXXL, p.stk3XL-p.sold3XL];
 return sizes.some(s=>s<=threshold);
 });
 const html = `
 <div class="modal-header">
  <h3>⚠️ Low Stock Alert (≤ ${toBn(threshold)})</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div style="font-size:12px;opacity:0.7;margin-bottom:10px">${toBn(items.length)} items Products Stock less</div>
 <div class="list" style="max-height:60vh;overflow-y:auto">
  ${items.length ? items.map(p=>{
  const alerts = [];
  (_isOneSizeP(p)?['M']:['S','M','L','XL','XXL','3XL']).forEach(sz=>{
  const left = p['stk'+sz]-p['sold'+sz];
  const lbl = _isOneSizeP(p)?'One Size':sz;
  if(left<=0) alerts.push(`<span class="chip chip-red">${lbl}:⛔</span>`);
  else if(left<=threshold) alerts.push(`<span class="chip chip-amber">${lbl}:${toBn(left)}</span>`);
  });
  return `<div class="list-item">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"fas fa-triangle-exclamation\"></i>'}</div>
  <div class="li-body">
   <div class="li-title">${esc(p.name)}</div>
   <div class="li-sub">${alerts.join(' ')}</div>
  </div>
  <button class="btn btn-blue btn-xs" onclick="YARZ.closeModal();YARZ.inv.editProduct('${esc(p.name)}')">Edit</button>
  </div>`;
  }).join('') : '<div class="empty-state"><i class="fas fa-check-circle"></i><p>All stock is fine ✅</p></div>'}
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 showStockManager(){
 const items = state.data.inventory.slice().sort((a,b)=>a.name.localeCompare(b.name));
 const html = `
 <div class="modal-header">
  <h3>📦 Stock Manager</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="search-wrap">
  <i class="fas fa-search sicon"></i>
  <input id="sm-search" class="input" placeholder="Search..." oninput="YARZ.inv._renderSM()">
 </div>
 <div id="sm-list" style="max-height:60vh;overflow-y:auto"></div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 YARZ.inv._renderSM();
 },

 _renderSM(){
 const q = ($('sm-search')?.value||'').toLowerCase().trim();
 let items = state.data.inventory.slice();
 if(q) items = items.filter(p=>p.name.toLowerCase().includes(q));
 // Track pending changes per product (in memory) so user can edit multiple sizes then Save once
 if(!YARZ.inv._smPending) YARZ.inv._smPending = {};
 const pending = YARZ.inv._smPending;
 $('sm-list').innerHTML = items.map(p=>{
 const imgUrl = p.img1 ? getImgSrc(p.img1) : '';
 const thumbStyle = imgUrl
  ? `background-image:url('${esc(imgUrl)}');background-size:cover;background-position:center`
  : '';
 const pend = pending[p.name] || {};
 const hasPending = Object.keys(pend).some(sz => pend[sz] !== undefined && pend[sz] !== null && pend[sz] !== '');
 return `
 <div class="glass mb-2" style="padding:10px">
  <div class="flex-between mb-2" style="gap:10px;align-items:center">
  <div class="thumb" style="width:46px;height:46px;border-radius:10px;flex-shrink:0;${thumbStyle};display:flex;align-items:center;justify-content:center;background-color:rgba(255,255,255,0.05)">
  ${imgUrl ? '' : '<i class="ri-shopping-bag-3-line" style="opacity:0.5"></i>'}
  </div>
  <div style="flex:1;min-width:0">
  <div class="li-title" style="font-size:13px;line-height:1.3">${esc(p.name)}</div>
  <div style="font-size:10.5px;opacity:0.6;margin-top:2px">${fmtBDT(p.sale)} · Stock: ${toBn(Math.max(0,p.remaining))}</div>
  </div>
  <span class="chip ${p.status==='Active'?'chip-green':'chip-amber'}" style="font-size:10px">${esc(p.status)}</span>
  </div>
  <div class="grid grid-4" style="gap:6px">
  ${(_isOneSizeP(p)?['M']:['S','M','L','XL','XXL','3XL']).map(sz=>{
  const left = p['stk'+sz]-p['sold'+sz];
  const szLbl = _isOneSizeP(p)?'One Size':sz;
  const pendVal = pend[sz];
  const previewLeft = (pendVal !== undefined && pendVal !== null && pendVal !== '')
   ? (parseInt(pendVal,10) || 0) - p['sold'+sz]
   : left;
  const colorVal = (pendVal !== undefined && pendVal !== null && pendVal !== '') ? previewLeft : left;
  return `<div style="text-align:center;padding:6px;background:rgba(255,255,255,0.04);border-radius:10px">
   <div style="font-size:10px;opacity:0.6">${szLbl} <span style="opacity:0.5">(${toBn(left)})</span></div>
   <input type="number" inputmode="numeric" min="0" 
   class="input sm-stock-input" 
   data-product="${esc(p.name)}" data-size="${sz}" 
   placeholder="${p['stk'+sz]}" 
   value="${pendVal !== undefined && pendVal !== null ? esc(String(pendVal)) : ''}"
   style="text-align:center;padding:6px 4px;font-size:13px;font-weight:800;margin:4px 0;color:${colorVal<=0?'#F87171':colorVal<5?'#FBBF24':'#34D399'}"
   oninput="YARZ.inv._smOnInput('${esc(p.name)}','${sz}',this.value)">
   <div class="flex" style="gap:3px;justify-content:center;margin-top:2px">
   <button class="btn btn-ghost btn-xs" style="padding:2px 6px" onclick="YARZ.inv._smStep('${esc(p.name)}','${sz}',-1)">-</button>
   <button class="btn btn-primary btn-xs" style="padding:2px 6px" onclick="YARZ.inv._smStep('${esc(p.name)}','${sz}',1)">+</button>
   </div>
  </div>`;
  }).join('')}
  </div>
  <div class="flex-gap" style="margin-top:8px;justify-content:flex-end;gap:6px">
  <button class="btn btn-ghost btn-xs" ${hasPending?'':'disabled style="opacity:0.4"'} onclick="YARZ.inv._smReset('${esc(p.name)}')"><i class="ri-close-line"></i> Cancel</button>
  <button class="btn btn-success btn-xs" ${hasPending?'':'disabled style="opacity:0.4"'} onclick="YARZ.inv._smSave('${esc(p.name)}')"><i class="ri-save-line"></i> Save</button>
  </div>
 </div>
 `;
 }).join('') || '<div class="empty-state">None</div>';
 },

 // Track typed input (does not save until user clicks Save)
 _smOnInput(name, size, val){
 if(!YARZ.inv._smPending) YARZ.inv._smPending = {};
 if(!YARZ.inv._smPending[name]) YARZ.inv._smPending[name] = {};
 YARZ.inv._smPending[name][size] = val;
 // Re-render only the buttons enable state without losing focus: light update
 // We rebuild whole list (cheap) — but preserve focus on this input.
 const activeKey = `${name}__${size}`;
 YARZ.inv._smRenderKeepFocus(activeKey);
 },

 _smRenderKeepFocus(activeKey){
 YARZ.inv._renderSM();
 if(activeKey){
 const [n, s] = activeKey.split('__');
 const sel = `input.sm-stock-input[data-product="${(window.CSS&&CSS.escape)?CSS.escape(n):n.replace(/"/g,'\\"')}"][data-size="${s}"]`;
 try {
  const el = document.querySelector(sel);
  if(el){
  el.focus();
  const v = el.value;
  el.value = '';
  el.value = v; // move cursor to end
  }
 } catch(e){}
 }
 },

 // +/- step: also goes through pending (no immediate API call)
 _smStep(name, size, delta){
 if(!YARZ.inv._smPending) YARZ.inv._smPending = {};
 if(!YARZ.inv._smPending[name]) YARZ.inv._smPending[name] = {};
 const p = state.data.inventory.find(x=>x.name===name);
 if(!p) return;
 const cur = (YARZ.inv._smPending[name][size] !== undefined && YARZ.inv._smPending[name][size] !== '')
 ? parseInt(YARZ.inv._smPending[name][size],10)
 : p['stk'+size];
 const next = Math.max(0, (isNaN(cur)?0:cur) + delta);
 YARZ.inv._smPending[name][size] = String(next);
 YARZ.inv._renderSM();
 },

 _smReset(name){
 if(YARZ.inv._smPending) delete YARZ.inv._smPending[name];
 YARZ.inv._renderSM();
 },

 // Save all pending size changes for a single product in ONE API call
 async _smSave(name){
 const pend = YARZ.inv._smPending && YARZ.inv._smPending[name];
 if(!pend) return;
 const p = state.data.inventory.find(x=>x.name===name);
 if(!p){ toast('Product None','error'); return; }

 // Compute deltas based on new desired stock vs current stk
 const data = { name, dS:0, dM:0, dL:0, dXL:0, dXXL:0, d3XL:0 };
 let anyChange = false;
 ['S','M','L','XL','XXL','3XL'].forEach(sz=>{
 const v = pend[sz];
 if(v === undefined || v === null || v === '') return;
 const newVal = parseInt(v,10);
 if(isNaN(newVal)) return;
 const delta = newVal - p['stk'+sz];
 if(delta !== 0){
  data['d'+sz] = delta;
  anyChange = true;
 }
 });

 if(!anyChange){
 toast('No changes','info');
 delete YARZ.inv._smPending[name];
 YARZ.inv._renderSM();
 return;
 }

 showLoader('Stock Saving...');
 try {
 const res = await appsPost('applyStockChange', data);
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 // Apply locally
 ['S','M','L','XL','XXL','3XL'].forEach(sz=>{
  if(data['d'+sz] !== 0){
  p['stk'+sz] = Math.max(0, p['stk'+sz] + data['d'+sz]);
  }
 });
 delete YARZ.inv._smPending[name];
 // ✅ v11.2: If GAS returned verified values, sync admin state to ground truth
 if(res && res.verify){
  const v = res.verify;
  if(typeof v.S === 'number') p.stkS = v.S;
  if(typeof v.M === 'number') p.stkM = v.M;
  if(typeof v.L === 'number') p.stkL = v.L;
  if(typeof v.XL === 'number') p.stkXL = v.XL;
  if(typeof v.XXL === 'number') p.stkXXL = v.XXL;
  if(typeof v['3XL'] === 'number') p.stk3XL = v['3XL'];
  toast(`✅ Saved → S:${v.S} M:${v.M} L:${v.L} XL:${v.XL} XXL:${v.XXL} 3XL:${v['3XL']}`,'success');
  } else {
  toast('Stock updated ✅','success');
  }
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  YARZ.inv._renderSM();
  YARZ.inv.render();
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  // Legacy single-step (kept for compatibility, not used now)
 async _adjustStock(name, size, delta){
 showLoader('Stock Updating...');
 try {
 // ✅ v10 FIX (#12): Include all 6 sizes in payload
 const data = { name, dS:0, dM:0, dL:0, dXL:0, dXXL:0, d3XL:0 };
 data['d'+size] = delta;
 const res = await appsPost('applyStockChange', data);
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 const p = state.data.inventory.find(x=>x.name===name);
 if(p) p['stk'+size] = Math.max(0, p['stk'+size]+delta);
 YARZ.inv._renderSM();
 YARZ.inv.render();
 } catch(e){ toast(e.message,'error'); }
 finally { hideLoader(); }
 },

 showBulkEdit(){
 // ✅ v11: Compute unique categories from inventory for filter chips
 const cats = [...new Set(state.data.inventory.map(p=>p.category).filter(Boolean))].sort();
 const catChipsHtml = `
 <button class="bulk-cat-chip active" data-cat="" onclick="YARZ.inv._bulkSetCat('')">All <span class="bulk-cat-count">${toBn(state.data.inventory.length)}</span></button>
 ${cats.map(c => {
  const count = state.data.inventory.filter(p => p.category === c).length;
  return `<button class="bulk-cat-chip" data-cat="${esc(c)}" onclick="YARZ.inv._bulkSetCat('${esc(c).replace(/'/g,"\\'")}')">${esc(c)} <span class="bulk-cat-count">${toBn(count)}</span></button>`;
 }).join('')}
 `;
 const html = `
 <div class="modal-header">
  <h3>🗂️ Bulk Editor <span style="font-size:11px;font-weight:500;color:var(--ink-3);margin-left:8px">— Select & apply changes to many products at once</span></h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="search-wrap">
  <i class="fas fa-search sicon"></i>
  <input id="bulk-search" class="input" placeholder="Search products..." oninput="YARZ.inv._bulkRender()">
 </div>

 <!-- ✅ v11: Category filter chips -->
 <div class="modal-section-title" style="margin-top:6px;margin-bottom:6px">📁 Filter by Category</div>
 <div class="bulk-cat-chips" id="bulk-cat-chips">
  ${catChipsHtml}
 </div>

 <!-- ✅ v11: Select-all helpers (current view + current category) -->
 <div class="bulk-action-bar">
  <button class="btn btn-ghost btn-xs" onclick="YARZ.inv._bulkSelVisible(true)" title="Select everything currently visible"><i class="fas fa-check-square"></i> Select Visible</button>
  <button class="btn btn-ghost btn-xs" onclick="YARZ.inv._bulkSelVisible(false)"><i class="far fa-square"></i> Deselect Visible</button>
  <button class="btn btn-ghost btn-xs" onclick="YARZ.inv._bulkSelByCategory()" title="Select all products in the currently filtered category"><i class="fas fa-folder-plus"></i> Select All in Category</button>
  <button class="btn btn-ghost btn-xs" onclick="YARZ.inv._bulkSelAll(false)"><i class="fas fa-times"></i> Clear All</button>
  <span id="bulk-count" style="margin-left:auto;font-size:12px;font-weight:700;color:var(--accent)">0 selected</span>
 </div>

 <div id="bulk-list" style="max-height:36vh;overflow-y:auto;margin-bottom:14px;border:1px solid var(--line);border-radius:10px;padding:6px"></div>

 <div class="modal-section-title">Apply Changes</div>
 <div class="row">
  <div class="field"><label>Status</label>
  <select id="bulk-status" class="select">
  <option value="">— Skip —</option><option>Active</option><option>Draft</option><option>Archived</option>
  </select>
  </div>
  <div class="field"><label>Discount %</label>
  <input id="bulk-disc" type="number" class="input" placeholder="e.g. 10" min="0" max="90">
  </div>
  <div class="field"><label>Badge</label>
  <select id="bulk-badge" class="select">
  <option value="">— Skip —</option>
  ${DEFAULT_BADGES.map(b=>`<option value="${esc(b)}">${esc(b||'—')}</option>`).join('')}
  </select>
  </div>
 </div>

 <!-- ✅ v11: Category change (move products to a different category) -->
 <div class="row" style="margin-top:6px">
  <div class="field"><label>Change Category To</label>
  <input id="bulk-cat-new" class="input" list="bulk-cat-list" placeholder="— Skip — (type or pick existing)">
  <datalist id="bulk-cat-list">
  ${cats.map(c=>`<option value="${esc(c)}">`).join('')}
  </datalist>
  </div>
 </div>

 <div class="modal-section-title">🚚 Delivery Charge (Bulk Update)</div>
 <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px">
  <div style="font-size:11px;color:var(--ink-3);margin-bottom:8px"> before will remain। new if given select All Product with Update will be।</div>
  <div class="row">
  <div class="field"><label>🏠 Inside Charge ()</label>
  <input id="bulk-del-inside" type="number" class="input" placeholder="e.g. 70" min="0" step="5">
  </div>
  <div class="field"><label>🚛 Outside Charge ()</label>
  <input id="bulk-del-outside" type="number" class="input" placeholder="e.g. 140" min="0" step="5">
  </div>
  </div>
 </div>

 <!-- ✅ v11.1: Coupon Code Bulk Update -->
 <div class="modal-section-title">🎫 Coupon Code (Bulk Update)</div>
 <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:14px">
  <div style="font-size:11px;color:var(--ink-3);margin-bottom:8px;line-height:1.6">
    Set / update coupon for many products at once. Leave a field empty to keep existing values.<br>
    <b style="color:var(--accent)">Hidden mode (v15.92):</b> coupon stays redeemable at checkout but is NOT displayed on the product page — perfect for live-stream giveaways, VIP / influencer codes, and private discounts.
  </div>
  <div class="row">
  <div class="field"><label>Coupon Active</label>
  <select id="bulk-coupon-active" class="select">
   <option value="">— Skip —</option>
   <option value="Yes">Yes (Show on product · public)</option>
   <option value="Hidden">Hidden (Secret · redeemable but not displayed)</option>
   <option value="No">No (Deactivate)</option>
  </select>
  </div>
  <div class="field"><label>Coupon Code</label>
  <input id="bulk-coupon-code" class="input" placeholder="e.g. EID20" maxlength="32">
  </div>
  <div class="field"><label>Coupon Discount %</label>
  <input id="bulk-coupon-disc" type="number" class="input" placeholder="e.g. 15" min="0" max="90">
  </div>
  </div>
 </div>

 <!-- ✅ v16.2: Per-Product Size Type (Bulk) -->
 <div class="modal-section-title">📐 Size Type (Bulk Update)</div>
 <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px">
  <div style="font-size:11px;color:var(--ink-3);margin-bottom:12px;line-height:1.6">
    Force how the selected products' sizes are LABELLED on the storefront. Use this for custom categories the auto-detect can't recognise (e.g. a Bengali name, or "Joggers").<br>
    <b style="color:var(--accent)">Tip:</b> Leave on "Skip" to keep each product's current setting. "Auto" lets the website decide from the category name (the normal behaviour).
  </div>
  <div class="field" style="margin-bottom:0">
    <label>Action</label>
    <select id="bulk-sizetype" class="select">
      <option value="">— Skip (don't change size type) —</option>
      <option value="auto">Auto-detect (from category)</option>
      <option value="shirt">Shirt sizes (S, M, L, XL, XXL, 3XL)</option>
      <option value="pant">Pant sizes (28, 30, 32, 34, 36, 38)</option>
    </select>
  </div>
  <div class="field" style="margin-bottom:0">
    <label>Men's Accessory</label>
    <select id="bulk-accessory" class="select">
      <option value="">— Skip (don't change) —</option>
      <option value="yes">Yes — move to Accessories section</option>
      <option value="no">No — normal apparel product</option>
    </select>
  </div>
 </div>

 <!-- ✅ v15.94: Per-Product Size Visibility (Bulk) -->
 <div class="modal-section-title">📏 Size Visibility (Bulk Update)</div>
 <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px">
  <div style="font-size:11px;color:var(--ink-3);margin-bottom:12px;line-height:1.6">
    Hide specific sizes on the storefront for the selected products only. Useful when a product runs out of a size permanently, or you only sell certain sizes for a particular item.<br>
    <b style="color:var(--accent)">Tip:</b> This is per-product. The global size toggles in Website Control → Extras still apply on top of this.
  </div>
  <!-- Mode selector -->
  <div class="field" style="margin-bottom:12px">
    <label>Action</label>
    <select id="bulk-size-mode" class="select" onchange="YARZ.inv._bulkSizeModeChange()">
      <option value="">— Skip (don't change size visibility) —</option>
      <option value="hide">Hide the sizes I tick below</option>
      <option value="clear">Show ALL sizes (clear any hidden sizes)</option>
    </select>
  </div>
  <!-- Size checkboxes — shown only in "hide" mode -->
  <div id="bulk-size-grid" style="display:none">
    <div style="font-weight:700;font-size:11px;color:var(--brand);margin:4px 0 8px;text-transform:uppercase;letter-spacing:0.5px">
      <i class="ri-shirt-line"></i> Shirt / Panjabi / T-Shirt Sizes
    </div>
    <div class="grid grid-3" style="gap:8px;margin-bottom:12px">
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="S"><span>S</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="M"><span>M</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="L"><span>L</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="XL"><span>XL</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="XXL"><span>XXL</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="3XL"><span>3XL</span></label>
    </div>
    <div style="font-weight:700;font-size:11px;color:var(--brand);margin:4px 0 8px;text-transform:uppercase;letter-spacing:0.5px;padding-top:10px;border-top:1px solid var(--line)">
      <i class="ri-shirt-line"></i> Pant / Jeans Sizes
    </div>
    <div style="font-size:10.5px;color:var(--ink-3);margin-bottom:8px">Pant sizes map to the same internal slots (S→28, M→30, L→32, XL→34, XXL→36, 3XL→38) — tick the slot that matches the waist size you want hidden.</div>
    <div class="grid grid-3" style="gap:8px">
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="S"><span>28</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="M"><span>30</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="L"><span>32</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="XL"><span>34</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="XXL"><span>36</span></label>
      <label class="bulk-size-chk"><input type="checkbox" class="bulk-size-box" value="3XL"><span>38</span></label>
    </div>
    <div style="font-size:10.5px;color:var(--warn);margin-top:10px;display:flex;align-items:center;gap:6px">
      <i class="ri-information-line"></i> Ticked sizes will be hidden from the storefront for every selected product.
    </div>
  </div>
 </div>

 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-primary" onclick="YARZ.inv._bulkApply()"><i class="fas fa-check"></i> Apply to Selected</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 YARZ.inv._bulkSel = {};
 YARZ.inv._bulkCatFilter = '';
 YARZ.inv._bulkRender();
 },

 _bulkSel: {},
 _bulkCatFilter: '',

 // ✅ v11: Filter list by category chip
 _bulkSetCat(cat){
 YARZ.inv._bulkCatFilter = cat || '';
 // Update chip active state
 qsa('.bulk-cat-chip').forEach(el => {
 el.classList.toggle('active', (el.dataset.cat || '') === (cat || ''));
 });
 YARZ.inv._bulkRender();
 },

 // ✅ v11: Get currently visible items (after search + category filter)
 _bulkVisibleItems(){
 const q = ($('bulk-search')?.value||'').toLowerCase().trim();
 const cat = YARZ.inv._bulkCatFilter || '';
 let items = state.data.inventory.slice();
 if(cat) items = items.filter(p => p.category === cat);
 if(q) items = items.filter(p => p.name.toLowerCase().includes(q));
 return items;
 },

 _bulkRender(){
 const items = YARZ.inv._bulkVisibleItems();
 $('bulk-list').innerHTML = items.map((p,i)=>{
 const chk = YARZ.inv._bulkSel[p.name]?'checked':'';
 const stChip = p.status === 'Active' ? 'chip-green' : p.status === 'Draft' ? 'chip-amber' : 'chip-gray';
 return `<label class="bulk-list-row">
  <input type="checkbox" ${chk} onchange="YARZ.inv._bulkSel['${esc(p.name).replace(/'/g,"\\'")}']=this.checked;YARZ.inv._bulkCount()">
  <div style="flex:1;min-width:0">
  <div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
  <div style="font-size:10.5px;color:var(--ink-3);margin-top:3px">
  <span class="chip ${stChip}" style="font-size:9px;padding:1px 6px">${esc(p.status||'Draft')}</span>
  <span style="margin-left:6px">${esc(p.category||'No category')}</span>
  <span style="margin-left:6px;font-weight:600;color:var(--ink-2)">${fmtBDT(p.sale)}</span>
  </div>
  </div>
 </label>`;
 }).join('') || '<div class="empty-state" style="padding:24px;text-align:center;color:var(--ink-3)">No products match.</div>';
 YARZ.inv._bulkCount();
 },

 _bulkCount(){
 const c = Object.values(YARZ.inv._bulkSel).filter(Boolean).length;
 const el = $('bulk-count');
 if(el) {
 // ✅ v11.1: Show out-of-total count, e.g. "5 / 12 selected"
 const total = YARZ.inv._bulkVisibleItems().length;
 el.textContent = `${toBn(c)} / ${toBn(total)} selected`;
 el.style.color = c > 0 ? 'var(--success, #22c55e)' : 'var(--ink-3)';
 }
 },

 _bulkSelAll(v){
 if(v){
 state.data.inventory.forEach(p=>{ YARZ.inv._bulkSel[p.name] = true; });
 } else {
 YARZ.inv._bulkSel = {};
 }
 YARZ.inv._bulkRender();
 },

 // ✅ v11: Select / deselect only the items currently visible (after filter+search)
 _bulkSelVisible(v){
 const items = YARZ.inv._bulkVisibleItems();
 items.forEach(p => { YARZ.inv._bulkSel[p.name] = !!v; });
 YARZ.inv._bulkRender();
 },

 // ✅ v11: Select every product in the currently filtered category
 _bulkSelByCategory(){
 const cat = YARZ.inv._bulkCatFilter;
 if(!cat){
 toast('First select a category from the chips above', 'warning');
 return;
 }
 state.data.inventory
 .filter(p => p.category === cat)
 .forEach(p => { YARZ.inv._bulkSel[p.name] = true; });
 YARZ.inv._bulkRender();
 toast(`${toBn(Object.values(YARZ.inv._bulkSel).filter(Boolean).length)} products selected from ${cat}`, 'success');
 },

 // ✅ v15.94: Toggle the size-checkbox grid based on the chosen action.
 // Only "hide" mode reveals the size ticks; "clear" and "skip" hide them.
 _bulkSizeModeChange(){
  const grid = $('bulk-size-grid');
  const mode = $('bulk-size-mode')?.value || '';
  if(grid) grid.style.display = (mode === 'hide') ? 'block' : 'none';
 },

 async _bulkApply(){
 const names = Object.keys(YARZ.inv._bulkSel).filter(k=>YARZ.inv._bulkSel[k]);
 if(!names.length){ toast('Select at least one product','error'); return; }
 const st = $('bulk-status')?.value || '';
 const disc = parseFloat($('bulk-disc')?.value)||0;
 const bd = $('bulk-badge')?.value || '';
 const newCat = $('bulk-cat-new')?.value.trim() || '';
 const delInsideEl = $('bulk-del-inside');
 const delOutsideEl = $('bulk-del-outside');
 const delInside = delInsideEl && delInsideEl.value !== '' ? parseFloat(delInsideEl.value) : null;
 const delOutside = delOutsideEl && delOutsideEl.value !== '' ? parseFloat(delOutsideEl.value) : null;

 // ✅ v11.1: Coupon bulk fields
 const cAct = $('bulk-coupon-active')?.value || '';
 const cCode = $('bulk-coupon-code')?.value.trim() || '';
 const cDiscRaw = $('bulk-coupon-disc')?.value;
 const cDisc = cDiscRaw !== '' && cDiscRaw != null ? parseFloat(cDiscRaw) : null;

 // ✅ v15.94: Size visibility bulk field.
 //   sizeMode '' = skip · 'hide' = set hidden list · 'clear' = show all
 const sizeMode = $('bulk-size-mode')?.value || '';
 let hiddenSizes = null;            // null = skip (don't send)
 if (sizeMode === 'clear') {
   hiddenSizes = '__CLEAR__';
 } else if (sizeMode === 'hide') {
   const ticked = Array.from(document.querySelectorAll('.bulk-size-box'))
     .filter(b => b.checked)
     .map(b => b.value);
   // Dedupe (shirt + pant rows share internal codes)
   const uniq = [...new Set(ticked)];
   if (!uniq.length) {
     toast('Tick at least one size to hide, or choose "Show ALL sizes"','warning');
     return;
   }
   hiddenSizes = uniq.join(',');
 }

 // ✅ v16.2: Size Type bulk field. '' = skip (don't change). 'auto'/'shirt'/
 // 'pant' = set. We store 'auto' as empty string server-side (auto IS the
 // empty/default state), so picking "Auto" effectively clears the override.
 const sizeTypeSel = $('bulk-sizetype')?.value || '';
 let sizeType = null;               // null = skip (don't send)
 if (sizeTypeSel) {
   sizeType = (sizeTypeSel === 'auto') ? '' : sizeTypeSel;
 }

 // ✅ v16.3: Accessory bulk field. '' = skip · 'yes'/'no' = set.
 const accessorySel = $('bulk-accessory')?.value || '';
 let accessory = null;              // null = skip (don't send)
 if (accessorySel) {
   accessory = accessorySel;        // 'yes' | 'no' — GAS normalizes
 }

 // Validate: at least one change must be requested
 if(!st && !disc && !bd && !newCat && delInside === null && delOutside === null
  && !cAct && !cCode && cDisc === null && hiddenSizes === null && sizeType === null && accessory === null){
 toast('Fill at least one field','warning');
 return;
 }

 showLoader(`${toBn(names.length)} items Product Updating...`);
 try {
 const payload = { names, st, disc, bd };
 if(newCat) payload.category = newCat;
 if(delInside !== null) payload.delInside = delInside;
 if(delOutside !== null) payload.delOutside = delOutside;
 if(cAct)   payload.couponActive = cAct;
 if(cCode)  payload.couponCode = cCode;
 if(cDisc !== null) payload.couponDisc = cDisc;
 if(hiddenSizes !== null) payload.hiddenSizes = hiddenSizes;
 if(sizeType !== null) payload.sizeType = sizeType;
 if(accessory !== null) payload.accessory = accessory;
 const res = await appsPost('applyBulkEdit', payload);
 if(res && res.ok===false) throw new Error(res.msg||'Failed');

 // Optimistic local updates so admin UI reflects changes instantly
 names.forEach(name => {
  const p = state.data.inventory.find(x=>x.name===name);
  if(!p) return;
  if(st) p.status = st;
  if(bd) p.badge = bd;
  if(newCat) p.category = newCat;
  if(disc > 0 && p.regular > 0){
  p.sale = Math.round(p.regular * (1 - disc/100));
  }
  if(delInside !== null) p.deliveryDhaka = delInside;
  if(delOutside !== null) p.deliveryOutside = delOutside;
  if(cAct)  p.couponActive = cAct;
  if(cCode)   p.couponCode = cCode;
  if(cDisc !== null) p.couponDisc = cDisc;
  // ✅ v16.1 ONE-SIZE GUARD: don't wipe a sizeless product's sentinel via
  // a Size-Visibility bulk edit (mirrors the server guard in applyBulkEdit).
  if(String(p.hiddenSizes||'').trim().toUpperCase() !== '__ONESIZE__'){
   if(hiddenSizes === '__CLEAR__') p.hiddenSizes = '';
   else if(hiddenSizes !== null) p.hiddenSizes = hiddenSizes;
  }
  // ✅ v16.2: reflect Size Type bulk change locally.
  if(sizeType !== null) p.sizeType = sizeType;
  // ✅ v16.3: reflect Accessory bulk change locally.
  if(accessory !== null) p.accessory = (accessory === 'yes') ? 'Yes' : 'No';
 });

  toast(`${toBn(names.length)} items Product Success Update happens ✅`,'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  YARZ.closeModal();
  await loadInventory();
  YARZ.render();
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
 },

 // ✅ v11.2: S/3XL Diagnostic — verifies the entire write/read pipeline
 async diagnoseS3XL(){
 showLoader('S/3XL diagnostic In progress...');
 try {
 const res = await appsPost('diagnoseS3XL', {});
 if(!res){ toast('GAS from any response comes', 'error'); return; }
 const checks = res.checks || {};
 const verdictColor = res.ok ? 'var(--success)' : 'var(--danger)';
 const html = `
  <div class="modal-header">
  <h3>🩺 S/3XL Diagnostic Report</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div style="padding:14px;border-radius:12px;background:var(--surface-1);border:1px solid var(--line);margin-bottom:14px">
  <div style="font-size:14px;font-weight:700;color:${verdictColor};margin-bottom:6px">${esc(res.verdict || (res.ok?'OK':'Failed'))}</div>
  <div style="font-size:11px;color:var(--ink-3)">GAS version: ${esc(res.version||'unknown')}</div>
  </div>
  <div class="modal-section-title">🔧 Diagnostic Details</div>
  <pre style="background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:14px;font-size:11px;line-height:1.6;overflow:auto;max-height:60vh;font-family:'Courier New',monospace;color:var(--ink)">${esc(JSON.stringify(checks, null, 2))}</pre>
  <div style="font-size:11px;color:var(--ink-3);margin-top:10px;padding:10px;background:var(--surface-1);border-radius:8px;line-height:1.6">
  <b>Quick read:</b><br>
  • <b>colsOk: true</b> means COL constants in deployed GAS match expected (S=46, 3XL=47).<br>
  • <b>writeOk: true</b> means writing to AT/AU columns works.<br>
  • <b>headers_46_to_49</b> shows what's currently labelled in row 1 of the sheet.<br>
  • If verdict says "redeploy required" — Apps Script editor → Deploy → Manage deployments → Edit (pencil) → New version → Deploy.
  </div>
  <div class="modal-actions">
  <button class="btn btn-primary" onclick="YARZ.closeModal()">OK</button>
  </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 } catch(e){ toast('Diagnostic error: ' + e.message, 'error'); }
 finally { hideLoader(); }
 },

 showAnalytics(){
 const items = state.data.inventory.slice().sort((a,b)=>b.net-a.net);
 const totalRev = items.reduce((s,p)=>s+p.revenue,0);
 const totalNet = items.reduce((s,p)=>s+p.net,0);
 const totalCost= items.reduce((s,p)=>s+p.invest,0);
 const totalAd = items.reduce((s,p)=>s+p.fbAd,0);
 const html = `
 <div class="modal-header">
  <h3>📊 Inventory Analytics</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="grid grid-2 mb-3">
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Revenue</div><div class="stat-value text-blue" style="font-size:16px">${fmtBDT(totalRev)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Cost</div><div class="stat-value text-amber" style="font-size:16px">${fmtBDT(totalCost)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Ad Spend</div><div class="stat-value text-purple" style="font-size:16px">${fmtBDT(totalAd)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Net Profit</div><div class="stat-value ${totalNet>=0?'text-green':'text-red'}" style="font-size:16px">${fmtBDT(totalNet)}</div></div>
 </div>
 <div class="modal-section-title">Top Performers (by Net)</div>
 <div style="max-height:40vh;overflow-y:auto">
  ${items.slice(0,20).map(p=>`
  <div class="list-item" onclick="YARZ.closeModal();YARZ.inv.showDetails('${esc(p.name)}')">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"fas fa-box\"></i>'}</div>
  <div class="li-body">
   <div class="li-title">${esc(p.name)}</div>
   <div class="li-sub">Sold: ${toBn(p.totalSold)} • Stock: ${toBn(Math.max(0,p.remaining))}</div>
  </div>
  <div class="li-right">
   <div class="${p.net>=0?'text-green':'text-red'}" style="font-weight:800">${fmtBDT(p.net)}</div>
   <div style="font-size:10px;opacity:0.6">${fmtBDT(p.revenue)} rev</div>
  </div>
  </div>
  `).join('')}
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 }
};

/* ============================================================
 ============ ORDERS MODULE ============
 Website Orders now split into 4 stages:
  - new:  status is 'Pending' (freshly placed)
  - picked: status is 'Picked Up'
  - shipped: status is 'Ready for Delivery' OR 'Handed to Courier'
  - delivered: status is 'Delivered'
 Plus: every card has a Delete button (removes from Google Sheet).
============================================================ */
YARZ.ord = {
 currentTab: 'manual',
 currentStage: 'new',

 /* ---------------------------------------------------------------
  Normalize any Bangladeshi phone input to E.164 format: +8801XXXXXXXXX
  Handles ALL common formats:
  01817667212  -> +8801817667212
  1817667212  -> +8801817667212
  8801817667212 -> +8801817667212
  +8801817667212  -> +8801817667212
  880 1817-667212 -> +8801817667212
  +880 1817 667 212 -> +8801817667212
  Returns '' if phone is invalid.
  The leading '+' is REQUIRED so WhatsApp can resolve the contact
  profile (otherwise it shows "Unknown number").
 --------------------------------------------------------------- */
 _normalizeBdPhone(raw){
 if(!raw) return '';
 // Strip everything except digits
 let d = String(raw).replace(/[^0-9]/g, '');
 if(!d) return '';

 // Case 1: starts with 880 (country code already present)
 if(d.startsWith('880')){
 d = d.slice(3);    // remove 880
 }
 // Case 2: starts with 0 (local format like 01817...)
 if(d.startsWith('0')){
 d = d.slice(1);    // remove leading 0
 }
 // After cleanup we expect a 10-digit BD mobile starting with '1'
 // (e.g. 1817667212). If user gave extra/less digits, take the LAST 10.
 if(d.length > 10){
 d = d.slice(-10);
 }
 if(d.length !== 10 || !d.startsWith('1')){
 return '';    // invalid BD number
 }
 return '+880' + d;   // final: +8801XXXXXXXXX (with '+')
 },

 sendWhatsApp(oid){
 const o = state.data.websiteOrders.find(x=>x.orderId===oid) || state.data.orders.find(x=>x.orderId===oid);
 if(!o || !o.phone) { toast('Phone number not found', 'error'); return; }

 const phone = this._normalizeBdPhone(o.phone);
 if(!phone){
 toast('Invalid phone number: ' + o.phone, 'error');
 return;
 }

 const qty = o.qty || 1;
 const del = o.delivery || 0;
 const total = o.total || (o.price*qty+del) || 0;
 const price = o.price || (total - del) || 0;
 const pm = o.payment || 'Cash on Delivery (COD)';

 const msg = `Hello ${o.customer||''}

Thank you for choosing YARZ! We are excited to let you know that your order has been successfully placed.

🏷️ Order Details:
- Product: ${o.product||''}
- Size: ${_ordSize(o.size)||'N/A'}
- Quantity: ${qty}
- Order ID: ${o.orderId}

🗞️ Payment Summary:
- Item Price: ${price}
- Delivery: ${del}
- Total Amount: ${total}
- Payment Method: ${pm}

Your parcel is being processed and will be on its way to you shortly. If you have any questions, feel free to reply to this message.

Best regards,
Team YARZ`;

 // wa.me URL with leading '+' so WhatsApp resolves the contact profile
 // even when the number is NOT saved in the user's contact list.
 const url = `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(msg)}`;
 window.open(url, '_blank');
 },

 // Map a stage key to the list of matching status strings
 // ✅ v15.99 FIX: 'In Transit' (written by Steadfast / allowed by the sheet's
 // status validation) had NO bucket → such orders silently vanished from
 // every website tab AND every count. Added to 'shipped'. A catch-all in
 // renderWebsite()/updateCounts() now also guarantees no status can ever
 // make an order disappear from the UI again.
 stageStatuses: {
 new:  ['Pending','Processing','Confirmed',''],
 picked: ['Picked Up'],
 shipped: ['Ready for Delivery','Handed to Courier','Shipped','In Transit'],
 delivered: ['Delivered']
 },

 // "Next stage" quick-action mapping
 nextStatus: {
 new:  'Picked Up',
 picked: 'Ready for Delivery',
 shipped: 'Delivered'
 },

 setTab(t){
 this.currentTab = t;
 qsa('.ord-tab').forEach(b=>b.classList.toggle('active', b.dataset.ordTab===t));
 ['website','manual','customers'].forEach(tab=>{
 $('ord-tab-'+tab).classList.toggle('hidden', tab!==t);
 });
 // ✅ v11.4: Re-evaluate bulk bar visibility based on current tab + stage
 const bulk = $('wo-bulk-bar');
 if(bulk) bulk.style.display = (t === 'website' && this.currentStage === 'new') ? 'flex' : 'none';
 this.render();
 },

 setStage(s){
 this.currentStage = s;
 qsa('.wo-stage').forEach(b=>b.classList.toggle('active', b.dataset.stage===s));
 // ✅ v11.4: Show bulk Steadfast bar only on "new" stage
 const bulk = $('wo-bulk-bar');
 if(bulk) bulk.style.display = (s === 'new') ? 'flex' : 'none';
 this.renderWebsite();
 },

 render(){
 this.updateCounts();
 this.renderWebsite();
 this.renderManual();
 this.renderCustomers();
 },

 updateCounts(){
 const ws = state.data.websiteOrders;
 const count = stage => new Set(ws.filter(o=>this.stageStatuses[stage].includes(o.status||'')).map(o=>o.orderId)).size;
 const set = (id,v)=>{ const el=$(id); if(el) el.textContent = toBn(v); };
 // Count TODAY's new orders only for the "new" tab badge (per user request)
 const today = new Date(); today.setHours(0,0,0,0);
 const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
 const newStages = this.stageStatuses['new'];
 const newToday = new Set(ws.filter(o=> newStages.includes(o.status||'') && o.date && o.date>=today && o.date<tomorrow).map(o=>o.orderId)).size;
 const newTotal = count('new');
 set('cnt-new', newTotal);
 set('cnt-picked', count('picked'));
 set('cnt-shipped', count('shipped'));
 set('cnt-delivered', count('delivered'));
 set('cnt-website-total', new Set(ws.map(o=>o.orderId)).size);
 set('cnt-manual-total', state.data.orders.length);
 // Store for later use
 this._newTodayCount = newToday;
 },

 renderWebsite(){
 const q = ($('wo-search')?.value||'').toLowerCase().trim();
 const stage = this.currentStage;
 const stageList = this.stageStatuses[stage];

 let items = state.data.websiteOrders.slice();
 // Include Cancelled / Returned only inside "delivered" stage as closed orders.
 // ✅ v15.99: Also include any order whose status doesn't match ANY known
 // stage bucket (unknown/legacy/future status) here, so an order can never
 // silently disappear from every tab. "delivered" acts as the catch-all.
 if(stage === 'delivered'){
 const known = []
  .concat(this.stageStatuses['new'])
  .concat(this.stageStatuses['picked'])
  .concat(this.stageStatuses['shipped'])
  .concat(this.stageStatuses['delivered']);
 items = items.filter(o=> stageList.includes(o.status||'') || o.status==='Cancelled' || o.status==='Returned' || !known.includes(o.status||''));
 } else {
 items = items.filter(o=> stageList.includes(o.status||''));
 }
 if(q) items = items.filter(o=>{
 // ✅ Tracking ID search — parse the courier field so user can match the bare tracking number
 const tp = parseCourierField(o.courier);
 const hay = (o.orderId+'|'+o.phone+'|'+o.customer+'|'+o.product+'|'+(o.courier||'')+'|'+tp.tracking+'|'+tp.courier).toLowerCase();
 return hay.includes(q);
 });

 // ✅ v10.2: GROUP BY ORDER ID (for multi-product checkouts)
 // ✅ v10 FIX (#16): Sum subtotal across all rows, then add delivery ONCE.
 // Previously summing `o.total` double-counted delivery for multi-item orders.
 const orderGroups = new Map();
 items.forEach(o => {
 let g = orderGroups.get(o.orderId);
 if (!g) {
  g = {
  ...o, // keep all base details
  products: [],
  subtotal: 0,
  totalAmount: 0,
  deliveryAmount: parseFloat(o.delivery) || 0
  };
  orderGroups.set(o.orderId, g);
 }
 // Keep the maximum delivery charge (only the first item carries it after _placeWebsiteOrder fix)
 g.deliveryAmount = Math.max(g.deliveryAmount, parseFloat(o.delivery) || 0);
 g.products.push({
  product: o.product,
  size: o.size,
  qty: o.qty,
  price: o.price,
  coupon: o.coupon,
  total: o.total
 });
 // Subtotal = qty × price for each line (no delivery)
 g.subtotal += (parseFloat(o.price) || 0) * (parseInt(o.qty) || 1);
 });
 // Compute final totalAmount once per group: subtotal + single delivery
 orderGroups.forEach(g => {
 g.totalAmount = g.subtotal + g.deliveryAmount;
 });
 
 items = Array.from(orderGroups.values());

 // Sort by date DESC (newest first)
 items.sort((a,b)=>{
 const ta = a.date ? a.date.getTime() : 0;
 const tb = b.date ? b.date.getTime() : 0;
 return tb - ta;
 });

 const container = $('wo-list');
 if(!items.length){
 const emptyMsg = {
  new: 'No new orders',
  picked: 'Pickup list empty',
  shipped: 'Nothing in delivery',
  delivered: 'No orders completed yet'
 }[stage] || 'No orders';
 container.innerHTML = `<div class="empty-state"><i class="ri-inbox-line" style="font-size:32px;opacity:0.4"></i><p style="margin-top:10px">${emptyMsg}</p></div>`;
 return;
 }

 // ===== Group orders by date bucket (Today / Yesterday / DayName+Date) =====
 const groups = {}; // key -> { label, isToday, date, dayName, items:[] }
 const orderedKeys = []; // preserve insertion order (newest first)
 items.forEach(o=>{
 const bucket = dateBucketLabel(o.date);
 if(!groups[bucket.key]){
  groups[bucket.key] = { ...bucket, items:[] };
  orderedKeys.push(bucket.key);
 }
 groups[bucket.key].items.push(o);
 });

 // Make sure "Today" (today) group is always on top, then by date desc
 orderedKeys.sort((a,b)=>{
 const ga = groups[a], gb = groups[b];
 if(ga.isToday && !gb.isToday) return -1;
 if(!ga.isToday && gb.isToday) return 1;
 if(!ga.date) return 1;
 if(!gb.date) return -1;
 return gb.date.getTime() - ga.date.getTime();
 });

 let html = '';
 orderedKeys.forEach(key=>{
 const g = groups[key];
 const dateStr = g.date ? fmtDateBn(g.date) : '';
 html += `
  <div class="date-group">
  <div class="date-group-header ${g.isToday?'today-row':''}">
  <div class="dg-label ${g.isToday?'today':''}">${esc(g.label)}</div>
  ${dateStr && !g.isToday ? `<div class="dg-date">· ${esc(dateStr)}</div>` : ''}
  ${g.isToday && dateStr ? `<div class="dg-date">· ${esc(dateStr)} (${esc(g.dayName||'')})</div>` : ''}
  <div class="date-group-divider"></div>
  <div class="dg-count">${toBn(g.items.length)} items Orders</div>
  </div>
  ${g.items.map(o=>this._renderOrderCard(o, stage, g.isToday)).join('')}
  </div>
 `;
 });

 container.innerHTML = html;
 },

 _renderOrderCard(o, stage, isToday){
 const sc = STATUS_COLORS[o.status]||'chip-gray';
 // Mark as "new" if it's today AND stage is "new"
 const isNewBadge = isToday && stage==='new';

 // Stage-specific primary action button
 let actionBtn = '';
 if(stage === 'new'){
 actionBtn = `<button class="btn btn-primary btn-xs" onclick="YARZ.ord.updateWebStatus('${esc(o.orderId)}','Picked Up')"><i class="ri-hand-coin-line"></i> Picked</button>`;
 } else if(stage === 'picked'){
 actionBtn = `<button class="btn btn-primary btn-xs" onclick="YARZ.ord.updateWebStatus('${esc(o.orderId)}','Ready for Delivery')"><i class="ri-truck-line"></i> Sent for delivery</button>`;
 } else if(stage === 'shipped'){
 actionBtn = `<button class="btn btn-success btn-xs" onclick="YARZ.ord.updateWebStatus('${esc(o.orderId)}','Delivered')"><i class="ri-checkbox-circle-line"></i> Delivery Complete</button>`;
 } else if(stage === 'delivered'){
 actionBtn = `<span class="chip ${sc}">${esc(o.status)}</span>`;
 }

 // ✅ v11.4: Steadfast Express button — only show on Pending orders
 const sfBtn = (stage === 'new') ? `<button class="btn btn-xs" style="background:linear-gradient(135deg,#10B981,#059669);color:#fff;border:none" onclick="YARZ.ord.sendToSteadfast('${esc(o.orderId)}')" title=" click Steadfast Courier- Send"><i class="ri-truck-line"></i> Steadfast- Send</button>` : '';
 // ✅ v11.5: Steadfast status check — show when courier field starts with "Steadfast"
 const isSteadfast = (o.courier || '').toLowerCase().indexOf('steadfast') === 0;
 const sfStatusBtn = (isSteadfast && stage !== 'new') ? `<button class="btn btn-ghost btn-xs" style="border:1px solid #10B981;color:#10B981" onclick="YARZ.ord.checkSteadfastStatus('${esc(o.orderId)}')" title="Steadfast from real-time status Check"><i class="ri-radar-line"></i> Status Check</button>` : '';

 // Courier selector (useful at picked/shipped) — quick courier name
 const courierSel = (stage==='picked' || stage==='shipped') ? `
 <select class="select" style="max-width:150px;padding:7px 12px;font-size:11px;border-radius:999px" onchange="if(this.value)YARZ.ord.updateCourier('${esc(o.orderId)}',this.value)">
  <option value="">Courier...</option>
  ${COURIERS.map(c=>`<option ${(o.courier||'').startsWith(c)?'selected':''}>${c}</option>`).join('')}
 </select>
 ` : '';

 // Parse current courier field into { courier, tracking }
 const parsed = parseCourierField(o.courier);
 const hasTracking = !!parsed.tracking;

 // "Add tracking ID" button (only shown if NO tracking yet)
 const addTrackBtn = !hasTracking ? `<button class="btn btn-amber btn-xs" onclick="YARZ.ord.editCourierId('${esc(o.orderId)}')" title="Courier Tracking ID Enter/Paste"><i class="ri-add-line"></i> Tracking ID Add</button>` : '';

 // Prominent tracking block (with current search query for highlight)
 const searchQ = ($('wo-search')?.value||'').trim();
 const trackingHtml = renderTrackingBlock(o.courier, o.orderId, searchQ);

 // ✅ v4.2: Find product image from inventory (for thumbnail in order card)
 const prodObj = (state.data.inventory || []).find(p => p.name === o.product);
 const prodImg = prodObj && prodObj.img1 ? getImgSrc(prodObj.img1) : '';
 const prodImgStyle = prodImg ? `background-image:url('${esc(prodImg)}')` : '';

 // ✅ v10.5: Calculate price breakdown over all products in the group!
 const prods = o.products || [{ qty: o.qty, price: o.price }];
 let totalQty = 0;
 let subtotal = 0;
 prods.forEach(p => {
 const q = parseInt(p.qty) || 1;
 totalQty += q;
 subtotal += q * (parseFloat(p.price) || 0);
 });
 
 // We only charge delivery once per order (it's stored in the first item)
 const delivery = parseFloat(o.deliveryAmount) || parseFloat(o.delivery) || 0;
 const expectedTotal = subtotal + delivery;
 
 // If g.totalAmount was calculated in renderWebsite, use it, otherwise fallback to expectedTotal
 let total = parseFloat(o.totalAmount) || parseFloat(o.total) || 0;
 
 // Sanity check: if stored total is clearly wrong, recompute.
 if (total <= 0 || total > expectedTotal * 10) {
 total = expectedTotal;
 }
 
 // Coupon detection
 const couponCode = (o.coupon || '').trim();
 const couponDiscount = expectedTotal > total ? (expectedTotal - total) : 0;
 const hasCoupon = !!couponCode || couponDiscount > 0;

 // ✅ v4.2: Time display — clean format
 const timeStr = o.date ? `${fmtTimeBn(o.date)} · ${fmtDateBn(o.date)}` : '—';
 const relTime = o.date ? relativeTime(o.date) : '';

 // ✅ v4.2: Build the redesigned card
 return `<div class="order-card ${isNewBadge?'is-new':''}" id="ord-${esc(o.orderId)}">
 <!-- Header: Order ID + Customer Name + Total -->
 <div class="order-head" style="cursor:pointer;" onclick="const b=document.getElementById('ob-${esc(o.orderId)}'); const i=this.querySelector('.exp-icon'); if(b.style.display==='none'){b.style.display='block';i.style.transform='rotate(180deg)';}else{b.style.display='none';i.style.transform='rotate(0deg)';}">
  <div style="min-width:0;flex:1">
  <div class="order-id"><i class="ri-hashtag" style="font-size:12px"></i>${esc(o.orderId)}</div>
  <div class="order-name"><i class="ri-user-3-fill"></i>${esc(o.customer||'Customer')}</div>
  <div class="order-meta">
  <span><i class="ri-time-line"></i> <span class="bn-num">${esc(timeStr)}</span></span>
  ${relTime ? `<span style="opacity:0.7; margin-left: 6px;">· ${esc(relTime)}</span>` : ''}
  </div>
  </div>
  <div style="text-align:right;flex-shrink:0; display:flex; align-items:center; gap:16px;">
  <div>
  <div class="order-total bn-num">${fmtBDT(total)}<small>Total Payment</small></div>
  ${stage!=='delivered' && o.status ? `<div style="margin-top:8px"><span class="chip ${sc}">${esc(o.status)}</span></div>`:''}
  </div>
  <div class="exp-icon-wrap">
  <i class="ri-arrow-down-s-line exp-icon" style="transition:transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1); font-size: 20px;"></i>
  </div>
  </div>
 </div>

 <div class="order-body" id="ob-${esc(o.orderId)}" style="display:none; padding-top:16px; margin-top:12px; border-top:1px dashed var(--line);">
 <!-- Product Rows (clickable -> opens product details with image) -->
 ${ (o.products || [{ product: o.product, size: o.size, qty: o.qty, price: o.price }]).map(p => {
  const pQty = parseInt(p.qty)||1;
  const pPrice = parseFloat(p.price)||0;
  const pObj = (state.data.inventory || []).find(inv => inv.name === p.product);
  const pImg = pObj && pObj.img1 ? getImgSrc(pObj.img1) : '';
  const pImgStyle = pImg ? `background-image:url('${esc(pImg)}')` : '';
  return `
  <div class="oc-product-row" onclick="YARZ.inv.showDetails('${esc(p.product||'')}')" title="Click to view product details">
  <div class="oc-product-thumb" style="${pImgStyle}">
  ${pImg ? '' : '<i class="ri-shopping-bag-3-line"></i>'}
  </div>
  <div class="oc-product-info">
  <a class="oc-product-name" onclick="event.stopPropagation();YARZ.inv.showDetails('${esc(p.product||'')}')">${esc(p.product||'No product name')}</a>
  <div class="oc-product-attrs">
   ${p.size ? `<span class="attr"><i class="ri-shirt-line"></i>Size: <b>${esc(_ordSize(p.size))}</b></span>` : ''}
   <span class="attr"><i class="ri-stack-line"></i>Quantity: <b class="bn-num">${toBn(pQty)}</b></span>
   <span class="attr"><i class="ri-price-tag-3-line"></i>Per piece: <b class="bn-num">${fmtBDT(pPrice)}</b></span>
  </div>
  </div>
  <div class="oc-view-icon" title="View Product"><i class="ri-eye-line"></i></div>
  </div>`;
 }).join('') }

 <!-- Customer Info Grid (v11.3 — copyable cells with copy buttons) -->
 <div class="oc-info-grid">
  <div class="oc-info-cell full">
  <i class="ri-user-3-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">Customer Name</div>
  <div class="val">${esc(o.customer||'—')}</div>
  </div>
  <button class="copy-btn" onclick="event.stopPropagation();YARZ.ord._copy('${esc(o.customer||'')}',this,'no/not Copied')" title="Copy "><i class="ri-file-copy-line"></i></button>
  </div>
  <div class="oc-info-cell">
  <i class="ri-phone-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">Phone Number</div>
  <div class="val bn-num">${esc(YARZ.ord._fmtBdPhoneDisplay(o.phone))}</div>
  </div>
  <button class="copy-btn" onclick="event.stopPropagation();YARZ.ord._copy(YARZ.ord._normalizeBdPhone('${esc(o.phone||'')}')||'${esc(o.phone||'')}',this,'Phone Copied')" title="Copy "><i class="ri-file-copy-line"></i></button>
  </div>
  <div class="oc-info-cell">
  <i class="ri-map-pin-2-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">District / Location</div>
  <div class="val">${esc(o.location||o.city||'—')}</div>
  </div>
  <button class="copy-btn" onclick="event.stopPropagation();YARZ.ord._copy('${esc(o.location||o.city||'')}',this,'low Copied')" title="Copy "><i class="ri-file-copy-line"></i></button>
  </div>
  <div class="oc-info-cell">
  <i class="ri-wallet-3-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">Payment Method</div>
  <div class="val">${esc(o.payment||'COD')}</div>
  </div>
  </div>
  ${o.email ? `
  <div class="oc-info-cell">
  <i class="ri-mail-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">Email</div>
  <div class="val" style="font-size:11.5px;word-break:break-all">${esc(o.email)}</div>
  </div>
  <button class="copy-btn" onclick="event.stopPropagation();YARZ.ord._copy('${esc(o.email||'')}',this,'Email Copied')" title="Copy "><i class="ri-file-copy-line"></i></button>
  </div>` : ''}
  ${o.address ? `
  <div class="oc-info-cell full">
  <i class="ri-home-4-line"></i>
  <div style="min-width:0;flex:1">
  <div class="lbl">Full Address</div>
  <div class="val" style="font-size:12.5px;line-height:1.5">${esc(o.address)}</div>
  </div>
  <button class="copy-btn" onclick="event.stopPropagation();YARZ.ord._copy('${esc((o.address||'')+(o.location?', '+o.location:''))}',this,'Address Copied')" title="Copy "><i class="ri-file-copy-line"></i></button>
  </div>` : ''}
 </div>

 <!-- ✅ v11.3: One-click courier block copy -->
 <button class="btn btn-primary btn-xs" style="width:100%;margin:8px 0;padding:10px;font-size:12.5px"
  onclick="event.stopPropagation();YARZ.ord._copy(YARZ.ord._courierBlock('${esc(o.orderId)}'),this,'courier for Complete Copied — paste ')">
  <i class="ri-clipboard-line"></i> courier for Complete Copy 
 </button>

 <!-- Price Breakdown -->
 <div class="oc-price-box">
  <div class="oc-price-line">
  <span class="lbl"><i class="ri-shopping-cart-2-line"></i>Product Price <span style="opacity:0.7">(<span class="bn-num">${toBn(totalQty)}</span> items item)</span></span>
  <span class="bn-num"><b>${fmtBDT(subtotal)}</b></span>
  </div>
  <div class="oc-price-line">
  <span class="lbl"><i class="ri-truck-line"></i>Delivery Charge</span>
  <span class="bn-num"><b>${fmtBDT(delivery)}</b></span>
  </div>
  ${hasCoupon ? `
  <div class="oc-price-line coupon">
  <span class="lbl"><i class="ri-coupon-3-line"></i>Coupon Discount${couponCode ? ` <span style="opacity:0.75;font-size:11px">(${esc(couponCode)})</span>` : ''}</span>
  <span class="bn-num"><b>${couponDiscount > 0 ? '− ' + fmtBDT(couponDiscount) : esc(couponCode)}</b></span>
  </div>` : ''}
  <div class="oc-price-line total">
  <span class="lbl"><i class="ri-money-dollar-circle-line"></i>Total payable</span>
  <span class="bn-num">${fmtBDT(total)}</span>
  </div>
 </div>

 ${o.notes ? `
 <div class="oc-notes">
  <i class="ri-sticky-note-line"></i><b>Note:</b> ${esc(o.notes)}
 </div>` : ''}

 ${o.activity ? `
 <details class="oc-notes" style="cursor:pointer;background:rgba(99,74,142,0.04);border-color:rgba(99,74,142,0.15)">
  <summary style="font-weight:600;color:var(--accent,#634A8E)"><i class="ri-history-line"></i> Order History ${o.updated ? `<span style="opacity:0.7;font-weight:400;font-size:11px">· Last updated: ${esc(o.updated)}</span>` : ''}</summary>
  <div style="margin-top:6px;font-size:11.5px;color:var(--ink-2);line-height:1.6;white-space:pre-wrap;word-break:break-word">${esc(o.activity)}</div>
 </details>` : ''}

 ${trackingHtml}

 <div class="order-actions" style="flex-wrap:wrap;gap:6px">
  ${actionBtn}
  ${sfBtn}
  ${sfStatusBtn}
  ${courierSel}
  ${stage!=='delivered' ? addTrackBtn : ''}
  <button class="btn btn-xs" style="background:#25D366;color:#fff;border:none" onclick="YARZ.ord.sendWhatsApp('${esc(o.orderId)}')"><i class="ri-whatsapp-fill"></i> WhatsApp</button>
  <button class="btn btn-ghost btn-xs" onclick="YARZ.ord.callCustomer('${esc(o.phone||'')}')" title="Call"><i class="ri-phone-fill" style="color:#0ea5e9"></i></button>
  ${stage!=='delivered' ? `<button class="btn btn-ghost btn-xs" onclick="YARZ.ord.showStatusMenu('${esc(o.orderId)}')" title="Change Status"><i class="ri-more-2-line"></i></button>` : ''}
  <button class="btn btn-ghost btn-xs" style="margin-left:auto;color:var(--danger)" onclick="YARZ.ord.deleteWebOrder('${esc(o.orderId)}')" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
 </div>
 </div>
 </div>`;
 },

 // ✅ v4.2: Quick call button — opens phone dialer on mobile
 callCustomer(phone){
 if(!phone){ toast('No phone number','warning'); return; }
 // ✅ Normalize first so a number stored without the leading 0
 // (e.g. "1601743670" — Google Sheets strips it on numeric cells)
 // still dials correctly as +8801601743670.
 const e164 = this._normalizeBdPhone(phone);
 const dial = e164 || String(phone).replace(/\D/g,'');
 if(!dial || dial.replace(/\D/g,'').length < 10){ toast('Invalid phone number','error'); return; }
 window.location.href = 'tel:' + dial;
 },

 showStatusMenu(orderId){
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId);
 if(!o) return;
 const statuses = ['Pending','Picked Up','Ready for Delivery','Handed to Courier','Delivered','Cancelled','Returned'];
 const html = `
 <div class="modal-header">
  <h3>Status Change — #${esc(orderId)}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <p style="font-size:12.5px;color:var(--ink-3);margin-bottom:14px">Current: <span class="chip ${STATUS_COLORS[o.status]||'chip-gray'}">${esc(o.status||'—')}</span></p>

 <div class="field" style="margin-bottom:16px;">
  <label style="font-size:11px;color:var(--ink-2)">Courier / Tracking Code (Optional)</label>
  <input id="status-courier-input" class="input" style="font-size:13px;" placeholder="e.g. RedX - 12345" value="${esc(o.courier || '')}">
 </div>

 <div style="display:grid;gap:8px">
  ${statuses.map(s=>`
  <button class="btn btn-ghost" style="justify-content:flex-start;${o.status===s?'border-color:var(--ink);font-weight:700':''}" onclick="YARZ.closeModal();YARZ.ord.updateWebStatus('${esc(orderId)}','${s}', document.getElementById('status-courier-input').value)">
  ${o.status===s?'<i class=\"fas fa-check\"></i> ':''}${s}
  </button>
  `).join('')}
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 async updateWebStatus(orderId, newStatus, courier = null){
 showLoader('Updating status...');
 try {
 const payload = { orderId, status:newStatus };
 if (courier !== null) payload.courier = courier;
 const res = await appsPost('updateWebsiteOrderStatus', payload);
 if(res && res.success===false) throw new Error(res.error||'Failed');
 // ✅ v15.51 MULTI-ITEM FIX: A multi-item cart writes ONE row per item
 // to Website_Orders, sharing the same orderId. GAS updates EVERY row
 // for this orderId, but the previous code only updated ONE local
 // object via `find` — leaving the other rows visually stuck on the
 // old status until a full refresh. Now we update ALL matching rows
 // so the UI immediately matches the server.
 const matched = state.data.websiteOrders.filter(x => x.orderId === orderId);
 matched.forEach(o => {
  o.status = newStatus;
  if (courier !== null) o.courier = courier;
 });
 this.updateCounts();
 this.renderWebsite();
 YARZ.updateBadges();
  toast(`#${orderId} → ${newStatus}` + (matched.length > 1 ? ` (${matched.length} items)` : ''),'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  // ✅ v11.6: Send single order to Steadfast Courier API with styled modal + idempotency
  async sendToSteadfast(orderId){
 // Idempotency lock — prevent double-click
 if(this._sfInFlight && this._sfInFlight[orderId]){
 toast('⏳ Orders within Send Processing...','warning');
 return;
 }
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId);
 if(!o){ toast('Order Not found','error'); return; }

 // Pre-flight validation
 const phone = (o.phone || '').trim();
 if(!/^01[3-9]\d{8}$/.test(phone.replace(/[^0-9]/g,'').replace(/^880/,'0').slice(-11))){
 toast('❌ Invalid phone number — Steadfast 11 digits Phone accept ', 'error');
 return;
 }
 if(!o.customer || !o.customer.trim()){
 toast('❌ Customer name empty - cannot send','error');
 return;
 }

 // Confirm modal (styled)
 const subtotal = (o.products || [{qty:o.qty,price:o.price}]).reduce((s,p)=>s+(parseFloat(p.qty)||1)*(parseFloat(p.price)||0),0);
 const delivery = parseFloat(o.deliveryAmount||o.delivery)||0;
 const total = subtotal + delivery;
 const isPrepaid = /^(bkash|nagad|rocket|bank|paid)$/i.test(o.payment||'');
 const cod = isPrepaid ? 0 : Math.round(total);

 const confirmHtml = `
 <div class="modal-header">
  <h3><i class="ri-truck-line" style="color:#10B981"></i> Steadfast Courier- will send?</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div style="padding:14px;background:linear-gradient(135deg,rgba(16,185,129,0.06),rgba(5,150,105,0.03));border:1px solid rgba(16,185,129,0.2);border-radius:12px;margin-bottom:16px">
  <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px">
  <div style="color:var(--ink-3);font-weight:600">Customer:</div><div>${esc(o.customer)}</div>
  <div style="color:var(--ink-3);font-weight:600">Phone:</div><div class="bn-num">${esc(YARZ.ord._fmtBdPhoneDisplay(o.phone))}</div>
  <div style="color:var(--ink-3);font-weight:600">Address:</div><div>${esc(o.address||'—')}${o.location?', '+esc(o.location):''}</div>
  <div style="color:var(--ink-3);font-weight:600">COD Amount:</div><div style="font-weight:700;color:${isPrepaid?'#0ea5e9':'#10B981'};font-size:15px">${cod}${isPrepaid?' (Prepaid)':''}</div>
  </div>
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-primary" style="background:linear-gradient(135deg,#10B981,#059669);border:none" onclick="YARZ.closeModal();YARZ.ord._sendToSteadfastConfirmed('${esc(orderId)}')"><i class="ri-truck-line"></i> Send</button>
 </div>
 `;
 $('modal-content').innerHTML = confirmHtml;
 $('modal-overlay').classList.add('show');
 },

 async _sendToSteadfastConfirmed(orderId){
 if(!this._sfInFlight) this._sfInFlight = {};
 if(this._sfInFlight[orderId]) return;
 this._sfInFlight[orderId] = true;
 showLoader('Steadfast- Orders ...');
 try {
 const res = await appsPost('steadfastCreate', { orderId });
 if(!res || res.ok === false) throw new Error(res?.msg || res?.error || 'Failed');
 const tc = res.trackingCode || '';
 const cid = res.consignmentId || '';
 // ✅ v15.51 MULTI-ITEM FIX: Update ALL rows sharing this orderId
 // so the multi-item cart moves to "Picked Up" together in one click.
 const matched = state.data.websiteOrders.filter(x => x.orderId === orderId);
 matched.forEach(o => {
  o.status = 'Picked Up';
  o.courier = 'Steadfast' + (tc ? ' | ' + tc : '');
 });
  this.updateCounts();
  this.renderWebsite();
  YARZ.updateBadges();
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  // Success modal — show tracking + consignment + copy buttons
  const successHtml = `
   <div class="modal-header">
   <h3>✅ Steadfast- Success Sent!</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div style="padding:18px;background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(5,150,105,0.04));border:1px solid rgba(16,185,129,0.3);border-radius:12px;text-align:center;margin-bottom:14px">
  <div style="font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Tracking Code</div>
  <div style="font-size:28px;font-weight:800;color:#10B981;font-family:monospace;letter-spacing:.05em;margin-bottom:8px">${esc(tc||'—')}</div>
  ${tc ? `<button class="btn btn-ghost btn-sm" onclick="YARZ.ord._copy('${esc(tc)}',this,'Tracking Copied')"><i class="ri-file-copy-line"></i> Tracking Copy</button>` : ''}
  </div>
  <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px;margin-bottom:14px;padding:12px;background:var(--surface-1);border-radius:10px">
  <div style="color:var(--ink-3);font-weight:600">Order ID:</div><div>${esc(orderId)}</div>
  <div style="color:var(--ink-3);font-weight:600">Consignment ID:</div><div>${esc(cid||'—')}</div>
  <div style="color:var(--ink-3);font-weight:600">COD:</div><div>${res.codAmount||0}${res.isPrepaid?' (Prepaid)':''}</div>
  <div style="color:var(--ink-3);font-weight:600">Status:</div><div><span class="chip chip-blue">Picked Up</span></div>
  </div>
  <div class="modal-actions">
  <button class="btn btn-primary" onclick="YARZ.closeModal()">OK</button>
  ${tc ? `<button class="btn btn-blue" onclick="YARZ.closeModal();YARZ.ord.checkSteadfastStatus('${esc(orderId)}')"><i class="ri-radar-line"></i> Status Check</button>` : ''}
  </div>
 `;
 $('modal-content').innerHTML = successHtml;
 $('modal-overlay').classList.add('show');
 } catch(e){
 toast('❌ Steadfast Error: ' + e.message, 'error');
 }
 finally {
 hideLoader();
 delete this._sfInFlight[orderId];
 }
 },

 // ✅ v11.5: Live status check from Steadfast (by invoice/orderId)
 async checkSteadfastStatus(orderId){
 showLoader('Steadfast from status ...');
 try {
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId);
 const courierField = o?.courier || '';
 // Try tracking first (more reliable), fall back to invoice
 const trackMatch = courierField.match(/\|\s*([A-Z0-9]{6,})/i);
 const tracking = trackMatch ? trackMatch[1] : '';
 const payload = tracking ? { trackingCode: tracking } : { invoice: orderId };
 const res = await appsPost('steadfastStatus', payload);
 if(!res || res.ok === false) throw new Error(res?.msg || 'Failed');
 const status = (res.data && (res.data.delivery_status || res.data.status)) || 'unknown';
 const html = `
  <div class="modal-header">
  <h3>📦 Steadfast Status — ${esc(orderId)}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div style="padding:16px;border-radius:12px;background:var(--surface-1);border:1px solid var(--line);margin-bottom:14px">
  <div style="font-size:13px;color:var(--ink-3);margin-bottom:6px">Current Steadfast Status:</div>
  <div style="font-size:22px;font-weight:800;color:var(--brand);text-transform:capitalize">${esc(status.replace(/_/g,' '))}</div>
  </div>
  <div class="modal-section-title">Full Response</div>
  <pre style="background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:11px;overflow:auto;max-height:50vh;font-family:monospace;color:var(--ink)">${esc(JSON.stringify(res.data, null, 2))}</pre>
  <div class="modal-actions">
  <button class="btn btn-primary" onclick="YARZ.closeModal()">OK</button>
  </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 } catch(e){
 toast('Status Error: ' + e.message, 'error');
 }
 finally { hideLoader(); }
 },

 // ✅ v11.6: Bulk send all "new" orders to Steadfast — with per-order failure breakdown
 async bulkSendToSteadfast(){
 const newOrders = state.data.websiteOrders.filter(o => {
 const s = (o.status || 'Pending').trim();
 return ['Pending','Processing','Confirmed',''].includes(s);
 });
 if(!newOrders.length){ toast('No new orders','warning'); return; }
 // ✅ v11.7: Styled confirm modal (replaces native confirm)
 const previewItems = newOrders.slice(0, 5);
 const confirmHtml = `
 <div class="modal-header">
  <h3><i class="ri-flashlight-fill" style="color:#10B981"></i> Bulk Steadfast will send?</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div style="padding:16px;background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(5,150,105,0.04));border:1px solid rgba(16,185,129,0.3);border-radius:12px;margin-bottom:14px;text-align:center">
  <div style="font-size:36px;font-weight:800;color:#10B981;line-height:1">${toBn(newOrders.length)}</div>
  <div style="font-size:12px;color:var(--ink-3);font-weight:600;margin-top:4px">items Pending Orders Steadfast Courier- Send will be</div>
 </div>
 <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:8px;font-weight:600"> ${Math.min(5, newOrders.length)} items:</div>
 <div style="border:1px solid var(--line);border-radius:8px;max-height:160px;overflow-y:auto;font-size:11.5px">
  ${previewItems.map(o=>`
  <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line)">
  <span><b>${esc(o.customer||'—')}</b> — ${esc(o.phone||'—')}</span>
  <span style="color:var(--ink-3);font-family:monospace;font-size:10px">${esc(o.orderId)}</span>
  </div>
  `).join('')}
  ${newOrders.length > 5 ? `<div style="padding:6px 10px;color:var(--ink-3);font-style:italic;font-size:11px">...and/more ${toBn(newOrders.length - 5)} items</div>` : ''}
 </div>
 <div style="font-size:11px;color:var(--ink-3);margin-top:10px;padding:8px;background:rgba(245,158,11,0.06);border-radius:6px">⚠️ Invalid phone or missing data if present that orders skip will be — end list will show।</div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-primary" style="background:linear-gradient(135deg,#10B981,#059669);border:none" onclick="YARZ.closeModal();YARZ.ord._bulkSendToSteadfastConfirmed()"><i class="ri-flashlight-fill"></i> Start sending</button>
 </div>
 `;
 $('modal-content').innerHTML = confirmHtml;
 $('modal-overlay').classList.add('show');
 },

 async _bulkSendToSteadfastConfirmed(){
 const newOrders = state.data.websiteOrders.filter(o => {
 const s = (o.status || 'Pending').trim();
 return ['Pending','Processing','Confirmed',''].includes(s);
 });
 if(!newOrders.length){ toast('No new orders','warning'); return; }
 showLoader(`${newOrders.length} items Orders ...`);
 try {
 const orderIds = newOrders.map(o => o.orderId);
 const res = await appsPost('steadfastBulk', { orderIds });
 if(!res || res.ok === false) throw new Error(res?.msg || 'Bulk failed');
 const succeeded = res.succeeded || 0;
 const failed = res.failed || ((res.total || 0) - succeeded);
 const failures = res.failures || [];
 // Update local state for successful ones
 (res.results || []).forEach(r => {
  if(r.ok){
  // ✅ v15.51 MULTI-ITEM FIX: Update every row sharing this orderId
  // so the entire cart moves to "Picked Up" instead of just one item.
  const matched = state.data.websiteOrders.filter(x => x.orderId === r.orderId);
  matched.forEach(o => {
  o.status = 'Picked Up';
  const tc = r.trackingCode || r.consignmentId || '';
  o.courier = 'Steadfast' + (tc ? ' | ' + tc : '');
  });
  }
 });
  this.updateCounts();
  this.renderWebsite();
  YARZ.updateBadges();
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}

  // Show detailed result modal
 const failureRows = failures.length ? failures.map(f =>
  `<tr><td style="padding:6px 8px;font-family:monospace;font-size:11px">${esc(f.orderId||'?')}</td><td style="padding:6px 8px;color:var(--danger);font-size:12px">${esc(f.msg||f.error||'Unknown')}</td></tr>`
 ).join('') : '';
 const resultHtml = `
  <div class="modal-header">
  <h3>📦 Steadfast Bulk Send Result</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="grid grid-2" style="gap:12px;margin-bottom:14px">
  <div style="padding:14px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.3);border-radius:10px;text-align:center">
  <div style="font-size:32px;font-weight:800;color:#10B981">${succeeded}</div>
  <div style="font-size:12px;color:var(--ink-3);font-weight:600">Success</div>
  </div>
  <div style="padding:14px;background:${failed>0?'rgba(239,68,68,0.08)':'rgba(0,0,0,0.04)'};border:1px solid ${failed>0?'rgba(239,68,68,0.3)':'var(--line)'};border-radius:10px;text-align:center">
  <div style="font-size:32px;font-weight:800;color:${failed>0?'var(--danger)':'var(--ink-3)'}">${failed}</div>
  <div style="font-size:12px;color:var(--ink-3);font-weight:600">Failed</div>
  </div>
  </div>
  ${failureRows ? `
  <div style="margin-bottom:14px">
  <div style="font-size:12px;font-weight:700;color:var(--ink-2);margin-bottom:6px">❌ Failed Orders :</div>
  <div style="border:1px solid var(--line);border-radius:8px;max-height:200px;overflow-y:auto">
   <table style="width:100%;font-size:12px">
   <thead><tr style="background:var(--surface-1)"><th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--ink-3)">Order ID</th><th style="text-align:left;padding:6px 8px;font-size:11px;color:var(--ink-3)">Reason</th></tr></thead>
   <tbody>${failureRows}</tbody>
   </table>
  </div>
  <div style="font-size:11px;color:var(--ink-3);margin-top:6px">💡 Failed Ordersitems which again attempt (e.g.: Phone Number , Customer Name )</div>
  </div>
  ` : ''}
  <div class="modal-actions">
  <button class="btn btn-primary" onclick="YARZ.closeModal()">OK</button>
  </div>
 `;
 $('modal-content').innerHTML = resultHtml;
 $('modal-overlay').classList.add('show');
 } catch(e){
 toast('❌ Bulk Error: ' + e.message, 'error');
 }
 finally { hideLoader(); }
 },

 async updateCourier(orderId, courier){
 showLoader('Courier Updating...');
 try {
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId);
 const status = o ? o.status : 'Pending';
 const res = await appsPost('updateWebsiteOrderStatus', { orderId, status, courier });
 if(res && res.success===false) throw new Error(res.error||'Failed');
 // ✅ v15.51 MULTI-ITEM FIX: Apply courier to every row sharing this orderId
 state.data.websiteOrders
  .filter(x => x.orderId === orderId)
  .forEach(o => { o.courier = courier; });
 this.renderWebsite();
  toast(`Courier Info Updated: ${courier}`,'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  async updateManualCourier(orderId, courier){
 showLoader('Courier Updating...');
 try {
 const o = state.data.orders.find(x=>x.orderId===orderId);
 const status = o ? o.status : 'Pending';
 const res = await appsPost('updateManualOrderStatus', { orderId, status, courier });
 if(res && res.success===false) throw new Error(res.error||'Failed');
 if(o) o.courier = courier;
 this.renderManual();
  toast(`Courier Info Updated: ${courier}`,'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  editCourierId(orderId){
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId) || state.data.orders.find(x=>x.orderId===orderId);
 if(!o) return;
 const isWeb = state.data.websiteOrders.includes(o);
 const current = o.courier || '';
 // Try to split current into "Courier Name - Tracking ID"
 let curName = '', curTrack = '';
 if(current.includes(' - ')){
 const parts = current.split(' - ');
 curName = parts[0].trim();
 curTrack = parts.slice(1).join(' - ').trim();
 } else if(COURIERS.includes(current)) {
 curName = current;
 } else {
 curTrack = current;
 }

 const html = `
 <div class="modal-header">
  <h3>🚚 Courier / Tracking — #${esc(orderId)}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="ri-close-line"></i></button>
 </div>
 <p style="font-size:12px;color:var(--ink-3);margin-bottom:14px">
  Courier Service submit after their Tracking ID here Enter/Paste। after any time edit to you can।
 </p>

 <div class="field" style="margin-bottom:12px">
  <label>Courier Service</label>
  <select id="ci-name" class="select">
  <option value="">— Select Courier —</option>
  ${COURIERS.map(c=>`<option value="${esc(c)}" ${curName===c?'selected':''}>${esc(c)}</option>`).join('')}
  </select>
 </div>

 <div class="field" style="margin-bottom:14px">
  <label>Tracking ID / Consignment No. <span style="color:var(--danger)">★</span></label>
  <input id="ci-track" class="input" placeholder="e.g.: 12345678" value="${esc(curTrack)}" style="font-family:'JetBrains Mono','Roboto Mono','Courier New',monospace;font-size:16px;font-weight:700;letter-spacing:0.5px;background:#FEF3C7;border:2px solid rgba(180,83,9,0.4);color:#92400E">
  <div style="font-size:11px;opacity:0.75;margin-top:6px;color:var(--ink-2)">
  <i class="ri-information-line"></i> courier from which no/notor (e.g. SteadFast Consignment ID) — this All । correct paste ।
  </div>
 </div>

 <div class="modal-actions">
  ${current ? `<button class="btn btn-ghost" onclick="YARZ.ord._saveCourierInfo('${esc(orderId)}', ${isWeb}, true)" style="color:var(--danger)"><i class="ri-delete-bin-6-line"></i> Delete</button>` : ''}
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-primary" onclick="YARZ.ord._saveCourierInfo('${esc(orderId)}', ${isWeb}, false)"><i class="ri-save-line"></i> Save</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 setTimeout(()=>{ const t=$('ci-track'); if(t) t.focus(); },100);
 },

 _saveCourierInfo(orderId, isWeb, clear){
 let val = '';
 if(!clear){
 const name = ($('ci-name')?.value||'').trim();
 const track = ($('ci-track')?.value||'').trim();
 if(name && track) val = `${name} - ${track}`;
 else val = name || track;
 }
 YARZ.closeModal();
 if(isWeb){
 this.updateCourier(orderId, val);
 } else {
 this.updateManualCourier(orderId, val);
 }
 },

 /* Copy tracking ID to clipboard with visual feedback */
 copyTracking(tid, btn){
 if(!tid) return;
 const showOk = ()=>{
 toast('Tracking ID Copied: '+tid, 'success');
 if(btn){
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="ri-check-line" style="color:#059669"></i>';
  setTimeout(()=>{ btn.innerHTML = orig; }, 1200);
 }
 };
 if(navigator.clipboard && navigator.clipboard.writeText){
 navigator.clipboard.writeText(tid).then(showOk).catch(()=>{
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = tid; document.body.appendChild(ta); ta.select();
  try{ document.execCommand('copy'); showOk(); }catch(e){ toast('Copy failed','error'); }
  document.body.removeChild(ta);
 });
 } else {
 const ta = document.createElement('textarea');
 ta.value = tid; document.body.appendChild(ta); ta.select();
 try{ document.execCommand('copy'); showOk(); }catch(e){ toast('Copy failed','error'); }
 document.body.removeChild(ta);
 }
 },

 // ✅ v11.3: Generic copy helper with visual feedback (used for all order fields)
 _copy(text, btn, label){
 if(!text){ toast('Nothing to copy','warning'); return; }
 const showOk = ()=>{
 toast((label||'Copied'),'success');
 if(btn){
  const orig = btn.innerHTML;
  btn.innerHTML = '<i class="ri-check-line" style="color:#059669"></i>';
  setTimeout(()=>{ btn.innerHTML = orig; }, 1100);
 }
 };
 if(navigator.clipboard?.writeText){
 navigator.clipboard.writeText(text).then(showOk).catch(()=>this._copyFallback(text, showOk));
 } else { this._copyFallback(text, showOk); }
 },
 _copyFallback(text, ok){
 const ta = document.createElement('textarea');
 ta.value = text; document.body.appendChild(ta); ta.select();
 try{ document.execCommand('copy'); ok(); }catch(e){ toast('Copy failed','error'); }
 document.body.removeChild(ta);
 },

 // ✅ v11.3: Format BD phone for display: +8801817667212 → 01817-667212
 _fmtBdPhoneDisplay(raw){
 const e164 = this._normalizeBdPhone(raw);
 if(!e164) return raw || '—';
 const local = '0' + e164.slice(4);
 return local.slice(0,5) + '-' + local.slice(5);
 },

 // ✅ v11.3: Build a clean multi-line block to copy into courier service forms
 _courierBlock(orderId){
 const o = state.data.websiteOrders.find(x=>x.orderId===orderId);
 if(!o) return '';
 const phone = this._normalizeBdPhone(o.phone) || (o.phone||'');
 const prods = (o.products || [{product:o.product,size:o.size,qty:o.qty,price:o.price}]);
 const productLines = prods.map(p=>`Product: ${p.product||''} (Size: ${_ordSize(p.size)||'-'}, Qty: ${p.qty||1})`).join('\n');
 const total = parseFloat(o.totalAmount||o.total||0);
 return [
 `Name: ${o.customer||''}`,
 `Phone: ${phone}`,
 `Address: ${o.address||''}${o.location?', '+o.location:''}`,
 productLines,
 `Amount: ${total}`
 ].join('\n');
 },

 deleteWebOrder(orderId){
 YARZ.openModal('delete-confirm', {
 name: `Website Order #${orderId}`,
 onArchive: `YARZ.ord.updateWebStatus('${esc(orderId)}', 'Cancelled')`,
 onDelete: `YARZ.ord._permanentlyDeleteWebOrder('${esc(orderId)}')`
 });
 },

 async _permanentlyDeleteWebOrder(orderId){
 showLoader('Deleting order...');
 try {
 const res = await appsPost('deleteWebsiteOrder', { orderId });
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 // ✅ v15.51 MULTI-ITEM FIX: A multi-item order has N rows sharing the
 // same orderId — remove ALL of them locally so the cart disappears
 // entirely instead of leaving 2 orphan items visible until refresh.
 state.data.websiteOrders = state.data.websiteOrders.filter(x => x.orderId !== orderId);
 this.updateCounts();
 this.renderWebsite();
 YARZ.updateBadges();
  toast('Order deleted','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  async archiveCompleted() {
 if(!confirm('You ? Delivered and Cancelled All Old Orders Archive which।')) return;
 showLoader();
 try {
 const res = await appsPost('archiveCompletedOrders', {});
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
  toast(res.msg || 'Order archived', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  // Hard refresh to sync the sheet
  setTimeout(() => window.location.reload(), 1500);
 } catch(e) { toast(e.message, 'error'); }
 finally { hideLoader(); }
 },

 renderManual(){
 const q = ($('mo-search')?.value||'').toLowerCase().trim();
 // Status sub-filter
 const stage = this._manualStage || 'all';
 let items = state.data.orders.slice().reverse();

 // Stage filter
 if(stage !== 'all'){
 const stageMap = {
  pending: ['Pending',''],
  shipped: ['Shipped','Picked Up','Ready for Delivery','Handed to Courier','Processing'],
  completed: ['Delivered','Completed']
 };
 const allowed = stageMap[stage] || [];
 items = items.filter(o=>allowed.includes(o.status||'Pending'));
 }
 if(q) items = items.filter(o=>{
 // ✅ Tracking ID search — parse the courier field so user can match the bare tracking number
 const tp = parseCourierField(o.courier);
 const hay = (o.orderId+'|'+o.phone+'|'+o.customer+'|'+o.product+'|'+(o.courier||'')+'|'+tp.tracking+'|'+tp.courier).toLowerCase();
 return hay.includes(q);
 });

 // Count by status
 const counts = { all: state.data.orders.length, pending:0, shipped:0, completed:0 };
 state.data.orders.forEach(o=>{
 const s = o.status || 'Pending';
 if(['Delivered','Completed'].includes(s)) counts.completed++;
 else if(['Shipped','Picked Up','Ready for Delivery','Handed to Courier','Processing'].includes(s)) counts.shipped++;
 else counts.pending++;
 });

 // Stage tabs
 const stageTabsHtml = `
 <div class="subtab-bar" style="margin-bottom:12px">
  <button class="subtab ${stage==='all'?'active':''}" onclick="YARZ.ord.setManualStage('all')"><i class="ri-list-check-3"></i> All<span class="sub-count">${toBn(counts.all)}</span></button>
  <button class="subtab ${stage==='pending'?'active':''}" onclick="YARZ.ord.setManualStage('pending')"><i class="ri-hourglass-2-line"></i> Pending<span class="sub-count">${toBn(counts.pending)}</span></button>
  <button class="subtab ${stage==='shipped'?'active':''}" onclick="YARZ.ord.setManualStage('shipped')"><i class="ri-truck-line"></i> Sent<span class="sub-count">${toBn(counts.shipped)}</span></button>
  <button class="subtab ${stage==='completed'?'active':''}" onclick="YARZ.ord.setManualStage('completed')"><i class="ri-checkbox-circle-line"></i> Complete<span class="sub-count">${toBn(counts.completed)}</span></button>
 </div>
 `;

 const listHtml = items.length ? items.map(o=>{
 const s = o.status||'Pending';
 const sc = STATUS_COLORS[s]||'chip-gray';

 // Determine next action based on current status
 let actionBtn = '';
 if(['Pending',''].includes(s)){
  actionBtn = `<button class="btn btn-blue btn-xs" onclick="YARZ.ord.updateManualStatus('${esc(o.orderId)}','Shipped')"><i class="ri-truck-line"></i> Sent</button>`;
 } else if(['Shipped','Picked Up','Ready for Delivery','Handed to Courier','Processing'].includes(s)){
  actionBtn = `<button class="btn btn-success btn-xs" onclick="YARZ.ord.updateManualStatus('${esc(o.orderId)}','Delivered')"><i class="ri-checkbox-circle-line"></i> Complete</button>`;
 } else {
  actionBtn = `<span class="chip chip-green"><i class="ri-check-line"></i> Done</span>`;
 }

 const parsed = parseCourierField(o.courier);
 const hasTracking = !!parsed.tracking;
 const searchQ = ($('mo-search')?.value||'').trim();
 const trackingHtml = renderTrackingBlock(o.courier, o.orderId, searchQ);
 const addTrackBtn = !hasTracking
  ? `<button class="btn btn-amber btn-xs" onclick="YARZ.ord.editCourierId('${esc(o.orderId)}')" title="Courier Tracking ID Enter/Paste"><i class="ri-add-line"></i> Tracking ID Add</button>`
  : '';

 return `<div class="list-item" style="flex-wrap:wrap">
  <div class="thumb"><i class="ri-shopping-bag-3-line"></i></div>
  <div class="li-body" style="min-width:0;flex:1">
  <div class="li-title">#${esc(o.orderId)} — ${esc(o.customer)}</div>
  <div class="li-sub"><i class="ri-phone-line"></i> <span class="bn-num">${esc(o.phone)}</span> · <span style="cursor:pointer;color:var(--brand);font-weight:700;text-decoration:underline;font-size:13.5px;" onclick="YARZ.inv.showDetails('${esc(o.product)}')"><i class="ri-shopping-bag-line"></i> ${esc(o.product)}</span> (${esc(_ordSize(o.size))}×<span class="bn-num">${toBn(o.qty)}</span>)</div>
  <div class="li-sub bn-num">${fmtDateTime(o.date)} · ${esc(o.payment)}</div>
  ${trackingHtml}
  <div class="li-actions" style="margin-top:8px;flex-wrap:wrap;gap:6px">
  ${actionBtn}
  ${addTrackBtn}
  <button class="btn btn-xs" style="background:#25D366;color:#fff;border:none" onclick="YARZ.ord.sendWhatsApp('${esc(o.orderId)}')"><i class="ri-whatsapp-fill"></i> WhatsApp</button>
  <button class="btn btn-ghost btn-xs" onclick="YARZ.ord.showManualStatusMenu('${esc(o.orderId)}')"><i class="ri-more-2-line"></i></button>
  <button class="btn btn-ghost btn-xs" style="color:var(--danger)" onclick="YARZ.ord.deleteManualOrder('${esc(o.orderId)}')"><i class="ri-delete-bin-6-line"></i></button>
  </div>
  </div>
  <div class="li-right">
  <div class="price bn-num">${fmtBDT(o.total)}</div>
  <span class="chip ${sc}">${esc(s)}</span>
  </div>
 </div>`;
 }).join('') : '<div class="empty-state"><i class="ri-file-list-3-line" style="font-size:32px;opacity:0.4"></i><p style="margin-top:10px">No orders</p></div>';

 $('mo-list').innerHTML = stageTabsHtml + listHtml;
 },

 setManualStage(stage){
 this._manualStage = stage;
 this.renderManual();
 },

 showManualStatusMenu(orderId){
 const o = state.data.orders.find(x=>x.orderId===orderId);
 if(!o) return;
 const statuses = ['Pending','Processing','Shipped','Delivered','Cancelled','Returned'];
 const html = `
 <div class="modal-header">
  <h3>Status Change — #${esc(orderId)}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="ri-close-line"></i></button>
 </div>
 <p style="font-size:12.5px;color:var(--ink-3);margin-bottom:14px">Current: <span class="chip ${STATUS_COLORS[o.status]||'chip-gray'}">${esc(o.status||'Pending')}</span></p>
 
 <div class="field" style="margin-bottom:16px;">
  <label style="font-size:11px;color:var(--ink-2)">Courier / Tracking Code (Optional)</label>
  <input id="status-courier-input" class="input" style="font-size:13px;" placeholder="e.g. Steadfast - 12345" value="${esc(o.courier || '')}">
 </div>

 <div style="display:grid;gap:8px">
  ${statuses.map(s=>`
  <button class="btn btn-ghost" style="justify-content:flex-start;${o.status===s?'border-color:var(--ink);font-weight:700':''}" onclick="YARZ.closeModal();YARZ.ord.updateManualStatus('${esc(orderId)}','${s}', document.getElementById('status-courier-input').value)">
  ${o.status===s?'<i class=\"ri-check-line\"></i> ':''}${s}
  </button>
  `).join('')}
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 async updateManualStatus(orderId, newStatus, courier = null){
 showLoader('Updating status...');
 try {
 const payload = { orderId, status:newStatus };
 if(courier !== null) payload.courier = courier;
 const res = await appsPost('updateManualOrderStatus', payload);
 if(res && res.success===false && res.error && !/Unknown action/i.test(res.error)) throw new Error(res.error||'Failed');
 // Update locally regardless (Apps Script add-on must support action)
 const o = state.data.orders.find(x=>x.orderId===orderId);
 if(o) {
  o.status = newStatus;
  if(courier !== null) o.courier = courier;
 }
 this.renderManual();
 YARZ.updateBadges();
  toast(`#${orderId} → ${newStatus}`,'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  deleteManualOrder(orderId){
 YARZ.openModal('delete-confirm', {
 name: `Manual Order #${orderId}`,
 onArchive: `YARZ.ord.updateManualStatus('${esc(orderId)}', 'Cancelled')`,
 onDelete: `YARZ.ord._permanentlyDeleteManualOrder('${esc(orderId)}')`
 });
 },

 async _permanentlyDeleteManualOrder(orderId){
 showLoader('Deleting...');
 try {
 const res = await appsPost('deleteManualOrder', { orderId });
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 const idx = state.data.orders.findIndex(x=>x.orderId===orderId);
 if(idx!==-1) state.data.orders.splice(idx,1);
 this.render();
  toast('Deleted','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  renderCustomers(){
 const q = ($('cu-search')?.value||'').toLowerCase().trim();
 const map = {};
 [...state.data.orders, ...state.data.websiteOrders].forEach(o=>{
 const ph = safeStr(o.phone); if(!ph) return;
 if(!map[ph]) map[ph] = { name:o.customer, phone:ph, orders:0, total:0, lastDate:null, returns:0 };
 map[ph].orders++;
 map[ph].total += num(o.total);
 if(o.date && (!map[ph].lastDate || o.date>map[ph].lastDate)) map[ph].lastDate = o.date;
 if(o.status==='Returned') map[ph].returns++;
 });
 let arr = Object.values(map).sort((a,b)=>b.total-a.total);
 if(q) arr = arr.filter(c=>(c.name+c.phone).toLowerCase().includes(q));
 $('cu-list').innerHTML = arr.length ? arr.map(c=>`
 <div class="list-item" onclick="YARZ.ord.showCustomer('${esc(c.phone)}')" style="cursor:pointer">
  <div class="thumb" style="background:rgba(139,127,217,0.18);color:var(--purple)"><i class="ri-user-3-line"></i></div>
  <div class="li-body">
  <div class="li-title">${esc(c.name)} ${c.returns>=3?'<span class="chip chip-red">⚠ High Risk</span>':''}</div>
  <div class="li-sub"><i class="ri-phone-line"></i> ${esc(YARZ.ord._fmtBdPhoneDisplay(c.phone))} • Last: ${c.lastDate?fmtDateBn(c.lastDate):'—'}</div>
  <div class="li-sub">${toBn(c.orders)} orders • ${toBn(c.returns)} returns</div>
  </div>
  <div class="li-right">
  <div class="price">${fmtBDT(c.total)}</div>
  <div style="font-size:10.5px;opacity:0.55;font-weight:600;margin-top:2px">View <i class="ri-arrow-right-s-line"></i></div>
  </div>
 </div>
 `).join('') : '<div class="empty-state"><i class="ri-team-line" style="font-size:32px;opacity:0.4"></i><p style="margin-top:10px">No customers</p></div>';
 },

 // ✅ Customer 360 — full profile + order history for one customer (phone).
 // Read-only: aggregates from in-memory orders/websiteOrders. No backend,
 // no storage writes — safe. Helps spot repeat buyers, risk, favourite size.
 showCustomer(phone){
 const ph = safeStr(phone);
 const all = [...state.data.orders, ...state.data.websiteOrders]
 .filter(o => safeStr(o.phone) === ph)
 .sort((a,b)=> (b.date?b.date.getTime():0) - (a.date?a.date.getTime():0));
 if(!all.length){ toast('No orders found','error'); return; }

 const name = safeStr(all.find(o=>o.customer)?.customer) || 'Customer';
 const totalSpent = all.reduce((s,o)=> s + num(o.total), 0);
 const delivered = all.filter(o=> o.status==='Delivered').length;
 const returned  = all.filter(o=> o.status==='Returned').length;
 const cancelled = all.filter(o=> /cancel/i.test(safeStr(o.status))).length;
 const pending   = all.length - delivered - returned - cancelled;
 const lastAddr  = safeStr(all.find(o=>o.address)?.address);
 const lastDate  = all[0].date ? fmtDateBn(all[0].date) : '—';
 const firstDate = all[all.length-1].date ? fmtDateBn(all[all.length-1].date) : '—';
 const avgValue  = all.length ? Math.round(totalSpent/all.length) : 0;

 // Favourite size (most ordered)
 const sizeCount = {};
 all.forEach(o=>{ const s = safeStr(o.size).toUpperCase(); if(s) sizeCount[s]=(sizeCount[s]||0)+1; });
 const favSize = Object.keys(sizeCount).sort((a,b)=>sizeCount[b]-sizeCount[a])[0] || '—';

 // Risk: 3+ returns, or returns >= half of all orders
 const isRisk = returned>=3 || (all.length>=2 && returned >= Math.ceil(all.length/2));
 // ✅ Normalize once: handles numbers stored without the leading 0
 // (Google Sheets strips it on numeric cells → "1601743670").
 const e164    = this._normalizeBdPhone(ph);           // +8801601743670 (or '')
 const phShow  = this._fmtBdPhoneDisplay(ph);          // 01601-743670
 const waPhone = e164 ? e164.replace('+','') : ph.replace(/[^\d]/g,'').replace(/^0/, '880');
 const telLink = e164 || ph;

 const rows = all.map(o=>{
 const chip = STATUS_COLORS[o.status] || 'chip-gray';
 const src = safeStr(o.source||o.activity||'Manual');
 return `
 <div class="list-item">
  <div class="li-body">
  <div class="li-title" style="font-size:13.5px">${esc(o.product||'—')} <span style="opacity:0.6;font-weight:500">${o.size?('• '+esc(_ordSize(o.size))):''} ${o.qty?('× '+toBn(o.qty)):''}</span></div>
  <div class="li-sub"><i class="ri-hashtag"></i>${esc(o.orderId||'—')} • ${o.date?fmtDateBn(o.date):'—'} ${src?('• '+esc(src)):''}</div>
  </div>
  <div class="li-right" style="text-align:right">
  <div class="price" style="font-size:14px">${fmtBDT(o.total)}</div>
  <span class="chip ${chip}" style="margin-top:3px">${esc(o.status||'—')}</span>
  </div>
 </div>`;
 }).join('');

 const html = `
 <div class="modal-header">
  <h3><i class="ri-user-3-line" style="color:var(--purple)"></i> ${esc(name)} ${isRisk?'<span class="chip chip-red" style="margin-left:6px">⚠ High Risk</span>':''}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="flex-gap mb-3" style="gap:8px;flex-wrap:wrap;align-items:center">
  <span class="li-sub"><i class="ri-phone-line"></i> ${esc(phShow)}</span>
  <a href="tel:${esc(telLink)}" class="btn btn-ghost btn-xs"><i class="ri-phone-line"></i> Call</a>
  <a href="https://wa.me/${esc(waPhone)}" target="_blank" rel="noopener" class="btn btn-sm" style="background:#25D366;color:#fff;border:none"><i class="ri-whatsapp-line"></i> WhatsApp</a>
 </div>
 <div class="grid grid-2 mb-3">
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Spent</div><div class="stat-value text-green" style="font-size:16px">${fmtBDT(totalSpent)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Total Orders</div><div class="stat-value" style="font-size:16px">${toBn(all.length)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Avg Order Value</div><div class="stat-value text-blue" style="font-size:16px">${fmtBDT(avgValue)}</div></div>
  <div class="stat-card glass" style="padding:10px"><div class="stat-label">Favourite Size</div><div class="stat-value text-purple" style="font-size:16px">${esc(_ordSize(favSize))}</div></div>
 </div>
 <div class="flex-gap mb-3" style="gap:6px;flex-wrap:wrap">
  <span class="chip chip-green">✓ Delivered: ${toBn(delivered)}</span>
  <span class="chip chip-amber">⏳ Pending: ${toBn(Math.max(0,pending))}</span>
  <span class="chip chip-red">↩ Returned: ${toBn(returned)}</span>
  ${cancelled?`<span class="chip chip-gray">✕ Cancelled: ${toBn(cancelled)}</span>`:''}
 </div>
 <div class="li-sub mb-3" style="line-height:1.6">
  <i class="ri-map-pin-line"></i> ${esc(lastAddr||'—')}<br>
  <i class="ri-calendar-line"></i> First order: ${firstDate} • Last order: ${lastDate}
 </div>
 <div class="modal-section-title">Order History (${toBn(all.length)})</div>
 <div style="max-height:38vh;overflow-y:auto">${rows}</div>
 <div class="modal-actions">
  <button class="btn btn-primary" onclick="YARZ.closeModal()">Close</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 }
};

/* ============================================================
 ============ FINANCE MODULE ============
============================================================ */
YARZ.finance = {
 render(){
 const totalAd = state.data.adTracker.reduce((s,a)=>s+a.amount,0);
 const totalExp = state.data.expenses.reduce((s,e)=>s+e.amount,0);
 const totalReturn = state.data.transactions.filter(t=>t.type==='Return').length;
 $('finance-stats').innerHTML = `
 <div class="stat-card">
  <div class="stat-icon purple"><i class="ri-megaphone-line"></i></div>
  <div class="stat-label">Total Ad Spend</div>
  <div class="stat-value">${fmtBDT(totalAd)}</div>
  <div class="stat-sub">${toBn(state.data.adTracker.length)} entries</div>
 </div>
 <div class="stat-card">
  <div class="stat-icon red"><i class="ri-bill-line"></i></div>
  <div class="stat-label">Total Expenses</div>
  <div class="stat-value">${fmtBDT(totalExp)}</div>
  <div class="stat-sub">${toBn(state.data.expenses.length)} entries</div>
 </div>
 <div class="stat-card">
  <div class="stat-icon amber"><i class="ri-arrow-go-back-line"></i></div>
  <div class="stat-label">Total Returns</div>
  <div class="stat-value">${toBn(totalReturn)}</div>
  <div class="stat-sub">Product Return</div>
 </div>
 `;

 $('ad-list').innerHTML = state.data.adTracker.slice(-10).reverse().map(a=>`
 <div class="list-item">
  <div class="thumb" style="background:rgba(139,127,217,0.18);color:var(--purple)"><i class="ri-megaphone-line"></i></div>
  <div class="li-body">
  <div class="li-title">${esc(a.product||a.campaign||'—')}</div>
  <div class="li-sub">${fmtDateBn(a.date)} • ${esc(a.campaign||'')}</div>
  </div>
  <div class="price" style="color:var(--purple)">${fmtBDT(a.amount)}</div>
 </div>
 `).join('') || '<div class="empty-state"><i class="ri-megaphone-line" style="font-size:28px;opacity:0.4"></i><p style="margin-top:8px">any Ad Spend None</p></div>';

 $('exp-list').innerHTML = state.data.expenses.slice(-10).reverse().map(e=>`
 <div class="list-item">
  <div class="thumb" style="background:rgba(232,98,92,0.14);color:var(--danger)"><i class="ri-bill-line"></i></div>
  <div class="li-body">
  <div class="li-title">${esc(e.category)}</div>
  <div class="li-sub">${fmtDateBn(e.date)} • ${esc(e.description||e.paidTo||'')}</div>
  </div>
  <div class="price" style="color:var(--danger)">${fmtBDT(e.amount)}</div>
 </div>
 `).join('') || '<div class="empty-state"><i class="ri-bill-line" style="font-size:28px;opacity:0.4"></i><p style="margin-top:8px">any Expense None</p></div>';
 }
};

/* ============================================================
 ============ REPORTS MODULE ============
============================================================ */
YARZ.cust = {
  data: [],
  selected: new Set(),
  toggleAll(checked) {
    const chks = document.querySelectorAll('.cust-chk');
    chks.forEach(c => { c.checked = checked; this.toggle(c.value, checked); });
  },
  toggle(phone, checked) {
    if(checked) this.selected.add(String(phone));
    else this.selected.delete(String(phone));
    this.updateBulkBar();
  },
  updateBulkBar() {
    const count = this.selected.size;
    const bar = document.getElementById('cust-bulk-bar');
    if(bar) bar.style.display = count > 0 ? 'flex' : 'none';
    const cEl = document.getElementById('cust-sel-count');
    if(cEl) cEl.innerText = count + ' Selected';
    const chkAll = document.getElementById('cust-chk-all');
    if(chkAll) chkAll.checked = (count > 0 && count === document.querySelectorAll('.cust-chk').length);
  },
  async bulkDelete() {
    if(this.selected.size === 0) return;
    if(!confirm('Are you sure you want to completely delete ' + this.selected.size + ' customer(s) from the LTV database? This cannot be undone.')) return;
    
    const phones = Array.from(this.selected);
    try {
      const res = await appsPost('delete_customers', { phones: phones });
      if(res && res.success) {
        toast(this.selected.size + ' customer(s) deleted', 'success');
        this.selected.clear();
        this.updateBulkBar();
        this.load(); // reload data
      } else {
        toast(res.msg || 'Failed to delete', 'error');
      }
    } catch(e) {
      toast('Network error', 'error');
    }
  },
  async load() {
    try {
      const r = await fetch(WORKER + '/__customerLTV', { 
        method: 'GET',
        headers: { 'Authorization': window._adminToken || '' }
      });
      const j = await r.json();
      if(j && j.success) {
        this.data = j.data;
        this.selected.clear();
        this.updateBulkBar();
        this.render();
        this.updateDashboard();
      }
    } catch(e) { console.error(e); }
  },
  render() {
    const q = ($('cust-search').value||'').toLowerCase().trim();
    let items = [...this.data];
    if(q) items = items.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q));
    
    // Sort by LTV descending
    items.sort((a,b) => Number(b.ltv) - Number(a.ltv));
    
    // Update metrics
    const vips = this.data.filter(c => Number(c.ltv) >= 5000).length;
    const repeats = this.data.filter(c => Number(c.orders) > 1).length;
    const rate = this.data.length ? Math.round((repeats / this.data.length) * 100) : 0;
    
    if($('vip-count')) $('vip-count').innerText = toBn(vips);
    if($('repeat-rate')) $('repeat-rate').innerText = toBn(rate) + '%';
    
    const el = $('cust-list');
    if(!items.length) {
      el.innerHTML = '<div class="empty-state"><p>No customers found</p></div>';
      return;
    }
    
    el.innerHTML = items.slice(0, 100).map((c, i) => {
      const isVip = Number(c.ltv) >= 5000;
      return `
      <div class="list-item">
        <input type="checkbox" class="cust-chk" value="${c.phone}" onchange="YARZ.cust.toggle(this.value, this.checked)" ${this.selected.has(String(c.phone)) ? 'checked' : ''} style="margin-right:12px; transform:scale(1.2); cursor:pointer">
        <div class="thumb" style="background:var(--bg-card);font-size:16px;display:flex;align-items:center;justify-content:center">${isVip?'👑':'👤'}</div>
        <div class="li-body">
          <div class="li-title" style="font-size:14.5px">${esc(c.name||'Customer')} ${isVip?'<span class="chip chip-warn">VIP</span>':''}</div>
          <div class="li-sub">${esc(c.phone)} &bull; ${toBn(c.orders)} Orders</div>
        </div>
        <div class="li-right" style="text-align:right">
          <div class="price text-green" style="font-size:16px">${fmtBDT(c.ltv)}</div>
          <div style="font-size:10px;opacity:0.6;font-weight:600">LTV</div>
        </div>
      </div>`;
    }).join('');
  },
  updateDashboard() {
    const repeats = this.data.filter(c => Number(c.orders) > 1).length;
    const rate = this.data.length ? Math.round((repeats / this.data.length) * 100) : 0;
    const dashEl = $('dash-repeat-rate');
    if(dashEl) dashEl.innerText = toBn(rate) + '% Repeat';
  }
};

YARZ.pa = {
  data: [],
  async load() {
    try {
      const r = await fetch(WORKER + '/__productAnalytics6m', { 
        method: 'GET',
        headers: { 'Authorization': window._adminToken || '' }
      });
      const j = await r.json();
      if(j && j.success) {
        this.data = j.data;
        this.render();
      }
    } catch(e) { console.error(e); }
  },
  render() {
    const q = ($('pa-search').value||'').toLowerCase().trim();
    // Group by product
    const prodMap = {};
    this.data.forEach(d => {
      if(!prodMap[d.product_name]) prodMap[d.product_name] = { totalRev:0, totalNet:0, totalUnits:0 };
      prodMap[d.product_name].totalRev += Number(d.revenue||0);
      prodMap[d.product_name].totalNet += (Number(d.revenue||0) - Number(d.cost||0));
      prodMap[d.product_name].totalUnits += Number(d.units_sold||0);
    });
    
    let prods = Object.keys(prodMap);
    if(q) prods = prods.filter(p => p.toLowerCase().includes(q));
    
    prods.sort((a,b) => prodMap[b].totalNet - prodMap[a].totalNet);

    const el = $('pa-list');
    if(!prods.length) {
      el.innerHTML = '<div class="empty-state"><p>No analytics found</p></div>';
      return;
    }
    
    el.innerHTML = prods.map(p => {
      const pm = prodMap[p];
      return `
      <div class="list-item clickable" onclick="YARZ.pa.showDetails('${esc(p)}')">
        <div class="li-body">
          <div class="li-title">${esc(p)}</div>
          <div class="li-sub">Units: ${toBn(pm.totalUnits)} &bull; Revenue: ${fmtBDT(pm.totalRev)}</div>
        </div>
        <div class="li-right">
          <div class="price ${pm.totalNet>=0?'text-green':'text-red'}">${fmtBDT(pm.totalNet)}</div>
          <div style="font-size:10px;text-align:right">6m Profit</div>
        </div>
      </div>`;
    }).join('');
  },
  showDetails(prod) {
    $('pa-modal-title').innerText = prod;
    
    const d = this.data.filter(x => x.product_name === prod);
    d.sort((a,b) => a.month_id.localeCompare(b.month_id));
    
    const labels = d.map(x => x.month_id);
    const nets = d.map(x => Number(x.revenue||0) - Number(x.cost||0));
    
    $('pa-modal-chart').innerHTML = '<div style="height:200px"><canvas id="pa-canvas"></canvas></div>';
    new Chart(document.getElementById('pa-canvas').getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{ label: 'Net Profit', data: nets, backgroundColor: nets.map(n=>n>=0?'#10b981':'#ef4444') }]
      },
      options: { maintainAspectRatio: false }
    });
    
    $('pa-modal-table').innerHTML = `
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr style="border-bottom:1px solid rgba(0,0,0,0.1)">
          <th style="padding:8px;text-align:left">Month</th>
          <th style="padding:8px;text-align:center">Units</th>
          <th style="padding:8px;text-align:right">Profit</th>
        </tr>
        ${d.map(x => `
        <tr style="border-bottom:1px solid rgba(0,0,0,0.05)">
          <td style="padding:8px">${esc(x.month_id)}</td>
          <td style="padding:8px;text-align:center">${toBn(x.units_sold)}</td>
          <td style="padding:8px;text-align:right" class="${nets[d.indexOf(x)]>=0?'text-green':'text-red'}">${fmtBDT(nets[d.indexOf(x)])}</td>
        </tr>`).join('')}
      </table>
    `;
    
    openModal('pa-modal');
  }
};

YARZ.rep = {
 filter: { from: null, to: null },

 onQuickSelect(val) {
   if(!val) return;
   const now = new Date();
   let f, t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
   if(val === 'this_month') { f = new Date(now.getFullYear(), now.getMonth(), 1); }
   else if(val === 'last_month') { f = new Date(now.getFullYear(), now.getMonth()-1, 1); t = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59); }
   else if(val === 'last_3_months') { f = new Date(now.getFullYear(), now.getMonth()-3, 1); }
   else if(val === 'this_year') { f = new Date(now.getFullYear(), 0, 1); }
   else if(val === 'all_time') { f = null; t = null; }
   
   if(f) $('rep-from').value = f.toISOString().split('T')[0]; else $('rep-from').value = '';
   if(t && val !== 'all_time') $('rep-to').value = t.toISOString().split('T')[0]; else $('rep-to').value = '';
   if(val === 'all_time') this.clearFilter();
   else this.applyFilter();
 },

 applyFilter() {
   const f = $('rep-from').value;
   const t = $('rep-to').value;
   this.filter.from = f ? new Date(f + 'T00:00:00') : null;
   this.filter.to = t ? new Date(t + 'T23:59:59') : null;
   this.render();
 },

 clearFilter() {
   $('rep-from').value = '';
   $('rep-to').value = '';
   $('rep-quick').value = '';
   this.filter.from = null;
   this.filter.to = null;
   this.render();
 },

 _inRange(d) {
   if(!d) return false;
   if(!this.filter.from && !this.filter.to) return true;
   const t = d.getTime();
   if(this.filter.from && t < this.filter.from.getTime()) return false;
   if(this.filter.to && t > this.filter.to.getTime()) return false;
   return true;
 },

 render(){
 // Sync UI
 if(this.filter.from) $('rep-from').value = this.filter.from.toISOString().split('T')[0];
 if(this.filter.to) $('rep-to').value = this.filter.to.toISOString().split('T')[0];

 // Monthly
 const monthly = this._buildGroup('month');
 const yearly = this._buildGroup('year');
 this._renderChart('monthly-chart', monthly, 'monthly');
 this._renderChart('yearly-chart', yearly, 'yearly');
 this._renderTable('monthly-table', monthly, 'monthly');
 this._renderTable('yearly-table', yearly, 'yearly');
 
 // Most Profitable Products

 // Filter profitable products by date range
 const fTx = state.data.transactions.filter(t => this._inRange(t.date));
 const pNet = {};
 fTx.forEach(t => {
   if(t.type !== 'Return') {
     pNet[t.product] = (pNet[t.product]||0) + (t.revenue - t.cost);
   }
 });
 const topProfitable = state.data.inventory
   .map(p => ({ ...p, fNet: pNet[p.name] || 0 }))
   .filter(p => p.fNet > 0)
   .sort((a,b) => b.fNet - a.fNet)
   .slice(0, 5);

 $('profitable-products').innerHTML = topProfitable.length ? topProfitable.map(p=>`
 <div class="list-item" onclick="YARZ.goPage('inventory');YARZ.inv.showDetails('${esc(p.name)}')">
  <div class="thumb" style="${p.img1?`background-image:url('${esc(getImgSrc(p.img1))}')`:''}">${p.img1?'':'<i class=\"ri-shopping-bag-3-line\"></i>'}</div>
  <div class="li-body">
  <div class="li-title" style="font-size:14.5px">${esc(p.name)}</div>
  <div class="li-sub">${esc(p.category||'')} • Sold: <strong style="font-size:13px;color:var(--ink);font-family:'Inter',sans-serif">${p.totalSold}</strong></div>
  </div>
  <div class="li-right" style="text-align:right">
  <div class="price text-green" style="font-size:17px;font-family:'Inter',sans-serif">${fmtBDT(p.fNet)}</div>
  <div style="font-size:10.5px;opacity:0.6;font-weight:600">Profit</div>
  </div>
 </div>
 `).join('') : '<div class="empty-state"><p>No data</p></div>';

 // Platform Ranking
 this._renderPlatformRanking();
 this._renderAdROI();
 },


 _renderAdROI(){
  const ad = state.data.adTracker.filter(a => this._inRange(a.date));
  const ord = [...state.data.orders, ...state.data.websiteOrders].filter(o => this._inRange(o.date) && o.status !== 'Cancelled' && o.status !== 'Returned');
  
  const chMap = {};
  
  // Aggregate Ad Spend by Channel
  ad.forEach(a => {
    const ch = (a.channel || 'Other').trim();
    if(!chMap[ch]) chMap[ch] = { spend:0, rev:0, orders:0 };
    chMap[ch].spend += Number(a.amount||0);
  });
  
  // Aggregate Orders & Revenue by Channel
  ord.forEach(o => {
    const ch = (o.source || 'Manual').trim();
    // Only map known channels from orders if they have ad spend or we want to track them
    if(chMap[ch] || ch !== 'Manual') {
      if(!chMap[ch]) chMap[ch] = { spend:0, rev:0, orders:0 };
      chMap[ch].rev += Number(o.total||0);
      chMap[ch].orders += 1;
    }
  });

  const ranked = Object.keys(chMap).map(k=>({ch:k,...chMap[k]})).filter(c => c.spend > 0 || c.orders > 0).sort((a,b)=>b.rev-a.rev);
  const el = $('ad-roi-list');
  if(!el) return;
  if(!ranked.length){
    el.innerHTML = '<div class="empty-state"><p>No Ad ROI data</p></div>'; return;
  }
  
  el.innerHTML = ranked.map(c => {
    const roas = c.spend > 0 ? (c.rev / c.spend).toFixed(2) : '0.00';
    const cpa = c.orders > 0 ? Math.round(c.spend / c.orders) : 0;
    const isGood = c.spend > 0 ? (c.rev / c.spend >= 2.0) : true;
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.6);margin-bottom:8px" class="dark-card">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
          <span style="font-weight:700;font-size:13.5px">${esc(c.ch)}</span>
          <span class="chip ${isGood?'chip-green':'chip-red'}" style="margin-left:auto">ROAS ${roas}x</span>
        </div>
        <div style="font-size:11px;color:var(--ink-3);display:flex;justify-content:space-between">
          <span>Spend: ${fmtBDT(c.spend)}</span>
          <span>Rev: ${fmtBDT(c.rev)}</span>
        </div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px">Orders: ${toBn(c.orders)} (CPA: ৳${toBn(cpa)})</div>
      </div>
    </div>`;
  }).join('');
 },

 _renderPlatformRanking(){
 const allOrders = [...state.data.orders, ...state.data.websiteOrders].filter(o => this._inRange(o.date));
 const PLATFORMS = {
 'Facebook': { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>', color: '#1877F2' },
 'Instagram': { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="url(#ig)"><defs><linearGradient id="ig" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#f09433"/><stop offset="25%" stop-color="#e6683c"/><stop offset="50%" stop-color="#dc2743"/><stop offset="75%" stop-color="#cc2366"/><stop offset="100%" stop-color="#bc1888"/></linearGradient></defs><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>', color: '#E1306C' },
 'WhatsApp': { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>', color: '#25D366' },
 'TikTok':  { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#000"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V9.09a8.16 8.16 0 004.77 1.52V7.16a4.85 4.85 0 01-1-.47z"/></svg>', color: '#000000' },
 'Website': { icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#5B8DEF"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-1 17.93A8.014 8.014 0 014.07 13H7c.13 1.04.38 2.03.73 2.93L11 17.93zM11 13H4.07A8.014 8.014 0 014.07 11H11v2zm0-4H4.458A8.047 8.047 0 0111 4.07V9zm2 8.93l3.27-2c.35-.9.6-1.89.73-2.93h2.93A8.014 8.014 0 0113 17.93zM13 13v-2h6.93A8.014 8.014 0 0113 13zM13 9V4.07A8.047 8.047 0 0119.542 9H13z"/></svg>', color: '#5B8DEF' },
 'Manual':  { icon: '<i class="ri-user-settings-line"></i>', color: '#8B7FD9' }
 };
 const rankMap = {};
 allOrders.forEach(o => {
 const src = o.source || 'Manual';
 rankMap[src] = rankMap[src] || { count:0, total:0 };
 rankMap[src].count++;
 rankMap[src].total += num(o.total);
 });
 const ranked = Object.keys(rankMap).map(k=>({src:k,...rankMap[k]})).sort((a,b)=>b.count-a.count);
 const maxCount = ranked[0]?.count || 1;
 const el = $('platform-ranking');
 if(!el) return;
 if(!ranked.length){
 el.innerHTML = '<div class="empty-state"><p>No order data</p></div>'; return;
 }
 el.innerHTML = ranked.map((p,i) => {
 const pf = PLATFORMS[p.src] || { icon: `<i class="ri-globe-line"></i>`, color:'var(--ink-3)' };
 const pct = Math.round(p.count/maxCount*100);
 const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
 return `
 <div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,0.4);border:1px solid rgba(255,255,255,0.6);margin-bottom:8px" class="dark-card">
  <div style="width:32px;height:32px;border-radius:10px;background:rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,0.08)">${pf.icon}</div>
  <div style="flex:1;min-width:0">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
  <span style="font-weight:700;font-size:13.5px">${medal} ${esc(p.src)}</span>
  <span class="chip chip-blue" style="margin-left:auto">${toBn(p.count)} Orders</span>
  </div>
  <div style="height:6px;background:rgba(0,0,0,0.06);border-radius:999px;overflow:hidden">
  <div style="height:100%;width:${pct}%;background:${pf.color};border-radius:999px;transition:width 0.6s ease"></div>
  </div>
  <div style="font-size:11px;color:var(--ink-3);margin-top:4px">Total: ${fmtBDT(p.total)}</div>
  </div>
  <div style="font-size:22px;font-weight:800;color:${pf.color};min-width:36px;text-align:right">${toBn(pct)}%</div>
 </div>`;
 }).join('');
 },

 _buildGroup(kind){
 const out = {};
 const tx = state.data.transactions;
 const ad = state.data.adTracker;
 const ex = state.data.expenses;
 const ord = [...state.data.orders, ...state.data.websiteOrders];
 const keyOf = d => {
 if(!d) return null;
 const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0');
 return kind==='month' ? `${y}-${m}` : String(y);
 };
 const bump = (k, kind2, v)=>{
 if(!k) return;
 out[k] = out[k] || { rev:0, cost:0, ad:0, exp:0, orders:0, returns:0 };
 out[k][kind2] += v;
 };
 tx.filter(t=>this._inRange(t.date)).forEach(t=>{
 const k = keyOf(t.date); if(!k) return;
 if(t.type==='Return'){ out[k] = out[k]||{rev:0,cost:0,ad:0,exp:0,orders:0,returns:0}; out[k].returns++; }
 out[k] = out[k]||{rev:0,cost:0,ad:0,exp:0,orders:0,returns:0};
 out[k].rev += t.revenue; out[k].cost += t.cost;
 });
 ad.filter(a=>this._inRange(a.date)).forEach(a=>{ const k=keyOf(a.date); if(!k)return; out[k]=out[k]||{rev:0,cost:0,ad:0,exp:0,orders:0,returns:0}; out[k].ad += a.amount; });
 ex.filter(e=>this._inRange(e.date)).forEach(e=>{ const k=keyOf(e.date); if(!k)return; out[k]=out[k]||{rev:0,cost:0,ad:0,exp:0,orders:0,returns:0}; out[k].exp += e.amount; });
 ord.filter(o=>this._inRange(o.date)).forEach(o=>{ const k=keyOf(o.date); if(!k)return; if(['Cancelled', 'Returned'].includes(o.status)) return; out[k]=out[k]||{rev:0,cost:0,ad:0,exp:0,orders:0,returns:0}; out[k].orders++; });
 return Object.keys(out).sort().map(k=>{
 const r = out[k]; const net = r.rev-r.cost-r.ad-r.exp;
 const margin = r.rev>0 ? Math.round(net/r.rev*100) : 0;
 return { key:k, ...r, net, margin };
 });
 },

 _renderChart(elId, data, kind){
 const el = $(elId);
 if(!data.length){ el.innerHTML='<div class="empty-state"><i class="fas fa-chart-bar"></i><p>No data</p></div>'; return; }
 const last = data.slice(-12);
 const canvasId = elId + '-canvas';
 el.innerHTML = `<div style="height:220px;width:100%"><canvas id="${canvasId}"></canvas></div>`;
 const ctx = document.getElementById(canvasId).getContext('2d');
 
 const labels = last.map(d => kind==='monthly' ? fmtBnMonth(d.key).replace(/\s+\d+$/,'') : toBn(d.key));
 const revs = last.map(d => d.rev);
 const nets = last.map(d => d.net);
 
 new Chart(ctx, {
 type: 'bar',
 data: {
  labels,
  datasets: [
  { label: 'Revenue', data: revs, backgroundColor: '#3b82f6', borderRadius: 4 },
  { label: 'Net Profit', data: nets, backgroundColor: nets.map(n=>n>=0?'#10b981':'#ef4444'), borderRadius: 4 }
  ]
 },
 options: {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
  legend: { display: true, position: 'bottom', labels: { color: document.body.classList.contains('dark') ? '#EDEDED' : '#1C1C1C' } }
  },
  scales: {
  y: { beginAtZero: true, grid: { color: 'rgba(150,150,150,0.1)' }, ticks: { color: document.body.classList.contains('dark') ? '#EDEDED' : '#1C1C1C' } },
  x: { grid: { display: false }, ticks: { color: document.body.classList.contains('dark') ? '#EDEDED' : '#1C1C1C' } }
  }
 }
 });
 },

 _renderTable(elId, data, kind){
 const el = $(elId);
 if(!data.length){ el.innerHTML=''; return; }
 const rev = data.slice().reverse();
 el.innerHTML = `
 <div style="overflow-x:auto">
  <table style="width:100%;font-size:12px;border-collapse:collapse">
  <thead><tr style="background:rgba(255,255,255,0.04);text-align:left">
  <th style="padding:8px">${kind==='monthly'?'':''}</th>
  <th style="padding:8px">Orders</th>
  <th style="padding:8px">Revenue</th>
  <th style="padding:8px">Cost</th>
  <th style="padding:8px">Ad</th>
  <th style="padding:8px">Exp</th>
  <th style="padding:8px">Net</th>
  <th style="padding:8px">Margin</th>
  </tr></thead>
  <tbody>
  ${rev.map(d=>`<tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
   <td style="padding:8px"><b>${kind==='monthly'?fmtBnMonth(d.key):toBn(d.key)}</b></td>
   <td style="padding:8px">${toBn(d.orders)}</td>
   <td style="padding:8px;color:#60A5FA">${fmtBDT(d.rev)}</td>
   <td style="padding:8px">${fmtBDT(d.cost)}</td>
   <td style="padding:8px;color:#A78BFA">${fmtBDT(d.ad)}</td>
   <td style="padding:8px;color:#F87171">${fmtBDT(d.exp)}</td>
   <td style="padding:8px;color:${d.net>=0?'#34D399':'#F87171'};font-weight:700">${fmtBDT(d.net)}</td>
   <td style="padding:8px">${toBn(d.margin)}%</td>
  </tr>`).join('')}
  </tbody>
  </table>
 </div>
 `;
 },

 async generate(kind){
 showLoader(`${kind==='monthly'?'Monthly':'Yearly'} Saving report...`);
 try {
 const res = await appsPost(kind==='monthly'?'generateMonthlyReport':'generateYearlyReport',{});
  toast('Report Sheet- Saved','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
 }
};

/* ============================================================
 ============ PREVIEW MODULE ============
============================================================ */
YARZ.preview = {
 render(){
 const q = ($('prev-search')?.value||'').toLowerCase().trim();
 let items = state.data.inventory.filter(p=>p.status==='Active');
 if(q) items = items.filter(p=>(p.name+p.category+p.fabric).toLowerCase().includes(q));
 $('preview-grid').innerHTML = items.length ? items.map(p=>{
 const left = Math.max(0,p.remaining);
 const sizesAvail = ['S','M','L','XL','XXL','3XL'].filter(sz=>(p['stk'+sz]-p['sold'+sz])>0);
 const imgs = [p.img1, p.img2, p.img3].map(x=>x?getImgSrc(x):'').filter(Boolean);
 const imgData = esc(JSON.stringify(imgs));
 return `<div class="preview-card" onclick="YARZ.inv.showDetails('${esc(p.name)}')">
  <div class="preview-img" id="prev-slider-${esc(p.name)}" data-imgs="${imgData}" data-idx="0" style="${imgs.length?`background-image:url('${esc(imgs[0])}')`:''}">
  ${imgs.length>1 ? `
  <div style="position:absolute;top:50%;left:5px;transform:translateY(-50%);background:rgba(0,0,0,0.4);color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="event.stopPropagation(); window.slideImg('prev-slider-${esc(p.name)}', -1)"><i class="ri-arrow-left-s-line"></i></div>
  <div style="position:absolute;top:50%;right:5px;transform:translateY(-50%);background:rgba(0,0,0,0.4);color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;cursor:pointer;" onclick="event.stopPropagation(); window.slideImg('prev-slider-${esc(p.name)}', 1)"><i class="ri-arrow-right-s-line"></i></div>
  ` : ''}
  ${p.badge?`<div class="preview-badge">${esc(p.badge)}</div>`:''}
  ${!imgs.length?'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;opacity:0.3"><i class="fas fa-image"></i></div>':''}
  </div>
  <div class="preview-body">
  <div class="preview-name">${esc(p.name)}</div>
  <div class="preview-price">
  <span class="preview-sale">${fmtBDT(p.sale)}</span>
  ${p.regular>p.sale?`<span class="preview-reg">${fmtBDT(p.regular)}</span>`:''}
  </div>
  <div class="preview-stock">
  ${left>0 ? `✅ Available • Sizes: ${sizesAvail.join(', ')||'—'}` : '<span style="color:#F87171">⛔ Out of Stock</span>'}
  </div>
  </div>
 </div>`;
 }).join('') : '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-store"></i><p>No active products</p></div>';
 }
};

/* ============================================================
 ============ WEBSITE CONTROL (CMS) MODULE ============
============================================================ */
YARZ.webControl = {
 setTab(tab) {
 qsa('.wc-tab').forEach(el => el.classList.remove('active'));
 qsa('.wc-tab-content').forEach(el => el.classList.add('hidden'));
 const btn = qs(`.wc-tab[data-wc-tab="${tab}"]`);
 const content = $(`wc-tab-${tab}`);
 if(btn) btn.classList.add('active');
 if(content) content.classList.remove('hidden');
 // ✅ v3.7 SAFETY: When user opens "Banners & Flash" or "Cart & Checkout"
 // tab, make sure their dynamic sections are rendered even if the main
 // render() never ran (e.g. settings still loading from Apps Script).
 try {
 if(tab === 'banners') {
  const bc = $('wc-banners-container');
  if(bc && (!bc.children.length || bc.querySelector('#wc-banners-empty-msg'))) this.renderBanners();
 } else if(tab === 'checkout') {
  const dc = $('wc-delivery-locations');
  if(dc && !dc.children.length) this.renderDeliveryRows();
 } else if(tab === 'extras') {
  // ✅ v11: Lazy-render the Extras tab on first open
  const fl = $('wc-faq-list'), rl = $('wc-reviews-list'), ps = $('wc-popup-slots');
  if(fl && !fl.children.length) this.renderFaqs();
  if(rl && !rl.children.length) this.renderReviews();
  if(ps && !ps.children.length) this.renderPopupSlots();
 }
 } catch(e) { /* silent */ }
 },

 render() {
 const s = state.data.settings || {};
 // ✅ v11.3: Robust parseBool — handles "TRUE" / true / "yes" / 1 / etc.
 const parseBool = (val) => {
 if (val === true || val === 1) return true;
 if (val === false || val === 0 || val == null || val === '') return false;
 const str = String(val).toLowerCase().trim();
 return ['true','yes','1','on','enabled','enable','chalu','Active'].includes(str);
 };
 
 // --- General & Promo ---
 const storeStatus = s['Store Status'];
 const cbStatus = $('wc-store-status');
 if(cbStatus) cbStatus.checked = (storeStatus === 'Maintenance');

 const b2bMode = s['B2B Mode'];
 const cbB2B = $('wc-b2b-mode');
 if(cbB2B) cbB2B.checked = parseBool(b2bMode);

 // v15.74: Holiday / Vacation Mode
 const cbHoliday = $('wc-holiday-mode');
 if(cbHoliday) cbHoliday.checked = parseBool(s['Holiday Mode']);
 const ddHolidayReason = $('wc-holiday-reason');
 if(ddHolidayReason) ddHolidayReason.value = (s['Holiday Reason'] || 'custom').toString().toLowerCase();
 const taHolidayMsg = $('wc-holiday-msg');
 if(taHolidayMsg) taHolidayMsg.value = s['Holiday Custom Message'] || '';
 const dtHolidayReturn = $('wc-holiday-return-date');
 if(dtHolidayReturn) {
 // ✅ FIX: Google Sheets coerces the saved datetime into a Date, which comes
 // back as a UTC ISO string (e.g. "2026-06-15T04:00:00.000Z"). A raw assign
 // made <input type="datetime-local"> silently reject it → field looked empty
 // → next Save wiped the value → countdown vanished. Normalise ANY form
 // (date-only, bare datetime-local, or ISO/Z) into the "YYYY-MM-DDTHH:MM"
 // Dhaka wall-clock the input expects (timezone-independent: always +6).
 var _hrd = String(s['Holiday Return Date'] || '').trim();
 if (_hrd) {
   var _bare = _hrd.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
   if (_bare) {
     // Already Dhaka wall-clock as admin typed; ensure a time part exists.
     _hrd = _bare[1] + '-' + _bare[2] + '-' + _bare[3] + 'T' + (_bare[4] || '00') + ':' + (_bare[5] || '00');
   } else {
     var _t = Date.parse(_hrd);
     if (!isNaN(_t)) {
       var _dh = new Date(_t + 6 * 3600 * 1000); // shift to Dhaka, read UTC fields
       var _p = function(n){ return String(n).padStart(2,'0'); };
       _hrd = _dh.getUTCFullYear() + '-' + _p(_dh.getUTCMonth()+1) + '-' + _p(_dh.getUTCDate())
            + 'T' + _p(_dh.getUTCHours()) + ':' + _p(_dh.getUTCMinutes());
     } else {
       _hrd = '';
     }
   }
 }
 dtHolidayReturn.value = _hrd;
 }

 const currency = $('wc-currency');
 if(currency) currency.value = s['Currency'] || '';

 const lang = $('wc-language');
 if(lang) lang.value = s['Language'] || 'bn';

 const active = s['Announcement Active'];
 const checkbox = $('wc-announcement-active');
 if(checkbox) checkbox.checked = parseBool(active);
 
 const textEl = $('wc-announcement-text');
 if(textEl) textEl.value = s['Announcement Text'] || '';
 if($('wc-ann-bg')) { $('wc-ann-bg').value = s['Announcement BG']||'#1A202C'; $('wc-ann-bg-picker').value = $('wc-ann-bg').value; }
 if($('wc-ann-text')) { $('wc-ann-text').value = s['Announcement Text Color']||'#FFFFFF'; $('wc-ann-text-picker').value = $('wc-ann-text').value; }

 const popupActive = s['Promo Popup Active'];
 const cbPopup = $('wc-popup-active');
 if(cbPopup) cbPopup.checked = parseBool(popupActive);

 const popupImg = $('wc-popup-img');
 if(popupImg) {
 popupImg.value = s['Promo Popup Image'] || '';
 this._previewImg(popupImg, 'wc-popup-preview');
 }
 const popupLink = $('wc-popup-link');
 if(popupLink) {
 popupLink.value = s['Promo Popup Link'] || '';
 this._previewImg(popupLink, 'wc-popup-preview2');
 }

 // --- Branding ---
 const logoEl = $('wc-logo'); if(logoEl) { logoEl.value = s['Website Logo URL']||''; this._previewImg(logoEl, 'wc-logo-preview'); }
 const colorEl = $('wc-theme-color'); if(colorEl) { colorEl.value = s['Theme Color']||'#1A202C'; $('wc-color-picker').value = colorEl.value; }
 const font = $('wc-font'); if(font) font.value = s['Font'] || 'inter';
 const livechat = $('wc-live-chat'); if(livechat) livechat.value = s['Live Chat'] || '';
 const footEl = $('wc-footer-text'); if(footEl) footEl.value = s['Footer Text']||'';
 const fbEl = $('wc-link-fb'); if(fbEl) fbEl.value = s['Link Facebook']||'';
 const igEl = $('wc-link-ig'); if(igEl) igEl.value = s['Link Instagram']||'';
 const waEl = $('wc-link-wa'); if(waEl) waEl.value = s['Link WhatsApp']||'';
 const msEl = $('wc-link-ms'); if(msEl) msEl.value = s['Link Messenger']||'';
 const ttEl = $('wc-link-tt'); if(ttEl) ttEl.value = s['Link TikTok']||'';
 const ytEl = $('wc-link-yt'); if(ytEl) ytEl.value = s['Link YouTube']||'';

 // --- Banners & Flash ---
 // ✅ v15.6: Flash Date is datetime-local — needs format normalization
 const _flashToDtLocal = (v) => {
 if (v == null || v === '') return '';
 const d = new Date(v);
 if (isNaN(d.getTime())) return String(v);
 const pad = n => String(n).padStart(2, '0');
 return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
   + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
 };
 const fdate = $('wc-flash-date'); if(fdate) fdate.value = _flashToDtLocal(s['Flash Date']);
 const ftitle = $('wc-flash-title'); if(ftitle) ftitle.value = s['Flash Title'] || '';

 // --- Hero Banners --- (delegated to renderBanners() so it runs even
 // before settings load, and can be re-triggered by the "Reload Banners" button)
 this.renderBanners();

 // --- Homepage Builder Sections ---
 const cats = [...new Set(state.data.inventory.map(p=>p.category).filter(Boolean))];
 let datalistHtml = `<datalist id="wc-cat-list">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`;
 
 let sectionsHtml = datalistHtml;
 let count = 0;
 for(let i=1; i<=50; i++){
 const secTitle = s[`Section ${i} Title`];
 const secCat = s[`Section ${i} Category`];
 const secImg = s[`Section ${i} Image`];
 const secLink = s[`Section ${i} Link`];
 if (!secTitle && !secCat && !secImg && !secLink && i > 1) continue; // Only render existing ones, but ensure at least 1 is shown
 
 count++;
 const secActive = s[`Section ${i} Active`] !== 'false';
 sectionsHtml += this._buildSectionHTML(secTitle||'', secCat||'', secActive, secImg||'', secLink||'');
 }
 if(count === 0) {
 count = 1;
 sectionsHtml += this._buildSectionHTML('', '', true, '', '');
 }
 this._secCount = count;
 
 const sContainer = $('wc-sections-container');
 if(sContainer) sContainer.innerHTML = sectionsHtml;
 // Initialize collapsible link-list UI (count badge + Show all/Collapse
 // button) for every rendered section.
 if(sContainer){
 sContainer.querySelectorAll('.wc-sec-links-container').forEach(c => this._updateLinksUI(c));
 }

 // --- Product Page ---
 const qv = $('wc-quick-view'); if(qv) qv.checked = parseBool(s['Quick View']);
 const sb = $('wc-stock-bar'); if(sb) sb.checked = parseBool(s['Stock Bar']);
 const rp = $('wc-related-prod'); if(rp) rp.checked = parseBool(s['Related Prod']);
 const ls = $('wc-live-search'); if(ls) ls.checked = parseBool(s['Live Search']);
 const he = $('wc-hover-effect'); if(he) he.value = s['Hover Effect'] || 'zoom';
 const ac = $('wc-add-cart-text'); if(ac) ac.value = s['Add Cart Text'] || '';
 const mq = $('wc-max-qty'); if(mq) mq.value = s['Max Qty'] || '';
 const ed = $('wc-exp-delivery'); if(ed) ed.value = s['Exp Delivery'] || '';

 // --- Cart & Checkout ---
 const cod = $('wc-enable-cod'); if(cod) cod.checked = (s['Enable COD'] == null || s['Enable COD'] === '') ? true : parseBool(s['Enable COD']); // Default true
 const fsa = $('wc-freeship-advance'); if(fsa) fsa.checked = (s['FreeShip Advance'] == null || s['FreeShip Advance'] === '') ? true : parseBool(s['FreeShip Advance']); // Default true (security ON)
 const cd = $('wc-cart-drawer'); if(cd) cd.checked = parseBool(s['Cart Drawer']);
 const on = $('wc-order-notes'); if(on) on.checked = parseBool(s['Order Notes']);
 const cm = $('wc-checkout-mode'); if(cm) cm.value = s['Checkout Mode'] || 'website';
 const cf = $('wc-custom-field'); if(cf) cf.value = s['Custom Field'] || '';
 const z1 = $('wc-zone-1-name'); if(z1) z1.value = s['Zone 1 Name'] || '';
 const z1c = $('wc-zone-1-charge'); if(z1c) z1c.value = s['Zone 1 Charge'] || '';
 const z2 = $('wc-zone-2-name'); if(z2) z2.value = s['Zone 2 Name'] || '';
 const z2c = $('wc-zone-2-charge'); if(z2c) z2c.value = s['Zone 2 Charge'] || '';
 const fs = $('wc-free-ship-amt'); if(fs) fs.value = s['Free Ship Amt'] || '';
 const mo = $('wc-min-order'); if(mo) mo.value = s['Min Order'] || '';
 this.renderDeliveryRows();

 // --- Marketing ---
 const ep = $('wc-exit-popup'); if(ep) ep.checked = parseBool(s['Exit Popup']);
 const ly = $('wc-loyalty'); if(ly) ly.checked = parseBool(s['Loyalty System']);
 const tb = $('wc-trust-badges'); if(tb) tb.checked = parseBool(s['Trust Badges']);
 const am = $('wc-abandon-msg'); if(am) am.value = s['Abandon Msg'] || '';

 // --- SEO Tracking Fields ---
 const mt = $('wc-meta-title'); if(mt) mt.value = s['Meta Title'] || '';
 const mde = $('wc-meta-desc'); if(mde) mde.value = s['Meta Desc'] || '';
 const fbpx = $('wc-fb-pixel'); if(fbpx) fbpx.value = s['FB Pixel'] || '';
 const fbcapi = $('wc-fb-capi-token'); if(fbcapi) fbcapi.value = s['FB CAPI Token'] || '';
 const ga4v = $('wc-ga4'); if(ga4v) ga4v.value = s['GA4'] || '';
 const igpx = $('wc-ig-pixel'); if(igpx) igpx.value = s['IG Pixel'] || '';
 const ttpx = $('wc-tt-pixel'); if(ttpx) ttpx.value = s['TT Pixel'] || '';
 const pinpx = $('wc-pin-pixel'); if(pinpx) pinpx.value = s['Pinterest Pixel'] || '';
 const snappx = $('wc-snap-pixel'); if(snappx) snappx.value = s['Snapchat Pixel'] || '';
 // ✅ v11.7: Server-side CAPI + Domain Verification fields
 const fbCapiTest = $('wc-fb-capi-test-code'); if(fbCapiTest) fbCapiTest.value = s['FB CAPI Test Code'] || '';
 // ✅ v15.44: Test Mode toggle wires to "FB CAPI Test Mode" SETTINGS key
 const fbCapiTestMode = $('wc-fb-capi-test-mode');
 if (fbCapiTestMode) {
 var _tmRaw = String(s['FB CAPI Test Mode'] || 'false').toLowerCase().trim();
 fbCapiTestMode.checked = (_tmRaw === 'true' || _tmRaw === '1' || _tmRaw === 'yes' || _tmRaw === 'on');
 }
 const fbDomVerify = $('wc-fb-domain-verify'); if(fbDomVerify) fbDomVerify.value = s['FB Domain Verify'] || '';
 const ttTok = $('wc-tt-token'); if(ttTok) ttTok.value = s['TT Access Token'] || '';
 const ttAdv = $('wc-tt-advertiser-id'); if(ttAdv) ttAdv.value = s['TT Advertiser ID'] || '';
 const aov = $('wc-avg-order-value'); if(aov) aov.value = s['Avg Order Value'] || '';
 const feedUrlDisp = $('fb-feed-url-display'); if(feedUrlDisp) feedUrlDisp.value = DEFAULT_APPS_URL + "?action=fb_feed&key=" + DEFAULT_API_KEY;
 const ogimg = $('wc-og-img'); if(ogimg) { ogimg.value = s['OG Image'] || ''; this._previewImg(ogimg, 'wc-og-preview'); }
 const gsct = $('wc-gsc-tag'); if(gsct) gsct.value = s['GSC Tag'] || '';
 const ccss = $('wc-custom-css'); if(ccss) ccss.value = s['Custom CSS'] || '';
 const tgt = $('wc-tg-token'); if(tgt) tgt.value = s['Telegram Bot Token'] || '';
 const tgc = $('wc-tg-chat'); if(tgc) tgc.value = s['Telegram Chat ID'] || '';

 // ✅ v14.0: Render Pixel Toggle states from saved settings
 try { if (YARZ.pixelToggles) YARZ.pixelToggles.render(); } catch(e) { console.warn('Pixel toggles render error', e); }

 // ✅ v11: Extras tab fields
 try { this._renderExtras(); } catch(e) { console.warn('Extras render error', e); }
 },

 // ✅ v3.7 FIX: Hero Slider Banners now have a dedicated render function so
 // they ALWAYS show 5 input rows — even if Apps Script settings haven't
 // loaded yet (which was the "blank banner section" bug). Called from:
 // 1. _renderControls() — populates with saved values when settings arrive
 // 2. init()    — runs immediately on page load (empty rows)
 // 3. "Reload Banners" btn — manual refresh
 renderBanners() {
 const bContainer = $('wc-banners-container');
 if(!bContainer) return;
 const s = (state && state.data && state.data.settings) ? state.data.settings : {};
 let bannersHtml = '';
 for(let i=1; i<=5; i++){
 const img = s[`Hero Banner ${i}`] || '';
 const link = s[`Banner Link ${i}`] || '';
 const title = s[`Banner Title ${i}`] || '';
 // ✅ v11 NEW: per-banner text color
 const textColor = s[`Banner Text Color ${i}`] || '#FFFFFF';
 const imgSrc = img ? (typeof getImgSrc === 'function' ? getImgSrc(img) : img) : '';
 bannersHtml += `
  <div style="display:flex;gap:16px;align-items:flex-start;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-1);margin-bottom:0">
  <div id="wc-bprev-${i}" style="width:160px;height:90px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center">
  ${imgSrc ? `<img src="${esc(imgSrc)}" alt="Banner ${i} preview" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.outerHTML='<div style=\\'opacity:0.3;color:var(--danger);font-size:11px;text-align:center;padding:4px\\'><i class=\\'ri-error-warning-line\\' style=\\'font-size:20px;display:block;margin-bottom:2px\\'></i>Invalid URL</div>'">` : `<div style="opacity:0.4;font-size:11px;text-align:center;color:var(--ink-3)"><i class="ri-image-add-line" style="font-size:24px;display:block;margin-bottom:4px"></i>Banner ${i}</div>`}
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:12px">
  <div style="display:flex;justify-content:space-between;align-items:center">
   <span style="font-size:11px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px">Banner Slot ${i}</span>
   ${img ? `<button type="button" onclick="(function(){const a=document.getElementById('wc-bimg-${i}');const b=document.getElementById('wc-btitle-${i}');const c=document.getElementById('wc-blink-${i}');const d=document.getElementById('wc-btxtcolor-${i}');if(a)a.value='';if(b)b.value='';if(c)c.value='';if(d)d.value='#FFFFFF';YARZ.webControl._previewImg('','wc-bprev-${i}');})()" style="font-size:10px;color:var(--danger);background:none;border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer"><i class="ri-delete-bin-line"></i> Clear</button>` : ''}
  </div>
  <div class="field" style="margin:0">
   <label style="font-size:12px">Banner Title (Premium Italic Serif Overlay — optional)</label>
   <input id="wc-btitle-${i}" class="input" style="padding:8px 12px" placeholder="e.g. New Summer Collection" value="${esc(title)}">
  </div>
  <div class="grid grid-2" style="gap:12px">
   <div class="field" style="margin:0">
   <label style="font-size:12px">Banner Image URL ${i} <span style="color:var(--danger)">*</span></label>
   <input id="wc-bimg-${i}" class="input" style="padding:8px 12px" placeholder="https://i.ibb.co/abc/banner.webp" value="${esc(img)}" oninput="YARZ.webControl._previewImg(this, 'wc-bprev-${i}')">
   </div>
   <div class="field" style="margin:0">
   <label style="font-size:12px">Banner Target Link (optional)</label>
   <input id="wc-blink-${i}" class="input" style="padding:8px 12px" placeholder="e.g. /category/shirts" value="${esc(link)}">
   </div>
  </div>
  <div class="field" style="margin:0">
   <label style="font-size:12px">Title Text Color (defaults to white)</label>
   <div style="display:flex;gap:10px;align-items:center">
   <input type="color" id="wc-btxtcolor-pick-${i}" value="${esc(textColor)}" style="width:40px;height:38px;border:none;border-radius:8px;cursor:pointer;background:none" oninput="document.getElementById('wc-btxtcolor-${i}').value=this.value">
   <input type="text" id="wc-btxtcolor-${i}" class="input" style="flex:1;padding:8px 12px" value="${esc(textColor)}" placeholder="#FFFFFF" oninput="document.getElementById('wc-btxtcolor-pick-${i}').value=this.value">
   </div>
  </div>
  </div>
  </div>
 `;
 }
 bContainer.innerHTML = bannersHtml;
 },

 _buildSectionHTML(title, category, isActive, imgUrl='', linkUrl='') {
 let links = [];
 try {
 links = JSON.parse(linkUrl);
 if(!Array.isArray(links)) links = linkUrl ? [linkUrl] : [];
 } catch(e) {
 links = linkUrl ? [linkUrl] : [];
 }
 if(links.length === 0) links.push('');

 const linksHtml = links.map(lnk => `
 <div class="wc-sec-link-row" style="display:flex;gap:8px;margin-bottom:8px">
  <input type="text" class="input wc-sec-link-input" placeholder="e.g. /product/shirt" value="${esc(lnk)}" style="flex:1">
  <button type="button" class="btn btn-ghost btn-sm" onclick="YARZ.webControl._removeLink(this)" style="color:var(--danger);padding:0 8px" title="Remove Link"><i class="ri-close-line"></i></button>
 </div>
 `).join('');

 return `
  <div class="wc-section-block" style="display:flex;align-items:flex-start;gap:16px;padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--surface-1);margin-bottom:12px;position:relative;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
  <button onclick="YARZ.ui.confirmDeleteSection(this.parentElement)" style="position:absolute;top:-8px;right:-8px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 4px rgba(0,0,0,0.2);z-index:2" title="Delete Section"><i class="ri-close-line"></i></button>
  
  <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0;margin-top:6px">
  <span style="font-size:10px;font-weight:700;color:var(--ink-3)">SHOW</span>
  <label class="ios-toggle">
   <input type="checkbox" class="wc-sec-active" ${isActive ? 'checked' : ''}>
   <span class="slider"></span>
  </label>
  </div>
  
  <div style="flex:1; display:flex; flex-direction:column; gap:12px">
  <div style="display:flex; gap:12px; flex-wrap:wrap">
   <div class="field" style="margin:0;flex:1;min-width:150px">
   <label style="font-size:11px">Section Title</label>
   <input type="text" class="input wc-sec-title" placeholder="e.g. Winter Collection" value="${esc(title)}">
   </div>
   <div class="field" style="margin:0;flex:1;min-width:150px">
   <label style="font-size:11px">Product Category / Tag</label>
   <input type="text" class="input wc-sec-cat" list="wc-cat-list" placeholder="Select category..." value="${esc(category)}">
   </div>
  </div>
  <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-start">
   <div class="field" style="margin:0;flex:1;min-width:150px">
   <label style="font-size:11px">Section Banner Image URL (Optional)</label>
   <div style="display:flex; gap:8px; align-items:center;">
   <div style="width:36px;height:36px;border-radius:6px;background:var(--surface-2);border:1px solid var(--line);flex-shrink:0;overflow:hidden">
     ${imgUrl ? `<img src="${esc(typeof getImgSrc === 'function' ? getImgSrc(imgUrl) : imgUrl)}" alt="Image preview" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0.3;font-size:16px"><i class="ri-image-line"></i></div>'}
   </div>
   <input type="text" class="input wc-sec-img" style="flex:1" placeholder="e.g. imgur.com/banner.jpg" value="${esc(imgUrl)}" oninput="YARZ.webControl._previewImg(this, this.previousElementSibling)">
   </div>
   </div>
   <div class="field wc-sec-links-container" style="margin:0;flex:1;min-width:150px">
   <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:6px">
   <label style="font-size:11px;margin:0">Target Links (Products) <span class="wc-sec-link-count" style="color:var(--ink-3);font-weight:600"></span></label>
   <div style="display:flex;gap:6px;align-items:center">
   <button type="button" class="btn btn-ghost btn-sm wc-sec-links-toggle" onclick="YARZ.webControl.toggleLinksList(this)" style="font-size:10px;padding:2px 6px;border:1px solid var(--line);color:var(--ink-2);border-radius:4px;display:none"><i class="ri-arrow-down-s-line"></i> Show all</button>
   <button type="button" class="btn btn-ghost btn-sm" onclick="YARZ.webControl.addLinkToSection(this)" style="font-size:10px;padding:2px 6px;border:1px solid var(--brand);color:var(--brand);border-radius:4px"><i class="ri-add-line"></i> Add Link</button>
   </div>
   </div>
   <div class="wc-sec-links-list wc-collapsed">
   ${linksHtml}
   </div>
   </div>
  </div>
  </div>
  </div>
 `;
 },

 addLinkToSection(btn) {
 const container = btn.closest('.wc-sec-links-container');
 const list = container ? container.querySelector('.wc-sec-links-list') : btn.parentElement.nextElementSibling;
 if(list.children.length >= 50) { toast('Maximum 50 links allowed','error'); return; }
 const div = document.createElement('div');
 div.className = 'wc-sec-link-row';
 div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
 div.innerHTML = `<input type="text" class="input wc-sec-link-input" placeholder="e.g. /product/shirt" style="flex:1">
    <button type="button" class="btn btn-ghost btn-sm" onclick="YARZ.webControl._removeLink(this)" style="color:var(--danger);padding:0 8px" title="Remove Link"><i class="ri-close-line"></i></button>`;
 list.appendChild(div);
 // Expand so the newly added link is visible, then refresh count/toggle UI
 if(container){
 list.classList.remove('wc-collapsed');
 const tgl = container.querySelector('.wc-sec-links-toggle');
 if(tgl) tgl.innerHTML = '<i class="ri-arrow-up-s-line"></i> Collapse';
 this._updateLinksUI(container);
 }
 list.lastElementChild.querySelector('input')?.focus();
 },

 // Remove a link row, then refresh the count + toggle visibility of its section.
 _removeLink(btn){
 const container = btn.closest('.wc-sec-links-container');
 btn.closest('.wc-sec-link-row')?.remove();
 if(container) this._updateLinksUI(container);
 },

 // Collapse/expand the long link list. Inputs stay in the DOM either way
 // (collapse only limits visible height), so saving always reads every link.
 toggleLinksList(btn){
 const container = btn.closest('.wc-sec-links-container');
 if(!container) return;
 const list = container.querySelector('.wc-sec-links-list');
 const collapsed = list.classList.toggle('wc-collapsed');
 btn.innerHTML = collapsed
  ? '<i class="ri-arrow-down-s-line"></i> Show all'
  : '<i class="ri-arrow-up-s-line"></i> Collapse';
 },

 // Keep the "N links" badge + the Show all/Collapse button in sync. The
 // toggle button only appears once there are enough links to overflow (>3).
 _updateLinksUI(container){
 if(!container) return;
 const list = container.querySelector('.wc-sec-links-list');
 const count = list ? list.querySelectorAll('.wc-sec-link-input').length : 0;
 const badge = container.querySelector('.wc-sec-link-count');
 if(badge) badge.textContent = count > 0 ? '(' + count + ')' : '';
 const tgl = container.querySelector('.wc-sec-links-toggle');
 if(tgl) tgl.style.display = count > 3 ? '' : 'none';
 },

 addSection() {
 this._secCount = (this._secCount || 0) + 1;
 if(this._secCount > 50) { toast('Maximum 50 sections allowed','error'); return; }
 const container = $('wc-sections-container');
 const div = document.createElement('div');
 div.innerHTML = this._buildSectionHTML('', '', true, '', '');
 container.appendChild(div.firstElementChild);
 const newContainer = container.lastElementChild.querySelector('.wc-sec-links-container');
 if(newContainer) this._updateLinksUI(newContainer);
 },

 _buildDeliveryRowHTML(loc = {}) {
 const id = esc(loc.id || ('zone_' + Date.now().toString(36)));
 return `
 <div class="wc-delivery-row" style="display:grid;grid-template-columns:1fr 1.4fr 110px 44px;gap:10px;align-items:end;padding:12px;border:1px solid var(--line);border-radius:12px;background:#fff;">
  <div class="field" style="margin:0"><label style="font-size:11px">Location ID</label><input class="input wc-delivery-id" value="${id}" placeholder="dhaka"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Location Name</label><input class="input wc-delivery-name" value="${esc(loc.name || '')}" placeholder="e.g. Sonargaon / Dhaka / Outside Dhaka"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Fee ()</label><input type="number" min="0" class="input wc-delivery-charge" value="${esc(loc.charge || 0)}" placeholder="60"></div>
  <button type="button" class="btn btn-ghost btn-sm" onclick="this.closest('.wc-delivery-row').remove()" title="Remove" style="height:38px;color:var(--danger);"><i class="ri-delete-bin-line"></i></button>
 </div>`;
 },

 renderDeliveryRows() {
 const container = $('wc-delivery-locations');
 if(!container) return;
 let rows = Array.isArray(state.data.deliveryCharges) && state.data.deliveryCharges.length ? state.data.deliveryCharges : [];
 if(!rows.length) {
 const s = state.data.settings || {};
 // ✅ v3.6: Narayanganj defaults (rename from UI anytime — saves to DELIVERY_CHARGES tab)
 rows = [
  { id:'inside_narayanganj', name:s['Zone 1 Name'] || 'Inside Narayanganj', charge:num(s['Zone 1 Charge'] || 70), active:true },
  { id:'outside_narayanganj', name:s['Zone 2 Name'] || 'Outside Narayanganj', charge:num(s['Zone 2 Charge'] || 140), active:true }
 ];
 }
 container.innerHTML = rows.filter(r=>r.active !== false).map(r=>this._buildDeliveryRowHTML(r)).join('');
 },

 addDeliveryRow() {
 const container = $('wc-delivery-locations');
 if(!container) return;
 const div = document.createElement('div');
 div.innerHTML = this._buildDeliveryRowHTML({ id:'area_' + (container.children.length + 1), name:'', charge:0, active:true });
 container.appendChild(div.firstElementChild);
 },

 _collectDeliveryLocations() {
 return qsa('.wc-delivery-row').map((row, idx)=>({
 id: (row.querySelector('.wc-delivery-id')?.value || ('zone_' + (idx + 1))).trim().replace(/\s+/g, '_'),
 name: (row.querySelector('.wc-delivery-name')?.value || '').trim(),
 charge: num(row.querySelector('.wc-delivery-charge')?.value || 0),
 active: true
 })).filter(loc=>loc.name);
 },

 _previewImg(inputEl, previewId) {
 // ✅ v3.7: Preview uses object-fit:contain so admin can see the FULL
 // uploaded image (no crop), exactly the way customers will see it on
 // the live site. High-quality rendering hint added too.
 const val = (typeof inputEl === 'string' ? inputEl : inputEl.value).trim();
 const container = typeof previewId === 'string' ? $(previewId) : previewId;
 if(!container) return;
 if(val) {
 const src = (typeof getImgSrc === 'function') ? getImgSrc(val) : val;
 container.innerHTML = `<img src="${esc(src)}" alt="Image preview" loading="lazy" style="width:100%;height:100%;object-fit:cover;" onerror="this.outerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0.3;color:var(--danger)\\'><i class=\\'ri-error-warning-line\\' style=\\'font-size:24px\\'></i></div>'">`;
 } else {
 container.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0.3"><i class="ri-image-line" style="font-size:24px"></i></div>';
 }
 },

 /* ============================================================
  ✅ v11 EXTRAS TAB (PREMIUM) — render + save helpers
  ============================================================ */

 // ✅ v15.85: 10 Premium Royal Theme Presets — every combo hand-tuned for
 // • Modern aesthetic appeal (no clashing tones)
 // • Mobile/desktop parity (theme is purely CSS-variable driven now)
 // • Auto-contrast footer (app.js derives heading/link/text from footer-bg
 //  luminance, so admins never get invisible-text footers again)
 // • Logo lock — disc/holes are fixed in CSS, only the wordmark color
 //  follows the theme, so the YARZ mark stays burgundy across all presets
 applyThemePreset(name){
 const presets = {
 // 🌙 1. CREAM + DARK RED — DEFAULT (the user's requested combination)
 // Cream bg + black body text + dark-red accents + dark-red footer
 // with cream wordmark. Mature, masculine, premium-fashion feel.
 cream_burgundy: {
  primary: '#ff004c', accent: '#8B2635', bg: '#FBF5E8', card: '#FFFFFF',
  text: '#1A1411', border: '#E8DECB', link: '#ff004c',
  sale: '#ff004c', footer: '#3A0F15'
 },
 // ⚫ 2. CLASSIC LUXE — black-tie, gold-accented, magazine-grade
 luxe: {
  primary: '#1A1A1A', accent: '#C9A23F', bg: '#FBF8F1', card: '#FFFFFF',
  text: '#1A1A1A', border: '#E8E4DC', link: '#1A1A1A',
  sale: '#C0392B', footer: '#0A0A0A'
 },
 // 📰 3. MODERN EDITORIAL — Vogue-cover deep-ink + tobacco accent
 editorial: {
  primary: '#0F172A', accent: '#94633A', bg: '#FFFFFF', card: '#FAFAFA',
  text: '#0F172A', border: '#E5E7EB', link: '#0F172A',
  sale: '#DC2626', footer: '#0F172A'
 },
 // 🏛 4. ROYAL MIDNIGHT — navy + champagne, formal-wear feel
 royal_midnight: {
  primary: '#1B2A4E', accent: '#D4AF7A', bg: '#FBF8F1', card: '#FFFFFF',
  text: '#0F1A33', border: '#E2DECD', link: '#1B2A4E',
  sale: '#8B2635', footer: '#0E1A30'
 },
 // 🌲 5. EMERALD ATELIER — deep forest green + ivory + brass
 emerald_atelier: {
  primary: '#1F4D3B', accent: '#B8915A', bg: '#F7F4EC', card: '#FFFFFF',
  text: '#152C24', border: '#E0DAC8', link: '#1F4D3B',
  sale: '#9A2A2A', footer: '#0F2D24'
 },
 // 🍷 6. WINE & PORCELAIN — bordeaux + warm white, sommelier vibes
 wine_porcelain: {
  primary: '#5B1A2C', accent: '#A87B4E', bg: '#FAF5EF', card: '#FFFFFF',
  text: '#2A1218', border: '#E5DBCC', link: '#5B1A2C',
  sale: '#5B1A2C', footer: '#3A1019'
 },
 // 🌑 7. NOIR ROSE — charcoal + dusty rose, contemporary streetwear-luxe
 noir_rose: {
  primary: '#1F1B1A', accent: '#B8736C', bg: '#F5F1ED', card: '#FFFFFF',
  text: '#1F1B1A', border: '#E4DDD5', link: '#1F1B1A',
  sale: '#B8736C', footer: '#14110F'
 },
 // 🟫 8. SAHARA — terracotta + sand + ink, warm Mediterranean
 sahara: {
  primary: '#A6502E', accent: '#D9A574', bg: '#F8EFE0', card: '#FFFFFF',
  text: '#3A1F12', border: '#E8DAC1', link: '#A6502E',
  sale: '#A6502E', footer: '#5C2614'
 },
 // ❄ 9. ICE EDITORIAL — pure white + glacier blue + jet, minimalist
 ice_editorial: {
  primary: '#0F172A', accent: '#5B7EA8', bg: '#FFFFFF', card: '#F8FAFC',
  text: '#0F172A', border: '#E2E8F0', link: '#0F172A',
  sale: '#0F172A', footer: '#0B1220'
 },
 // 🌿 10. SAGE BOTANICAL — soft sage + cream + olive, calm & organic
 sage_botanical: {
  primary: '#4A6B4F', accent: '#8B9A6B', bg: '#F5F1E8', card: '#FFFFFF',
  text: '#1F2D22', border: '#DCD6C5', link: '#4A6B4F',
  sale: '#7A2E2E', footer: '#2A3F2D'
 },
 // 🫒 11. OLIVE IMPERIAL — deep imperial olive + warm cream + 24K gold trim.
 // Hermès "Bois d'Olivier" feel — military-luxe, masculine, royal.
 // The olive depth + gold accent is the most aristocratic combo
 // in this set; pairs perfectly with Cormorant Garamond serif.
 olive_imperial: {
  primary: '#4D5D2D', accent: '#C9A23F', bg: '#F8F4E8', card: '#FFFFFF',
  text: '#2A3215', border: '#DCD2B8', link: '#4D5D2D',
  sale: '#8B2635', footer: '#2A3215'
 },
 // 👑 12. AURUM ONYX — pure obsidian black + 24K gold leaf + warm ivory.
 // The most "Hermès / Cartier window-display" theme. Reserved for
 // the brand's most premium-positioning moments.
 aurum_onyx: {
  primary: '#0A0A0A', accent: '#D4AF37', bg: '#FAF8F2', card: '#FFFFFF',
  text: '#0A0A0A', border: '#EFE9D9', link: '#0A0A0A',
  sale: '#A8862C', footer: '#0A0A0A'
 },
 // 🍷 13. VELVET BORDEAUX — plush deep wine + champagne pink + rosé cream.
 // Old-money, opulent, evening-wear feel. Excellent for women's
 // capsule lines or limited-edition luxury drops.
 velvet_bordeaux: {
  primary: '#4A0E1F', accent: '#E8C9A6', bg: '#FAF1ED', card: '#FFFFFF',
  text: '#2A0810', border: '#ECD8CD', link: '#4A0E1F',
  sale: '#4A0E1F', footer: '#2A0810'
 },
 // 🛡 14. COBALT HERITAGE — British royal cobalt + heraldic brass + parchment.
 // "Crest & coat-of-arms" energy. Tailored menswear / heritage label
 // positioning; heritage British flagship store vibe.
 cobalt_heritage: {
  primary: '#1B3A6B', accent: '#C8A04C', bg: '#F6F1E2', card: '#FFFFFF',
  text: '#0E1F3D', border: '#E0D8BB', link: '#1B3A6B',
  sale: '#8B2635', footer: '#0E1F3D'
 },
 // ☕ 15. PEARL MOCHA — soft pearl blush + cocoa + warm mocha.
 // Modern minimalist feminine-luxe. Atelier-cafe aesthetic.
 // The warmest theme in the set — feels like a Parisian boutique.
 pearl_mocha: {
  primary: '#4A2C2A', accent: '#B8896B', bg: '#F8EFE7', card: '#FFFFFF',
  text: '#2A1818', border: '#E8D8CB', link: '#4A2C2A',
  sale: '#4A2C2A', footer: '#2A1818'
 },
 // ─────────────────────────────────────────────────────────────
 // ✅ v15.90: +10 NEW PREMIUM PRESETS (total now 25) — sourced from
 // owner-supplied color-combination references. Each follows the same
 // 9-field contract; none touch the locked logo vars (disc/ring/holes
 // stay #ff004c/#cc003d — only the wordmark color follows `text`).
 // ─────────────────────────────────────────────────────────────
 // 🔮 16. VIOLET IMPERIAL — deep royal violet + imperial coral red.
 // Bold, modern, runway-editorial. The most unexpected combo in the set.
 violet_imperial: {
  primary: '#321847', accent: '#F15153', bg: '#FBF6F2', card: '#FFFFFF',
  text: '#1F0E2E', border: '#E6D9E8', link: '#321847',
  sale: '#F15153', footer: '#25113A'
 },
 // 🍇 17. CAMELOT SWIRL — raspberry-wine + warm stone grey.
 // Soft romantic-luxe; pairs a rich berry with a calm neutral.
 camelot_swirl: {
  primary: '#8D2F47', accent: '#B5708A', bg: '#F6F3EE', card: '#FFFFFF',
  text: '#2E1019', border: '#E2DCD0', link: '#8D2F47',
  sale: '#8D2F47', footer: '#5E1F30'
 },
 // 💖 18. MAGENTA PLUM — electric magenta + deep plum + blush.
 // High-energy feminine pop. Great for capsule / limited drops.
 magenta_plum: {
  primary: '#6A1B4D', accent: '#FF007A', bg: '#FFF6FA', card: '#FFFFFF',
  text: '#2A0A1E', border: '#F0D9E5', link: '#6A1B4D',
  sale: '#FF007A', footer: '#3D0F2C'
 },
 // 🌊 19. MOONSTONE VANILLA — teal-blue moonstone + soft vanilla.
 // Fresh, airy, coastal-luxe. Calming and very readable.
 moonstone_vanilla: {
  primary: '#2E6E80', accent: '#4C9DB0', bg: '#FFF9EC', card: '#FFFFFF',
  text: '#14333B', border: '#EDE2C6', link: '#2E6E80',
  sale: '#C0392B', footer: '#1C4651'
 },
 // 🪖 20. FELDGRAU WHEAT — slate field-green + wheat gold.
 // Quiet military-luxe; understated, masculine, heritage feel.
 feldgrau_wheat: {
  primary: '#3A4B41', accent: '#B08C52', bg: '#F5EFE2', card: '#FFFFFF',
  text: '#1F2A23', border: '#E2D9C5', link: '#3A4B41',
  sale: '#8B2635', footer: '#283530'
 },
 // 🌲 21. PINE BEIGE — very deep pine green + warm beige.
 // Crisp, evergreen, botanical-premium. Strong contrast, elegant.
 pine_beige: {
  primary: '#00311E', accent: '#4D694E', bg: '#FBF6E9', card: '#FFFFFF',
  text: '#06241A', border: '#E6DEC9', link: '#00311E',
  sale: '#7A2E2E', footer: '#00311E'
 },
 // 🏝 22. CYPRUS LAGOON — deep cyprus teal + tropical teal accent.
 // Clean spa / atelier feel on a near-white canvas.
 cyprus_lagoon: {
  primary: '#004643', accent: '#0F9E99', bg: '#F7FAF9', card: '#FFFFFF',
  text: '#00302E', border: '#DCE8E6', link: '#004643',
  sale: '#C0392B', footer: '#002E2C'
 },
 // 👖 23. DENIM GIVRY — royal denim blue + warm givry cream + brass.
 // Confident, modern-classic; bright but grounded.
 denim_givry: {
  primary: '#275CCC', accent: '#C0894C', bg: '#FBF3E8', card: '#FFFFFF',
  text: '#14254F', border: '#EADFCC', link: '#275CCC',
  sale: '#C0392B', footer: '#19306E'
 },
 // 🪵 24. MAHOGANY ASH — deep mahogany brown + soft ash grey.
 // Warm, woody, gallery-refined. Rich without being heavy.
 mahogany_ash: {
  primary: '#582B23', accent: '#9C8478', bg: '#EFEBE3', card: '#FFFFFF',
  text: '#2E140F', border: '#DED7CB', link: '#582B23',
  sale: '#8B2635', footer: '#3A1C17'
 },
 // 🍷 25. WINE SAND — deep wine red + light sand + gold.
 // Opulent, festive, evening-wear luxe on a soft sand backdrop.
 wine_sand: {
  primary: '#7F011F', accent: '#C2A14E', bg: '#FBF4E4', card: '#FFFFFF',
  text: '#2E0610', border: '#ECDFC4', link: '#7F011F',
  sale: '#7F011F', footer: '#50010F'
 },
 // 🔄 RESET — clears all overrides; storefront falls back to CSS defaults
 reset: {
  primary: '', accent: '', bg: '', card: '',
  text: '', border: '', link: '',
  sale: '', footer: ''
 }
 };
 const labels = {
 cream_burgundy: 'Cream + Brand Red (Default)',
 luxe: 'Classic Luxe',
 editorial: 'Modern Editorial',
 royal_midnight: 'Royal Midnight',
 emerald_atelier: 'Emerald Atelier',
 wine_porcelain: 'Wine & Porcelain',
 noir_rose: 'Noir Rose',
 sahara: 'Sahara',
 ice_editorial: 'Ice Editorial',
 sage_botanical: 'Sage Botanical',
 olive_imperial: 'Olive Imperial',
 aurum_onyx: 'Aurum Onyx',
 velvet_bordeaux: 'Velvet Bordeaux',
 cobalt_heritage: 'Cobalt Heritage',
 pearl_mocha: 'Pearl Mocha',
 violet_imperial: 'Violet Imperial',
 camelot_swirl: 'Camelot Swirl',
 magenta_plum: 'Magenta Plum',
 moonstone_vanilla: 'Moonstone Vanilla',
 feldgrau_wheat: 'Feldgrau Wheat',
 pine_beige: 'Pine Beige',
 cyprus_lagoon: 'Cyprus Lagoon',
 denim_givry: 'Denim Givry',
 mahogany_ash: 'Mahogany Ash',
 wine_sand: 'Wine Sand',
 reset: 'Default (Reset)'
 };
 const p = presets[name];
 if(!p){ toast('Preset Not found','error'); return; }
 const setPair = (txtId, pickId, val) => {
 const t = $(txtId), pk = $(pickId);
 if(t) t.value = val; if(pk && val) pk.value = val;
 };
 setPair('wc-theme-primary', 'wc-theme-primary-pick', p.primary);
 setPair('wc-theme-accent', 'wc-theme-accent-pick', p.accent);
 setPair('wc-theme-bg', 'wc-theme-bg-pick', p.bg);
 setPair('wc-theme-card', 'wc-theme-card-pick', p.card);
 setPair('wc-theme-text', 'wc-theme-text-pick', p.text);
 setPair('wc-theme-border', 'wc-theme-border-pick', p.border);
 setPair('wc-theme-link', 'wc-theme-link-pick', p.link);
 setPair('wc-theme-sale', 'wc-theme-sale-pick', p.sale);
 setPair('wc-theme-footer', 'wc-theme-footer-pick', p.footer);
 toast(`${labels[name] || name} Preset loaded — click Save All Changes।`, 'success');
 },

 // FAQ rows
 _buildFaqRowHTML(idx, q, a){
 return `
 <div class="wc-faq-row" data-idx="${idx}" style="padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-1);position:relative">
  <button type="button" onclick="this.closest('.wc-faq-row').remove()" style="position:absolute;top:6px;right:6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px" title="Remove"><i class="ri-close-line"></i></button>
  <div class="field" style="margin:0 0 8px 0"><label style="font-size:11px">Question</label><input type="text" class="input wc-faq-q" value="${esc(q||'')}" placeholder="e.g. What is your return policy?"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Answer</label><textarea class="input wc-faq-a" rows="2" placeholder="Short, customer-friendly answer">${esc(a||'')}</textarea></div>
 </div>`;
 },
 renderFaqs(){
 const list = $('wc-faq-list'); if(!list) return;
 const s = state.data.settings || {};
 let html = '';
 for(let i=1;i<=10;i++){
 const q = s[`FAQ Q${i}`] || '';
 const a = s[`FAQ A${i}`] || '';
 if(q || a) html += this._buildFaqRowHTML(i, q, a);
 }
 if(!html) html = this._buildFaqRowHTML(1, '', '');
 list.innerHTML = html;
 },
 addFaq(){
 const list = $('wc-faq-list'); if(!list) return;
 if(list.children.length >= 10){ toast('Maximum 10 FAQ items','error'); return; }
 const div = document.createElement('div');
 div.innerHTML = this._buildFaqRowHTML(list.children.length + 1, '', '');
 list.appendChild(div.firstElementChild);
 },

 // Testimonial rows
 _buildReviewRowHTML(idx, name, photo, stars, text){
 return `
 <div class="wc-rev-row" data-idx="${idx}" style="padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--surface-1);position:relative">
  <button type="button" onclick="this.closest('.wc-rev-row').remove()" style="position:absolute;top:6px;right:6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px" title="Remove"><i class="ri-close-line"></i></button>
  <div class="grid grid-3" style="gap:10px;margin-bottom:8px">
  <div class="field" style="margin:0"><label style="font-size:11px">Customer Name</label><input type="text" class="input wc-rev-name" value="${esc(name||'')}" placeholder="e.g. Tahmid Hasan"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Photo URL (optional)</label><input type="text" class="input wc-rev-photo" value="${esc(photo||'')}" placeholder="i.ibb.co/abc/face.jpg"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Stars (1-5)</label><input type="number" min="1" max="5" class="input wc-rev-stars" value="${esc(stars||'5')}"></div>
  </div>
  <div class="field" style="margin:0"><label style="font-size:11px">Review Text</label><textarea class="input wc-rev-text" rows="2" placeholder="Great quality, very fast delivery!">${esc(text||'')}</textarea></div>
 </div>`;
 },
 renderReviews(){
 const list = $('wc-reviews-list'); if(!list) return;
 const s = state.data.settings || {};
 let html = '';
 for(let i=1;i<=10;i++){
 const n = s[`Review ${i} Name`] || '';
 const p = s[`Review ${i} Photo`] || '';
 const st = s[`Review ${i} Stars`] || '';
 const t = s[`Review ${i} Text`] || '';
 if(n || t) html += this._buildReviewRowHTML(i, n, p, st, t);
 }
 if(!html) html = this._buildReviewRowHTML(1, '', '', '5', '');
 list.innerHTML = html;
 },
 addReview(){
 const list = $('wc-reviews-list'); if(!list) return;
 if(list.children.length >= 10){ toast('Maximum 10 testimonials','error'); return; }
 const div = document.createElement('div');
 div.innerHTML = this._buildReviewRowHTML(list.children.length + 1, '', '', '5', '');
 list.appendChild(div.firstElementChild);
 },

 // Promo Popup Slots (3)
 _buildPopupSlotHTML(idx, active, img, link, start, end, trigger){
 return `
 <div class="wc-popup-slot" data-idx="${idx}" style="padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-1)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
  <div style="font-weight:700;color:var(--ink-2)">Popup Slot ${idx}</div>
  <label class="ios-toggle"><input type="checkbox" class="wc-popup-active" ${active?'checked':''}><span class="slider"></span></label>
  </div>
  <div class="grid grid-2" style="gap:10px;margin-bottom:8px">
  <div class="field" style="margin:0"><label style="font-size:11px">Popup Image URL</label><input type="text" class="input wc-popup-img" value="${esc(img||'')}" placeholder="https://i.ibb.co/abc/eid-popup.jpg"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Click Target Link (optional)</label><input type="text" class="input wc-popup-link" value="${esc(link||'')}" placeholder="/category/eid-special"></div>
  </div>
  <div class="grid grid-3" style="gap:10px">
  <div class="field" style="margin:0"><label style="font-size:11px">Start Date</label><input type="date" class="input wc-popup-start" value="${esc(start||'')}"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">End Date</label><input type="date" class="input wc-popup-end" value="${esc(end||'')}"></div>
  <div class="field" style="margin:0"><label style="font-size:11px">Trigger</label>
  <select class="input wc-popup-trigger">
   <option value="3" ${trigger==='3'?'selected':''}>After 3s</option>
   <option value="10" ${trigger==='10'?'selected':''}>After 10s</option>
   <option value="30" ${trigger==='30'?'selected':''}>After 30s</option>
   <option value="exit" ${trigger==='exit'?'selected':''}>On exit intent</option>
   <option value="scroll" ${trigger==='scroll'?'selected':''}>After 50% scroll</option>
  </select>
  </div>
  </div>
 </div>`;
 },
 renderPopupSlots(){
 const list = $('wc-popup-slots'); if(!list) return;
 const s = state.data.settings || {};
 // ✅ v11.3: Robust parseBool
 const parseBool = (val) => {
 if (val === true || val === 1) return true;
 if (val === false || val === 0 || val == null || val === '') return false;
 const str = String(val).toLowerCase().trim();
 return ['true','yes','1','on','enabled','enable','chalu','Active'].includes(str);
 };
 // ✅ v15.6: Format date strings/Date objects for <input type="date"> (YYYY-MM-DD)
 const _toDateOnly = (v) => {
 if (v == null || v === '') return '';
 const d = new Date(v);
 if (isNaN(d.getTime())) return String(v).slice(0, 10);
 const pad = n => String(n).padStart(2, '0');
 return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
 };
 let html = '';
 for(let i=1;i<=3;i++){
 const a = parseBool(s[`Popup ${i} Active`]);
 const img = s[`Popup ${i} Image`] || '';
 const link = s[`Popup ${i} Link`] || '';
 const st = _toDateOnly(s[`Popup ${i} Start`]);
 const en = _toDateOnly(s[`Popup ${i} End`]);
 const tr = s[`Popup ${i} Trigger`] || '10';
 html += this._buildPopupSlotHTML(i, a, img, link, st, en, tr);
 }
 list.innerHTML = html;
 },

 // Render all extras fields from settings
 _renderExtras(){
 const s = state.data.settings || {};
 // ✅ v11.3: Robust parseBool — handles "TRUE", true, "true", "yes", 1, etc.
 const parseBool = (val) => {
 if (val === true || val === 1) return true;
 if (val === false || val === 0 || val == null || val === '') return false;
 const str = String(val).toLowerCase().trim();
 return ['true','yes','1','on','enabled','enable','chalu','Active'].includes(str);
 };
 const setVal = (id, v, fb='') => { const el = $(id); if(el) el.value = v != null && v !== '' ? v : fb; };
 const setChk = (id, v) => { const el = $(id); if(el) el.checked = parseBool(v); };
 const setPair = (txtId, pickId, v, fb) => { const t=$(txtId), p=$(pickId); if(t) t.value = v||fb||''; if(p) p.value = v||fb||'#000000'; };

 // ✅ v15.6: Convert any datetime value (ISO string, Date object, or already
 // formatted YYYY-MM-DDTHH:MM) to the format that <input type="datetime-local">
 // expects. Without this, dates from Google Sheets come back as Date objects /
 // ISO strings which the input silently rejects, making the field appear empty.
 const _toDtLocal = (v) => {
 if (v == null || v === '') return '';
 const d = new Date(v);
 if (isNaN(d.getTime())) {
  // Already a string but not a date → return as-is
  return String(v);
 }
 const pad = n => String(n).padStart(2, '0');
 return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate())
   + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
 };
 // Date-only variant for <input type="date">
 const _toDateOnly = (v) => {
 const s = _toDtLocal(v);
 return s ? s.slice(0, 10) : '';
 };
 const setDt = (id, v) => { const el = $(id); if(el) el.value = _toDtLocal(v); };
 const setDate = (id, v) => { const el = $(id); if(el) el.value = _toDateOnly(v); };

 // 1. Theme Palette
 setPair('wc-theme-primary', 'wc-theme-primary-pick', s['Theme Primary'], '#634A8E');
 setPair('wc-theme-accent', 'wc-theme-accent-pick', s['Theme Accent'], '#D4910A');
 setPair('wc-theme-bg', 'wc-theme-bg-pick', s['Theme BG'], '#FBF8F1');
 setPair('wc-theme-card', 'wc-theme-card-pick', s['Theme Card BG'], '#FFFFFF');
 setPair('wc-theme-text', 'wc-theme-text-pick', s['Theme Text'], '#FFFDF8');
 setPair('wc-theme-border', 'wc-theme-border-pick', s['Theme Border'], '#E8E4DC');
 setPair('wc-theme-link', 'wc-theme-link-pick', s['Theme Link'], '#634A8E');
 setPair('wc-theme-sale', 'wc-theme-sale-pick', s['Theme Sale Price'], '#1A1A1A');
 setPair('wc-theme-footer', 'wc-theme-footer-pick', s['Theme Footer BG'], '#FFFDF8');
 // 2. Typography
 setVal('wc-heading-font', s['Heading Font']);
 setVal('wc-body-font', s['Body Font']);
 setVal('wc-bn-font', s['Bengali Font']);
 // 3. Card Style
 setVal('wc-card-style', s['Card Style'] || 'rounded');
 setVal('wc-card-hover', s['Card Hover'] || 'zoom');
 // 4. Countdown
 setChk('wc-countdown-active', s['Countdown Active']);
 setDt('wc-countdown-end',  s['Countdown End']);
 setVal('wc-countdown-title', s['Countdown Title']);
 setVal('wc-countdown-style', s['Countdown Style'] || 'red');
 setVal('wc-countdown-bg',  s['Countdown BG']);
 setVal('wc-countdown-text', s['Countdown Text']);
 // Sync color picker values too
 try {
 var cdBg = (s['Countdown BG'] || '').toString().trim();
 var cdTx = (s['Countdown Text'] || '').toString().trim();
 if (/^#[0-9a-f]{3,8}$/i.test(cdBg)) { var p1 = $('wc-countdown-bg-pick'); if (p1) p1.value = cdBg; }
 if (/^#[0-9a-f]{3,8}$/i.test(cdTx)) { var p2 = $('wc-countdown-text-pick'); if (p2) p2.value = cdTx; }
 } catch(e) {}
 // 5. Free Shipping
 setChk('wc-freeship-active', s['Free Ship Bar Active']);
 setVal('wc-freeship-text', s['Free Ship Bar Text'] || '🚚 Free shipping on orders over {amount}');
 setVal('wc-freeship-bg',  s['Free Ship Bar BG']);
 setVal('wc-freeship-text-color', s['Free Ship Bar Text Color']);
 setVal('wc-freeship-thickness', s['Free Ship Bar Thickness'] || 'slim');
 try {
 var fsBg = (s['Free Ship Bar BG'] || '').toString().trim();
 var fsTx = (s['Free Ship Bar Text Color'] || '').toString().trim();
 if (/^#[0-9a-f]{3,8}$/i.test(fsBg)) { var f1 = $('wc-freeship-bg-pick'); if (f1) f1.value = fsBg; }
 if (/^#[0-9a-f]{3,8}$/i.test(fsTx)) { var f2 = $('wc-freeship-text-color-pick'); if (f2) f2.value = fsTx; }
 } catch(e) {}
 // 6. Best Sellers / New Arrivals / Recently Viewed / Wishlist
 setChk('wc-bestseller-active', s['Best Sellers Active']);
 setVal('wc-bestseller-title', s['Best Sellers Title'] || '🔥 Best Sellers');
 setVal('wc-bestseller-count', s['Best Sellers Count'] || 8);
 setChk('wc-newarrival-active', s['New Arrival Active']);
 setVal('wc-newarrival-days', s['New Arrival Days'] || 7);
 setChk('wc-recently-viewed', s['Recently Viewed']);
 setChk('wc-wishlist-active', s['Wishlist Active']);
 // 7. Product Page Premium
 setChk('wc-sticky-buy',  s['Sticky ATC Mobile']);
 setChk('wc-video-autoplay',  s['Video Autoplay']);
 setChk('wc-oos-hide',   s['OOS Hide']);
 setChk('wc-quick-view-active', s['Quick View Active']);
 // 7B. Size Visibility Control — defaults: all sizes ON, OOS-size mode OFF (=show strikethrough)
 // Helper: setChk with explicit default when sheet value is empty/missing
 const setChkDef = (id, v, def) => {
 const el = $(id); if(!el) return;
 if (v == null || v === '') el.checked = !!def;
 else el.checked = parseBool(v);
 };
 setChkDef('wc-size-oos-hide', s['Size OOS Hide'], false);
 setChkDef('wc-size-shirt-S', s['Size Shirt S'], true);
 setChkDef('wc-size-shirt-M', s['Size Shirt M'], true);
 setChkDef('wc-size-shirt-L', s['Size Shirt L'], true);
 setChkDef('wc-size-shirt-XL', s['Size Shirt XL'], true);
 setChkDef('wc-size-shirt-XXL', s['Size Shirt XXL'], true);
 setChkDef('wc-size-shirt-3XL', s['Size Shirt 3XL'], true);
 setChkDef('wc-size-pant-28', s['Size Pant 28'], true);
 setChkDef('wc-size-pant-30', s['Size Pant 30'], true);
 setChkDef('wc-size-pant-32', s['Size Pant 32'], true);
 setChkDef('wc-size-pant-34', s['Size Pant 34'], true);
 setChkDef('wc-size-pant-36', s['Size Pant 36'], true);
 setChkDef('wc-size-pant-38', s['Size Pant 38'], true);
 // 8. Newsletter
 setChk('wc-newsletter-active', s['Newsletter Active']);
 setVal('wc-newsletter-title', s['Newsletter Title'] || 'Get 10% off your first order!');
 setVal('wc-newsletter-code', s['Newsletter Code'] || '');
 setVal('wc-newsletter-trigger',s['Newsletter Trigger'] || '15');
 // 9. Store Hours
 setChk('wc-hours-active', s['Store Hours Active']);
 setVal('wc-hours-open', s['Store Hours Open']);
 setVal('wc-hours-close', s['Store Hours Close']);
 setVal('wc-hours-msg', s['Store Hours Msg']);
 // 10. FAQ
 setChk('wc-faq-active', s['FAQ Active']);
 this.renderFaqs();
 // 11. Reviews
 setChk('wc-reviews-active', s['Reviews Active']);
 this.renderReviews();
 // 12. Float Chat
 setVal('wc-float-pos', s['Float Chat Position'] || 'bottom-right');
 setVal('wc-float-offset', s['Float Chat Offset'] || 20);
 // 13. Popup Slots
 this.renderPopupSlots();

 // ✅ v11.8: Advanced (Royal) tab fields
 // A1. Marquee
 setChk('wc-marquee-active', s['Marquee Active']);
 setVal('wc-marquee-text', s['Marquee Text'] || '');
 setVal('wc-marquee-bg',  s['Marquee BG'] || '');
 setVal('wc-marquee-text-color', s['Marquee Text Color'] || '');
 setVal('wc-marquee-speed', s['Marquee Speed'] || 'slow');
 try {
 var mqBg = (s['Marquee BG'] || '').toString().trim();
 var mqTx = (s['Marquee Text Color'] || '').toString().trim();
 if (/^#[0-9a-f]{3,8}$/i.test(mqBg)) { var mp1 = $('wc-marquee-bg-pick'); if(mp1) mp1.value = mqBg; }
 if (/^#[0-9a-f]{3,8}$/i.test(mqTx)) { var mp2 = $('wc-marquee-text-color-pick'); if(mp2) mp2.value = mqTx; }
 } catch(e) {}
 // A2. Trust strip
 setChk('wc-trust-strip-active', s['Trust Strip Active']);
 for (var ti = 1; ti <= 4; ti++) {
 setVal('wc-trust-' + ti + '-icon', s['Trust ' + ti + ' Icon'] || '');
 setVal('wc-trust-' + ti + '-label', s['Trust ' + ti + ' Label'] || '');
 }
 // A3. Royal frame
 setChk('wc-royal-frame-active', s['Royal Frame Active']);
 setVal('wc-royal-accent',  s['Royal Accent'] || '');
 setVal('wc-royal-frame-style', s['Royal Frame Style'] || 'corners');
 try {
 var raAcc = (s['Royal Accent'] || '').toString().trim();
 if (/^#[0-9a-f]{3,8}$/i.test(raAcc)) { var rp = $('wc-royal-accent-pick'); if(rp) rp.value = raAcc; }
 } catch(e) {}
 // A4. Editorial story
 setChk('wc-editorial-active', s['Editorial Active']);
 setVal('wc-editorial-img', s['Editorial Image'] || '');
 setVal('wc-editorial-title', s['Editorial Title'] || '');
 setVal('wc-editorial-body', s['Editorial Body'] || '');
 setVal('wc-editorial-cta', s['Editorial CTA'] || '');
 setVal('wc-editorial-link', s['Editorial Link'] || '');
 try {
 var edImg = (s['Editorial Image'] || '').toString().trim();
 if (edImg) {
  var edI = $('wc-editorial-img'); if (edI) this._previewImg(edI, 'wc-editorial-preview');
 }
 } catch(e) {}
 // A5. Instagram gallery
 setChk('wc-iggrid-active', s['IG Grid Active']);
 setVal('wc-iggrid-title', s['IG Grid Title'] || '');
 for (var gi = 1; gi <= 6; gi++) {
 setVal('wc-iggrid-' + gi, s['IG Grid Image ' + gi] || '');
 }
 setVal('wc-iggrid-link', s['IG Grid Link'] || '');
 // ✅ v16.3: Men's Accessories showcase
 setChk('wc-accessories-active', s['Accessories Active']);
 setVal('wc-accessories-title', s['Accessories Title'] || '');
 setVal('wc-accessories-subtitle', s['Accessories Subtitle'] || '');
 setVal('wc-accessories-banner', s['Accessories Banner'] || '');
 },

 async save() {
 const deliveryLocations = this._collectDeliveryLocations();
 // ✅ v3.6: Narayanganj defaults (used for legacy Zone 1/2 settings backward-compat)
 const firstDelivery = deliveryLocations[0] || { id:'inside_narayanganj', name:'Inside Narayanganj', charge:70 };
 const secondDelivery = deliveryLocations[1] || { id:'outside_narayanganj', name:'Outside Narayanganj', charge:140 };

 const updates = {
 // General
 'Store Status': $('wc-store-status')?.checked ? 'Maintenance' : 'Live',
 'B2B Mode': $('wc-b2b-mode')?.checked ? 'true' : 'false',
 // v15.74: Holiday / Vacation Mode
 'Holiday Mode': $('wc-holiday-mode')?.checked ? 'true' : 'false',
 'Holiday Reason': $('wc-holiday-reason')?.value || 'custom',
 'Holiday Custom Message': $('wc-holiday-msg')?.value.trim() || '',
 'Holiday Return Date': $('wc-holiday-return-date')?.value || '',
 'Currency': $('wc-currency')?.value.trim(),
 'Language': $('wc-language')?.value,
 'Announcement Active': $('wc-announcement-active')?.checked ? 'true' : 'false',
 'Announcement Text': $('wc-announcement-text')?.value.trim(),
 'Announcement BG': $('wc-ann-bg')?.value.trim() || '',
 'Announcement Text Color': $('wc-ann-text')?.value.trim() || '',
 'Promo Popup Active': $('wc-popup-active')?.checked ? 'true' : 'false',
 'Promo Popup Image': $('wc-popup-img')?.value.trim(),
 'Promo Popup Link': $('wc-popup-link')?.value.trim(),

 // Banners
 'Flash Date': $('wc-flash-date')?.value.trim(),
 'Flash Title': $('wc-flash-title')?.value.trim(),

 // Product Page
 'Quick View': $('wc-quick-view')?.checked ? 'true' : 'false',
 'Stock Bar': $('wc-stock-bar')?.checked ? 'true' : 'false',
 'Related Prod': $('wc-related-prod')?.checked ? 'true' : 'false',
 'Live Search': $('wc-live-search')?.checked ? 'true' : 'false',
 'Hover Effect': $('wc-hover-effect')?.value,
 'Add Cart Text': $('wc-add-cart-text')?.value.trim(),
 'Max Qty': $('wc-max-qty')?.value.trim() || '',
 'Exp Delivery': $('wc-exp-delivery')?.value.trim() || '',

 // Checkout
 'Enable COD': $('wc-enable-cod')?.checked ? 'true' : 'false',
 'FreeShip Advance': $('wc-freeship-advance')?.checked ? 'true' : 'false',
 'Cart Drawer': $('wc-cart-drawer')?.checked ? 'true' : 'false',
 'Order Notes': $('wc-order-notes')?.checked ? 'true' : 'false',
 'Checkout Mode': $('wc-checkout-mode')?.value,
 'Custom Field': $('wc-custom-field')?.value.trim(),
 'Zone 1 Name': firstDelivery.name || '',
 'Zone 1 Charge': firstDelivery.charge || 0,
 'Zone 2 Name': secondDelivery.name || '',
 'Zone 2 Charge': secondDelivery.charge || 0,
 'Delivery Locations': JSON.stringify(deliveryLocations),
 'Free Ship Amt': $('wc-free-ship-amt')?.value.trim(),
 'Min Order': $('wc-min-order')?.value.trim(),

 // Marketing
 'Exit Popup': $('wc-exit-popup')?.checked ? 'true' : 'false',
 'Loyalty System': $('wc-loyalty')?.checked ? 'true' : 'false',
 'Trust Badges': $('wc-trust-badges')?.checked ? 'true' : 'false',
 'Abandon Msg': $('wc-abandon-msg')?.value.trim(),

 // Branding & SEO
 'Website Logo URL': $('wc-logo')?.value.trim() || '',
 'Font': $('wc-font')?.value,
 'Theme Color': $('wc-theme-color')?.value.trim() || '',
 'Live Chat': $('wc-live-chat')?.value,
 'Footer Text': $('wc-footer-text')?.value.trim() || '',
 'Link Facebook': $('wc-link-fb')?.value.trim() || '',
 'Link Instagram': $('wc-link-ig')?.value.trim() || '',
 'Link WhatsApp': $('wc-link-wa')?.value.trim() || '',
 'Link Messenger': $('wc-link-ms')?.value.trim() || '',
 'Link TikTok': $('wc-link-tt')?.value.trim() || '',
 'Link YouTube': $('wc-link-yt')?.value.trim() || '',
 'Meta Title': $('wc-meta-title')?.value.trim() || '',
 'Meta Desc': $('wc-meta-desc')?.value.trim() || '',
 'FB Pixel': $('wc-fb-pixel')?.value.trim() || '',
 'FB CAPI Token': $('wc-fb-capi-token')?.value.trim() || '',
 'GA4': $('wc-ga4')?.value.trim() || '',
 'IG Pixel': $('wc-ig-pixel')?.value.trim() || '',
 'TT Pixel': $('wc-tt-pixel')?.value.trim() || '',
 'Pinterest Pixel': $('wc-pin-pixel')?.value.trim() || '',
 'Snapchat Pixel': $('wc-snap-pixel')?.value.trim() || '',
 // ✅ v11.7: Server-side CAPI + Domain Verification
 'FB CAPI Test Code': $('wc-fb-capi-test-code')?.value.trim() || '',
 // ✅ v15.44: Test Mode toggle — when OFF, the test code above is IGNORED
 // by the Apps Script, so production events flow to your real ad campaigns.
 'FB CAPI Test Mode': ($('wc-fb-capi-test-mode')?.checked ? 'true' : 'false'),
 'FB Domain Verify': $('wc-fb-domain-verify')?.value.trim() || '',
 'TT Access Token': $('wc-tt-token')?.value.trim() || '',
 'TT Advertiser ID': $('wc-tt-advertiser-id')?.value.trim() || '',
 'Avg Order Value': $('wc-avg-order-value')?.value.trim() || '',
 'OG Image': $('wc-og-img')?.value.trim() || '',
 'GSC Tag': $('wc-gsc-tag')?.value.trim() || '',
 'Custom CSS': $('wc-custom-css')?.value.trim() || '',
 'Telegram Bot Token': $('wc-tg-token')?.value.trim() || '',
 'Telegram Chat ID': $('wc-tg-chat')?.value.trim() || ''
 };

 // Hero Banners loop
 for(let i=1; i<=5; i++){
 updates[`Hero Banner ${i}`] = $(`wc-bimg-${i}`)?.value.trim() || '';
 updates[`Banner Link ${i}`] = $(`wc-blink-${i}`)?.value.trim() || '';
 updates[`Banner Title ${i}`] = $(`wc-btitle-${i}`)?.value.trim() || '';
 // ✅ v11 NEW: per-banner title text color
 updates[`Banner Text Color ${i}`] = $(`wc-btxtcolor-${i}`)?.value.trim() || '#FFFFFF';
 }

 // Dynamic Sections loop
 const blocks = document.querySelectorAll('.wc-section-block');
 let secIdx = 1;
 blocks.forEach(block => {
 const active = block.querySelector('.wc-sec-active').checked ? 'true' : 'false';
 const title = block.querySelector('.wc-sec-title').value.trim();
 const cat = block.querySelector('.wc-sec-cat').value.trim();
 const img = block.querySelector('.wc-sec-img')?.value.trim() || '';
 const linkInputs = block.querySelectorAll('.wc-sec-link-input');
 const links = Array.from(linkInputs).map(inp => inp.value.trim()).filter(v => v);
 const link = links.length ? JSON.stringify(links) : '';
 
 if(title || cat || img || link) {
  updates[`Section ${secIdx} Active`] = active;
  updates[`Section ${secIdx} Title`] = title;
  updates[`Section ${secIdx} Category`] = cat;
  updates[`Section ${secIdx} Image`] = img;
  updates[`Section ${secIdx} Link`] = link;
  secIdx++;
 }
 });
 
 // Clear remaining up to 50
 for(let i=secIdx; i<=50; i++){
 updates[`Section ${i} Active`] = 'false';
 updates[`Section ${i} Title`] = '';
 updates[`Section ${i} Category`] = '';
 updates[`Section ${i} Image`] = '';
 updates[`Section ${i} Link`] = '';
 }

 // ============================================================
 // ✅ v11 EXTRAS TAB — collect all premium control values
 // ============================================================
 const v = (id) => ($(id)?.value || '').trim();
 const c = (id) => $(id)?.checked ? 'true' : 'false';

 // 1. Theme Palette
 updates['Theme Primary'] = v('wc-theme-primary');
 updates['Theme Accent'] = v('wc-theme-accent');
 updates['Theme BG'] = v('wc-theme-bg');
 updates['Theme Card BG'] = v('wc-theme-card');
 updates['Theme Text'] = v('wc-theme-text');
 updates['Theme Border'] = v('wc-theme-border');
 updates['Theme Link'] = v('wc-theme-link');
 updates['Theme Sale Price'] = v('wc-theme-sale');
 updates['Theme Footer BG'] = v('wc-theme-footer');
 // 2. Typography
 updates['Heading Font'] = v('wc-heading-font');
 updates['Body Font']  = v('wc-body-font');
 updates['Bengali Font'] = v('wc-bn-font');
 // 3. Card Style
 updates['Card Style'] = v('wc-card-style') || 'rounded';
 updates['Card Hover'] = v('wc-card-hover') || 'zoom';
 // 4. Countdown
 updates['Countdown Active'] = c('wc-countdown-active');
 updates['Countdown End'] = v('wc-countdown-end');
 updates['Countdown Title'] = v('wc-countdown-title');
 updates['Countdown Style'] = v('wc-countdown-style') || 'red';
 updates['Countdown BG']  = v('wc-countdown-bg');
 updates['Countdown Text'] = v('wc-countdown-text');
 // 5. Free Shipping
 updates['Free Ship Bar Active'] = c('wc-freeship-active');
 updates['Free Ship Bar Text'] = v('wc-freeship-text');
 updates['Free Ship Bar BG']  = v('wc-freeship-bg');
 updates['Free Ship Bar Text Color'] = v('wc-freeship-text-color');
 updates['Free Ship Bar Thickness'] = v('wc-freeship-thickness') || 'slim';
 // 6. Best Sellers / New Arrivals / Recently Viewed / Wishlist
 updates['Best Sellers Active'] = c('wc-bestseller-active');
 updates['Best Sellers Title'] = v('wc-bestseller-title');
 updates['Best Sellers Count'] = v('wc-bestseller-count') || 8;
 updates['New Arrival Active'] = c('wc-newarrival-active');
 updates['New Arrival Days'] = v('wc-newarrival-days') || 7;
 updates['Recently Viewed']  = c('wc-recently-viewed');
 updates['Wishlist Active']  = c('wc-wishlist-active');
 // 7. Product Page Premium
 updates['Sticky ATC Mobile'] = c('wc-sticky-buy');
 updates['Video Autoplay']  = c('wc-video-autoplay');
 updates['OOS Hide']   = c('wc-oos-hide');
 updates['Quick View Active'] = c('wc-quick-view-active');
 // 7B. Size Visibility Control
 updates['Size OOS Hide'] = c('wc-size-oos-hide');
 updates['Size Shirt S'] = c('wc-size-shirt-S');
 updates['Size Shirt M'] = c('wc-size-shirt-M');
 updates['Size Shirt L'] = c('wc-size-shirt-L');
 updates['Size Shirt XL'] = c('wc-size-shirt-XL');
 updates['Size Shirt XXL'] = c('wc-size-shirt-XXL');
 updates['Size Shirt 3XL'] = c('wc-size-shirt-3XL');
 updates['Size Pant 28'] = c('wc-size-pant-28');
 updates['Size Pant 30'] = c('wc-size-pant-30');
 updates['Size Pant 32'] = c('wc-size-pant-32');
 updates['Size Pant 34'] = c('wc-size-pant-34');
 updates['Size Pant 36'] = c('wc-size-pant-36');
 updates['Size Pant 38'] = c('wc-size-pant-38');
 // 8. Newsletter
 updates['Newsletter Active'] = c('wc-newsletter-active');
 updates['Newsletter Title'] = v('wc-newsletter-title');
 updates['Newsletter Code'] = v('wc-newsletter-code');
 updates['Newsletter Trigger'] = v('wc-newsletter-trigger') || '15';
 // 9. Store Hours
 updates['Store Hours Active'] = c('wc-hours-active');
 updates['Store Hours Open'] = v('wc-hours-open');
 updates['Store Hours Close'] = v('wc-hours-close');
 updates['Store Hours Msg'] = v('wc-hours-msg');
 // 10. FAQ — toggle + collect rows + clear remaining
 updates['FAQ Active'] = c('wc-faq-active');
 {
 const rows = qsa('#wc-faq-list .wc-faq-row');
 let i = 1;
 rows.forEach(row => {
  if(i > 10) return;
  const q = (row.querySelector('.wc-faq-q')?.value || '').trim();
  const a = (row.querySelector('.wc-faq-a')?.value || '').trim();
  if(q || a) {
  updates[`FAQ Q${i}`] = q;
  updates[`FAQ A${i}`] = a;
  i++;
  }
 });
 for(; i<=10; i++){ updates[`FAQ Q${i}`] = ''; updates[`FAQ A${i}`] = ''; }
 }
 // 11. Testimonials
 updates['Reviews Active'] = c('wc-reviews-active');
 {
 const rows = qsa('#wc-reviews-list .wc-rev-row');
 let i = 1;
 rows.forEach(row => {
  if(i > 10) return;
  const n = (row.querySelector('.wc-rev-name')?.value || '').trim();
  const p = (row.querySelector('.wc-rev-photo')?.value || '').trim();
  const st = (row.querySelector('.wc-rev-stars')?.value || '5').trim();
  const t = (row.querySelector('.wc-rev-text')?.value || '').trim();
  if(n || t) {
  updates[`Review ${i} Name`] = n;
  updates[`Review ${i} Photo`] = p;
  updates[`Review ${i} Stars`] = st;
  updates[`Review ${i} Text`] = t;
  i++;
  }
 });
 for(; i<=10; i++){
  updates[`Review ${i} Name`] = '';
  updates[`Review ${i} Photo`] = '';
  updates[`Review ${i} Stars`] = '';
  updates[`Review ${i} Text`] = '';
 }
 }
 // 12. Float Chat
 updates['Float Chat Position'] = v('wc-float-pos') || 'bottom-right';
 updates['Float Chat Offset'] = v('wc-float-offset') || 20;
 // 13. Popup Slots
 {
 const slots = qsa('#wc-popup-slots .wc-popup-slot');
 slots.forEach((row, idx) => {
  const i = idx + 1;
  if(i > 3) return;
  updates[`Popup ${i} Active`] = row.querySelector('.wc-popup-active')?.checked ? 'true' : 'false';
  updates[`Popup ${i} Image`] = (row.querySelector('.wc-popup-img')?.value || '').trim();
  updates[`Popup ${i} Link`] = (row.querySelector('.wc-popup-link')?.value || '').trim();
  updates[`Popup ${i} Start`] = (row.querySelector('.wc-popup-start')?.value || '').trim();
  updates[`Popup ${i} End`]  = (row.querySelector('.wc-popup-end')?.value || '').trim();
  updates[`Popup ${i} Trigger`] = (row.querySelector('.wc-popup-trigger')?.value || '10').trim();
 });
 }

 // ✅ v11.8: Advanced (Royal) tab — A1-A5
 // A1. Royal Marquee
 updates['Marquee Active']  = c('wc-marquee-active');
 updates['Marquee Text']  = v('wc-marquee-text');
 updates['Marquee BG']  = v('wc-marquee-bg');
 updates['Marquee Text Color'] = v('wc-marquee-text-color');
 updates['Marquee Speed'] = v('wc-marquee-speed') || 'slow';
 // A2. Trust strip
 updates['Trust Strip Active'] = c('wc-trust-strip-active');
 for (let ti = 1; ti <= 4; ti++) {
 updates['Trust ' + ti + ' Icon'] = v('wc-trust-' + ti + '-icon');
 updates['Trust ' + ti + ' Label'] = v('wc-trust-' + ti + '-label');
 }
 // A3. Royal frame
 updates['Royal Frame Active'] = c('wc-royal-frame-active');
 updates['Royal Accent']  = v('wc-royal-accent');
 updates['Royal Frame Style'] = v('wc-royal-frame-style') || 'corners';
 // A4. Editorial story
 updates['Editorial Active'] = c('wc-editorial-active');
 updates['Editorial Image'] = v('wc-editorial-img');
 updates['Editorial Title'] = v('wc-editorial-title');
 updates['Editorial Body'] = v('wc-editorial-body');
 updates['Editorial CTA'] = v('wc-editorial-cta');
 updates['Editorial Link'] = v('wc-editorial-link');
 // A5. Instagram gallery
 updates['IG Grid Active'] = c('wc-iggrid-active');
 updates['IG Grid Title'] = v('wc-iggrid-title');
 for (let gi = 1; gi <= 6; gi++) {
 updates['IG Grid Image ' + gi] = v('wc-iggrid-' + gi);
 }
 updates['IG Grid Link'] = v('wc-iggrid-link');
 // ✅ v16.3: Men's Accessories showcase
 updates['Accessories Active'] = c('wc-accessories-active');
 updates['Accessories Title'] = v('wc-accessories-title');
 updates['Accessories Subtitle'] = v('wc-accessories-subtitle');
 updates['Accessories Banner'] = v('wc-accessories-banner');

 showLoader('Saving website data...');
 try {
 const res = await appsPost('updateSettings', { settings: updates });
 if(res && res.success===false) throw new Error(res.msg||'Failed');
 const delRes = await appsPost('updateDeliveryCharges', { locations: deliveryLocations });
 if(delRes && delRes.success===false) throw new Error(delRes.msg||delRes.error||'Delivery charge save failed');
 
 // Update local state
 state.data.settings = state.data.settings || {};
 Object.assign(state.data.settings, updates);
 state.data.deliveryCharges = deliveryLocations;
 
 // v3.9: Re-load from sheet to confirm persistence (cache-busted)
 try { await loadSettings(); await loadDeliveryCharges(); this.render(); } catch(re) {}
 
  toast(' Save ! Delivery charges will sync to site within ~10 seconds.','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  // v3.6: Show success in delivery sync indicator, then auto-hide after 10s
  // ✅ v9.7: Post-save cache invalidation — signal storefront to clear stale data
  try {
   localStorage.setItem('yarz_settings_dirty', Date.now().toString());
   Object.keys(localStorage).forEach(function(k) {
   if (k.startsWith('yarz_api_cache_') || k === 'yarz_storeinfo_cache' || k === 'yarz_prefetch_snapshot') {
   localStorage.removeItem(k);
   }
   });
   if (navigator.serviceWorker && navigator.serviceWorker.controller) {
   navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_API_CACHE' });
   }
  } catch(cacheErr) { /* silent */ }
 // ✅ v15.0 FIX: Direct Cloudflare cache purge — no waiting for GAS trigger.
 // This is the missing link that caused admin updates to never reflect on
 // the live website. Fire-and-forget, 3s timeout — does not block UI.
 // ✅ v15.50: Purge BOTH the customer-facing domain and the workers.dev
 // origin so neither colo serves stale cache slots. See Publish handler
 // for the full rationale.
 try {
  const _purgeCtrl = new AbortController();
  setTimeout(function(){ try { _purgeCtrl.abort(); } catch(e){} }, 3000);
  const _pBody = JSON.stringify({ actions: ['store_info', 'products', 'categories', 'delivery_charges'] });
  const _pHeaders = { 'X-Purge-Key': 'yarz_xK9mP2nL8vR4qH7', 'Content-Type': 'application/json' };
  ['https://yarzclothing.xyz/__purge', 'https://yarz.marufhasan80009.workers.dev/__purge'].forEach(function (_u) {
  fetch(_u, {
  method: 'POST', headers: _pHeaders, body: _pBody,
  signal: _purgeCtrl.signal, keepalive: true
  }).catch(function(){ /* silent — GAS auto-purge is fallback */ });
  });
 } catch(purgeErr) { /* silent */ }
 const _syncBoxOk = $('wc-delivery-sync-indicator');
 const _syncTxtOk = $('wc-delivery-sync-text');
 if(_syncBoxOk){ _syncBoxOk.style.display = 'flex'; }
 if(_syncTxtOk){ _syncTxtOk.textContent = 'Saved! Website will reflect new delivery locations within 10 seconds.'; }
 setTimeout(()=>{ if(_syncBoxOk) _syncBoxOk.style.display = 'none'; }, 10000);
 } catch(e){
 toast(e.message,'error');
 const _syncBoxErr = $('wc-delivery-sync-indicator');
 const _syncTxtErr = $('wc-delivery-sync-text');
 if(_syncBoxErr){ _syncBoxErr.style.display = 'flex'; _syncBoxErr.style.background = 'linear-gradient(90deg,#FEF2F2,#FEE2E2)'; _syncBoxErr.style.borderColor = '#FCA5A5'; _syncBoxErr.style.color = '#B91C1C'; }
 if(_syncTxtErr){ _syncTxtErr.textContent = 'Sync failed: ' + e.message; }
 setTimeout(()=>{ if(_syncBoxErr){ _syncBoxErr.style.display = 'none'; _syncBoxErr.style.background = ''; _syncBoxErr.style.borderColor = ''; _syncBoxErr.style.color = ''; } }, 5000);
 }
 finally { hideLoader(); }
 }
};

/* ============================================================
 ============ PIXEL TOGGLES MODULE (v14.0) ============
 Lets admin enable/disable each pixel event individually.
 - Reads current state from `state.storeInfo` (refreshed on load)
 - Writes to SETTINGS sheet via `updatesettings` action
 - Critical events (Purchase, ViewContent, etc.) stay locked ON regardless
============================================================ */
YARZ.pixelToggles = {
 // Map: HTML element ID → SETTINGS sheet key
 _NETWORK_KEYS: {
 'pix_net_fb':  'pixel_net_fb',
 'pix_net_fb_capi': 'pixel_net_fb_capi',
 'pix_net_ga4':  'pixel_net_ga4',
 'pix_net_tiktok': 'pixel_net_tiktok',
 'pix_net_snap': 'pixel_net_snap',
 'pix_net_pinterest': 'pixel_net_pinterest'
 },
 _EVENT_KEYS: {
 // Locked (always ON)
 'pix_evt_pageview':  'pixel_evt_pageview',
 'pix_evt_view_content':  'pixel_evt_view_content',
 'pix_evt_add_to_cart':  'pixel_evt_add_to_cart',
 'pix_evt_initiate_checkout': 'pixel_evt_initiate_checkout',
 'pix_evt_purchase':  'pixel_evt_purchase',
 // Standard
 'pix_evt_add_payment_info': 'pixel_evt_add_payment_info',
 'pix_evt_add_to_wishlist':  'pixel_evt_add_to_wishlist',
 'pix_evt_search':   'pixel_evt_search',
 'pix_evt_lead':   'pixel_evt_lead',
 'pix_evt_abandoned_checkout': 'pixel_evt_abandoned_checkout',
 // Custom
 'pix_evt_whatsapp_click': 'pixel_evt_whatsapp_click',
 'pix_evt_time_on_page':  'pixel_evt_time_on_page',
 'pix_evt_size_selected':  'pixel_evt_size_selected',
 'pix_evt_viewed_many_products':'pixel_evt_viewed_many_products',
 // Engagement milestones
 'pix_evt_engaged_session':  'pixel_evt_engaged_session',
 'pix_evt_session_end':  'pixel_evt_session_end',
 'pix_evt_tos_15':   'pixel_evt_tos_15',
 'pix_evt_tos_30':   'pixel_evt_tos_30',
 'pix_evt_tos_60':   'pixel_evt_tos_60',
 'pix_evt_tos_120':   'pixel_evt_tos_120',
 'pix_evt_tos_180':   'pixel_evt_tos_180',
 'pix_evt_tos_300':   'pixel_evt_tos_300',
 'pix_evt_scroll_25':   'pixel_evt_scroll_25',
 'pix_evt_scroll_50':   'pixel_evt_scroll_50',
 'pix_evt_scroll_75':   'pixel_evt_scroll_75',
 'pix_evt_scroll_100':  'pixel_evt_scroll_100',
 // Server-side delivery flow (default OFF)
 'pix_evt_order_delivered':  'pixel_evt_order_delivered',
 'pix_evt_order_cancelled':  'pixel_evt_order_cancelled',
 'pix_evt_order_returned': 'pixel_evt_order_returned'
 },
 // Read truthy: empty/undefined = ON (default), 'false'/'0'/'no'/'off' = OFF
 _isOn(value, defaultOn) {
 if (value === undefined || value === null) return defaultOn !== false;
 var s = String(value).toLowerCase().trim();
 if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === 'n') return false;
 if (s === '') return defaultOn !== false;
 return true;
 },
 // Default state per key (some events default OFF — order status events)
 _defaultOn(key) {
 if (key === 'pixel_evt_order_delivered') return false;
 if (key === 'pixel_evt_order_cancelled') return false;
 if (key === 'pixel_evt_order_returned') return false;
 return true;
 },
 // Render: load current values from saved settings into the checkboxes.
 // ✅ v14.0 fix: read from state.data.settings (populated by loadSettings())
 // — NOT state.storeInfo which doesn't exist in admin context. Without this fix,
 // every page reload would show defaults and "Save" would silently overwrite
 // previously-saved toggle state.
 render() {
 var settings = (state && state.data && state.data.settings) ? state.data.settings : {};
 var self = this;
 function setEl(elId, sheetKey) {
 var el = document.getElementById(elId);
 if (!el) return;
 el.checked = self._isOn(settings[sheetKey], self._defaultOn(sheetKey));
 }
 Object.keys(this._NETWORK_KEYS).forEach(function(elId) {
 setEl(elId, self._NETWORK_KEYS[elId]);
 });
 Object.keys(this._EVENT_KEYS).forEach(function(elId) {
 setEl(elId, self._EVENT_KEYS[elId]);
 });
 },
 // Save: collect all toggle states and write to SETTINGS sheet
 async save() {
 var self = this;
 var settings = {};
 function readEl(elId, sheetKey) {
 var el = document.getElementById(elId);
 if (!el) return;
 // Locked events are always disabled in UI but stored as TRUE
 var val = el.disabled ? true : !!el.checked;
 settings[sheetKey] = val ? 'true' : 'false';
 }
 Object.keys(this._NETWORK_KEYS).forEach(function(elId) {
 readEl(elId, self._NETWORK_KEYS[elId]);
 });
 Object.keys(this._EVENT_KEYS).forEach(function(elId) {
 readEl(elId, self._EVENT_KEYS[elId]);
 });

 var status = document.getElementById('pixel-toggles-status');
 if (status) { status.textContent = 'Saving...'; status.style.color = 'var(--ink-3)'; }

 try {
 var res = await appsPost('updateSettings', { settings: settings });
 if (res && (res.ok || res.success)) {
  if (status) { status.textContent = '✅ Saved successfully'; status.style.color = 'var(--success)'; }
  // ✅ v14.0 fix: Update state.data.settings (the canonical admin store) so
  // next render() reads the just-saved values, not stale ones.
  if (state && state.data && state.data.settings) {
  Object.keys(settings).forEach(function(k) {
  state.data.settings[k] = settings[k];
  });
  }
  // Mark dirty so storefront refetches settings on next load
  try { localStorage.setItem('yarz_settings_dirty', '1'); } catch(e) {}
  toast('Pixel controls Saved', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  setTimeout(function() { if (status) status.textContent = ''; }, 4000);
  } else {
  throw new Error(res && res.msg ? res.msg : 'Save failed');
  }
  } catch (err) {
 if (status) { status.textContent = '❌ ' + (err.message || 'Save failed'); status.style.color = 'var(--danger)'; }
 toast('Error saving: ' + (err.message || 'unknown'), 'error');
 }
 },
 // Reset all to default ON
 resetAll() {
 if (!confirm('All toggle ON to want?\n\n(Order status events default OFF will remain)')) return;
 var self = this;
 Object.keys(this._NETWORK_KEYS).forEach(function(elId) {
 var el = document.getElementById(elId);
 if (el && !el.disabled) el.checked = true;
 });
 Object.keys(this._EVENT_KEYS).forEach(function(elId) {
 var el = document.getElementById(elId);
 if (el && !el.disabled) {
  el.checked = self._defaultOn(self._EVENT_KEYS[elId]);
 }
 });
 toast('Reset happens — Save Pixel Controls confirm ', 'info');
 }
};

/* ============================================================
 ============ SETTINGS MODULE ============
============================================================ */
YARZ.settings = {
 render(){
 $('set-apps-url').value = state.appsUrl || '';
 $('set-sheet-id').value = state.sheetId;
 $('set-api-key').value = state.apiKey;

 const s = state.data.settings;
 const storeKeys = [
 ['Store Name','Store Name'],
 ['Store Tagline','Tagline'],
 ['Contact Phone','Phone'],
 ['Contact Email','Email'],
 ['Website URL','Website URL'],
 ['Facebook Page','Facebook'],
 ['Instagram','Instagram'],
 ['WhatsApp','WhatsApp'],
 ['Business Address','Address'],
 ['Default Delivery (Dhaka)','Inside Narayanganj Delivery '],
 ['Default Delivery (Outside)','Outside Narayanganj Delivery '],
 ['Return Policy Days','Return Policy (Days)'],
 ['Low Stock Threshold','Low Stock Alert (≤)'],
 ['Payment Methods','Payment Methods']
 ];
 $('store-settings').innerHTML = storeKeys.map(([k,lbl])=>`
 <div class="field"><label>${esc(lbl)}</label>
  <input class="input" data-setting="${esc(k)}" value="${esc(s[k]||'')}">
 </div>
 `).join('');

 const gh = [
 ['GitHub Token','Token','password'],
 ['GitHub Owner','Owner','text'],
 ['GitHub Repo','Repo','text'],
 ['GitHub Branch','Branch','text'],
 ['GitHub File Path','File Path','text']
 ];
 $('github-settings').innerHTML = gh.map(([k,lbl,tp])=>`
 <div class="field"><label>${esc(lbl)}</label>
  <input class="input" data-gh="${esc(k)}" type="${tp}" value="${esc(s[k]||'')}">
 </div>
 `).join('');

 // ✅ v11.4: Populate Steadfast credentials
 const sfApi = $('sf-api-key'); if(sfApi) sfApi.value = s['Steadfast API Key'] || '';
 const sfSec = $('sf-secret'); if(sfSec) sfSec.value = s['Steadfast Secret Key'] || '';
 },

 saveConn(){
 // ★ Apps URL if present DEFAULT_APPS_URL use will be
 const appsUrl = $('set-apps-url').value.trim() || DEFAULT_APPS_URL;
 const sheetId = $('set-sheet-id').value.trim()||DEFAULT_SHEET_ID;
 const apiKey = $('set-api-key').value.trim()||DEFAULT_API_KEY;
 state.appsUrl = appsUrl;
 state.sheetId = sheetId;
 state.apiKey = apiKey;
 // ✅ v3.8: SETTINGS_VERSION track which future Update auto-reset happens
 _ls('yarz_settings', JSON.stringify({ appsUrl, sheetId, apiKey, __v: SETTINGS_VERSION }));
  toast('Connection Saved','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  YARZ.loadAll(true);
  },

  // ✅ v3.8: which reset or — setting clear DEFAULTS goes
 resetConn(){
 if(!confirm('Connection settings reset will be DEFAULTS । ?')) return;
try { localStorage.removeItem('yarz_settings'); } catch(e) {}
  state.appsUrl = DEFAULT_APPS_URL;
 state.sheetId = DEFAULT_SHEET_ID;
 state.apiKey = DEFAULT_API_KEY;
 $('set-apps-url').value = DEFAULT_APPS_URL;
 $('set-sheet-id').value = DEFAULT_SHEET_ID;
 $('set-api-key').value = DEFAULT_API_KEY;
_ls('yarz_settings', JSON.stringify({ appsUrl: DEFAULT_APPS_URL, sheetId: DEFAULT_SHEET_ID, apiKey: DEFAULT_API_KEY, __v: SETTINGS_VERSION }));
  toast('Defaults reset happens — Save Connection Days','success');
 },

 // ✅ v3.8: Test Connection — backend with API key which ।
 // this GET request health endpoint and key valid no/not।
 async testConn(){
 showLoader('Connection test Processing...');
 try {
 const url = (state.appsUrl || DEFAULT_APPS_URL) + '?action=health&key=' + encodeURIComponent(state.apiKey || DEFAULT_API_KEY);
 const res = await fetch(url, { method:'GET', redirect:'follow' });
 const txt = await res.text();
 let parsed;
 try { parsed = JSON.parse(txt); } catch(e){
  if(txt.indexOf('<!DOCTYPE')!==-1 || txt.indexOf('<html')!==-1){
  throw new Error('Apps Script HTML return — Deploy → Manage deployments → Who has access: "Anyone" ');
  }
  throw new Error('Apps Script from JSON no/not — response: ' + txt.slice(0,120));
 }
 if(parsed && parsed.success){
  toast('✅ Connection Success! Backend version: ' + (parsed.version || 'unknown'), 'success');
 } else if(parsed && (parsed.error||parsed.msg||'').toLowerCase().indexOf('invalid api key')!==-1){
  toast('❌ Invalid API Key — Apps Script API_KEY constant with no/not। google-apps-script.txt Copy Apps Script paste and new deployment publish ।','error');
 } else {
  toast('⚠️ Backend response: ' + (parsed.error || parsed.msg || JSON.stringify(parsed)).slice(0,180), 'error');
 }
 } catch(e){
 toast('Connection error: ' + e.message, 'error');
 } finally {
 hideLoader();
 }
 },

 async saveStore(){
 const updates = {};
 qsa('[data-setting]').forEach(el=>{
 updates[el.dataset.setting] = el.value;
 });
 showLoader('Settings Saving...');
 try {
 const res = await appsPost('updateSettings', { settings: updates });
 if(res && res.success===false) throw new Error(res.error||'Failed');
  toast('Settings Saved','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  Object.assign(state.data.settings, updates);
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
 },

 async saveGitHub(){
 const gh = {};
 qsa('[data-gh]').forEach(el=>{ gh[el.dataset.gh] = el.value; });
 showLoader('GitHub Settings Saving...');
 try {
 const res = await appsPost('saveGitHubSettings', { t:gh['GitHub Token'], o:gh['GitHub Owner'], r:gh['GitHub Repo'], b:gh['GitHub Branch']||'main', p:gh['GitHub File Path']||'data/products.json' });
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('GitHub Saved','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  Object.assign(state.data.settings, gh);
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
 },

 async githubSync(){
 showLoader('GitHub- sync Processing...');
 try {
 const res = await appsPost('githubSyncNow',{});
  toast('Sync Success','success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  // ✅ v11.4: Steadfast Courier API
 async saveSteadfast(){
 const apiKey = ($('sf-api-key')?.value || '').trim();
 const secret = ($('sf-secret')?.value || '').trim();
 if(!apiKey || !secret){ toast('API Key and Secret Key Days','error'); return; }
 showLoader('Steadfast keys Saving...');
 try {
 const res = await appsPost('steadfastSaveKeys', { apiKey, secret });
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 // Update local cache
 state.data.settings = state.data.settings || {};
 state.data.settings['Steadfast API Key'] = apiKey;
 state.data.settings['Steadfast Secret Key'] = secret;
  toast('✅ Steadfast keys Saved — Test Connection click ', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  async testSteadfast(){
 showLoader('Steadfast- connect Processing...');
 try {
 const res = await appsPost('steadfastBalance', {});
 if(res && res.ok && res.data && res.data.current_balance !== undefined){
  const bal = res.data.current_balance;
  toast(`✅ Steadfast Connected! Balance: ${bal}`, 'success');
  const disp = $('sf-balance-display');
  if(disp) disp.innerHTML = `<i class="ri-wallet-3-line" style="color:#10B981"></i> Balance: <b>${bal}</b>`;
 } else {
  const msg = (res.data && (res.data.message || res.data.error)) || res.msg || 'Connection failed';
  toast('❌ ' + msg, 'error');
 }
 } catch(e){ toast(e.message,'error'); }
 finally { hideLoader(); }
 },

 async checkSteadfastBalance(){
 showLoader('Balance Checking...');
 try {
 const res = await appsPost('steadfastBalance', {});
 if(res && res.ok && res.data){
  const bal = res.data.current_balance;
  const disp = $('sf-balance-display');
  if(disp) disp.innerHTML = `<i class="ri-wallet-3-line" style="color:#10B981"></i> Balance: <b>${bal}</b>`;
  toast(`Balance: ${bal}`, 'success');
 } else {
  toast('Balance Not found — keys correct no/not Check ', 'error');
 }
 } catch(e){ toast(e.message,'error'); }
 finally { hideLoader(); }
 },

 confirmClearFinancials(){
 const html = `
 <div class="modal-header">
  <h3><i class="ri-eraser-line" style="color:var(--warn)"></i> Clean Financial data only</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <p style="margin-bottom:18px;color:var(--ink-2);line-height:1.7">⚠️ optionitems or Product Inventory <b> </b> but Transactions, Orders, Ad Spend, Expenses All <b>delete </b>। Google Sheets- delete which। This cannot be undone!</p>
 <p style="font-size:12px;background:rgba(232,165,71,0.1);padding:10px;border-radius:10px;border:1px solid rgba(232,165,71,0.3);margin-bottom:18px">Type in the box below to confirm: <b>CLEAR FINANCIAL</b></p>
 <div class="field"><input id="clear-confirm-text" class="input" placeholder="CLEAR FINANCIAL"></div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-amber" onclick="YARZ.settings._doClearFinancials()">Yes, delete only Financial data</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 async _doClearFinancials(){
 const txt = ($('clear-confirm-text')?.value||'').trim();
 if(txt !== 'CLEAR FINANCIAL'){
 toast('Type the correct text','error'); return;
 }
 YARZ.closeModal();
 showLoader('Financial Deleting data...');
 try {
 const res = await appsPost('clearFinancialsOnly', {});
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 state.data.transactions = [];
 state.data.orders = [];
 state.data.websiteOrders = [];
 state.data.adTracker = [];
 state.data.expenses = [];
 YARZ.render();
  toast(' delete ✔️', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  confirmClearInventoryOnly(){
 const html = `
 <div class="modal-header">
  <h3><i class="ri-box-3-line" style="color:var(--brand)"></i> Clean Products and Inventory only</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <p style="margin-bottom:18px;color:var(--ink-2);line-height:1.7">⚠️ optionitems and/more give <b> </b> but INVENTORY WEBSITE_SYNC from All Product <b>delete </b>।<br><br>🛡️ <b>fear None! no/not Website Control Settings (CMS), whichno/not and Homepage section configuration protected will remain।</b></p>
 <p style="font-size:12px;background:rgba(99,102,241,0.1);padding:10px;border-radius:10px;border:1px solid rgba(99,102,241,0.3);margin-bottom:18px">Type in the box below to confirm: <b>CLEAR PRODUCTS</b></p>
 <div class="field"><input id="clear-prod-confirm-text" class="input" placeholder="CLEAR PRODUCTS"></div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-primary" onclick="YARZ.settings._doClearInventoryOnly()">Yes, delete only Products</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 async _doClearInventoryOnly(){
 const txt = ($('clear-prod-confirm-text')?.value||'').trim();
 if(txt !== 'CLEAR PRODUCTS'){
 toast('Type the correct text','error'); return;
 }
 YARZ.closeModal();
 showLoader('Deleting product...');
 try {
 const res = await appsPost('clearInventoryOnly', {});
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 state.data.inventory = [];
 YARZ.render();
  toast('Product delete ✔️', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  },

  confirmFullReset(){
 const html = `
 <div class="modal-header">
  <h3><i class="ri-restart-line" style="color:var(--danger)"></i> Complete Factory Reset</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <p style="margin-bottom:18px;color:var(--ink-2);line-height:1.7">️️⚠️⚠️ Everything will be deleted — <b>Product, Inventory, Orders, taka Finance</b> — All। Google Sheets- delete which। <b>This cannot be undone!</b><br><br>🛡️ <b>fear None! no/not Website Control Settings (CMS), whichno/not and Homepage section configuration protected will remain।</b></p>
 <p style="font-size:12px;background:rgba(232,98,92,0.1);padding:10px;border-radius:10px;border:1px solid rgba(232,98,92,0.3);margin-bottom:18px">Type in the box below to confirm: <b>FACTORY RESET</b></p>
 <div class="field"><input id="reset-confirm-text" class="input" placeholder="FACTORY RESET"></div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button class="btn btn-red" onclick="YARZ.settings._doFullReset()">Yes, delete everything</button>
 </div>
 `;
 $('modal-content').innerHTML = html;
 $('modal-overlay').classList.add('show');
 },

 async _doFullReset(){
 const txt = ($('reset-confirm-text')?.value||'').trim();
 if(txt !== 'FACTORY RESET'){
 toast('Type the correct text','error'); return;
 }
 YARZ.closeModal();
 showLoader('Full Reset in progress...');
 try {
 const res = await appsPost('fullFactoryReset', {});
 if(res && res.success===false) throw new Error(res.error||res.msg||'Failed');
 state.data.inventory = [];
 state.data.orders = [];
 state.data.websiteOrders = [];
 state.data.transactions = [];
 state.data.adTracker = [];
 state.data.expenses = [];
 YARZ.render();
  toast('Factory Reset Done ✔️', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } catch(e){ toast(e.message,'error'); }
  finally { hideLoader(); }
  }
};


/* ============================================================
 ============ MODAL BUILDERS ============
============================================================ */

// Helper: build a select + "Custom..." option with a hidden input that gets
// revealed when user picks "Custom..."
// id = base id; options = array of strings; value = currently selected value
function buildComboSelect(id, options, value){
 // Check if current value exists in options \u2013 if not, user likely typed custom
 const isCustom = value && !options.includes(value);
 const opts = options.map(c=>`<option ${c===value?'selected':''} value="${esc(c)}">${esc(c||'—')}</option>`).join('')
 + `<option value="__CUSTOM__" ${isCustom?'selected':''}>➕ Custom (Type manually)</option>`;
 return `
 <div class="custom-input-wrap ${isCustom?'show-custom':''}" id="${id}-wrap">
 <select id="${id}" class="select" onchange="YARZ._onComboChange('${id}')">${opts}</select>
 <input id="${id}-custom" class="input" placeholder="Write as you like..." value="${esc(isCustom?value:'')}">
 </div>
 `;
}

// Returns the final value of a combo-select (either dropdown value or custom input)
function readComboValue(id){
 const wrap = $(id+'-wrap');
 if(wrap && wrap.classList.contains('show-custom')){
 return ($(id+'-custom').value||'').trim();
 }
 const v = $(id).value;
 return v==='__CUSTOM__' ? '' : v;
}

// Toggle custom input when user selects "Custom..."
YARZ._onComboChange = function(id){
 const wrap = $(id+'-wrap');
 const sel = $(id);
 if(sel.value === '__CUSTOM__'){
 wrap.classList.add('show-custom');
 setTimeout(()=>$(id+'-custom').focus(), 50);
 } else {
 wrap.classList.remove('show-custom');
 }
 // ✅ v16.1 ONE-SIZE: when the chosen Category is a typically-sizeless one
 // (cap, watch, wallet, etc.), auto-enable the "One Size" toggle so the owner
 // doesn't have to think about which size box to use. Only auto-applies while
 // the toggle hasn't been manually touched (data-touched flag), so the owner
 // can always override. Fires for both add + edit product modals.
 if(id === 'f-cat'){
 try {
  const tog = $('f-onesize');
  if(tog && !tog.dataset.touched){
  const ONE_SIZE_CATS = ['cap','hat','watch','wallet','sunglasses','belt','accessories'];
  const catVal = (readComboValue('f-cat')||'').trim().toLowerCase();
  const shouldOne = ONE_SIZE_CATS.indexOf(catVal) !== -1;
  if(tog.checked !== shouldOne){
   tog.checked = shouldOne;
   if(typeof YARZ._toggleOneSize === 'function') YARZ._toggleOneSize(shouldOne);
  }
  }
 } catch(e){}
 }
};

const modalBuilders = {
 'delete-confirm': (data)=>{
 return `
 <div class="modal-header">
  <h3><i class="ri-delete-bin-line" style="color:var(--danger)"></i> Delete Confirmation</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <p style="margin-bottom:20px;color:var(--ink-2)">You <b>${esc(data.name)}</b> delete which। You items only Archive/Cancel to want, no/not delete want?</p>
 <div style="display:grid;gap:10px">
  ${data.onArchive ? `<button class="btn btn-primary" onclick="YARZ.closeModal(); ${data.onArchive}"><i class="ri-archive-line"></i> Archive / Hide (Recommended)</button>` : ''}
  ${data.onDeleteKeepFin ? `<button class="btn btn-ghost" style="color:#d97706;border:1px solid #d97706" onclick="YARZ.closeModal(); ${data.onDeleteKeepFin}"><i class="ri-eraser-line"></i> Delete Product ONLY (Keep Financials)</button>` : ''}
  <button class="btn btn-ghost" style="color:var(--danger);border:1px solid var(--danger)" onclick="YARZ.closeModal(); ${data.onDelete}"><i class="ri-delete-bin-6-fill"></i> Permanently Delete EVERYTHING</button>
 </div>
 `;
 },

 'add-product': ()=>{
 const s = state.data?.settings || {};
 // ✅ v3.8: Default zones → Narayanganj (Inside / Outside)
 const z1 = s['Zone 1 Name'] || 'Inside Narayanganj';
 const z2 = s['Zone 2 Name'] || 'Outside Narayanganj';
 const cats = DEFAULT_CATEGORIES;
 const fabs = DEFAULT_FABRICS;
 const bads = DEFAULT_BADGES;
 return `
 <div class="modal-header">
  <h3><i class="fas fa-plus"></i> New Product</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="field"><label>Product Name <span class="req">*</span></label><input id="f-name" class="input"></div>
 <div class="row">
  <div class="field"><label>Category</label>${buildComboSelect('f-cat', cats, cats[0])}</div>
  <div class="field"><label>Fabric</label>${buildComboSelect('f-fab', fabs, fabs[0])}</div>
 </div>
 <div class="row">
  <div class="field"><label>Badge</label>${buildComboSelect('f-bad', bads, '')}</div>
  <div class="field"><label>Status</label><select id="f-status" class="select"><option>Draft</option><option>Active</option><option>Archived</option></select></div>
 </div>
 <div class="row">
  <div class="field"><label>Discount Type</label><select id="f-dt" class="select">${DISC_TYPES.map(c=>`<option>${c}</option>`).join('')}</select></div>
  <div class="field"><label>Discount %</label><input id="f-disc" type="number" class="input" placeholder="0"></div>
  <div class="field"><label>Delivery Days</label><input id="f-ddays" class="input" value="2-3 days"></div>
 </div>

 <div class="modal-section-title">🎁 Coupon Code</div>
 <div class="row">
  <div class="field"><label>Coupon Active</label><select id="f-cAct" class="select"><option value="No">No</option><option value="Yes">Yes (Public)</option><option value="Hidden">Hidden (Secret)</option></select></div>
  <div class="field"><label>Coupon Code</label><input id="f-cCode" class="input" placeholder="e.g. WINTER10"></div>
  <div class="field"><label>Coupon Disc %</label><input id="f-cDisc" type="number" class="input" placeholder="0"></div>
 </div>

 <div class="modal-section-title">🖼️ Media</div>
 <div class="field"><label>Image 1 URL</label><input id="f-img1" class="input"></div>
 <div class="row">
  <div class="field"><label>Image 2</label><input id="f-img2" class="input"></div>
  <div class="field"><label>Image 3</label><input id="f-img3" class="input"></div>
 </div>
 <div class="row">
  <div class="field"><label>Image 4</label><input id="f-img4" class="input"></div>
  <div class="field"><label>Image 5</label><input id="f-img5" class="input"></div>
 </div>
 <div class="field"><label>Image 6</label><input id="f-img6" class="input"></div>
 <div class="field"><label>Video URL</label><input id="f-vid" class="input"></div>

 <div class="modal-section-title">📝 Description</div>
 <div class="field"><label>Description</label><textarea id="f-desc" class="textarea"></textarea></div>
 <div class="field"><label>Size Chart</label><textarea id="f-sc" class="textarea" style="min-height:60px"></textarea></div>

 <div class="modal-section-title">💰 Price</div>
 <div class="row">
  <div class="field"><label>Cost <span class="req">*</span></label><input id="f-cost" type="number" class="input" oninput="if(window.calcDisc)window.calcDisc()"></div>
  <div class="field"><label>Regular <span class="req">*</span></label><input id="f-reg" type="number" class="input" oninput="if(window.calcDisc)window.calcDisc()"></div>
  <div class="field"><label>Sale <span class="req">*</span></label><input id="f-sale" type="number" class="input" oninput="if(window.calcDisc)window.calcDisc()"></div>
 </div>

 <div class="modal-section-title">🚚 Delivery</div>
 <div class="row">
  <div class="field"><label>${esc(z1)} </label><input id="f-din" type="number" class="input" value="60"></div>
  <div class="field"><label>${esc(z2)} </label><input id="f-dout" type="number" class="input" value="120"></div>
 </div>

 <div class="modal-section-title">📊 Stock</div>
 <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px">
  <label class="ios-toggle" style="margin:0">
   <input type="checkbox" id="f-onesize" onchange="this.dataset.touched='1'; YARZ._toggleOneSize(this.checked)">
   <span class="slider"></span>
  </label>
  <div style="line-height:1.3">
   <div style="font-size:12.5px;font-weight:700;color:var(--ink)">One Size / No Size</div>
   <div style="font-size:10.5px;color:var(--ink-3)">Cap, watch, blanket etc. — sells as single piece, no S/M/L</div>
  </div>
 </div>
 <div class="field" style="margin-bottom:10px">
  <label style="font-size:11.5px">Size Type <span style="font-weight:500;color:var(--ink-3)">— how sizes show on the website</span></label>
  <select id="f-sizetype" class="select">
   <option value="">Auto-detect (from category)</option>
   <option value="shirt">Shirt sizes (S, M, L, XL, XXL, 3XL)</option>
   <option value="pant">Pant sizes (28, 30, 32, 34, 36, 38)</option>
  </select>
 </div>
 <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px">
  <label class="ios-toggle" style="margin:0">
   <input type="checkbox" id="f-accessory">
   <span class="slider"></span>
  </label>
  <div style="line-height:1.3">
   <div style="font-size:12.5px;font-weight:700;color:var(--ink)">Men's Accessory</div>
   <div style="font-size:10.5px;color:var(--ink-3)">Cap, watch, bracelet, sunglasses — shows ONLY in the Accessories section, hidden from the main shop</div>
  </div>
 </div>
 <div class="row" id="f-size-grid">
  <div class="field"><label>S</label><input id="f-sS" type="number" class="input" value="0"></div>
  <div class="field"><label>M</label><input id="f-sM" type="number" class="input" value="0"></div>
  <div class="field"><label>L</label><input id="f-sL" type="number" class="input" value="0"></div>
  <div class="field"><label>XL</label><input id="f-sXL" type="number" class="input" value="0"></div>
  <div class="field"><label>XXL</label><input id="f-sXXL" type="number" class="input" value="0"></div>
  <div class="field"><label>3XL</label><input id="f-s3XL" type="number" class="input" value="0"></div>
 </div>
 <div class="row" id="f-onesize-qty-wrap" style="display:none">
  <div class="field" style="flex:1"><label>Quantity (pieces in stock)</label><input id="f-onesize-qty" type="number" class="input" value="0" placeholder="e.g. 25"></div>
 </div>

 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-product" class="btn btn-primary" onclick="YARZ._saveNewProduct()"><i class="fas fa-floppy-disk"></i> Save</button>
 </div>
 `;
 },

 'edit-product': (p)=>{
 const s = state.data?.settings || {};
 // ✅ v3.8: Default zones → Narayanganj (Inside / Outside)
 const z1 = s['Zone 1 Name'] || 'Inside Narayanganj';
 const z2 = s['Zone 2 Name'] || 'Outside Narayanganj';
 const cats = DEFAULT_CATEGORIES;
 const fabs = DEFAULT_FABRICS;
 const bads = DEFAULT_BADGES;
 return `
 <div class="modal-header">
  <h3><i class="fas fa-pen"></i> Edit: ${esc(p.name||'')}</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <input type="hidden" id="f-origname" value="${esc(p.name||'')}">
 <div class="field"><label>Product Name <span class="req">*</span></label><input id="f-name" class="input" value="${esc(p.name||'')}"></div>
 <div class="row">
  <div class="field"><label>Category</label>${buildComboSelect('f-cat', cats, p.category||'')}</div>
  <div class="field"><label>Fabric</label>${buildComboSelect('f-fab', fabs, p.fabric||'')}</div>
 </div>
 <div class="row">
  <div class="field"><label>Badge</label>${buildComboSelect('f-bad', bads, p.badge||'')}</div>
  <div class="field"><label>Status</label><select id="f-status" class="select">
  ${['Active','Draft','Archived'].map(s=>`<option ${s===(p.status||'Active')?'selected':''}>${s}</option>`).join('')}
  </select></div>
 </div>
 <div class="row">
  <div class="field"><label>Discount Type</label><select id="f-dt" class="select">${DISC_TYPES.map(c=>`<option ${c===(p.discType||'Normal')?'selected':''}>${c}</option>`).join('')}</select></div>
  <div class="field"><label>Discount %</label><input id="f-disc" type="number" class="input" value="${p.discPct||0}"></div>
  <div class="field"><label>Delivery Days</label><input id="f-ddays" class="input" value="${esc(p.deliveryDays||'')}"></div>
 </div>
 <div class="modal-section-title">🎁 Coupon Code</div>
 <div class="row">
  <div class="field"><label>Coupon Active</label><select id="f-cAct" class="select"><option value="No" ${(p.couponActive||'No')==='No'?'selected':''}>No</option><option value="Yes" ${(p.couponActive||'No')==='Yes'?'selected':''}>Yes (Public)</option><option value="Hidden" ${(p.couponActive||'No')==='Hidden'?'selected':''}>Hidden (Secret)</option></select></div>
  <div class="field"><label>Coupon Code</label><input id="f-cCode" class="input" value="${esc(p.couponCode||'')}"></div>
  <div class="field"><label>Coupon Disc %</label><input id="f-cDisc" type="number" class="input" value="${p.couponDisc||0}"></div>
 </div>
 <div class="modal-section-title">🖼️ Media</div>
 <div class="field"><label>Image 1 URL</label><input id="f-img1" class="input" value="${esc(p.img1||'')}"></div>
 <div class="row">
  <div class="field"><label>Image 2</label><input id="f-img2" class="input" value="${esc(p.img2||'')}"></div>
  <div class="field"><label>Image 3</label><input id="f-img3" class="input" value="${esc(p.img3||'')}"></div>
 </div>
 <div class="row">
  <div class="field"><label>Image 4</label><input id="f-img4" class="input" value="${esc(p.img4||'')}"></div>
  <div class="field"><label>Image 5</label><input id="f-img5" class="input" value="${esc(p.img5||'')}"></div>
 </div>
 <div class="field"><label>Image 6</label><input id="f-img6" class="input" value="${esc(p.img6||'')}"></div>
 <div class="field"><label>Video URL</label><input id="f-vid" class="input" value="${esc(p.video||'')}"></div>
 <div class="modal-section-title">📝 Description</div>
 <div class="field"><label>Description</label><textarea id="f-desc" class="textarea">${esc(p.desc||'')}</textarea></div>
 <div class="field"><label>Size Chart</label><textarea id="f-sc" class="textarea" style="min-height:60px">${esc(p.sizeChart||'')}</textarea></div>
 <div class="modal-section-title">💰 Price</div>
 <div class="row">
  <div class="field"><label>Cost</label><input id="f-cost" type="number" class="input" value="${p.cost||0}" oninput="if(window.calcDisc)window.calcDisc()"></div>
  <div class="field"><label>Regular</label><input id="f-reg" type="number" class="input" value="${p.regular||0}" oninput="if(window.calcDisc)window.calcDisc()"></div>
  <div class="field"><label>Sale</label><input id="f-sale" type="number" class="input" value="${p.sale||0}" oninput="if(window.calcDisc)window.calcDisc()"></div>
 </div>
 <div class="modal-section-title">🚚 Delivery</div>
 <div class="row">
  <div class="field"><label>${esc(z1)}</label><input id="f-din" type="number" class="input" value="${p.deliveryDhaka||0}"></div>
  <div class="field"><label>${esc(z2)}</label><input id="f-dout" type="number" class="input" value="${p.deliveryOutside||0}"></div>
 </div>
 <div class="modal-section-title">📊 Stock</div>
 <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px">
  <label class="ios-toggle" style="margin:0">
   <input type="checkbox" id="f-onesize" ${String(p.hiddenSizes||'').trim().toUpperCase()==='__ONESIZE__'?'checked':''} onchange="this.dataset.touched='1'; YARZ._toggleOneSize(this.checked)">
   <span class="slider"></span>
  </label>
  <div style="line-height:1.3">
   <div style="font-size:12.5px;font-weight:700;color:var(--ink)">One Size / No Size</div>
   <div style="font-size:10.5px;color:var(--ink-3)">Cap, watch, blanket etc. — sells as single piece, no S/M/L</div>
  </div>
 </div>
 <div class="field" style="margin-bottom:10px">
  <label style="font-size:11.5px">Size Type <span style="font-weight:500;color:var(--ink-3)">— how sizes show on the website</span></label>
  <select id="f-sizetype" class="select">
   <option value="" ${!p.sizeType||String(p.sizeType).toLowerCase()==='auto'?'selected':''}>Auto-detect (from category)</option>
   <option value="shirt" ${String(p.sizeType||'').toLowerCase()==='shirt'?'selected':''}>Shirt sizes (S, M, L, XL, XXL, 3XL)</option>
   <option value="pant" ${String(p.sizeType||'').toLowerCase()==='pant'?'selected':''}>Pant sizes (28, 30, 32, 34, 36, 38)</option>
  </select>
 </div>
 <div class="field" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px">
  <label class="ios-toggle" style="margin:0">
   <input type="checkbox" id="f-accessory" ${String(p.accessory||'').trim().toLowerCase()==='yes'?'checked':''}>
   <span class="slider"></span>
  </label>
  <div style="line-height:1.3">
   <div style="font-size:12.5px;font-weight:700;color:var(--ink)">Men's Accessory</div>
   <div style="font-size:10.5px;color:var(--ink-3)">Cap, watch, bracelet, sunglasses — shows ONLY in the Accessories section, hidden from the main shop</div>
  </div>
 </div>
 <div class="row" id="f-size-grid" style="display:${String(p.hiddenSizes||'').trim().toUpperCase()==='__ONESIZE__'?'none':'flex'}">
  <div class="field"><label>S</label><input id="f-sS" type="number" class="input" value="${p.stkS}"></div>
  <div class="field"><label>M</label><input id="f-sM" type="number" class="input" value="${p.stkM}"></div>
  <div class="field"><label>L</label><input id="f-sL" type="number" class="input" value="${p.stkL}"></div>
  <div class="field"><label>XL</label><input id="f-sXL" type="number" class="input" value="${p.stkXL}"></div>
  <div class="field"><label>XXL</label><input id="f-sXXL" type="number" class="input" value="${p.stkXXL}"></div>
  <div class="field"><label>3XL</label><input id="f-s3XL" type="number" class="input" value="${p.stk3XL}"></div>
 </div>
 <div class="row" id="f-onesize-qty-wrap" style="display:${String(p.hiddenSizes||'').trim().toUpperCase()==='__ONESIZE__'?'flex':'none'}">
  <div class="field" style="flex:1"><label>Quantity (pieces in stock)</label><input id="f-onesize-qty" type="number" class="input" value="${p.stkM}" placeholder="e.g. 25"></div>
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-edit" class="btn btn-primary" onclick="YARZ._saveEditProduct()"><i class="fas fa-floppy-disk"></i> Update</button>
 </div>
 `;
 },

 'sale-entry': (data)=>{
 const active = state.data.inventory.filter(p=>p.status==='Active');
 return `
 <div class="modal-header">
  <h3><i class="fas fa-cash-register"></i> Sales Entry</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="field"><label>Product <span class="req">*</span></label>
  <select id="se-product" class="select" onchange="YARZ._updateStkBadge('se'); YARZ._showProductPreview('se');">
  <option value="">— Select —</option>
  ${active.map(p=>`<option value="${esc(p.name)}" ${data.product===p.name?'selected':''}>${esc(p.name)} (${p.sale})</option>`).join('')}
  </select>
  <!-- ✅ v10 FIX: Product Preview Card (image + category + price + stock by size) -->
  <div id="se-product-preview" style="display:none;margin-top:10px;padding:12px;border-radius:14px;background:rgba(59,130,246,0.07);border:1px solid rgba(59,130,246,0.22)">
  <div style="display:flex;gap:12px;align-items:center">
  <div id="se-prod-img" style="width:64px;height:64px;border-radius:12px;background:rgba(0,0,0,0.05) center/cover no-repeat;flex-shrink:0;border:1px solid rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--ink-4)"><i class="ri-shopping-bag-3-line"></i></div>
  <div style="flex:1;min-width:0">
   <div id="se-prod-name" style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:3px"></div>
   <div id="se-prod-cat" style="font-size:11px;color:var(--ink-3);margin-bottom:5px"></div>
   <div id="se-prod-price" style="font-size:15px;font-weight:800;color:var(--info);margin-bottom:5px"></div>
   <div id="se-prod-stock" style="display:flex;gap:4px;flex-wrap:wrap"></div>
  </div>
  </div>
  </div>
 </div>
 <div class="row">
  <div class="field"><label>Size <span id="se-stk-badge" class="chip chip-gray" style="font-size:10px;padding:2px 4px;margin-left:4px;display:none"></span></label>
  <select id="se-size" class="select" onchange="YARZ._updateStkBadge('se')"><option>S</option><option>M</option><option>L</option><option>XL</option><option>XXL</option><option>3XL</option></select>
  </div>
  <div class="field"><label>Quantity</label><input id="se-qty" type="number" class="input" value="1" min="1"></div>
 </div>
 <div style="font-size:12px;opacity:0.7;padding:10px;background:rgba(59,130,246,0.1);border-radius:10px;border:1px solid rgba(59,130,246,0.2)">
  <i class="fas fa-info-circle"></i> INVENTORY- Sold Update and TRANSACTIONS- log । Stock auto May which।
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-sale" class="btn btn-primary" onclick="YARZ._saveSale()"><i class="fas fa-check"></i> Confirm Sale</button>
 </div>
 `;
 },

 'new-order': ()=>{
 const active = state.data.inventory.filter(p=>p.status==='Active');
 const today = new Date();
 const dateStr = today.getFullYear().toString().slice(-2)+String(today.getMonth()+1).padStart(2,'0')+String(today.getDate()).padStart(2,'0');
 const rnd = Math.floor(1000+Math.random()*9000);
 const oid = `YARZ-${dateStr}-${rnd}`;
 // Fix: z1/z2 must be defined inside this scope
 const _s = state.data.settings || {};
 const z1 = _s['Zone 1 Name'] || 'Inside Dhaka';
 const z2 = _s['Zone 2 Name'] || 'Outside Dhaka';
 return `
 <div class="modal-header">
  <h3><i class="fas fa-bag-shopping"></i> New Order</h3>
  <button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button>
 </div>
 <div class="row">
  <div class="field"><label>Order ID <span class="req">*</span></label><input id="o-oid" class="input" value="${oid}"></div>
  <div class="field"><label>Source</label><select id="o-source" class="select"><option value="Facebook">📘 Facebook</option><option value="Instagram">📸 Instagram</option><option value="WhatsApp">💬 WhatsApp</option><option value="TikTok">🎵 TikTok</option><option value="Website">🌐 Website</option></select></div>
 </div>
 <div class="field"><label>Customer Name <span class="req">*</span></label><input id="o-name" class="input"></div>
 <div class="row">
  <div class="field"><label>Phone <span class="req">*</span></label><input id="o-phone" class="input"></div>
  <div class="field"><label>Location</label><select id="o-loc" class="select" onchange="YARZ._calcOrder()"><option value="Dhaka">${esc(z1)}</option><option value="Outside">${esc(z2)}</option></select></div>
 </div>
 <div class="field"><label>Address <span class="req">*</span></label><textarea id="o-addr" class="textarea" style="min-height:60px"></textarea></div>
 <div class="field"><label>Product <span class="req">*</span></label>
  <select id="o-product" class="select" onchange="YARZ._calcOrder(); YARZ._updateStkBadge('o'); YARZ._showProductPreview('o');">
  <option value="">— Select —</option>
  ${active.map(p=>`<option value="${esc(p.name)}" data-sale="${p.sale}" data-din="${p.deliveryDhaka}" data-dout="${p.deliveryOutside}">${esc(p.name)} (${p.sale})</option>`).join('')}
  </select>
  <!-- Product Preview Card -->
  <div id="o-product-preview" style="display:none;margin-top:10px;padding:12px;border-radius:14px;background:rgba(63,191,165,0.07);border:1px solid rgba(63,191,165,0.22)">
  <div style="display:flex;gap:12px;align-items:center">
  <div id="o-prod-img" style="width:64px;height:64px;border-radius:12px;background:rgba(0,0,0,0.05) center/cover no-repeat;flex-shrink:0;border:1px solid rgba(63,191,165,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--ink-4)"><i class="ri-shopping-bag-3-line"></i></div>
  <div style="flex:1;min-width:0">
   <div id="o-prod-name" style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:3px"></div>
   <div id="o-prod-cat" style="font-size:11px;color:var(--ink-3);margin-bottom:5px"></div>
   <div id="o-prod-price" style="font-size:15px;font-weight:800;color:var(--accent-2);margin-bottom:5px"></div>
   <div id="o-prod-stock" style="display:flex;gap:4px;flex-wrap:wrap"></div>
  </div>
  </div>
  </div>
 </div>
 <div class="row">
  <div class="field"><label>Size <span id="o-stk-badge" class="chip chip-gray" style="font-size:10px;padding:2px 4px;margin-left:4px;display:none"></span></label>
  <select id="o-size" class="select" onchange="YARZ._updateStkBadge('o')"><option>S</option><option>M</option><option>L</option><option>XL</option><option>XXL</option><option>3XL</option></select>
  </div>
  <div class="field"><label>Qty</label><input id="o-qty" type="number" class="input" value="1" min="1" onchange="YARZ._calcOrder()"></div>
 </div>
 <div class="row">
  <div class="field"><label>Payment</label><select id="o-pay" class="select">${PAYMENT_METHODS.map(p=>`<option>${p}</option>`).join('')}</select></div>
  <div class="field"><label>Courier</label><select id="o-courier" class="select">${COURIERS.map(c=>`<option>${c}</option>`).join('')}</select></div>
 </div>
 <div class="field"><label>Courier Tracking ID</label><input id="o-tracking" class="input" placeholder="Consignment / Tracking No"></div>
 <div class="field"><label>Status</label>
  <select id="o-status" class="select">
  <option value="Pending" selected>⏳ Pending (New Order)</option>
  <option value="Processing">📦 Processing (Packaging)</option>
  <option value="Picked Up">🤝 Picked Up (Sent to courier)</option>
  <option value="Shipped">🚚 Shipped (On the way)</option>
  <option value="Delivered">✅ Delivered (Delivery Complete)</option>
  <option value="Returned">↩️ Returned (Return)</option>
  <option value="Cancelled">❌ Cancelled</option>
  </select>
 </div>
 <div class="field"><label>Notes</label><input id="o-notes" class="input"></div>
 <div class="glass" style="padding:12px;background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3)">
  <div class="flex-between"><span>Subtotal:</span><b id="o-sub">0</b></div>
  <div class="flex-between"><span>Delivery:</span><b id="o-del">0</b></div>
  <div class="flex-between mt-2" style="padding-top:8px;border-top:1px dashed rgba(245,158,11,0.4);font-size:16px"><span>Total:</span><b class="text-amber" id="o-tot">0</b></div>
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-order" class="btn btn-primary" onclick="YARZ._saveOrder()"><i class="fas fa-check"></i> Order saved</button>
 </div>
 `;
 },

 'ad-spend': ()=>{
 return `
 <div class="modal-header"><h3><i class="fas fa-bullhorn"></i> Ad Spend</h3><button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button></div>
 <div class="field"><label>Product</label>
  <select id="ad-p" class="select">
  <option value="">— Select —</option>
  ${state.data.inventory.map(p=>`<option>${esc(p.name)}</option>`).join('')}
  </select>
 </div>
 <div class="field"><label>Amount <span class="req">*</span></label><input id="ad-amt" type="number" class="input"></div>
 <div class="field"><label>Campaign</label><input id="ad-camp" class="input"></div>
 <div class="field"><label>Notes</label><input id="ad-notes" class="input"></div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-ad" class="btn btn-primary" onclick="YARZ._saveAd()"><i class="fas fa-check"></i> Save</button>
 </div>
 `;
 },

 'expense': ()=>{
 const cats = ["Courier","Packaging","Office","Electricity","Internet","Rent","Salary","Transport","Marketing","Supplier","Other"];
 return `
 <div class="modal-header"><h3><i class="fas fa-receipt"></i> Expense</h3><button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button></div>
 <div class="field">
  <label>Category <span class="req">*</span></label>
  <input id="ex-cat" class="input" list="ex-cat-list" placeholder="Select or type category...">
  <datalist id="ex-cat-list">${cats.map(c=>`<option value="${c}">`).join('')}</datalist>
 </div>
 <div class="field"><label>Amount <span class="req">*</span></label><input id="ex-amt" type="number" class="input"></div>
 <div class="field"><label>Description</label><textarea id="ex-desc" class="textarea"></textarea></div>
 <div class="field"><label>Paid To</label><input id="ex-paid" class="input"></div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-exp" class="btn btn-primary" onclick="YARZ._saveExp()"><i class="fas fa-check"></i> Save</button>
 </div>
 `;
 },

 'return': ()=>{
 return `
 <div class="modal-header"><h3><i class="fas fa-rotate-left"></i> Return Entry</h3><button class="modal-close" onclick="YARZ.closeModal()"><i class="fas fa-xmark"></i></button></div>
 <div class="field"><label>Product <span class="req">*</span></label>
  <select id="rt-product" class="select" onchange="YARZ._showProductPreview('rt'); YARZ._updateStkBadge('rt');">
  <option value="">— Select —</option>
  ${state.data.inventory.map(p=>`<option value="${esc(p.name)}">${esc(p.name)} (${p.sale})</option>`).join('')}
  </select>
  <!-- Return Product Preview Card -->
  <div id="rt-product-preview" style="display:none;margin-top:10px;padding:12px;border-radius:14px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.22)">
  <div style="display:flex;gap:12px;align-items:center">
  <div id="rt-prod-img" style="width:64px;height:64px;border-radius:12px;background:rgba(0,0,0,0.05) center/cover no-repeat;flex-shrink:0;border:1px solid rgba(245,158,11,0.2);display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--ink-4)"><i class="ri-shopping-bag-3-line"></i></div>
  <div style="flex:1;min-width:0">
   <div id="rt-prod-name" style="font-weight:700;font-size:13.5px;color:var(--ink);margin-bottom:3px"></div>
   <div id="rt-prod-cat" style="font-size:11px;color:var(--ink-3);margin-bottom:5px"></div>
   <div id="rt-prod-price" style="font-size:15px;font-weight:800;color:var(--warn);margin-bottom:5px"></div>
   <div id="rt-prod-stock" style="display:flex;gap:4px;flex-wrap:wrap"></div>
  </div>
  </div>
  </div>
 </div>
 <div class="row">
  <div class="field"><label>Size <span id="rt-stk-badge" class="chip chip-gray" style="font-size:10px;padding:2px 4px;margin-left:4px;display:none"></span></label>
  <select id="rt-size" class="select" onchange="YARZ._updateStkBadge('rt')"><option>S</option><option>M</option><option>L</option><option>XL</option><option>XXL</option><option>3XL</option></select>
  </div>
  <div class="field"><label>Quantity</label><input id="rt-q" type="number" class="input" value="1" min="1"></div>
 </div>
 <div class="field"><label>Delivery Loss () <span style="font-size:10px;opacity:0.6">(Optional)</span></label><input id="rt-dlv-loss" type="number" class="input" placeholder="e.g. 120" min="0"></div>
 <div class="field"><label>Reason</label><input id="rt-r" class="input"></div>
 <div style="font-size:12px;opacity:0.7;padding:10px;background:rgba(245,158,11,0.1);border-radius:10px;border:1px solid rgba(245,158,11,0.2)">
  <i class="fas fa-info-circle"></i> Return if given Stock Product All and Sales Finance delete which। Delivery if present separate Expense will remain।
 </div>
 <div class="modal-actions">
  <button class="btn btn-ghost" onclick="YARZ.closeModal()">Cancel</button>
  <button id="save-ret" class="btn btn-amber" onclick="YARZ._saveRet()"><i class="fas fa-rotate-left"></i> Return</button>
 </div>
 `;
 }
};

/* ============================================================
 ============ SAVE HANDLERS ============
============================================================ */

window.calcDisc = function(){
 const r=num($('f-reg').value);
 const s=num($('f-sale').value);
 if(r>0 && s>=0 && $('f-disc')){
 $('f-disc').value = Math.max(0, Math.round(((r-s)/r)*100));
 }
};

YARZ._toggleOneSize = function(on){
 // ✅ v16.1 ONE-SIZE: toggle between the 6-size grid and a single Quantity
 // input in the add/edit product modal. Pure UI — the save functions read
 // the visible control. When switching ON, seed the qty from the M field so
 // an existing value isn't lost; when OFF, push the qty back into M.
 try {
 const grid = $('f-size-grid');
 const qtyWrap = $('f-onesize-qty-wrap');
 if(!grid || !qtyWrap) return;
 if(on){
  const cur = $('f-onesize-qty');
  const mVal = $('f-sM') ? (parseInt($('f-sM').value,10)||0) : 0;
  if(cur && (!cur.value || cur.value==='0') && mVal>0) cur.value = mVal;
  grid.style.display = 'none';
  qtyWrap.style.display = 'flex';
 } else {
  grid.style.display = 'flex';
  qtyWrap.style.display = 'none';
 }
 } catch(e){}
};

YARZ._saveNewProduct = async function(){
 const name = $('f-name').value.trim();
 if(!name){ toast('Name required','error'); return; }
 const cost = num($('f-cost').value);
 const reg = num($('f-reg').value);
 const sale = num($('f-sale').value);
 if(!cost||!reg||!sale){ toast('Price required','error'); return; }
 const d = {
 name,
 cat: readComboValue('f-cat'),
 fab: readComboValue('f-fab'),
 bad: readComboValue('f-bad'),
 status:$('f-status').value, dt:$('f-dt').value, ddays:$('f-ddays').value,
 img1:$('f-img1').value.trim(), img2:$('f-img2').value.trim(), img3:$('f-img3').value.trim(),
 img4:$('f-img4')?$('f-img4').value.trim():'', img5:$('f-img5')?$('f-img5').value.trim():'', img6:$('f-img6')?$('f-img6').value.trim():'',
 cAct:$('f-cAct')?$('f-cAct').value:'No', cCode:$('f-cCode')?$('f-cCode').value.trim():'', cDisc:$('f-cDisc')?num($('f-cDisc').value):0,
 vid:$('f-vid').value.trim(), desc:$('f-desc').value, sc:$('f-sc').value,
 cost, reg, sale, discPct:num($('f-disc').value),
 din:num($('f-din').value)||60, dout:num($('f-dout').value)||120,
 sS:int($('f-sS')?$('f-sS').value:0), sM:int($('f-sM').value), sL:int($('f-sL').value),
 sXL:int($('f-sXL').value), sXXL:int($('f-sXXL').value), s3XL:int($('f-s3XL')?$('f-s3XL').value:0)
 };
 // ✅ v16.1 ONE-SIZE: if the "One Size" toggle is on, store the single qty in
 // the M slot, zero every other size, and flag the product sizeless.
 const _oneSizeNew = $('f-onesize') && $('f-onesize').checked;
 if(_oneSizeNew){
 const _q = $('f-onesize-qty') ? int($('f-onesize-qty').value) : 0;
 d.oneSize = true;
 d.sS=0; d.sM=_q; d.sL=0; d.sXL=0; d.sXXL=0; d.s3XL=0;
 } else {
 d.oneSize = false;
 }
 // ✅ v16.2: Size Type override (""/shirt/pant) — controls how the website
 // labels this product's sizes regardless of category auto-detect.
 d.sizeType = $('f-sizetype') ? ($('f-sizetype').value || '') : '';
 // ✅ v16.3: Accessory flag — product goes to the Men's Accessories showcase.
 d.accessory = ($('f-accessory') && $('f-accessory').checked) ? 'Yes' : 'No';
 const btn = $('save-product'); btn.disabled = true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 // ✅ INSTANT UI SERVER: Close modal and update UI immediately (Zero latency)
 YARZ.closeModal();
 state.data.inventory.unshift({
 name: d.name, img1: d.img1, img2: d.img2, img3: d.img3,
 img4: d.img4, img5: d.img5, img6: d.img6, video: d.vid,
 cost: d.cost, regular: d.reg, sale: d.sale, discPct: d.discPct,
 status: d.status, category: d.cat, fabric: d.fab, badge: d.bad,
 stkS: d.sS, stkM: d.sM, stkL: d.sL, stkXL: d.sXL, stkXXL: d.sXXL, stk3XL: d.s3XL,
 soldS: 0, soldM: 0, soldL: 0, soldXL: 0, soldXXL: 0, sold3XL: 0,
 deliveryDhaka: d.din, deliveryOutside: d.dout,
 couponActive: d.cAct, couponCode: d.cCode, couponDisc: d.cDisc,
 hiddenSizes: d.oneSize ? '__ONESIZE__' : '',
 sizeType: d.sizeType || '',
 accessory: d.accessory || 'No'
 });
 YARZ.render();
 toast('Saving (Background)...', 'info');
 
 // Background Server Sync - Resolving images happens silently
 resolveImageLinks(d).then(() => {
 return appsPost('saveProductFromForm', d);
 }).then(res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 // ✅ v11.2: Sync local state with verified S/3XL values from GAS
 if(res && res.verify){
  const np = state.data.inventory.find(x=>x.name===d.name);
  if(np){
  const v = res.verify;
  if(typeof v.S === 'number') np.stkS = v.S;
  if(typeof v.M === 'number') np.stkM = v.M;
  if(typeof v.L === 'number') np.stkL = v.L;
  if(typeof v.XL === 'number') np.stkXL = v.XL;
  if(typeof v.XXL === 'number') np.stkXXL = v.XXL;
  if(typeof v['3XL'] === 'number') np.stk3XL = v['3XL'];
  }
   toast(`✅ Saved → S:${res.verify.S} M:${res.verify.M} L:${res.verify.L} XL:${res.verify.XL} XXL:${res.verify.XXL} 3XL:${res.verify['3XL']}`, 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } else {
  toast('Product saved!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  }
  loadInventory();
  }).catch(e => toast('Background Save Error: ' + e.message, 'error'));

 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-floppy-disk"></i> Save'; }
};

YARZ._saveEditProduct = async function(){
 const origName = $('f-origname').value;
 const name = $('f-name').value.trim();
 if(!name){ toast('Name required','error'); return; }
 const d = {
 origName, name,
 cat: readComboValue('f-cat'),
 fab: readComboValue('f-fab'),
 bad: readComboValue('f-bad'),
 status:$('f-status').value, dt:$('f-dt').value, ddays:$('f-ddays').value,
 img1:$('f-img1').value.trim(), img2:$('f-img2').value.trim(), img3:$('f-img3').value.trim(),
 img4:$('f-img4')?$('f-img4').value.trim():'', img5:$('f-img5')?$('f-img5').value.trim():'', img6:$('f-img6')?$('f-img6').value.trim():'',
 cAct:$('f-cAct')?$('f-cAct').value:'No', cCode:$('f-cCode')?$('f-cCode').value.trim():'', cDisc:$('f-cDisc')?num($('f-cDisc').value):0,
 vid:$('f-vid').value.trim(), desc:$('f-desc').value, sc:$('f-sc').value,
 cost:num($('f-cost').value), reg:num($('f-reg').value), sale:num($('f-sale').value),
 discPct:num($('f-disc').value),
 din:num($('f-din').value)||60, dout:num($('f-dout').value)||120,
 sS:int($('f-sS')?$('f-sS').value:0), sM:int($('f-sM').value), sL:int($('f-sL').value),
 sXL:int($('f-sXL').value), sXXL:int($('f-sXXL').value), s3XL:int($('f-s3XL')?$('f-s3XL').value:0)
 };
 // ✅ v16.1 ONE-SIZE: mirror the add-form logic. Toggle on → qty into M slot,
 // others zeroed, oneSize:true (GAS writes the "__ONESIZE__" sentinel). Toggle
 // off → oneSize:false (GAS clears the sentinel if it was set).
 const _oneSizeEdit = $('f-onesize') && $('f-onesize').checked;
 if(_oneSizeEdit){
 const _q = $('f-onesize-qty') ? int($('f-onesize-qty').value) : 0;
 d.oneSize = true;
 d.sS=0; d.sM=_q; d.sL=0; d.sXL=0; d.sXXL=0; d.s3XL=0;
 } else {
 d.oneSize = false;
 }
 // ✅ v16.2: Size Type override (""/shirt/pant).
 d.sizeType = $('f-sizetype') ? ($('f-sizetype').value || '') : '';
 // ✅ v16.3: Accessory flag.
 d.accessory = ($('f-accessory') && $('f-accessory').checked) ? 'Yes' : 'No';
 const btn = $('save-edit'); btn.disabled = true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 // ✅ INSTANT UI SERVER: Update state instantly (Zero latency)
 YARZ.closeModal();
 const p = state.data.inventory.find(x => x.name === d.origName);
 if(p) {
 p.name = d.name; p.category = d.cat; p.fabric = d.fab; p.status = d.status; p.badge = d.bad;
 p.img1 = d.img1; p.img2 = d.img2; p.img3 = d.img3; p.img4 = d.img4; p.img5 = d.img5; p.img6 = d.img6; p.video = d.vid;
 p.cost = d.cost; p.regular = d.reg; p.sale = d.sale; p.discPct = d.discPct;
 p.stkS = d.sS; p.stkM = d.sM; p.stkL = d.sL; p.stkXL = d.sXL; p.stkXXL = d.sXXL; p.stk3XL = d.s3XL;
 p.deliveryDhaka = d.din; p.deliveryOutside = d.dout;
 p.couponActive = d.cAct; p.couponCode = d.cCode; p.couponDisc = d.cDisc;
 // ✅ v16.1 ONE-SIZE: reflect the sizeless flag in memory so the inventory
 // list + a re-open of the edit modal show the correct state immediately.
 p.hiddenSizes = d.oneSize ? '__ONESIZE__' : (String(p.hiddenSizes||'').trim().toUpperCase()==='__ONESIZE__' ? '' : (p.hiddenSizes||''));
 p.sizeType = d.sizeType || '';
 p.accessory = d.accessory || 'No';
 }
 YARZ.render();
 toast('Updating (Background)...', 'info');

 // Background Server Sync - Resolving images happens silently
 resolveImageLinks(d).then(() => {
 return appsPost('saveProductEditFromForm', d);
 }).then(res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
 // ✅ v11.2: Sync local state with verified S/3XL values from GAS
 if(res && res.verify){
  const ep = state.data.inventory.find(x=>x.name===d.name);
  if(ep){
  const v = res.verify;
  if(typeof v.S === 'number') ep.stkS = v.S;
  if(typeof v.M === 'number') ep.stkM = v.M;
  if(typeof v.L === 'number') ep.stkL = v.L;
  if(typeof v.XL === 'number') ep.stkXL = v.XL;
  if(typeof v.XXL === 'number') ep.stkXXL = v.XXL;
  if(typeof v['3XL'] === 'number') ep.stk3XL = v['3XL'];
  }
   toast(`✅ Updated → S:${res.verify.S} M:${res.verify.M} L:${res.verify.L} XL:${res.verify.XL} XXL:${res.verify.XXL} 3XL:${res.verify['3XL']}`, 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  } else {
  toast('Updated!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  }
  loadInventory();
  }).catch(e => toast('Background Update Error: ' + e.message, 'error'));

 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-floppy-disk"></i> Update'; }
};

YARZ._saveSale = async function(){
 const product = $('se-product').value;
 if(!product){ toast('Select product','error'); return; }
 const size = $('se-size').value;
 const qty = int($('se-qty').value)||1;
 const pData = state.data.inventory.find(x=>x.name === product);
 if(pData) {
 // ✅ v16.1 ONE-SIZE: "ONE" stock lives in the M slot — normalize for the
 // oversell check + optimistic update so the guard isn't bypassed (NaN).
 const _sk = (String(size).toUpperCase()==='ONE') ? 'M' : size;
 const left = pData['stk'+_sk] - pData['sold'+_sk];
 if(left < qty) {
 if(left <= 0) { toast(`Out of stock! (${size} Size end)`, 'error'); return; }
 else if(!confirm(`Warning: Stock just ${left} pcs ! You ${qty} pcs to want?`)) return;
 }
 }
 const btn = $('save-sale'); btn.disabled = true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 // ✅ INSTANT UI SERVER
 YARZ.closeModal();
 if(pData) { const _sk2 = (String(size).toUpperCase()==='ONE') ? 'M' : size; pData['sold'+_sk2] += qty; } // Optimistic stock update
 YARZ.render();
 toast('Saving sale (Background)...', 'info');

 appsPost('recordSale', { product, size, qty }).then(async res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('Sale recorded!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  await loadInventory();
  await loadTransactions();
  YARZ.render();
  }).catch(e => toast('Sale Sync Error: ' + e.message, 'error'));

 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Confirm Sale'; }
};

YARZ._showProductPreview = function(prefix){
 // Generic: works for both 'o' (order) and 'rt' (return) prefixes
 const pfx = prefix || 'o';
 const sel = $(pfx+'-product');
 const preview = $(pfx+'-product-preview');
 if(!preview || !sel) return;
 const pName = sel.value;
 if(!pName){ preview.style.display='none'; return; }
 const p = state.data.inventory.find(x=>x.name===pName);
 if(!p){ preview.style.display='none'; return; }
 preview.style.display='block';
 const imgEl = $(pfx+'-prod-img');
 const imgSrc = p.img1 ? getImgSrc(p.img1) : '';
 if(imgSrc){
 imgEl.style.backgroundImage = `url('${imgSrc}')`;
 imgEl.innerHTML = '';
 } else {
 imgEl.style.backgroundImage = '';
 imgEl.innerHTML = '<i class="ri-shopping-bag-3-line"></i>';
 }
 $(pfx+'-prod-name').textContent = p.name;
 $(pfx+'-prod-cat').textContent = (p.category||'') + (p.fabric?' · '+p.fabric:'') + (p.badge?' · '+p.badge:'');
 $(pfx+'-prod-price').textContent = fmtBDT(p.sale) + (p.regular>p.sale ? ' (MRP: '+fmtBDT(p.regular)+')' : '');
 // ✅ v16.1 ONE-SIZE: if the picked product is sizeless, collapse the size
 // dropdown to a single "One Size" option (value "ONE", maps to the M slot
 // server-side) and show one stock chip. Otherwise restore the 6-size list.
 const _isOne = String(p.hiddenSizes||'').trim().toUpperCase() === '__ONESIZE__';
 const sizeSel = $(pfx+'-size');
 if(sizeSel){
 if(_isOne){
  sizeSel.innerHTML = '<option value="ONE">One Size</option>';
 } else if(sizeSel.options.length !== 6 || sizeSel.options[0].value === 'ONE'){
  // Rebuild the standard 6-size list (only if it was previously collapsed)
  sizeSel.innerHTML = ['S','M','L','XL','XXL','3XL'].map(function(s){return '<option>'+s+'</option>';}).join('');
 }
 }
 if(_isOne){
 var oneLeft = Math.max(0, (p.stkM||0) - (p.soldM||0));
 $(pfx+'-prod-stock').innerHTML = '<span class="chip '+(oneLeft>0?'chip-green':'chip-red')+'" style="font-size:10px">One Size: '+toBn(oneLeft)+'</span>';
 } else {
 const sizes = [['S',p.stkS-p.soldS],['M',p.stkM-p.soldM],['L',p.stkL-p.soldL],['XL',p.stkXL-p.soldXL],['XXL',p.stkXXL-p.soldXXL],['3XL',p.stk3XL-p.sold3XL]];
 $(pfx+'-prod-stock').innerHTML = sizes.map(([sz,qty])=>`<span class="chip ${qty>0?'chip-green':'chip-red'}" style="font-size:10px">${sz}: ${toBn(Math.max(0,qty))}</span>`).join('');
 }
 if(typeof YARZ._updateStkBadge==='function') { try{ YARZ._updateStkBadge(pfx); }catch(e){} }
};

YARZ._calcOrder = function(){
 const sel = $('o-product'); const opt = sel.options[sel.selectedIndex];
 if(!opt || !opt.value){ $('o-sub').textContent='0'; $('o-del').textContent='0'; $('o-tot').textContent='0'; return; }
 const price = num(opt.dataset.sale);
 const qty = int($('o-qty').value)||1;
 const loc = $('o-loc').value;
 const del = loc==='Dhaka' ? num(opt.dataset.din) : num(opt.dataset.dout);
 const sub = price*qty;
 $('o-sub').textContent = fmtBDT(sub);
 $('o-del').textContent = fmtBDT(del);
 $('o-tot').textContent = fmtBDT(sub+del);
};

YARZ._saveOrder = async function(){
 const oid = $('o-oid').value.trim();
 const cust = $('o-name').value.trim();
 const ph = $('o-phone').value.trim();
 const addr = $('o-addr').value.trim();
 const prod = $('o-product').value;
 if(!oid||!cust||!ph||!addr||!prod){ toast('Fill all fields','error'); return; }
 const opt = $('o-product').options[$('o-product').selectedIndex];
 const price = num(opt.dataset.sale);
 const loc = $('o-loc').value;
 const dlv = loc==='Dhaka' ? num(opt.dataset.din) : num(opt.dataset.dout);
 // Fix: Apps Script saveOrderFromForm expects {cust, ph, addr, loc, prod, sz, qty, price, dlv, pay, notes}
 const d = {
 oid, cust, ph, addr, loc, prod,
 sz:$('o-size').value, qty:int($('o-qty').value)||1,
 price, dlv,
 pay:$('o-pay').value, courier:$('o-courier').value, tracking:$('o-tracking')?$('o-tracking').value:'', source:$('o-source')?$('o-source').value:'Manual', notes:$('o-notes').value,
 status: $('o-status') ? $('o-status').value : 'Pending'
 };
 const pData = state.data.inventory.find(x=>x.name === prod);
 if(pData) {
 // ✅ v16.1 ONE-SIZE: normalize "ONE" → M slot for the oversell guard.
 const _osk = (String(d.sz).toUpperCase()==='ONE') ? 'M' : d.sz;
 const left = pData['stk'+_osk] - pData['sold'+_osk];
 if(left < d.qty) {
 if(left <= 0) { toast(`Out of stock! (${d.sz} Size end)`, 'error'); return; }
 else if(!confirm(`Warning: Stock just ${left} pcs ! You ${d.qty} pcs Orders to take want?`)) return;
 }
 }
 const btn = $('save-order'); btn.disabled = true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 // ✅ INSTANT UI SERVER
 YARZ.closeModal();
 if(pData) { const _osk2 = (String(d.sz).toUpperCase()==='ONE') ? 'M' : d.sz; pData['sold'+_osk2] += d.qty; } // Optimistic stock decrease
 
 // Optimistic Order Injection
 if (!state.data.orders) state.data.orders = [];
 state.data.orders.unshift({
 id: d.oid, date: new Date().toISOString(), customer: d.cust, phone: d.ph,
 amount: (d.price * d.qty) + d.dlv, status: d.status,
 items: [{name: d.prod, size: d.sz, qty: d.qty, price: d.price}]
 });
 YARZ.render();
 toast('Saving order (Background)...', 'info');

 appsPost('saveOrderFromForm', d).then(async res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('Order Saved!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  await loadOrders();
  await loadInventory();
  YARZ.render();
  }).catch(e => toast('Order Sync Error: ' + e.message, 'error'));

 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Order saved'; }
};

YARZ._saveAd = async function(){
 const spend = num($('ad-amt').value);
 if(!spend){ toast('Amount Required','error'); return; }
 // Fix: Apps Script saveAdFromForm expects {prod, spend, reach, imp, cl, nt}
 const d = { prod:$('ad-p').value, spend, reach:0, imp:0, cl:0, nt:$('ad-notes').value };
 const btn = $('save-ad'); btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 YARZ.closeModal();
 toast('Ad Saving (Background)...', 'info');
 appsPost('saveAdFromForm', d).then(async res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('Ad Saved!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  await loadAdTracker();
  YARZ.render();
  }).catch(e => toast('Ad Sync Error', 'error'));
 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Save'; }
};

YARZ._saveExp = async function(){
 const amt = num($('ex-amt').value);
 if(!amt){ toast('Amount Required','error'); return; }
 const d = { cat:$('ex-cat').value, amt, desc:$('ex-desc').value, nt:$('ex-paid').value };
 const btn = $('save-exp'); btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 YARZ.closeModal();
 toast('Expense Saving (Background)...', 'info');
 appsPost('saveExpenseFromForm', d).then(async res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('Expense Saved!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  await loadExpenses();
  YARZ.render();
  }).catch(e => toast('Expense Sync Error', 'error'));
 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-check"></i> Save'; }
};

YARZ._saveRet = async function(){
 const d = { prod:$('rt-product').value, sz:$('rt-size').value, qty:parseInt($('rt-q').value)||1, nt:$('rt-r').value, delLoss:parseFloat($('rt-dlv-loss')?.value)||0 };
 const btn = $('save-ret'); btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
 try {
 YARZ.closeModal();
 toast('Return Saving (Background)...', 'info');
 appsPost('saveReturnFromForm', d).then(async res => {
 if(res && res.ok===false) throw new Error(res.msg||'Failed');
  toast('Return Saved!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  await loadInventory();
  await loadTransactions();
  YARZ.render();
  }).catch(e => toast('Return Sync Error', 'error'));
 } catch(e){ toast(e.message,'error'); btn.disabled=false; btn.innerHTML='<i class="fas fa-rotate-left"></i> Return'; }
};

// ============ CUSTOM UI MODULE ============
YARZ.ui = {
 confirmDeleteSection(element) {
 $('ui-confirm-modal').style.display = 'flex';
 this._deleteTarget = element;
 },
 executeDelete() {
 if(this._deleteTarget) {
 this._deleteTarget.remove();
 this._deleteTarget = null;
 }
 this.closeConfirm();
 },
 closeConfirm() {
 $('ui-confirm-modal').style.display = 'none';
 this._deleteTarget = null;
 },

 showGuide(tabName) {
 const data = {
 'general': {
  icon: 'ri-settings-4-line', color: 'var(--brand)', title: 'General Setup - Guidelines',
  body: `<b>1. Maywhich (Store Maintenance):</b><br>
 You no/not new any Theme Update , or Stock , or Orders Off to keep will want, optionitems । items if present general/normal Customer can no/not, its/their items "Under Maintenance" page will get। however You Dashboard login  to you can।<br><br>

<b>2. B2B / Wholesale Mode:</b><br>
You if wholesale business and want no/not general/normal no/not Product , then items । items if done Product visible which but high will remain। onlyjust registered or login only wholesalers and Orders to can। items no/not pricing which secret/hidden to keep ।<br><br>

<b>3. / which (Holiday / Vacation Mode):</b><br>
, , courier Off — All items no/not business Orders Off to keep । Maywhich fear "Under Maintenance" page no/not , optionitems Customer items premium, after "We're On Holiday" page will show — its/their Off and । with WhatsApp or will remain urgent/important for।<br><br>

<b>How to configure:</b><br>
• <b>Holiday Reason</b>: / / All / Stock Check / <b>Personal Reason</b> / Custom — items no/not with goes items । items option for before from items premium or May create , Customer items ।<br>
• <b>Personal Reason (Personal)</b> — if no/not any Reason Off to keep want (e.g.: afteror , or Reason, need), optionitems and below Custom Message yourself write/enter Reason Off। then Customer <i>only no/not textitems</i> — any reset May All no/not। Complete design (low, headline, WhatsApp or, return date) will remain।<br>
• <b>Custom Message (Optional)</b>: if You yourself to say want (e.g. "12–16 October Off"), here write/enter। items May <i>Above</i> will show। only May will show।<br>
• <b>Expected Return Date &amp; Time (Optional)</b>: Days time from again Orders Active will be, items Days (Asia/Dhaka time)। if done Customer on page <i>Live countdown</i> — Days · · · All beautiful will show। countdown "again Active — " will show and items Refresh or All। its/their no/not if given countdown will remain — only overlay will show।<br><br>

<b>Important Note:</b><br>
• Maywhich and — with if present <b>Maywhich priority will get</b>। Reason Maywhich items which , and/more items business announcement।<br>
• if present Customer Check can no/not, cart use to can no/not — entire items items page announcement happens which। however Customer in cart which All preserved will remain — items end auto- will be।<br>
• items end must items to wrong/incorrect no/not। system its/their goes yourself from happens no/not (items intentional design — which wrong/incorrect its/their Reason time Active no/not happens)।<br><br>

<b>4. (Currency) (Language):</b><br>
no/not  will be (e.g.: or BDT) here write/enter। alongside items or will remain no/not , or । "Bilingual (Toggle)" select if done Customer May from yourself as preferred to take can, which user many or ।<br><br>

<b>5. lowor whichno/notMay (Global Announcement):</b><br>
 Above items or whichno/not remains, which All page from visible which। items lowor whichno/notMay । here You various offer to keep । e.g.: "🔥 free Home Delivery 2000 taka more Orders !"। whichno/not which color select which no/not Theme with no/not and fast/quickly । text color usually white or black Features ।<br><br>

<b>6. popup (Promotional Popup):</b><br>
 any if done screen items offer whichno/not popup । items or (Impulse Buying) or । here items Image (e.g.: "Welcome Offer - 10% Discount")। and "Target Link" discount which link । Customer popup click if done directly offer's on page which। items conversion rate or ।`
 },
 'banners': {
  icon: 'ri-image-line', color: 'var(--info)', title: 'Banners & Flash - Guidelines',
  body: `<b>1. which timer (Flash Sale Timer):</b><br>
which low items limited time offer which Customer "Fear of Missing Out (FOMO)" or fear create । You items specific its/their time select , Website in header below items countdown timer start happens which (e.g.: 02 Days 14 Hours 30 Minutes)। with items attractive title Days e.g. "Stock end before !"। items Customer fast/quickly Orders to or ।<br><br>

<b>2. slider whichno/not (Hero Slider Banners):</b><br>
Website Homeon page after All whichno/notitems slide remains, items whichno/not। items Website impression 3 whichno/not on । here maximum 5items whichno/not to give you can। whichno/notitems must high-items and 16:9 ratio (e.g.: 1920x1080 Pixel) will be। general/normal Image You if you want MP4 Video link to give । Video whichno/not Customer attention more which ।<br><br>

<b>3. whichno/not text (Overlay Text):</b><br>
Image Above if any visible want, items here । however whichno/not May inside itself if beautiful design remains, then items good।<br><br>

<b>4. link (Banner Target Link):</b><br>
only whichno/not visible will be no/not, Customer so that whichno/not click directly Product to buy that to will be। , whichno/notitems "Winter Collection" । then no/not Website which the link Copy here paste । link time entire URL no/not with only <code>/category/winter</code> if given Website fast/quickly load happens।`
 },
 'builder': {
  icon: 'ri-layout-masonry-line', color: 'var(--teal)', title: 'Homepage Builder - Guidelines',
  body: `<b>1. no/not section (Dynamic Sections):</b><br>
items -less Website Homepage beautiful remains, Customer more time and more Product buys। with You no/not Website Homepage yourself as desired 50items Lock you can। any code without You which-- section create to you can।<br><br>

<b>2. section title (Section Title):</b><br>
items section Above remains items here Days। e.g.: "New Arrivals", "Best Sellers", or "Top Gadgets"। attractive title use which Customer Productitems happens।<br><br>

<b>3. which link (Category Linking):</b><br>
items All option। section You Productitems visible want to will be। You Inventory Product load time which or which use , items from Select। system automatic which New Productitems section All।<br><br>

<b>4. whichno/not May link (Optional):</b><br>
Product start before You if you want section for items whichno/not Image to give । items sectionitems and/more attractive । without "Target Link" click if done Customer entire which on page which, which Allitems Product with will get।`
 },
 'product': {
  icon: 'ri-shopping-bag-3-line', color: 'var(--purple)', title: 'Product Page - Guidelines',
  body: `<b>1. (AJAX Quick View):</b><br>
Customer Product remains, oror on page its/their no/not May । items if done Product on click just items beautiful popup Product Image, and in cart or All। page load without Customer Product to buy can।<br><br>

<b>2. Stock and/more or (Stock Urgency Bar):</b><br>
All which from Customer fast/quickly Orders items items ! items if done Product on page items or will show and will remain "Hurry up! Only 5 items left in stock"। items Customer urgency items (Scarcity Marketing), as a result fast/quickly Check goes।<br><br>

<b>3. fake (Image Hover Effect):</b><br>
 from which no/not Website , its/their Product Image on will be from । 'Zoom In' if given Imageitems happens Product will show। and/more 'Swap to 2nd Image' if given automatic Product Imageitems will show, which or which May in case of good ।<br><br>

<b>4. maximum Orders limit (Max Order Quantity):</b><br>
any Customer which wrong/incorrect or intentional or 100-200 pcs Orders fake Orders items no/not , for items limit Days। e.g.: "5" if given Customer or 5items more pcs in cart to can no/not।<br><br>

<b>5. Delivery May (Expected Delivery):</b><br>
Customer Product prefer after All more items low " Delivery ?"। Product on page if remains "Expected Delivery: Inside Dhaka 2 Days, Outside 3 Days", then Customer and/more any remains no/not and conversion rate goes।`
 },
 'checkout': {
  icon: 'ri-shopping-cart-2-line', color: 'var(--accent)', title: 'Cart & Checkout - Guidelines',
  body: `<b>1. cart (Slide-out Cart Drawer):</b><br>
Customer "Add to Cart" click , directly cart on page and/more Product no/not। but cart Product in cart after screen from beautiful items slider happens comes। Customer if you want items low and/more no/not , which no/not Orders which (AOV) or ।<br><br>

<b>2. Check (Checkout Mode):</b><br>
"Direct Website Checkout" select if done Customer Website inside itself no/not, Phone number, Address with Orders submit । and/more if "WhatsApp Order Redirect" select , however in cart Product automatic May Customer which which and from no/not with Orders confirm । new business in case of which Orders Customer or increases।<br><br>

<b>3. Orders Note Custom field:</b><br>
Customer if special any request (e.g.: ", Productitems beautiful which with, items ") to , however Order Notes keep। and/more You if Customer from to take want (e.g.: no/not or BIN number), then Custom Field use ।<br><br>

<b>4. free or (Free Shipping Target):</b><br>
items or । You if here "2000" give, however Customer 500 taka Product in cart will show "Add 1500 more to get FREE SHIPPING!"। free Delivery Customer and/more Product in cart ।`
 },
 'marketing': {
  icon: 'ri-megaphone-line', color: 'var(--danger)', title: 'Marketing - Guidelines',
  body: `<b>1. - popup (Exit-Intent Popup):</b><br>
no/not Website any Product no/not None Website from happens which for items Above (Close or or which ) which, screen items popup All। will remain "Wait! Don't go! Here is a 10% special discount for you."। featureitems use many Customer no/not ।<br><br>

<b>2. whichitems points (Loyalty Points System):</b><br>
no/not Customer so that oror no/not Website from no/not , for systemitems general/normal । Customer 100 taka no/not if done points Days, which with after no/not discount will get। Return Customer (Returning Customer) gets and Customer which (CAC) many May goes।<br><br>

<b>3. which (Secure Trust Badges):</b><br>
new Website Customer May to or which taka to give fear gets। Check page and Product on page if "100% Secure Checkout", "SSL Secured", or "Verified Merchant" whichitems show happens, however Customer or many goes and fake Orders May genuine Orders comes।<br><br>

<b>4. whichor cart May (Abandon Cart Recovery):</b><br>
many Customer Product in cart but May no/not or Orders confirm no/not happens goes। items urgent/important। here You items May template , e.g.: "Hello! You Website Product in cart । no/not for Ordersitems confirm ?"। after You Dashboard from just click Mayitems Customer which you can।`
 },
 'branding': {
  icon: 'ri-paint-brush-line', color: 'var(--ink-1)', title: 'Branding, SEO & Ads Tracking - Guidelines',
  body: `<b>All which from high-items no/not and less -- Guidelines:</b><br><br>

<b>1. Pixel (Pixel) and ?</b><br>
You All which give, All many no/not Website visible। but All Product buys no/not। Pixel low items which code or ID, which All  items no/not Website , Product in cart , and Orders confirm । All its/their AI (AI) system and/more smart and after whichitems onlyjust that visible which Product no/not no/not All more। Pixel without which means , no/not taka will be but All no/not।<br><br>

<b>2. Pixel (Pixel ID) ?</b><br>
• <b>Facebook Pixel:</b> no/not Facebook Business Manager Sign In। <code>Events Manager</code> > <code>Data Sources</code> which। no/not Website no/notMay items Pixel create । Pixel create if items 15-16 digit number will get (e.g.: 101234567890123), items Copy Facebook Pixel ID in field Days।<br>
• <b>Instagram/TikTok/Snapchat Pixel:</b> TikTok Ads Manager or Snapchat Ads Manager Events option Pixel create its/their ID items Days।<br>
• Pixel Enter/Paste after no/not and/more code will be no/not। system automatic ViewContent, AddToCart, InitiateCheckout and Purchase eventitems All will remain।<br><br>

<b>3. which time :</b><br>
All which time must <code>Traffic</code> or <code>Engagement</code> items <b><code>Sales</code></b> or <b><code>Conversions</code></b> items select । conversion event <code>Purchase</code> select । All no/not Lock low no/not, only or click no/not is not। as a result no/not which (CPA) many May which and fake Orders no/not high-items Orders All।<br><br>

<b>4. Google Analytics 4 (GA4):</b><br>
no/not Website Days , its/their from , or no/not less use , and on page All more time — All no/notitems visible for GA4 use happens। analytics.google.com items "G-XXXXXXX" which Measurement ID items here Days।<br><br>

<b>5. Social Sharing Image (OG Image):</b><br>
no/not Website link May or which , items preview Image visible goes। items Open Graph Image । You which (Canva) with 1200x630 Size beautiful items cover photo or imgur.com load its/their the link here with Days। items no/not which no/not ।<br><br>

<b>6. Google Search Console (GSC):</b><br>
 Google no/not which no/not or Product if given so that no/not Websiteitems on page comes, its/their for Websiteitems Google verify to happens। search.google.com/search-console "HTML Tag" Mayitems Select। from <code>&lt;meta name="google-site-verification" content="xxx..." /&gt;</code> codeitems Copy here Days। after Google easily no/not Website ।`
 }
 };
 
 const d = data[tabName];
 if(!d) return;
 
 $('ui-guide-title').innerHTML = `<i class="${d.icon}" style="color:${d.color}"></i> ${d.title}`;
 $('ui-guide-body').innerHTML = d.body;
 $('ui-guide-modal').style.display = 'flex';
 },
 closeGuide() {
 $('ui-guide-modal').style.display = 'none';
 }
};

// ============ BOOT ============
if (document.readyState === 'loading') {
 document.addEventListener('DOMContentLoaded', setupLogin);
} else {
 setupLogin();
}

// Attach publish action to global window so HTML buttons can call it
window.publishToWebsiteAction = async function() {
 const btn = document.getElementById('publish-btn');
 if (!btn) return;
 const ogHtml = btn.innerHTML;

 // Safety timer — re-enable button no matter what (in case all paths hang)
 const safetyTimer = setTimeout(() => {
 btn.disabled = false;
 btn.innerHTML = ogHtml;
 }, 35000);

 try {
 btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing...';
 btn.disabled = true;
 toast('Publishing to website...', 'info');

 // ─── Path A: Direct Cloudflare purge from browser ───
 // ✅ v15.1: 10s timeout (was 3s — too tight for cross-origin POST + preflight
 // on slow networks). If Worker CORS allows our origin, this is the fastest path.
 let directOk = false;
 let directErrMsg = '';
 // ✅ v15.50 PURGE FIX: Hit BOTH the customer-facing domain AND the
 // workers.dev domain in parallel. Cloudflare's edge cache is per-host:
 // a purge call to workers.dev only deletes that host's cache slots,
 // not yarzclothing.xyz. Without firing both, customers on the custom
 // domain saw stale data until manual "Purge Everything" in dashboard.
 try {
 const ctrl = new AbortController();
 const tid = setTimeout(() => ctrl.abort(), 10000);
 const purgeBody = JSON.stringify({ actions: ['products', 'store_info', 'categories', 'delivery_charges'] });
 const purgeHeaders = { 'X-Purge-Key': 'yarz_xK9mP2nL8vR4qH7', 'Content-Type': 'application/json' };

 // Fire both purge URLs in parallel — first one to succeed wins.
 // Custom domain comes first because that's where customers actually
 // browse, so its cache slot is the critical one to invalidate.
 const purgeUrls = [
  'https://yarzclothing.xyz/__purge',
  'https://yarz.marufhasan80009.workers.dev/__purge'
 ];
 const purgeResults = await Promise.all(purgeUrls.map(function (u) {
  return fetch(u, {
  method: 'POST', headers: purgeHeaders, body: purgeBody, signal: ctrl.signal
  }).then(function (r) { return { url: u, ok: r.ok, status: r.status }; })
  .catch(function (e) { return { url: u, ok: false, err: (e && e.message) || 'fetch failed' }; });
 }));
 clearTimeout(tid);
 const anyOk = purgeResults.some(function (r) { return r.ok; });
 if (anyOk) {
  directOk = true;
 } else {
  // All purge URLs failed — surface the first error
  const firstErr = purgeResults[0] || {};
  directErrMsg = 'Worker responded ' + (firstErr.status || firstErr.err || 'unknown');
 }
 } catch (e) {
 directErrMsg = (e && e.message) || 'fetch failed';
 console.warn('[Publish] Direct path failed, trying Apps Script fallback:', directErrMsg);
 }

 if (directOk) {
 toast('Successfully published to website!', 'success');
 return;
 }

 // ─── Path B: Fallback via Apps Script ───
 // ✅ v15.1: 30s timeout (was 8s — GAS cold starts can take 5–15s, plus the
 // outbound UrlFetchApp call to Cloudflare adds another 0.5–2s). 8s was
 // routinely timing out during cold starts even when the purge succeeded.
 let res;
 try {
 const appsPostPromise = appsPost('publish_to_cloudflare', {});
 const timeoutPromise = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('No response from server (Timeout)')), 30000)
 );
 res = await Promise.race([appsPostPromise, timeoutPromise]);
 } catch (e) {
 // appsPost already throws a descriptive Bengali message — surface it
 throw new Error(e && e.message ? e.message : 'Apps Script call failed');
 }

 // Inspect inner result from _executeCloudflarePurge
  if (res && res.result && res.result.ok === false) {
  console.warn('[Publish] Cloudflare purge failed but data is saved:', res.result);
  toast('Saved! (Cloudflare cache may take ~30s to update.)', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
  return;
  }

  toast('Successfully published to website!', 'success');
  try{ if(window.YARZ_API && YARZ_API.flushAllCaches) YARZ_API.flushAllCaches(); }catch(e){}
 } catch (error) {
 console.error('[Publish] error:', error);
 toast('Failed: ' + (error.message || 'Unknown error'), 'error');
 } finally {
 clearTimeout(safetyTimer);
 btn.disabled = false;
 btn.innerHTML = ogHtml;
 }
};

})();

    // ============ YARZ FIREWALL (Fortress) ============
    YARZ.firewall = {
      _threats: [],
      _devices: [],
      _search: '',
      _autoTimer: null,
      async refresh() {
        try {
          const res = await appsPost('__fortress_lookup', {});
          if (res && res.ok) {
            this._threats = res.threats || [];
            this._devices = res.devices || [];
            this.render();
            this._updateBadge();
          }
        } catch (e) {
          console.error('Firewall refresh failed:', e);
        }
      },
      _updateBadge() {
        const flagged = this._threats.filter(t =>
          /flagged|blocked|burst|shadow/.test(t.eventType || '')).length;
        const el = document.getElementById('nav-firewall-badge');
        if (el) {
          if (flagged > 0) { el.textContent = flagged; el.classList.remove('hidden'); }
          else { el.classList.add('hidden'); }
        }
      },
      render() {
        this._renderThreats();
        this._renderBlocks();
      },
      _renderThreats() {
        const root = document.getElementById('firewall-threats');
        if (!root) return;
        if (!this._threats.length) {
          root.innerHTML = '<div style="padding:18px;text-align:center;color:var(--ink-3);font-size:13px">✅ No threats logged. Your site is calm.</div>';
          return;
        }
        const sorted = this._threats.slice().reverse().slice(0, 30);
        root.innerHTML = sorted.map(t => {
          const evType = t.eventType || 'event';
          let icon = '⚠️', color = 'var(--warn)';
          if (/blocked|shadow/.test(evType)) { icon = '🚫'; color = 'var(--danger)'; }
          else if (/burst/.test(evType))     { icon = '🔥'; color = 'var(--danger)'; }
          else if (/flagged/.test(evType))   { icon = '⚠️'; color = 'var(--warn)'; }
          else if (/block_added|block_removed|clear/.test(evType)) { icon = '🔒'; color = 'var(--info)'; }
          return `
            <div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
              <div style="font-size:18px">${icon}</div>
              <div style="flex:1;min-width:200px">
                <div style="font-size:13px;font-weight:600;color:${color}">${esc(evType.toUpperCase().replace(/_/g, ' '))}</div>
                <div style="font-size:11.5px;color:var(--ink-3);margin-top:2px">
                  📱 <code style="font-size:10.5px">${esc(t.deviceId || '?')}</code>
                  ${t.phoneHash ? '· ☎ <code style="font-size:10.5px">' + esc(t.phoneHash.slice(0,12)) + '…</code>' : ''}
                  ${t.ip ? '· 🌐 ' + esc(t.ip) : ''}
                  ${t.country ? '(' + esc(t.country) + ')' : ''}
                  ${t.riskScore ? '· <b style="color:' + color + '">Risk ' + t.riskScore + '/100</b>' : ''}
                </div>
                <div style="font-size:10.5px;color:var(--ink-3);margin-top:2px">
                  🕒 ${esc(t.ts || '')} · <b>${esc(t.reason || 'n/a')}</b>
                  ${t.orderId ? '· Order <code style="font-size:10.5px">' + esc(t.orderId) + '</code>' : ''}
                </div>
              </div>
              <div>
                <button class="btn btn-red btn-xs" onclick="YARZ.firewall.blockFromThreat('${esc(t.deviceId)}')" title="Block this device"><i class="ri-forbid-line"></i> Block</button>
              </div>
            </div>`;
        }).join('');
      },
      _renderBlocks() {
        const root = document.getElementById('firewall-blocks');
        if (!root) return;
        const term = (this._search || '').toLowerCase();
        const visible = this._devices.filter(d =>
          !term || (d.deviceId || '').toLowerCase().indexOf(term) !== -1
        );
        if (!visible.length) {
          root.innerHTML = '<div style="padding:18px;text-align:center;color:var(--ink-3);font-size:13px">' +
            (term ? 'No blocked devices match "' + esc(term) + '".' : '✅ No blocked devices.') + '</div>';
          return;
        }
        root.innerHTML = visible.map(d => `
          <div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-left:4px solid var(--danger)">
            <div style="font-size:22px">🚫</div>
            <div style="flex:1;min-width:240px">
              <div style="font-size:13px;font-weight:600">📱 <code style="font-size:11.5px">${esc(d.deviceId)}</code></div>
              <div style="font-size:11.5px;color:var(--ink-3);margin-top:3px">
                🕒 Blocked: ${esc(d.blockedAt || '?')}
                · By: <b>${esc(d.blockedBy || 'admin')}</b>
                ${d.expiresAt ? '· Expires: ' + esc(d.expiresAt) : '· <b>Permanent</b>'}
                ${d.orderAttempts ? '· ' + d.orderAttempts + ' attempts' : ''}
              </div>
              ${d.blockReason ? '<div style="font-size:11px;color:var(--ink-3);margin-top:3px">📋 ' + esc(d.blockReason) + '</div>' : ''}
              ${d.adminNotes ? '<div style="font-size:11px;color:var(--info);margin-top:2px">💬 ' + esc(d.adminNotes) + '</div>' : ''}
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-green btn-xs" onclick="YARZ.firewall.unblock('${esc(d.deviceId)}')" title="Remove from blocklist"><i class="ri-lock-unlock-line"></i> Unblock</button>
            </div>
          </div>`).join('');
      },
      filter() {
        this._search = (document.getElementById('firewall-search') || {}).value || '';
        this._renderBlocks();
      },
      async block(deviceId, opts) {
        opts = opts || {};
        try {
          const res = await appsPost('__fortress_block', {
            deviceId: deviceId,
            blockedBy: opts.by || 'admin',
            reason: opts.reason || 'manual',
            blockType: opts.type || 'hard',
            expiresAt: opts.expiresAt || ''
          });
          if (res && res.ok) {
            toast('🚫 Device blocked: ' + deviceId.slice(0, 12) + '…', 'success');
            this.refresh();
            return true;
          }
          toast('Block failed: ' + (res.msg || 'unknown'), 'error');
          return false;
        } catch (e) {
          toast('Block error: ' + e.message, 'error');
          return false;
        }
      },
      async unblock(deviceId) {
        if (!confirm('Unblock this device?\n\n' + deviceId + '\n\nThe device will be able to place orders again.')) return;
        try {
          const res = await appsPost('__fortress_unblock', { deviceId: deviceId });
          if (res && res.ok) {
            toast('✅ Device unblocked', 'success');
            this.refresh();
          } else {
            toast('Unblock failed: ' + (res.msg || 'unknown'), 'error');
          }
        } catch (e) {
          toast('Unblock error: ' + e.message, 'error');
        }
      },
      async blockFromThreat(deviceId) {
        if (!confirm('Block this device permanently?\n\n' + deviceId + '\n\nIt will be added to the shadow-ban list.')) return;
        await this.block(deviceId, { reason: 'threat_log', by: 'admin' });
      },
      async confirmClearAll() {
        if (!confirm('⚠️ Clear ALL blocked devices?\n\nThis archives every entry (sets status=archived). You can still find them in the archive view later.')) return;
        try {
          const res = await appsPost('__fortress_clear_all', {});
          if (res && res.ok) {
            toast('🗑️ Archived ' + (res.archived || 0) + ' blocks', 'success');
            this.refresh();
          } else {
            toast('Clear failed: ' + (res.msg || 'unknown'), 'error');
          }
        } catch (e) {
          toast('Clear error: ' + e.message, 'error');
        }
      },
      startAutoRefresh() {
        if (this._autoTimer) return;
        this._autoTimer = setInterval(() => {
          // Only refresh if Firewall tab is active
          const activePage = document.querySelector('.page.active');
          if (activePage && activePage.dataset.page === 'firewall') {
            this.refresh();
          }
        }, 10000);
      },
    };

    // Auto-init on first nav to firewall
    (function(){
      const origGoPage = YARZ.goPage;
      YARZ.goPage = function(page) {
        origGoPage.call(this, page);
        if (page === 'firewall') {
          YARZ.firewall.refresh();
          YARZ.firewall.startAutoRefresh();
        }
      };
    })();


