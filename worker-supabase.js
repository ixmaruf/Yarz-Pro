/**
 * =====================================================================
 * YARZ Cloudflare Worker — GAS + Supabase dual routing
 * Date: 2026-06-20
 *
 * Replaces the old `cloudflare workers.txt` v17.5.
 * Key changes:
 *   1. SUPABASE_ENABLED env var — kill switch for new path
 *   2. Per-action map (ACTIONS_SUPABASE) — granular control
 *   3. Falls back to GAS if Supabase errors / disabled
 *   4. Cache-Control headers preserved
 *
 * Deployment:
 *   wrangler deploy worker-supabase.js --name yarz-api
 *   wrangler secret put SUPABASE_URL
 *   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 *   wrangler secret put PURGE_SECRET   (already exists)
 *
 * Env vars (use `wrangler secret put NAME`):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   GAS_DEPLOYMENT_ID  (the script.google.com /exec/ path)
 *   PURGE_SECRET
 *   SUPABASE_ENABLED   (default "true" — Supabase is primary path)
 *   ACTIONS_SUPABASE   (JSON string of per-action overrides, optional)
 * =====================================================================
 */

// ----------------------- CONFIG (read from env in fetch handler) -----------------------
// Note: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PURGE_SECRET, TG_BOT_TOKEN, TG_WEBHOOK_SECRET
// are SECRETS (set via `wrangler secret put`). SUPABASE_ENABLED, TG_OWNER_ID, FRESHT_TTL, etc.
// are VARS (set in wrangler.toml [vars]). Both are accessible via the `env` param in fetch.

// ✅ FIX #14: Read TTL values from env (set via wrangler.toml [vars]).
// Falls back to safe defaults if env not provided.
function getTtls(env) {
  const fresh = parseInt(env.FRESHT_TTL || "") || 30 * 60;
  const swr   = parseInt(env.SWR_TTL   || "") || 5  * 60;
  const hard  = parseInt(env.HARD_TTL  || "") || 24 * 60 * 60;
  return { fresh, swr, hard };
}

// Public actions (no admin auth, only API_KEY) -- safe to cache at edge
const PUBLIC_CACHEABLE = new Set([
  "products","product","categories","store_info","delivery_charges","fb_feed","health"
]);

// Public POST actions -- passthrough (rate-limited)
const PUBLIC_POST = new Set([
  "place_order","subscribe_newsletter","subscribenewsletter","capi","fbcapi","ttapi","ttevents"
]);

// Admin actions -- require session token verified upstream
const ADMIN_ACTIONS = new Set([
  "adminlogin","admin_login","adminlogout","admin_logout","verify_auth",
  "saveproductfromform","saveproducteditfromform","updateproductstatus",
  "applystockchange","applybulkedit","recordsale","deleteproduct",
  "saveorderfromform","updatewebsiteorderstatus","updatemanualorderstatus",
  "deletewebsiteorder","deletemanualorder","archivecompletedorders",
  "saveadfromform","saveexpensefromform","savereturnfromform",
  "generatemonthlyreport","generateyearlyreport",
  "updatesettings","updatedeliverycharges","savegithubsettings","githubsyncnow",
  "getcurrentmonthsnapshot","getproductanalytics6m","getcustomerltv","snapshotmonth",
  "fullfactoryreset","clearfinancialsonly","clearinventoryonly",
  "steadfastcreate","steadfastbulk","steadfaststatus","steadfastbalance",
  "steadfastsavekeys","steadfastgetreturn","steadfastlistreturns",
  "steadfastlistpayments","steadfastgetpayment","steadfastlistpolicestations",
  "__fortress_lookup","__fortress_block","__fortress_unblock",
  "__fortress_clear_all","__fortress_log_event",
  "sheet_read","sheet_read_formatted",
  "migrate","diagnoses3xl","repairwebsiteordersstatus","repaircouponactivevalidation",
  "publish_to_cloudflare",
  "changeadminpassword","changeadminusername",
  "setadminpin","verifyadminpin","hasadminpin","changeadminpin"
]);

// ----------------------- SUPABASE ACTION MAP -----------------------
// Maps a GAS action (lowercase) to a Supabase REST query.
// Each entry can return either:
//   { kind: "view",   view: "view_name" }              -> SELECT * from view
//   { kind: "table",  table: "tbl", order: "col", filter: "?col=eq.val" }
//   { kind: "rpc",    fn: "function_name", args: {...} } -> call RPC
//   { kind: "passthrough" } -> always go to GAS
//
// Actions missing here always go to GAS (safe default).
const ACTIONS_SUPABASE = {
  // ---- Public reads (cached at edge) ----
  products:           { kind: "view", view: "website_sync_view" },
  product:            { kind: "table", table: "inventory", filter: "?product=eq.{name}", single: true },
  categories:         { kind: "passthrough" }, // uses SETTINGS in GAS
  store_info:         { kind: "passthrough" }, // aggregate over settings+delivery
  delivery_charges:   { kind: "table", table: "delivery_charges", filter: "?active=eq.true&order=sort_order" },
  fb_feed:            { kind: "passthrough" }, // CSV generation needs GAS logic
  health:             { kind: "passthrough" },

  // ---- Public reads (NOT cached -- PII) ----
  orders_by_phone:    { kind: "table", table: "website_orders", filter: "?cust_phone=eq.{phone}", order: "created_at.desc" },

  // ---- Public POSTs (not cached) ----
  place_order:        { kind: "passthrough" }, // complex, keep in GAS for now
  subscribe_newsletter: { kind: "table", table: "newsletter_subscribers", op: "insert" },
  subscribenewsletter:  { kind: "table", table: "newsletter_subscribers", op: "insert" },
  capi:               { kind: "passthrough" },
  ttapi:              { kind: "passthrough" },

  // ---- Admin reads ----
  sheet_read:         { kind: "table_or_view" }, // dynamic based on range
  sheet_read_formatted:{ kind: "passthrough" },
  verify_auth:        { kind: "passthrough" },

  // ---- Admin writes (most can be done via Supabase; some need GAS logic) ----
  saveproductfromform:    { kind: "table", table: "inventory", op: "insert" },
  saveproducteditfromform:{ kind: "table", table: "inventory", op: "update", key: "product" },
  updateproductstatus:    { kind: "table", table: "inventory", op: "update", key: "product" },
  applystockchange:       { kind: "rpc", fn: "atomic_adjust_stock", args: {
                                     p_product: "$product", p_size: "$size",
                                     p_delta: "$delta", p_kind: "$kind" } },
  applybulkedit:          { kind: "passthrough" },
  recordsale:             { kind: "passthrough" },
  deleteproduct:          { kind: "table", table: "inventory", op: "delete", key: "product" },

  saveorderfromform:      { kind: "rpc", fn: "create_manual_order", args: {
                                     p_order_id: "$order_id", p_cust_name: "$cust_name",
                                     p_cust_phone: "$cust_phone", p_cust_addr: "$cust_addr",
                                     p_deliv_dist: "$deliv_dist", p_deliv_zone: "$deliv_zone",
                                     p_product: "$product", p_size: "$size",
                                     p_qty: "$qty", p_price: "$price",
                                     p_delivery_charge: "$delivery_charge",
                                     p_total: "$total", p_payment: "$payment",
                                     p_status: "$status", p_courier: "$courier",
                                     p_notes: "$notes" } },
  updatewebsiteorderstatus:{ kind: "table", table: "website_orders", op: "update", key: "order_id" },
  updatemanualorderstatus:{ kind: "table", table: "orders", op: "update", key: "order_id" },
  deletewebsiteorder:     { kind: "rpc", fn: "delete_website_order", args: { p_order_id: "$orderId" } },
  deletemanualorder:       { kind: "table", table: "orders", op: "delete", key: "order_id" },
  archivecompletedorders:  { kind: "passthrough" },

  saveadfromform:      { kind: "table", table: "ad_tracker", op: "insert" },
  saveexpensefromform: { kind: "table", table: "expenses", op: "insert" },
  savereturnfromform:  { kind: "passthrough" },

  updatesettings:        { kind: "table", table: "settings", op: "upsert" },
  updatedeliverycharges: { kind: "table", table: "delivery_charges", op: "upsert" },
  savegithubsettings:    { kind: "table", table: "settings", op: "upsert" },
  githubsyncnow:         { kind: "passthrough" },

  // ---- Analytics (compute in DB is more efficient) ----
  generatemonthlyreport:   { kind: "rpc", fn: "generate_monthly_report", args: {
                                     p_year: "$year", p_month: "$month" } },
  generateyearlyreport:   { kind: "rpc", fn: "generate_yearly_report", args: { p_year: "$year" } },
  getcurrentmonthsnapshot: { kind: "passthrough" },
  getproductanalytics6m:   { kind: "passthrough" },
  getcustomerltv:          { kind: "view", view: "customer_ltv_view" },
  snapshotmonth:           { kind: "passthrough" },

  // ---- Cleanup (DANGER; double-auth via upstream + here we still verify session) ----
  fullfactoryreset:    { kind: "passthrough" },
  clearfinancialsonly: { kind: "passthrough" },
  clearinventoryonly:  { kind: "passthrough" },

  // ---- Courier (external HTTP — keep in GAS until Edge Function migrated) ----
  steadfastcreate:  { kind: "passthrough" },
  steadfastbulk:    { kind: "passthrough" },
  steadfaststatus:  { kind: "passthrough" },
  steadfastbalance: { kind: "passthrough" },
  steadfastsavekeys:{ kind: "passthrough" },

  // ---- Fortress (anti-fraud) — custom handlers in fetch() ----
  __fortress_save_fingerprint: { kind: "custom" },
  __fortress_public_blocklist: { kind: "custom" },
  __fortress_lookup:           { kind: "custom" },
  __fortress_block:            { kind: "custom" },
  __fortress_unblock:          { kind: "custom" },
  __fortress_clear_all:        { kind: "custom" },
  __fortress_log_event:        { kind: "custom" },

  // ---- Admin self-service (credential change) ----
  // ✅ v11.4: routed via Supabase RPCs. Worker is a passthrough shim that
  // forwards the POST body to the change_admin_password / change_admin_username
  // functions defined in supabase/rpc.sql. Body must include sessionToken,
  // currentPassword, newPassword (and newUsername for the username RPC).
  changeadminpassword: { kind: "rpc", fn: "change_admin_password", args: {
                                p_token: "$sessionToken",
                                p_current_password: "$currentPassword",
                                p_new_password: "$newPassword" } },
  changeadminusername: { kind: "rpc", fn: "change_admin_username", args: {
                                p_token: "$sessionToken",
                                p_new_username: "$newUsername" } },

  // ---- Admin PIN protection ----
  // v11.5: routes for setting, verifying, checking, and changing the admin PIN.
  // Body must include sessionToken and pin (and oldPin/newPin for change).
  setadminpin: { kind: "rpc", fn: "set_admin_pin", args: {
                         p_token: "$sessionToken",
                         p_pin: "$pin" } },
  verifyadminpin: { kind: "rpc", fn: "verify_admin_pin", args: {
                            p_token: "$sessionToken",
                            p_pin: "$pin" } },
  hasadminpin: { kind: "rpc", fn: "has_admin_pin", args: {
                         p_token: "$sessionToken" } },
  changeadminpin: { kind: "rpc", fn: "change_admin_pin", args: {
                            p_token: "$sessionToken",
                            p_old_pin: "$oldPin",
                            p_new_pin: "$newPin" } }
};
// ----------------------- HELPERS -----------------------
function safeUrl(u) {
  if (typeof u !== "string" || u.length === 0) return "";
  const t = u.trim();
  if (/^data:image\/(png|jpe?g|webp|gif|avif|svg\+xml);/i.test(t)) return t;
  if (/^data:/i.test(t)) return "";
  if (/^(javascript|vbscript|file|blob|about):/i.test(t)) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("/") || t.startsWith("./") || t.startsWith("../")) return t;
  return "";
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Purge-Key",
    "Access-Control-Max-Age": "86400"
  };
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(corsHeaders(), {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    })
  });
}

async function supabaseRequest(env, path, init) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured (URL or service_role key missing)");
  const fullUrl = url.replace(/\/+$/, "") + "/rest/v1/" + path;
  // Deep-merge headers so caller's headers (e.g. Prefer) don't clobber apikey/Auth
  const defaultHeaders = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json"
  };
  const mergedHeaders = Object.assign({}, defaultHeaders, (init && init.headers) || {});
  const mergedInit = Object.assign({}, init || {}, { headers: mergedHeaders });
  const res = await fetch(fullUrl, mergedInit);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Supabase " + res.status + ": " + txt.substring(0, 300));
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) return await res.json();
  return await res.text();
}

// ----------------------- ACTION HANDLERS -----------------------
async function handleSupabase(env, action, payload, request) {
  const def = ACTIONS_SUPABASE[action];
  if (!def || def.kind === "passthrough") {
    // ✅ FIX #38: Steadfast handlers — not in ACTIONS_SUPABASE because they
    // call external Packzy API directly, not Supabase.
    if (action === "steadfastcreate")        return await steadfastCreateOrder(env, payload || {});
    if (action === "steadfastbulk")          return await steadfastBulkCreate(env, payload || {});
    if (action === "steadfaststatus")        return await steadfastStatus(env, payload || {});
    if (action === "steadfastbalance")       return await steadfastBalance(env);
    if (action === "steadfastcreatereturn") return await steadfastCreateReturn(env, payload || {});
    if (action === "steadfastgetreturn")     return await steadfastGetReturn(env, payload || {});
    if (action === "steadfastlistreturns")   return await steadfastListReturns(env);
    if (action === "steadfastlistpayments")  return await steadfastListPayments(env);
    if (action === "steadfastgetpayment")    return await steadfastGetPayment(env, payload || {});
    if (action === "steadfastlistpolicestations") return await steadfastPoliceStations(env);
    if (action === "steadfastsavekeys")      return await steadfastSaveKeys(env, payload || {});
    if (action === "steadfastlistkeys")      return await steadfastKeysList(env);
    return null; // signal: fall back to GAS
  }

  try {
    switch (def.kind) {
      case "view": {
        const data = await supabaseRequest(env, def.view + "?select=*", { method: "GET" });
        // ✅ FIX #21: Map PascalCase view columns → lowercase for backward compat
        // The website_sync_view in Supabase has explicit column aliases:
        //   "Product", "Image1", "Regular", "Sale", "S_Left", "M_Left", "3XL_Left"...
        // But the customer site js/api.js + app.js expect:
        //   p.product, p.image1, p.regular, p.sale, p.stockS/M/L/XL/XXL/3XL...
        // IMPORTANT: do NOT spread original `...p` — that re-introduces PascalCase keys
        // which creates duplicate keys in JSON (invalid). Only emit the lowercase fields.
        const mapped = Array.isArray(data) ? data.map(p => {
          if (!p || typeof p !== 'object') return p;
          return {
            product: p.product ?? p.Product,
            // âœ… FIX #22: backward compat for app.js openProduct(name)
            // Customer site lookup: state.products.find(function (p) { return p.name === name; })
            // The view returns 'Product' (PascalCase) which we map to 'product' (lowercase).
            // But the customer site expects 'name' for the onclick parameter. Add both.
            name: p.product ?? p.Product,
            image1: p.image1 ?? p.Image1,
            image2: p.image2 ?? p.Image2,
            image3: p.image3 ?? p.Image3,
            image4: p.image4 ?? p.Image4,
            image5: p.image5 ?? p.Image5,
            image6: p.image6 ?? p.Image6,
            video_url: p.video_url ?? p.Video,
            description: p.description ?? p.Description,
            category: p.category ?? p.Category,
            fabric: p.fabric ?? p.Fabric,
            badge: p.badge ?? p.Badge,
            size_chart: p.size_chart ?? p.SizeChart,
            delivery_days: p.delivery_days ?? p.DeliveryDays,
            regular: p.regular ?? p.Regular,
            sale: p.sale ?? p.Sale,
            discPct: p.discPct ?? p['Disc%'],
            disc_type: p.disc_type ?? p.DiscType,
            dhaka_delivery: p.dhaka_delivery ?? p['Delivery(Dhaka)'],
            outside_delivery: p.outside_delivery ?? p['Delivery(Outside)'],
            stockS: p.stockS ?? p.S_Left,
            stockM: p.stockM ?? p.M_Left,
            stockL: p.stockL ?? p.L_Left,
            stockXL: p.stockXL ?? p.XL_Left,
            stockXXL: p.stockXXL ?? p.XXL_Left,
            stock3XL: p.stock3XL ?? p['3XL_Left'],
            status: p.status ?? p.Status,
            coupon_active: p.coupon_active ?? p.CouponActive,
            coupon_code: p.coupon_code ?? p.CouponCode,
            coupon_disc_percent: p.coupon_disc_percent ?? p.CouponDisc,
            // ✅ FIX #28: camelCase aliases for app.js (L3808 condition: product.couponActive/Code/Disc)
            couponActive: p.coupon_active ?? p.CouponActive,
            couponCode: p.coupon_code ?? p.CouponCode,
            couponDisc: p.coupon_disc_percent ?? p.CouponDisc
          };
        }) : data;
        return { success: true, ok: true, data: mapped };
      }
      case "table": {
        if (request.method === "GET") {
          let path = def.table + "?select=*" + (def.filter || "");
          // replace {name} placeholders with actual payload values
          const m = def.filter && def.filter.match(/\{(\w+)\}/);
          if (m) {
            const v = payload[m[1]];
            if (v === undefined) throw new Error("Missing param: " + m[1]);
            path = path.replace("{" + m[1] + "}", encodeURIComponent(v));
          }
          let data = await supabaseRequest(env, path, { method: "GET" });
          if (def.single && Array.isArray(data)) data = data[0] || null;
          return { success: true, ok: true, data: data };
        }
        if (request.method === "POST" && def.op === "insert") {
          // Strip meta fields that don't exist in table schema
          const cleanPayload = Object.assign({}, payload);
          delete cleanPayload.action;
          delete cleanPayload.key;
          delete cleanPayload._t;
          const r = await supabaseRequest(env, def.table, { method: "POST", body: JSON.stringify(cleanPayload) });
          return { success: true, ok: true, data: r };
        }
        if (request.method === "POST" && (def.op === "update" || def.op === "delete")) {
          const keyVal = payload[def.key];
          if (!keyVal) return { success: false, ok: false, msg: "Missing key: " + def.key };
          const body = Object.assign({}, payload);
          delete body[def.key];
          // Strip meta fields that don't exist in table schema
          delete body.action;
          delete body.key;
          delete body._t;
          const r = await supabaseRequest(
            env,
            def.table + "?" + def.key + "=eq." + encodeURIComponent(keyVal),
            { method: def.op === "update" ? "PATCH" : "DELETE", body: JSON.stringify(body) }
          );
          return { success: true, ok: true, msg: "Updated", data: r };
        }
        if (def.op === "upsert") {
          const rows = Array.isArray(payload) ? payload : [payload];
          const conflictCol = def.key || "id";
          const r = await supabaseRequest(
            env,
            def.table + "?on_conflict=" + conflictCol,
            { method: "POST",
              headers: { "Prefer": "resolution=merge-duplicates" },
              body: JSON.stringify(rows) }
          );
          return { success: true, ok: true, data: r };
        }
        break;
      }
      case "rpc": {
        // Call Supabase RPC via PostgREST: POST /rest/v1/rpc/<fn>
        // Args may use $placeholder syntax to pull from payload
        const args = {};
        if (def.args) {
          for (const k in def.args) {
            const v = def.args[k];
            if (typeof v === "string" && v.charAt(0) === "$") {
              const key = v.slice(1);
              args[k] = payload[key];
            } else {
              args[k] = v;
            }
          }
        }
        const r = await supabaseRequest(env, "rpc/" + def.fn, {
          method: "POST",
          body: JSON.stringify(args)
        });
        return { success: true, ok: true, data: r };
      }
    }
  } catch (e) {
    console.error("[supabase]", action, e.message);
    return null; // signal: fall back to GAS
  }
  return null;
}

// ----------------------- CUSTOM HANDLERS -----------------------
// place_order: maps customer-site payload to create_manual_order RPC
// Handles single OR multiple cart items (creates one order per item)
async function placeOrderSupabase(env, body, request) {
  const orderData = body.order || body;
  // âœ… FIX #26: Normalize flat customer-site params (cust_phone) AND nested order{}
  if (!orderData || typeof orderData !== 'object') return null;
  // Accept all common phone field names
  if (!orderData.phone) orderData.phone = orderData.cust_phone || orderData.customerPhone || orderData.contactPhone || '';
  if (!orderData.customerName) orderData.customerName = orderData.cust_name || orderData.name || '';
  if (!orderData.address) orderData.address = orderData.cust_addr || '';
  if (!orderData.location) orderData.location = orderData.deliv_zone || orderData.city || '';
  // Phone is required to proceed
  if (!orderData.phone) return null;
  let items = orderData.cartItems || [];
  if (items.length === 0) {
    const singleProduct = orderData.product || orderData.p || '';
    if (singleProduct) {
      items = [{ product: singleProduct, name: singleProduct, size: orderData.size || orderData.s || '', qty: Number(orderData.qty || orderData.q) || 1, price: Number(orderData.price) || 0 }];
    }
  }
  if (items.length === 0) return null;
  const orderIds = [];
  const ts = Date.now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const orderId = items.length === 1
      ? (orderData.orderId || ("WEB-" + ts + "-" + Math.floor(Math.random()*10000)))
      : (orderData.orderId + "-" + (i+1));
    const clientIp = (request && request.headers) ?
                     (request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "") : (orderData.ip || "");
    const args = {
      p_order_id: orderId,
      p_cust_name: orderData.customerName || orderData.name || "",
      p_cust_phone: orderData.phone || "",
      p_cust_addr: orderData.address || "",
      p_deliv_zone: orderData.location || orderData.city || "",
      p_product: it.product || it.name || "",
      p_size: it.size || "",
      p_qty: it.qty || 1,
      p_price: (it.price || 0),
      p_delivery_charge: (orderData.deliveryCharge || 0),
      p_total: (orderData.total || 0),
      p_payment: orderData.payment || "Cash on Delivery",
      p_status: "Pending",
      p_notes: orderData.notes || "",
      p_user: "website",
      p_device_id: orderData.deviceId || "",
      p_ip: clientIp,
      p_country: orderData.country || "",
      p_asn: orderData.asn || "",
      p_risk_score: orderData.riskScore || 0,
      p_risk_signals: orderData.riskSignals || "[]",
      p_flagged: orderData.isFlagged || false,
      p_flag_reason: orderData.flagReason || "",
      p_device_info: orderData.deviceInfo ? JSON.stringify(orderData.deviceInfo) : null
    };
    try {
      const r = await supabaseRequest(env, "rpc/create_website_order", {
        method: "POST",
        body: JSON.stringify(args)
      });
      orderIds.push(orderId);
    } catch (e) {
      console.error("[place_order] item", i, "failed:", e.message);
      return null; // fall back to GAS for the whole batch
    }
  }
  return {
    success: true,
    ok: true,
    orderId: orderIds[0],
    orderIds: orderIds,
    timestamp: ts,
    bdTime: new Date(ts).toISOString().replace("T", " ").substring(0, 19),
    total: orderData.total || 0,
    qty: items.reduce((s, it) => s + (it.qty || 1), 0),
    status: "Pending"
  };
}

// store_info: aggregate settings + delivery_charges
// ✅ FIX #6: Build output explicitly — no Object.assign merge that creates
// both lowercase "currency" and Title Case "Currency" in the JSON response.
async function storeInfoSupabase(env) {
  // Keys that the explicit-mapped fields above already cover.
  // These are filtered out of the settings spread to avoid case-collision
  // duplicates in case-insensitive JSON consumers (e.g. PowerShell ConvertFrom-Json).
  const EXCLUDED_FROM_SPREAD = new Set(['currency','currency symbol','store name','store phone','store email','store address','link facebook','link instagram','link whatsapp','link messenger','link tiktok','link youtube','custom categories','custom fabrics','custom badges','github repo','github branch','github path']);

  try {
    const settingsRes = await supabaseRequest(env, "settings?is_secret=eq.false&select=key,value", { method: "GET" });
    const settings = {};
    for (const r of settingsRes) settings[r.key] = r.value;
    const dcRes = await supabaseRequest(env, "delivery_charges?active=eq.true&order=sort_order&select=id,name,charge,active", { method: "GET" });
    const result = {
      success: true,
      ok: true,
      data: {
        // Identity
        name: settings["Store Name"] || "",
        phone: settings["Store Phone"] || "",
        email: settings["Store Email"] || "",
        address: settings["Store Address"] || "",
        currency: settings["Currency Symbol"] || settings["Currency"] || "৳",
        // Social links (customer site uses snake_case lowercase)
        link_facebook: settings["Link Facebook"] || "",
        link_instagram: settings["Link Instagram"] || "",
        link_whatsapp: settings["Link WhatsApp"] || "",
        link_messenger: settings["Link Messenger"] || "",
        link_tiktok: settings["Link TikTok"] || "",
        link_youtube: settings["Link YouTube"] || "",
        // Custom taxonomies
        custom_categories: settings["Custom Categories"] || "",
        custom_fabrics: settings["Custom Fabrics"] || "",
        custom_badges: settings["Custom Badges"] || "",
        // GitHub
        github_repo: settings["GitHub Repo"] || "",
        github_branch: settings["GitHub Branch"] || "main",
        github_path: settings["GitHub Path"] || "data.json",
        // âœ… FIX #25: Banner fields â€” explicit lookups for customer-site compatibility
        // The customer site reads data.hero_banner_1 (with underscore) but the DB
        // stores "Hero Banner 1" (with space). Try all reasonable casings.
        hero_banner_1: settings["hero banner 1"] || settings["Hero Banner 1"] || "",
        hero_banner_2: settings["hero banner 2"] || settings["Hero Banner 2"] || "",
        hero_banner_3: settings["hero banner 3"] || settings["Hero Banner 3"] || "",
        hero_banner_4: settings["hero banner 4"] || settings["Hero Banner 4"] || "",
        hero_banner_5: settings["hero banner 5"] || settings["Hero Banner 5"] || "",
        banner_title_1: settings["banner title 1"] || settings["Banner Title 1"] || "",
        banner_title_2: settings["banner title 2"] || settings["Banner Title 2"] || "",
        banner_title_3: settings["banner title 3"] || settings["Banner Title 3"] || "",
        banner_title_4: settings["banner title 4"] || settings["Banner Title 4"] || "",
        banner_title_5: settings["banner title 5"] || settings["Banner Title 5"] || "",
        banner_link_1: settings["banner link 1"] || settings["Banner Link 1"] || "",
        banner_link_2: settings["banner link 2"] || settings["Banner Link 2"] || "",
        banner_link_3: settings["banner link 3"] || settings["Banner Link 3"] || "",
        banner_link_4: settings["banner link 4"] || settings["Banner Link 4"] || "",
        banner_link_5: settings["banner link 5"] || settings["Banner Link 5"] || "",
        banner_text_color_1: settings["banner text color 1"] || settings["Banner Text Color 1"] || "",
        banner_text_color_2: settings["banner text color 2"] || settings["Banner Text Color 2"] || "",
        banner_text_color_3: settings["banner text color 3"] || settings["Banner Text Color 3"] || "",
        banner_text_color_4: settings["banner text color 4"] || settings["Banner Text Color 4"] || "",
        banner_text_color_5: settings["banner text color 5"] || settings["Banner Text Color 5"] || "",
        // Delivery zones
        delivery_charges: dcRes,
        // Spread all admin settings keys in LOWERCASE so JSON consumers
        // (PowerShell ConvertFrom-Json is case-insensitive) do NOT see duplicate
        // keys. Excludes keys we already explicitly mapped above.
        ...Object.fromEntries(
          Object.keys(settings)
            .filter(function(k) { return !EXCLUDED_FROM_SPREAD.has(k.toLowerCase()); })
            .map(function(k) { return [k.toLowerCase(), settings[k]]; })
        )
      }
    };

    // Apply sensible defaults for missing critical fields so the site never shows
    // a broken-looking empty hero when admin has not yet populated the Banners tab.
    if (!result.data.hero_banner_1) {
      result.data.hero_banner_1 = 'https://yarzclothing.xyz/images/og-banner.png';
    }
    if (!result.data.banner_title_1) {
      result.data.banner_title_1 = (result.data.name ? String(result.data.name) : 'YARZ') + ' \u2014 Premium Men\u2019s Fashion';
    }

    return result;

  } catch (e) {
    console.error("[store_info] failed:", e.message);
    return null;
  }
}

// categories: read Custom Categories from settings, split by comma
async function categoriesSupabase(env) {
  try {
    const r = await supabaseRequest(env, "settings?key=eq.Custom Categories&select=value", { method: "GET" });
    if (!r || r.length === 0) return { success: true, ok: true, data: [] };
    const cats = (r[0].value || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
    return { success: true, ok: true, data: cats };
  } catch (e) {
    console.error("[categories] failed:", e.message);
    return null;
  }
}

// current_month_snapshot: returns aggregated stats for the current month
// FIX #32: home dashboard "This Month" was always empty. Now returns counts + revenue.
async function currentMonthSnapshotSupabase(env) {
  try {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    // Use both website_orders and orders tables; sum what's there.
    const [web, man] = await Promise.all([
      supabaseRequest(env, "website_orders?date=gte." + firstOfMonth + "&select=order_id,product,qty,price,total,status,cust_phone", { method: "GET" }).catch(() => []),
      supabaseRequest(env, "orders?date=gte." + firstOfMonth + "&select=order_id,product,qty,price,total,status,cust_phone", { method: "GET" }).catch(() => [])
    ]);
    const wArr = Array.isArray(web) ? web : [];
    const mArr = Array.isArray(man) ? man : [];
    const all = wArr.concat(mArr);
    const sum = (arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0);
    const counts = {};
    for (const r of all) {
      const k = (r.product || "Unknown").trim() || "Unknown";
      counts[k] = (counts[k] || 0) + (Number(r.qty) || 1);
    }
    const topProducts = Object.keys(counts)
      .map(k => ({ product: k, qty: counts[k] }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    return {
      success: true,
      ok: true,
      data: {
        month_start: firstOfMonth,
        website_orders: wArr.length,
        manual_orders: mArr.length,
        total_orders: all.length,
        revenue_website: sum(wArr, "total"),
        revenue_manual: sum(mArr, "total"),
        revenue_total: sum(all, "total"),
        unique_customers_website: new Set(wArr.map(r => r.cust_phone).filter(Boolean)).size,
        unique_customers_manual: new Set(mArr.map(r => r.cust_phone).filter(Boolean)).size,
        top_products: topProducts
      }
    };
  } catch (e) {
    console.error("[currentMonthSnapshot] failed:", e.message);
    return { success: true, ok: true, data: { month_start: new Date().toISOString(), website_orders: 0, manual_orders: 0, total_orders: 0, revenue_total: 0, top_products: [], error: e.message } };
  }
}

/**
 * 6-month product analytics from transactions table.
 * Returns array of { product_name, revenue, cost, units_sold } per product per month.
 */
async function productAnalytics6mSupabase(env) {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const since = sixMonthsAgo.toISOString();
    const rows = await supabaseRequest(env,
      "transactions?date=gte." + since + "&select=product,qty,revenue,cost&order=date.asc",
      { method: "GET" }
    );
    const arr = Array.isArray(rows) ? rows : [];
    // Group by product
    const map = {};
    for (const r of arr) {
      const name = (r.product || "Unknown").trim() || "Unknown";
      if (!map[name]) map[name] = { product_name: name, revenue: 0, cost: 0, units_sold: 0 };
      map[name].revenue += Number(r.revenue) || 0;
      map[name].cost += Number(r.cost) || 0;
      map[name].units_sold += Number(r.qty) || 1;
    }
    return { success: true, data: Object.values(map) };
  } catch (e) {
    console.error("[productAnalytics6m] failed:", e.message);
    return { success: true, data: [] };
  }
}

function gasUpstream(env) {
  const id = env && env.GAS_DEPLOYMENT_ID;
  if (!id) throw new Error("GAS_DEPLOYMENT_ID not set; cannot route to legacy GAS fallback. Set it via `wrangler secret put GAS_DEPLOYMENT_ID` if you need GAS fallback.");
  return "https://script.google.com/macros/s/" + id + "/exec";
}

// GitHub Pages is the canonical static host for the customer site.
// When yarzclothing.xyz receives a non-API GET (no ?action= and no ?key=),
// proxy to GH Pages so visitors see the actual website instead of JSON.
const GH_PAGES_BASE = "https://ixmaruf.github.io/Yarz";
const GH_PAGES_HOST = "ixmaruf.github.io";

function isStaticRequest(url) {
  // No action AND no key AND not a worker-internal path -> assume browser wants static
  if (url.searchParams.has("action")) return false;
  if (url.searchParams.has("key")) return false;
  if (url.searchParams.has("__purge")) return false;
  const p = url.pathname;
  if (p.startsWith("/__")) return false;          // __env, __purge
  if (p === "/purge" || p === "/tg-webhook") return false;
  if (p.startsWith("/api/")) return false;
  return true;
}

async function fetchFromGitHubPages(request) {
  const url = new URL(request.url);
  const target = GH_PAGES_BASE + url.pathname + url.search;
  try {
    const ghResp = await fetch(target, {
      method: "GET",
      headers: { "User-Agent": "YARZ-Worker/1.0" },
      redirect: "follow"
    });
    if (!ghResp.ok) {
      // 404 fallback: try /index.html (for SPA-style deep links)
      if (ghResp.status === 404 && !pathHasExtension(url.pathname)) {
        const fallback = await fetch(GH_PAGES_BASE + "/index.html", {
          headers: { "User-Agent": "YARZ-Worker/1.0" }
        });
        if (fallback.ok) return new Response(fallback.body, fallback);
      }
      return new Response("Static asset not found: " + url.pathname, { status: ghResp.status });
    }
    // Pass through content, with permissive cache
    const respHeaders = new Headers(ghResp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return new Response(ghResp.body, { status: ghResp.status, headers: respHeaders });
  } catch (e) {
    return new Response("Static proxy error: " + e.message, { status: 502 });
  }
}

function pathHasExtension(p) {
  return /\.[a-z0-9]{1,5}$/i.test(p);
}

// ----------------------- ROUTER -----------------------
async function routeToGas(request, body, env, ctx) {
  const upstream = gasUpstream(env);
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
  if (request.method === "GET") {
    const url = new URL(request.url);
    init.method = "GET";
    init.body = undefined;
    // forward query string to GAS
    return fetch(upstream + url.search, init);
  }
  return fetch(upstream, init);
}

async function handle(request, env, ctx) {
  const { fresh: FRESH_TTL, swr: SWR_TTL, hard: HARD_TTL } = getTtls(env);
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Debug endpoint: /__env shows which secrets/vars are injected (safe; does NOT print secret values)
  const __url0 = new URL(request.url);
  if (__url0.pathname === "/__env") {
    return jsonResponse({
      has_url: !!env.SUPABASE_URL,
      url_prefix: env.SUPABASE_URL ? env.SUPABASE_URL.substring(0, 30) + "..." : null,
      has_key: !!env.SUPABASE_SERVICE_ROLE_KEY,
      key_len: env.SUPABASE_SERVICE_ROLE_KEY ? env.SUPABASE_SERVICE_ROLE_KEY.length : 0,
      supabase_enabled: env.SUPABASE_ENABLED,
      has_purge: !!env.PURGE_SECRET,
      has_tg_token: !!env.TG_BOT_TOKEN,
      has_tg_webhook: !!env.TG_WEBHOOK_SECRET,
      env_keys: Object.keys(env).sort()
    });
  }

  // Parse request
  let action = null;
  let body = {};
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase();
  
  if (path === "/__customerltv") {
    action = "getcustomerltv";
  } else if (path === "/__productanalytics6m") {
    action = "getproductanalytics6m";
  } else if (path === "/__currentmonthsnapshot") {
    action = "getcurrentmonthsnapshot";
  } else if (request.method === "GET") {
    action = (url.searchParams.get("action") || "products").toLowerCase();
    // FIX #39: Public GET table queries use URL placeholders (e.g. ?action=product&name=SHED).
    // Merge URL params into body so handleSupabase can replace {name} placeholders.
    try { for (const [k, v] of url.searchParams.entries()) { body[k] = v; } } catch(e) {}
  } else {
    const txt = await request.text();
    try { body = txt ? JSON.parse(txt) : {}; } catch(e) { body = {}; }
    // FIX #27: Customer site sends params in URL, not body. Merge URL params.
    try { for (const [k, v] of url.searchParams.entries()) { if (!(k in body) || body[k] === "" || body[k] == null) body[k] = v; } } catch(e) {}
    action = String(body.action || url.searchParams.get("action") || "").toLowerCase();
  }

  // Supabase enabled? Default true so production always uses Supabase unless explicitly disabled.
  const supabaseEnabled = env.SUPABASE_ENABLED !== "false";

  // Visitor analytics beacon: record one visit per page load in Supabase
  // Called by armor.js on customer website page load
  if (supabaseEnabled && path === "/__analytics" && request.method === "GET") {
    try {
      const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-real-ip") || "unknown";
      // Bangladesh time (UTC+6)
      const bdNow = new Date(Date.now() + 6 * 3600 * 1000);
      const today = bdNow.toISOString().slice(0, 10);
      await supabaseRequest(env, "rpc/track_visit", {
        method: "POST",
        body: JSON.stringify({ p_ip: clientIp, p_date: today })
      });
      return jsonResponse({ success: true, tracked: true });
    } catch (e) {
      // Silent fail — analytics should never break the page
      return jsonResponse({ success: true, tracked: false });
    }
  }

  // ===== FORTRESS (anti-fraud) — custom handlers =====
  // fortress.js sends camelCase payloads; Supabase table uses snake_case.
  // These handlers map fields and call Supabase directly.

  // __fortress_save_fingerprint: POST — upsert device fingerprint (visit_count auto-increments)
  if (supabaseEnabled && action === "__fortress_save_fingerprint" && request.method === "POST") {
    try {
      const fp = body;
      const visitorId = fp.visitorId || fp.visitor_id || "";
      if (!visitorId) return jsonResponse({ ok: true, msg: "no visitorId" });
      // Step 1: Call PostgreSQL function to increment visit_count + update last_seen_at
      await supabaseRequest(env, "rpc/visit_fingerprint", {
        method: "POST",
        body: JSON.stringify({ p_visitor_id: visitorId, p_ip: fp.ip || "" })
      });
      // Step 2: Update fingerprint details (device info, hashes, etc.)
      const details = {
        composite_hash: fp.compositeHash || fp.composite_hash || "",
        raw_components: fp,
        ip_country: fp.ipCountry || "",
        ip_city: fp.ipCity || "",
        ip_region: fp.ipRegion || "",
        ip_isp: fp.ipIsp || "",
        is_vpn: fp.isVpn || false,
        is_proxy: fp.isProxy || false,
        is_datacenter: fp.isDatacenter || false,
        user_agent: fp.userAgent || "",
        device_name: fp.deviceName || "",
        device_os: fp.deviceOS || "",
        device_browser: fp.deviceBrowser || "",
        device_screen: fp.deviceScreen || "",
        canvas_hash: fp.canvasHash || "",
        audio_hash: fp.audioHash || "",
        webgl_vendor: fp.webglVendor || "",
        webgl_renderer: fp.webglRenderer || "",
        screen_resolution: fp.screenResolution || "",
        color_depth: fp.colorDepth || 0,
        hardware_concurrency: fp.hwCores || 0,
        device_memory: fp.deviceMemory || 0,
        pixel_ratio: fp.pixelRatio || 1,
        timezone: fp.timezone || "",
        timezone_offset: fp.timezoneOffset || 0,
        languages: fp.language || "",
        fonts_count: fp.fontsCount || 0,
        touch_support: fp.touchSupport || 0,
        network_type: fp.networkType || "",
        fingerprintjs_id: fp.fpjsId || "",
        fingerprintjs_confidence: fp.fpjsConfidence || 0
      };
      await supabaseRequest(env, "device_fingerprints?visitor_id=eq." + encodeURIComponent(visitorId), {
        method: "PATCH",
        body: JSON.stringify(details)
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      console.error("[fortress] save_fingerprint error:", e.message);
      return jsonResponse({ ok: true }); // silent fail — fortress should never break the page
    }
  }

  // __fortress_public_blocklist: GET — return blocked device IDs + blocked IPs
  if (supabaseEnabled && action === "__fortress_public_blocklist" && request.method === "GET") {
    try {
      const [deviceData, ipData] = await Promise.all([
        supabaseRequest(env, "blocked_devices?select=device_id&status=eq.active", { method: "GET" }).catch(() => []),
        supabaseRequest(env, "blocked_ips?select=ip_address", { method: "GET" }).catch(() => [])
      ]);
      const devices = Array.isArray(deviceData) ? deviceData.map(d => d.device_id) : [];
      const ips = Array.isArray(ipData) ? ipData.map(i => i.ip_address) : [];
      return jsonResponse({ ok: true, devices: devices, ips: ips });
    } catch (e) {
      return jsonResponse({ ok: true, devices: [], ips: [] });
    }
  }

  // __fortress_lookup: POST — return blocked devices + fingerprints for admin
  if (supabaseEnabled && action === "__fortress_lookup" && request.method === "POST") {
    try {
      const blocked = await supabaseRequest(env, "blocked_devices?select=*&status=eq.active&order=created_at.desc", { method: "GET" });
      const fingerprints = await supabaseRequest(env, "device_fingerprints?select=*&order=last_seen_at.desc&limit=100", { method: "GET" });
      return jsonResponse({ ok: true, devices: blocked || [], fingerprints: fingerprints || [], threats: [] });
    } catch (e) {
      return jsonResponse({ ok: true, devices: [], fingerprints: [], threats: [] });
    }
  }

  // __fortress_block: POST — block a device
  if (supabaseEnabled && action === "__fortress_block" && request.method === "POST") {
    try {
      const deviceId = body.device_id || body.deviceId || "";
      if (!deviceId) return jsonResponse({ ok: false, msg: "device_id required" });
      const row = {
        device_id: deviceId,
        block_reason: body.reason || body.block_reason || "manual",
        blocked_by: body.blocked_by || body.blockedBy || "admin",
        block_type: "hard",
        status: "active",
        phones_seen: body.phones_seen || body.phonesSeen || "",
        ips_seen: body.ips_seen || body.ipsSeen || ""
      };
      await supabaseRequest(env, "blocked_devices?on_conflict=device_id", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([row])
      });
      // Also block the IP if provided
      const ip = body.ip || body.ip_address || "";
      if (ip) {
        await supabaseRequest(env, "blocked_ips?on_conflict=ip_address", {
          method: "POST",
          headers: { "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify([{ ip_address: ip, reason: body.reason || "manual", blocked_by: "admin" }])
        });
      }
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }

  // __fortress_unblock: POST — unblock a device
  if (supabaseEnabled && action === "__fortress_unblock" && request.method === "POST") {
    try {
      const deviceId = body.device_id || body.deviceId || "";
      if (!deviceId) return jsonResponse({ ok: false, msg: "device_id required" });
      await supabaseRequest(env, "blocked_devices?device_id=eq." + encodeURIComponent(deviceId), {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive", updated_at: new Date().toISOString() })
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }

  // __fortress_clear_all: POST — deactivate all blocked devices
  if (supabaseEnabled && action === "__fortress_clear_all" && request.method === "POST") {
    try {
      await supabaseRequest(env, "blocked_devices?status=eq.active", {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive", updated_at: new Date().toISOString() })
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }

  // ===== IP BLOCKING ENDPOINTS =====

  // __fortress_block_ip: POST — block an IP address
  if (supabaseEnabled && action === "__fortress_block_ip" && request.method === "POST") {
    try {
      const ip = body.ip || body.ip_address || "";
      if (!ip) return jsonResponse({ ok: false, msg: "ip required" });
      await supabaseRequest(env, "blocked_ips?on_conflict=ip_address", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([{ ip_address: ip, reason: body.reason || "manual", blocked_by: "admin", notes: body.notes || "" }])
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }

  // __fortress_unblock_ip: POST — unblock an IP address
  if (supabaseEnabled && action === "__fortress_unblock_ip" && request.method === "POST") {
    try {
      const ip = body.ip || body.ip_address || "";
      if (!ip) return jsonResponse({ ok: false, msg: "ip required" });
      await supabaseRequest(env, "blocked_ips?ip_address=eq." + encodeURIComponent(ip), {
        method: "DELETE"
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }

  // __fortress_list_blocked_ips: GET — list all blocked IPs
  if (supabaseEnabled && action === "__fortress_list_blocked_ips" && request.method === "GET") {
    try {
      const data = await supabaseRequest(env, "blocked_ips?select=*&order=created_at.desc", { method: "GET" });
      return jsonResponse({ ok: true, ips: data || [] });
    } catch (e) {
      return jsonResponse({ ok: true, ips: [] });
    }
  }

  // __fortress_check_ip: POST — check if an IP is blocked (used by website)
  if (supabaseEnabled && action === "__fortress_check_ip" && request.method === "POST") {
    try {
      const ip = body.ip || "";
      if (!ip) return jsonResponse({ ok: true, blocked: false });
      const data = await supabaseRequest(env, "blocked_ips?ip_address=eq." + encodeURIComponent(ip) + "&select=ip_address,reason", { method: "GET" });
      const blocked = Array.isArray(data) && data.length > 0;
      return jsonResponse({ ok: true, blocked: blocked, reason: blocked ? data[0].reason : "" });
    } catch (e) {
      return jsonResponse({ ok: true, blocked: false });
    }
  }

  // __fortress_public_blocklist: update to include blocked IPs
  // (already handled above, but let's also return IPs in the existing endpoint)

  // __fortress_log_event: POST — log a fortress event
  if (supabaseEnabled && action === "__fortress_log_event" && request.method === "POST") {
    try {
      const row = {
        visitor_id: body.visitor_id || body.visitorId || "",
        event_type: body.event_type || body.eventType || "unknown",
        detail: body.detail || body,
        ip: body.ip || ""
      };
      await supabaseRequest(env, "fortress_events", {
        method: "POST",
        body: JSON.stringify(row)
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ ok: true }); // silent fail
    }
  }

  // place_order (public POST) -> Supabase create_manual_order RPC
  if (supabaseEnabled && action === "place_order" && request.method === "POST") {
    // SERVER-SIDE IP CHECK — block fraudulent IPs before order creation
    const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "";
    if (clientIp) {
      try {
        const ipCheck = await supabaseRequest(env, "blocked_ips?ip_address=eq." + encodeURIComponent(clientIp) + "&select=ip_address,reason", { method: "GET" });
        if (Array.isArray(ipCheck) && ipCheck.length > 0) {
          console.log("[place_order] BLOCKED IP:", clientIp, "reason:", ipCheck[0].reason);
          return jsonResponse({ success: false, blocked: true, error: "This IP address has been blocked. Reason: " + (ipCheck[0].reason || "manual") });
        }
      } catch (e) { /* fail open — don't block orders if check fails */ }
    }
    const r = await placeOrderSupabase(env, body, request);
    if (r) {
      ctx.waitUntil(purgeCacheForAction("products", caches.default));
      return jsonResponse(r);
    }
    // null = fall back to GAS
  }

  // store_info (public GET) -> Supabase settings+delivery_charges
  if (supabaseEnabled && action === "store_info" && request.method === "GET") {
    const r = await storeInfoSupabase(env);
    if (r) {
      const resp = new Response(JSON.stringify(r), {
        headers: Object.assign({
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + FRESH_TTL + ", stale-while-revalidate=" + SWR_TTL
        }, corsHeaders())
      });
      return resp;
    }
  }

  // categories (public GET) -> Supabase settings
  if (supabaseEnabled && action === "categories" && request.method === "GET") {
    const r = await categoriesSupabase(env);
    if (r) {
      const resp = new Response(JSON.stringify(r), {
        headers: Object.assign({
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + FRESH_TTL + ", stale-while-revalidate=" + SWR_TTL
        }, corsHeaders())
      });
      return resp;
    }
  }

  // __currentMonthSnapshot (admin POST) -> Supabase monthly stats
  // FIX #32: home dashboard "This Month" was always empty
  // FIX: action is set to "getcurrentmonthsnapshot" by path normalizer (line 744)
  if (supabaseEnabled && action === "getcurrentmonthsnapshot") {
    const r = await currentMonthSnapshotSupabase(env);
    return jsonResponse(r);
  }
  // __productAnalytics6m (admin GET) -> Supabase product analytics
  if (supabaseEnabled && action === "getproductanalytics6m") {
    const r = await productAnalytics6mSupabase(env);
    return jsonResponse(r);
  }
  // Health / pub-cacheable: try Supabase first if enabled
  if (supabaseEnabled && PUBLIC_CACHEABLE.has(action) && request.method === "GET") {
    const cache = caches.default;
    // ✅ FIX #14: Use normalized cache key (only the action path, not the full URL with key/ts)
    // This way multiple customer requests share the same cache entry.
    const cacheKey = new Request("https://yarzclothing.xyz/?action=" + action);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const r = await handleSupabase(env, action, body, request);
    if (r) {
      const resp = new Response(JSON.stringify(r), {
        headers: Object.assign({
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=" + FRESH_TTL + ", stale-while-revalidate=" + SWR_TTL
        }, corsHeaders())
      });
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    }
    // fall through to GAS
  }

  // Admin writes: try Supabase
  if (supabaseEnabled && ADMIN_ACTIONS.has(action) && request.method === "POST") {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      // After successful admin write, purge the GET cache
      ctx.waitUntil(purgeCacheForAction(action, caches.default));
      return jsonResponse(r);
    }
    // null = passthrough to GAS
  }

  // Public POSTs (subscribe_newsletter etc.): try Supabase (no cache purge)
  if (supabaseEnabled && PUBLIC_POST.has(action) && request.method === "POST") {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      return jsonResponse(r);
    }
    // null = passthrough to GAS
  }

  // FIX #40: Public GET actions that are NOT edge-cacheable (PII / dynamic) but
  // exist in ACTIONS_SUPABASE should still route to Supabase, not GAS.
  if (supabaseEnabled && request.method === "GET" && ACTIONS_SUPABASE[action] && ACTIONS_SUPABASE[action].kind !== "passthrough" && !PUBLIC_CACHEABLE.has(action)) {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      return jsonResponse(r);
    }
  }

  // Default: GAS upstream
  const gasResp = await routeToGas(request, body, env, ctx);
  // Copy through CORS headers
  const headers = new Headers(gasResp.headers);
  Object.entries(corsHeaders()).forEach(function(kv){ headers.set(kv[0], kv[1]); });
  return new Response(gasResp.body, { status: gasResp.status, headers: headers });
}

async function purgeCacheForAction(action, cache) {
  // ✅ FIX #14: Use the same normalized cache key as handle() (action-only URL)
  // so the deletion actually matches the cached entries.
  const endpoints = [];
  if (action.includes("product") || action.includes("stock") || action.includes("inventory")) {
    endpoints.push("?action=products", "?action=product", "?action=store_info");
  }
  if (action.includes("order") || action.includes("sale") || action.includes("transaction")) {
    endpoints.push("?action=products", "?action=store_info");
  }
  if (action.includes("setting") || action.includes("delivery")) {
    endpoints.push("?action=store_info", "?action=delivery_charges");
  }
  await Promise.all(endpoints.map(async function(q) {
    try { await cache.delete(new Request("https://yarzclothing.xyz/" + q)); } catch (e) {}
  }));
}

// ----------------------- WEBHOOK -----------------------
// ✅ FIX #13: Purge endpoint accepts both /purge and /__purge paths.
// Auth: optional. If env.PURGE_SECRET is set, header/param must match.
// If not set, any request is allowed (dev convenience).
async function handlePurgeWebhook(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/purge" && url.pathname !== "/__purge") return null;
  // ✅ FIX #13: Handle CORS preflight (OPTIONS) immediately
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const expected = (env && env.PURGE_SECRET) || "";
  if (expected) {
    const provided = request.headers.get("x-purge-secret") || url.searchParams.get("secret") || "";
    if (provided !== expected) {
      return new Response(JSON.stringify({ success: false, error: "Invalid purge secret" }), {
        status: 401,
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }
  }
  // If no PURGE_SECRET configured at all → allow without auth (dev convenience)
  // Best-effort: delete known cache keys (Cloudflare Workers does NOT support cache.keys())
  const cache = caches.default;
  const purgeRequests = [
    new Request("https://yarzclothing.xyz/?action=products"),
    new Request("https://yarzclothing.xyz/?action=delivery_charges"),
    new Request("https://yarzclothing.xyz/?action=store_info"),
    new Request("https://yarzclothing.xyz/?action=categories")
  ];
  let purged = 0;
  await Promise.all(purgeRequests.map(async function(r) {
    try { if (await cache.delete(r)) purged++; } catch (e) {}
  }));
  return new Response(JSON.stringify({ success: true, purged: purged, note: "best-effort (known endpoints)" }), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" })
  });
}

// ----------------------- TELEGRAM WEBHOOK -----------------------
async function tgApiCall(botToken, method, body) {
  return fetch("https://api.telegram.org/bot" + botToken + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// Helper: list recent orders
async function listRecentOrders(env, since) {
  try {
    let hours = 24;
    const m = String(since || "24h").match(/^(\d+)h?$/);
    if (m) hours = parseInt(m[1], 10);
    const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const r = await supabaseRequest(env, "website_orders?created_at=gt." + sinceIso + "&order=created_at.desc&limit=10&select=order_id,created_at,cust_name,cust_phone,product,size,qty,price,total,status", { method: "GET" });
    if (!Array.isArray(r) || r.length === 0) return "📭 No orders in last " + hours + "h.";
    let lines = ["📦 <b>Last " + r.length + " orders (last " + hours + "h):</b>\n"];
    for (const o of r) {
      lines.push("• <code>" + o.order_id + "</code> — " + o.product + " " + o.size + " ×" + o.qty + " = ৳" + o.total + " (" + o.status + ")");
    }
    return lines.join("\n");
  } catch (e) {
    return "❌ Error: " + e.message;
  }
}

// Helper: get order stats
async function getOrderStats(env) {
  try {
    const r = await supabaseRequest(env, "website_orders?order=created_at.desc&limit=200&select=created_at,total,status", { method: "GET" });
    if (!Array.isArray(r) || r.length === 0) return "📊 No orders yet.";
    const today = new Date(); today.setHours(0,0,0,0);
    let totalOrders = r.length;
    let todayOrders = 0, todayRevenue = 0;
    let totalRevenue = 0, pending = 0, confirmed = 0, shipped = 0, delivered = 0, cancelled = 0;
    for (const o of r) {
      const t = parseFloat(o.total || 0);
      totalRevenue += t;
      if (o.status === "Pending") pending++;
      else if (o.status === "Confirmed") confirmed++;
      else if (o.status === "Shipped") shipped++;
      else if (o.status === "Delivered") delivered++;
      else if (o.status === "Cancelled") cancelled++;
      if (new Date(o.created_at) >= today) {
        todayOrders++;
        todayRevenue += t;
      }
    }
    return "📊 <b>YARZ Stats</b>\n\n" +
      "• Total orders: " + totalOrders + "\n" +
      "• Today: " + todayOrders + " orders, ৳" + todayRevenue.toFixed(2) + "\n" +
      "• Total revenue: ৳" + totalRevenue.toFixed(2) + "\n\n" +
      "• Pending: " + pending + " | Confirmed: " + confirmed + "\n" +
      "• Shipped: " + shipped + " | Delivered: " + delivered + "\n" +
      "• Cancelled: " + cancelled;
  } catch (e) {
    return "❌ Error: " + e.message;
  }
}

async function handleTelegramWebhook(request, env) {
  const TG_BOT_TOKEN = env && env.TG_BOT_TOKEN;
  const TG_OWNER_ID = String((env && env.TG_OWNER_ID) || "6409729183");
  if (!TG_BOT_TOKEN) return new Response("Bot token not configured", { status: 500 });

  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Handle callback_query (button clicks: confirm/cancel/shipped/delivered)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = String(cb.data || "");
    const colon = data.indexOf(":");
    const action = colon > 0 ? data.substring(0, colon) : data;
    const orderId = colon > 0 ? data.substring(colon + 1) : "";

    // Security: verify user is the owner
    if (String(cb.from.id) !== TG_OWNER_ID) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id, text: "⛔ অনুমতি নেই!", show_alert: true
      });
      return new Response("ok");
    }

    const statusMap = {
      "confirm": "Processing",
      "shipped": "Shipped",
      "delivered": "Delivered",
      "cancel":  "Cancelled"
    };
    const newStatus = statusMap[action];
    if (!newStatus) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id, text: "❌ Unknown action", show_alert: true
      });
      return new Response("ok");
    }
    if (!orderId) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id, text: "❌ Missing order id", show_alert: true
      });
      return new Response("ok");
    }

    try {
      const now = new Date().toISOString();
      // Update order status in Supabase directly (REST PATCH)
      await supabaseRequest(env,
        "website_orders?order_id=eq." + encodeURIComponent(orderId),
        {
          method: "PATCH",
          body: JSON.stringify({
            status: newStatus,
            updated_at: now,
            activity: ((cb.message && cb.message.text) || "") + " | " + newStatus + " @ " + now
          })
        }
      );
      // Answer callback query
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: newStatus + " — " + orderId,
        show_alert: true
      });
      // Edit the original message
      if (cb.message) {
        const editText = ((cb.message.text || "") + "\n\n<b>" + newStatus + "</b> — " + now)
          .substring(0, 4096);
        await tgApiCall(TG_BOT_TOKEN, "editMessageText", {
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: editText
        });
      }
    } catch (e) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id, text: "❌ " + e.message, show_alert: true
      });
    }
    return new Response("ok");
  }

  // Handle message commands (e.g. /start, /orders) — minimal handler
  if (update.message && update.message.text) {
    const txt = update.message.text.trim();
    const fromId = String(update.message.from.id);
    // /start: respond to anyone (so they know bot is alive)
    if (txt === "/start" || txt === "/help") {
      await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "🛒 <b>YARZ Orders Bot</b>\n\n" +
              "✅ Bot is online.\n\n" +
              "Order notifications will be sent here when customers place orders on yarzclothing.xyz.\n" +
              "You'll get buttons to confirm/cancel/ship/deliver each order.\n\n" +
              "Use /whoami to see your Telegram user ID.",
        parse_mode: "HTML"
      });
    } else if (txt === "/whoami") {
      await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "👤 Your Telegram user ID: <code>" + fromId + "</code>\n\n" +
              "Owner-only commands work if this ID matches TG_OWNER_ID in the worker config.\n" +
              "Current TG_OWNER_ID: <code>" + TG_OWNER_ID + "</code>",
        parse_mode: "HTML"
      });
    } else if (fromId === TG_OWNER_ID) {
      // Owner-only commands: /orders, /stats
      if (txt === "/orders" || txt.startsWith("/orders ")) {
        const since = txt.length > 7 ? txt.substring(8) : "24h";
        const orders = await listRecentOrders(env, since);
        await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
          chat_id: update.message.chat.id,
          text: orders,
          parse_mode: "HTML"
        });
      } else if (txt === "/stats") {
        const stats = await getOrderStats(env);
        await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
          chat_id: update.message.chat.id,
          text: stats,
          parse_mode: "HTML"
        });
      }
    }
    return new Response("ok");
  }

  return new Response("ok");
}

// ----------------------- ENTRY -----------------------
// ---- R2 BACKUP SYSTEM ----
// Rolling window backup + cleanup for Supabase tables
// CRON: runs daily at midnight UTC via wrangler cron trigger
// Storage: Cloudflare R2 bucket (yarz-backups)
// -------------------------------------------------------

const BACKUP_TABLES = {
  // Rolling window: backup THEN delete old rows
  orders:               { days: 60,  dateCol: "created_at" },
  website_orders:       { days: 60,  dateCol: "created_at" },
  transactions:         { days: 60,  dateCol: "created_at" },
  customers:            { days: 180, dateCol: "created_at" },
  expenses:             { days: 180, dateCol: "created_at" },
  ad_tracker:           { days: 180, dateCol: "created_at" },
  delivery_charges:     { days: 365, dateCol: null }, // yearly full backup only
  device_fingerprints:  { days: 10,  dateCol: "created_at" }, // backup + cleanup: 10k visitors/day
  device_models:        { days: 10,  dateCol: "created_at" }, // backup + cleanup: device info
};

const CLEANUP_TABLES = {
  // Cleanup only (no backup needed)
  admin_sessions:       { days: 10,  dateCol: "created_at" },
  admin_login_attempts: { days: 10,  dateCol: "ts" },
  rate_limit_log:       { days: 10,  dateCol: "ts" },
  audit_log:            { days: 10,  dateCol: "ts" },
  _activity:            { days: 10,  dateCol: "ts" },
  steadfast_balance_cache: { days: 7, dateCol: "fetched_at" },
  steadfast_consignments:  { days: 90, dateCol: "created_at" },
};

// Yearly backup (January only) — never delete
const YEARLY_TABLES = ["delivery_charges"];

// Permanent backup: backup daily, NEVER delete from R2 or Supabase
// Only tables with actual business data (keep under 50 subrequest limit)
const PERMANENT_BACKUP_TABLES = [
  "inventory",           // 3500+ products — most critical
  "settings",            // 570+ business settings
  "blocked_devices",     // security: blocked fraudsters
  "admin_users",         // login credentials
  "_draft_data",         // product drafts
  "_archive_data",       // archived products
];

async function runDailyBackup(env) {
  const now = new Date();
  // Bangladesh time (UTC+6)
  const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const dateStr = bdNow.toISOString().slice(0, 10); // YYYY-MM-DD in BD time
  const month = bdNow.getMonth() + 1;
  const results = [];

  // ---- Step 1: Backup rolling window tables ----
  for (const [table, cfg] of Object.entries(BACKUP_TABLES)) {
    try {
      const rows = await supaQueryAll(env, table);
      if (!rows.length) { results.push({ table, action: "skip", reason: "no rows" }); continue; }

      // Upload to R2
      const key = `rolling/${table}/${dateStr}.json`;
      await r2Put(env, key, JSON.stringify(rows));

      // Delete rows older than window
      if (cfg.dateCol) {
        const cutoff = new Date(now.getTime() - cfg.days * 86400000).toISOString();
        await supaDelete(env, table, cfg.dateCol, "lt", cutoff);
      }

      results.push({ table, action: "backup+cleanup", rows: rows.length, key });
    } catch (e) {
      results.push({ table, action: "error", msg: e.message });
    }
  }

  // ---- Step 2: Cleanup-only tables ----
  for (const [table, cfg] of Object.entries(CLEANUP_TABLES)) {
    try {
      const cutoff = new Date(now.getTime() - cfg.days * 86400000).toISOString();
      const deleted = await supaDelete(env, table, cfg.dateCol, "lt", cutoff);
      results.push({ table, action: "cleanup", deleted });
    } catch (e) {
      results.push({ table, action: "error", msg: e.message });
    }
  }

  // ---- Step 3: Yearly backup (January only) ----
  if (month === 1) {
    for (const table of YEARLY_TABLES) {
      try {
        const rows = await supaQueryAll(env, table);
        const key = `yearly/${table}/${dateStr}.json`;
        await r2Put(env, key, JSON.stringify(rows));
        results.push({ table, action: "yearly-backup", rows: rows.length, key });
      } catch (e) {
        results.push({ table, action: "error", msg: e.message });
      }
    }
  }

  // ---- Step 4: Permanent backup (daily, never delete) ----
  for (const table of PERMANENT_BACKUP_TABLES) {
    try {
      const rows = await supaQueryAll(env, table);
      if (!rows.length) { results.push({ table: table, action: "skip", reason: "no rows" }); continue; }
      const key = `permanent/${table}/${dateStr}.json`;
      await r2Put(env, key, JSON.stringify(rows));
      results.push({ table: table, action: "permanent-backup", rows: rows.length, key: key });
    } catch (e) {
      results.push({ table: table, action: "error", msg: e.message });
    }
  }

  // NOTE: R2 cleanup removed — all rolling backups kept forever in R2 (free tier 10GB, ~100MB used)
  // User can download & clear manually from admin panel anytime

  console.log("[BACKUP]", dateStr, JSON.stringify(results));
  return results;
}

async function handleBackupDownload(request, env) {
  // Auth check
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  // If key is provided, download that specific file
  if (key) {
    const data = await env.YARZ_BACKUPS.get(key);
    if (!data) {
      return jsonResponse({ error: "File not found" }, 404);
    }
    const json = await data.json();
    return jsonResponse({ success: true, key, data: json });
  }

  // Otherwise list all files grouped by table
  const listed = await env.YARZ_BACKUPS.list();
  if (!listed.objects.length) {
    return jsonResponse({ error: "No backups found" }, 404);
  }

  const byTable = {};
  for (const obj of listed.objects) {
    const parts = obj.key.split("/"); // rolling/table/date.json
    const table = parts[1] || parts[0];
    if (!byTable[table]) byTable[table] = [];
    byTable[table].push({ key: obj.key, size: obj.size, uploaded: obj.uploaded });
  }

  return jsonResponse({ success: true, backups: byTable, totalFiles: listed.objects.length });
}

async function handleBackupList(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const listed = await env.YARZ_BACKUPS.list();
  const files = listed.objects.map(o => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
  return jsonResponse({ success: true, files, totalSize: files.reduce((a, f) => a + f.size, 0) });
}

async function handleBackupRun(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const results = await runDailyBackup(env);
    return jsonResponse({ success: true, results });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}

async function handleBackupClear(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const rollingCount = await r2DeleteAll(env, "rolling/");
    const permanentCount = await r2DeleteAll(env, "permanent/");
    return jsonResponse({ success: true, deleted: rollingCount + permanentCount });
  } catch (e) {
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}

// ---- Supabase helpers for backup ----
async function supaQueryAll(env, table) {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const url = `${env.SUPABASE_URL}/rest/v1/${table}?select=*&order=id&offset=${offset}&limit=${batchSize}`;
    const resp = await fetch(url, {
      headers: {
        "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Prefer": "return=representation"
      }
    });
    if (!resp.ok) throw new Error(`Supabase ${table} query failed: ${resp.status}`);
    const batch = await resp.json();
    if (!batch.length) break;
    allRows.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }
  return allRows;
}

async function supaDelete(env, table, dateCol, op, cutoff) {
  const filter = `?${dateCol}=${op}.${cutoff}`;
  const url = `${env.SUPABASE_URL}/rest/v1/${table}${filter}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Prefer": "return=minimal"
    }
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Supabase ${table} delete failed: ${resp.status} ${errText}`);
  }
  return 0;
}

async function r2Put(env, key, value) {
  await env.YARZ_BACKUPS.put(key, value, {
    httpMetadata: { contentType: "application/json" }
  });
}

async function r2Get(env, key) {
  return env.YARZ_BACKUPS.get(key);
}

async function r2List(env, prefix) {
  return env.YARZ_BACKUPS.list({ prefix });
}

async function r2DeleteAll(env, prefix) {
  const listed = await env.YARZ_BACKUPS.list({ prefix });
  for (const obj of listed.objects) {
    await env.YARZ_BACKUPS.delete(obj.key);
  }
  return listed.objects.length;
}

// ---- Download as ZIP helper ----
async function r2DownloadZip(env, table) {
  const prefix = `rolling/${table}/`;
  const listed = await env.YARZ_BACKUPS.list({ prefix });
  if (!listed.objects.length) return null;

  // For simplicity, return the latest file as JSON
  const latest = listed.objects.sort((a, b) => b.uploaded - a.uploaded)[0];
  const data = await env.YARZ_BACKUPS.get(latest.key);
  return { key: latest.key, data: await data.text(), size: latest.size };
}

// ----------------------- ENTRY -----------------------
// Modern fetch handler (wrangler 4.x: env passed as 2nd arg)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // ✅ FIX #26: Serve /favicon.ico from the worker. GitHub Pages only has
    // /favicon.svg, but most browsers still request /favicon.ico by default.
    // We serve the SVG content with the correct image/svg+xml mime type so
    // modern browsers display it. This fixes the 404 in the browser console.
    if (url.pathname === "/favicon.ico") {
      try {
        const svgResp = await fetch("https://ixmaruf.github.io/Yarz/favicon.svg");
        if (svgResp.ok) {
          const svgBody = await svgResp.text();
          return new Response(svgBody, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml; charset=utf-8",
              "Cache-Control": "public, max-age=86400",
              "Access-Control-Allow-Origin": "*"
            }
          });
        }
      } catch (e) { /* fall through to 404 */ }
      return new Response("Not Found", { status: 404 });
    }
    // Webhook endpoint (Cloudflare cache purge) — supports both /purge and /__purge
    if (url.pathname === "/purge" || url.pathname === "/__purge") {
      return handlePurgeWebhook(request, env, ctx);
    }
    // Telegram webhook
    if (url.pathname === "/tg-webhook") {
      return handleTelegramWebhook(request, env, ctx);
    }
    // AI Agent routes (/agent/webhook, /agent/send, /agent/settings, /agent/test, /agent/orders/new, /agent/forward)
    if (url.pathname.startsWith("/agent/")) {
      return handleAgentRoute(request, env, ctx);
    }
    // ---- R2 Backup routes ----
    // Handle OPTIONS preflight for all /backup/* routes
    if (url.pathname.startsWith("/backup/") && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === "/backup/download") {
      return handleBackupDownload(request, env);
    }
    if (url.pathname === "/backup/list") {
      return handleBackupList(request, env);
    }
    if (url.pathname === "/backup/run" && request.method === "POST") {
      return handleBackupRun(request, env);
    }
    if (url.pathname === "/backup/clear" && request.method === "POST") {
      return handleBackupClear(request, env);
    }
    if (request.method === "GET" && isStaticRequest(url)) {
      return await fetchFromGitHubPages(request);
    }
    return handle(request, env, ctx);
  },
  // ---- CRON: Daily backup at midnight UTC ----
  async scheduled(event, env, ctx) {
    await runDailyBackup(env);
  }
};

// Image handler removed in v3.7.0 — was causing edge propagation issues
// (R2 custom domain now serves images directly).

// =====================================================================
// STEADFAST COURIER INTEGRATION (Packzy API v1)
// https://portal.packzy.com/api/v1
// Auth: env.STEADFAST_API_KEY + env.STEADFAST_SECRET_KEY (set via wrangler secret put)
// =====================================================================
async function steadfastRequest(env, path, method, body) {
  const apiKey = env.STEADFAST_API_KEY;
  const secretKey = env.STEADFAST_SECRET_KEY;
  if (!apiKey || !secretKey) {
    return { success: false, ok: false, msg: "Steadfast API keys not configured. Run: wrangler secret put STEADFAST_API_KEY / STEADFAST_SECRET_KEY" };
  }
  const url = "https://portal.packzy.com/api/v1" + path;
  try {
    const init = { method: method || "GET", headers: { "Api-Key": apiKey, "Secret-Key": secretKey, "Content-Type": "application/json" } };
    if (body && (method || "GET").toUpperCase() !== "GET") init.body = typeof body === "string" ? body : JSON.stringify(body);
    const resp = await fetch(url, init);
    let data;
    try { data = await resp.json(); } catch (e) { data = { raw: await resp.text().catch(function(){ return ""; }) }; }
    return { success: resp.ok, ok: resp.ok, status: resp.status, data: data };
  } catch (e) {
    return { success: false, ok: false, msg: "Steadfast request failed: " + e.message };
  }
}

async function steadfastSaveConsignments(env, rows) {
  if (!rows || !rows.length) return;
  try { await supabaseRequest(env, "steadfast_consignments", { method: "POST", body: JSON.stringify(rows) }); }
  catch (e) { console.error("[steadfastSave] error:", e.message); }
}

async function steadfastCreateOrder(env, p) {
  const r = await steadfastRequest(env, "/create_order", "POST", p);
  if (r.data && r.data.consignment) {
    const c = r.data.consignment;
    await steadfastSaveConsignments(env, [{
      consignment_id: c.consignment_id, invoice: c.invoice, tracking_code: c.tracking_code,
      recipient_name: c.recipient_name || "", recipient_phone: c.recipient_phone || "",
      recipient_address: c.recipient_address || "", cod_amount: Number(c.cod_amount) || 0,
      status: c.status || "in_review", note: c.note || "",
      api_response: JSON.stringify(r.data),
      created_at: c.created_at || new Date().toISOString(),
      updated_at: c.updated_at || new Date().toISOString()
    }]);
  }
  return r;
}

async function steadfastBulkCreate(env, p) {
  const orders = (p && (p.orders || p.data)) || (Array.isArray(p) ? p : []);
  const r = await steadfastRequest(env, "/create_order/bulk-order", "POST", { data: JSON.stringify(orders) });
  if (Array.isArray(r.data)) {
    const rows = r.data.filter(function(c){ return c && c.consignment_id; }).map(function(c){
      return {
        consignment_id: c.consignment_id, invoice: c.invoice, tracking_code: c.tracking_code,
        recipient_name: c.recipient_name || "", recipient_phone: c.recipient_phone || "",
        recipient_address: c.recipient_address || "", cod_amount: Number(c.cod_amount) || 0,
        status: c.status || (c.consignment_id ? "success" : "error"),
        note: c.note || "", api_response: JSON.stringify(c),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      };
    });
    await steadfastSaveConsignments(env, rows);
  }
  return r;
}

async function steadfastStatus(env, p) {
  const t = String(p.type || "cid").toLowerCase();
  const v = p.value || p.id || p.invoice || p.trackingcode || p.trackingCode;
  if (!v) return { success: false, ok: false, msg: "Missing id/invoice/trackingcode" };
  let path;
  if (t === "invoice") path = "/status_by_invoice/" + encodeURIComponent(v);
  else if (t === "trackingcode" || t === "tracking_code") path = "/status_by_trackingcode/" + encodeURIComponent(v);
  else path = "/status_by_cid/" + encodeURIComponent(v);
  const r = await steadfastRequest(env, path, "GET");
  if (r.data && r.data.delivery_status) {
    try {
      const col = t === "invoice" ? "invoice" : (t.startsWith("tracking") ? "tracking_code" : "consignment_id");
      await supabaseRequest(env, "steadfast_consignments?" + col + "=eq." + encodeURIComponent(v), {
        method: "PATCH",
        body: JSON.stringify({ status: r.data.delivery_status, updated_at: new Date().toISOString() })
      });
    } catch (e) {}
  }
  return r;
}

async function steadfastBalance(env) {
  const r = await steadfastRequest(env, "/get_balance", "GET");
  if (r.data && typeof r.data.current_balance !== "undefined") {
    try {
      await supabaseRequest(env, "steadfast_balance_cache", {
        method: "POST",
        body: JSON.stringify({ balance: Number(r.data.current_balance) || 0, fetched_at: new Date().toISOString() })
      });
    } catch (e) {}
  }
  return r;
}

async function steadfastCreateReturn(env, p) {
  return await steadfastRequest(env, "/create_return_request", "POST", p);
}

async function steadfastListReturns(env) {
  return await steadfastRequest(env, "/get_return_requests", "GET");
}

async function steadfastGetReturn(env, p) {
  const id = p && (p.id || p.return_id);
  if (!id) return { success: false, ok: false, msg: "Missing return id" };
  return await steadfastRequest(env, "/get_return_request/" + encodeURIComponent(id), "GET");
}

async function steadfastListPayments(env) {
  return await steadfastRequest(env, "/payments", "GET");
}

async function steadfastGetPayment(env, p) {
  const id = p && (p.id || p.payment_id);
  if (!id) return { success: false, ok: false, msg: "Missing payment id" };
  return await steadfastRequest(env, "/payments/" + encodeURIComponent(id), "GET");
}

async function steadfastPoliceStations(env) {
  return await steadfastRequest(env, "/police_stations", "GET");
}

async function steadfastSaveKeys(env, p) {
  const r = await getWriteDb(); await ensureAuth();
  const rows = (p.keys || [{ api_key: p.apiKey, secret_key: p.secretKey }]).map(function(k){
    return { name: k.name || "default", api_key: k.api_key || k.apiKey || "", secret_key: k.secret_key || k.secretKey || "", updated_at: new Date().toISOString() };
  });
  const up = await r.from("steadfast_keys").upsert(rows, { onConflict: "name" });
  if (up.error) throw new Error(up.error.message);
  return ok({ msg: "Keys saved", count: rows.length });
}

async function steadfastKeysList(env) {
  const r = await supabaseRequest(env, "steadfast_keys?select=name,updated_at&order=updated_at.desc", { method: "GET" });
  return { success: true, ok: true, data: r };
}

/* ============ AI AGENT CORE ============ */
// Backend brain of the multi-platform AI Agent system.
// Manages AI model calls, platform webhooks, conversation memory,
// rate limiting, human handover, and Telegram notifications.

// ----------------------- DEFAULT SETTINGS -----------------------
/** @type {object} Default AI agent settings; overridden by ai_settings row in DB. */
const DEFAULT_AI_SETTINGS = {
  active_model: 'gemini',
  platforms: { messenger: true, instagram: false, whatsapp: false, tiktok: false },
  rate_limit_per_min: 10,
  handover_keywords: ['admin', 'owner', 'human', 'মালিক', 'এডমিন'],
  delivery: { narayanganj_in: 80, narayanganj_out: 125 },
  greeting: 'আসসালামু আলাইকুম! YARZ Clothing-এ স্বাগতম। কীভাবে সাহায্য করতে পারি?',
  max_history: 20,
  model_params: {
    gemini:   { model: 'gemini-2.0-flash', max_tokens: 1024, temperature: 0.7 },
    minimax:  { model: 'MiniMax',           max_tokens: 1024, temperature: 0.7 },
    kimi:     { model: 'moonshot-v1-8k',    max_tokens: 1024, temperature: 0.7 },
    deepseek: { model: 'deepseek-chat',     max_tokens: 1024, temperature: 0.7 },
    chatgpt:  { model: 'gpt-4o-mini',       max_tokens: 1024, temperature: 0.7 },
    claude:   { model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, temperature: 0.7 }
  }
};

// ----------------------- IN-MEMORY STATE -----------------------
/** @type {Map<string, number[]>} sender_id -> recent message timestamps (ms). */
const rateLimitMap = new Map();
/** @type {Map<string, Array<{role: string, message: string, created_at: string}>>} sender_id -> last N messages. */
const memoryMap = new Map();

// ----------------------- SETTINGS LOADER -----------------------
/**
 * Load AI settings from DB (ai_settings table, single row keyed by id=1) with
 * fallback to DEFAULT_AI_SETTINGS. If DB is unavailable, returns defaults.
 * @param {object} env Worker env (used to call supabaseRequest).
 * @returns {Promise<object>} Merged settings object.
 */
async function loadSettings(env) {
  try {
    if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return DEFAULT_AI_SETTINGS;
    }
    const r = await supabaseRequest(env, "ai_settings?id=eq.1&select=*", { method: "GET" });
    if (Array.isArray(r) && r.length > 0 && r[0]) {
      const db = r[0];
      const merged = Object.assign({}, DEFAULT_AI_SETTINGS, db);
      merged.platforms = Object.assign({}, DEFAULT_AI_SETTINGS.platforms, db.platforms || {});
      merged.delivery  = Object.assign({}, DEFAULT_AI_SETTINGS.delivery,  db.delivery  || {});
      merged.handover_keywords = Array.isArray(db.handover_keywords) && db.handover_keywords.length > 0
        ? db.handover_keywords
        : DEFAULT_AI_SETTINGS.handover_keywords;
      merged.model_params = Object.assign({}, DEFAULT_AI_SETTINGS.model_params, db.model_params || {});
      return merged;
    }
  } catch (e) {
    console.error("[loadSettings] failed, using defaults:", e.message);
  }
  return DEFAULT_AI_SETTINGS;
}

/**
 * Persist AI settings back to DB (single-row upsert by id=1).
 * @param {object} env Worker env.
 * @param {object} settings Settings object to save.
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function saveSettings(env, settings) {
  try {
    const payload = Object.assign({ id: 1, updated_at: new Date().toISOString() }, settings || {});
    const r = await supabaseRequest(env, "ai_settings", {
      method: "POST",
      headers: { "Prefer": "resolution=merge-duplicates" },
      body: JSON.stringify([payload])
    });
    return { success: true, data: r };
  } catch (e) {
    console.error("[saveSettings] failed:", e.message);
    return { success: false, error: e.message };
  }
}

// ----------------------- RATE LIMITER -----------------------
/**
 * Check if sender has exceeded the per-minute message limit.
 * Increments the counter on allowed requests.
 * @param {string} senderId Platform-specific user id.
 * @param {number} maxPerMin Max messages allowed in a 60s window.
 * @returns {boolean} true if rate-limited (should drop message).
 */
function isRateLimited(senderId, maxPerMin) {
  if (!senderId || !maxPerMin || maxPerMin <= 0) return false;
  const now = Date.now();
  const cutoff = now - 60000;
  const arr = (rateLimitMap.get(senderId) || []).filter(function (t) { return t > cutoff; });
  if (arr.length >= maxPerMin) {
    rateLimitMap.set(senderId, arr);
    return true;
  }
  arr.push(now);
  rateLimitMap.set(senderId, arr);
  return false;
}

// ----------------------- HUMAN HANDOVER -----------------------
/**
 * Detect whether a customer message requests human handover.
 * Matches any keyword case-insensitively as a substring.
 * @param {string} message Customer text.
 * @param {string[]} keywords List of trigger words/phrases.
 * @returns {boolean} true if handover should be triggered.
 */
function detectHandover(message, keywords) {
  if (!message || !Array.isArray(keywords) || keywords.length === 0) return false;
  const lower = String(message).toLowerCase();
  for (let i = 0; i < keywords.length; i++) {
    if (lower.includes(String(keywords[i]).toLowerCase())) return true;
  }
  return false;
}

// ----------------------- CONVERSATION MEMORY -----------------------
/**
 * Get the last N messages for a sender. Tries Supabase ai_messages table
 * first; falls back to in-memory memoryMap.
 * @param {string} senderId
 * @param {object} env
 * @param {number} limit
 * @returns {Promise<Array<{role: string, message: string, created_at: string}>>}
 */
async function getRecentMessages(senderId, env, limit) {
  const max = limit || 20;
  if (!senderId) return [];
  // Try Supabase
  try {
    if (env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const r = await supabaseRequest(env,
        "ai_messages?sender_id=eq." + encodeURIComponent(senderId) +
        "&order=created_at.desc&limit=" + max + "&select=role,message,created_at",
        { method: "GET" }
      );
      if (Array.isArray(r)) {
        // Return in chronological order (oldest first)
        return r.reverse().map(function (m) {
          return { role: m.role, message: m.message, created_at: m.created_at };
        });
      }
    }
  } catch (e) {
    console.error("[getRecentMessages] DB fallback:", e.message);
  }
  // Fallback to memoryMap
  const arr = memoryMap.get(senderId) || [];
  return arr.slice(-max);
}

/**
 * Save a single chat message. Tries Supabase; also updates in-memory fallback.
 * @param {string} senderId
 * @param {string} platform One of: messenger, instagram, whatsapp, tiktok.
 * @param {string} role "user" or "assistant".
 * @param {string} message Text content.
 * @param {object} env
 * @returns {Promise<void>}
 */
async function saveMessage(senderId, platform, role, message, env) {
  if (!senderId || !role) return;
  const row = {
    sender_id: senderId,
    platform:  platform || "unknown",
    role:      role,
    message:   String(message || "").substring(0, 8000), // cap length
    created_at: new Date().toISOString()
  };
  // Try Supabase
  try {
    if (env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      await supabaseRequest(env, "ai_messages", {
        method: "POST",
        body: JSON.stringify(row)
      });
    }
  } catch (e) {
    console.error("[saveMessage] DB save failed:", e.message);
  }
  // Always update in-memory fallback (cap to last 40)
  const arr = memoryMap.get(senderId) || [];
  arr.push({ role: row.role, message: row.message, created_at: row.created_at });
  if (arr.length > 40) arr.splice(0, arr.length - 40);
  memoryMap.set(senderId, arr);
}

// ----------------------- SYSTEM PROMPT BUILDER -----------------------
/**
 * Build the system prompt that instructs the AI to behave as a human moderator.
 * @param {object} settings AI settings (delivery, model, etc.).
 * @param {string} [inventorySummary] Optional summary of in-stock products.
 * @returns {string} The system prompt text.
 */
function buildSystemPrompt(settings, inventorySummary) {
  const deliv = (settings && settings.delivery) || DEFAULT_AI_SETTINGS.delivery;
  const inv = inventorySummary || "YARZ Clothing-এর বর্তমানে বিভিন্ন সাইজের (S, M, L, XL, XXL, 3XL) প্রিমিয়াম পোশাক স্টকে আছে।";
  return [
    'তুমি হলে YARZ Clothing-এর একজন মানুষ মডারেটর। তোমার নাম "YARZ Support"।',
    'গুরুত্বপূর্ণ: কখনো বলবে না যে তুমি AI, রোবট, বা চ্যাটবট। তুমি একজন সহানুভূতিশীল বাংলাদেশি মডারেটর।',
    '',
    'ভাষা: প্রধানত বাংলায় কথা বলবে। প্রয়োজনে ইংরেজি বা বাংলা+ইংরেজি মিক্স ব্যবহার করতে পারো।',
    'টোন: উষ্ণ, পেশাদার, সংক্ষিপ্ত কিন্তু সহায়ক। অপ্রয়োজনীয় লম্বা মেসেজ লিখবে না।',
    '',
    'ইনভেন্টরি (স্টকে আছে):',
    inv,
    '',
    'অর্ডার নেওয়ার নিয়ম:',
    '1. যখন কেউ অর্ডার/কেনাকাটা করতে চাইবে, তখন নিচের ফরম্যাটে তথ্য চাইবে (বাংলায়):',
    '   Name:',
    '   Phone Number:',
    '   Full Address:',
    '   Product Size:',
    '   Quantity:',
    '2. কাস্টমার সব তথ্য দিলে নিচের ফরম্যাটে কনফার্মেশন দেবে:',
    '   Name: ...',
    '   Phone Number: ...',
    '   Full Address: ...',
    '   Product: ...',
    '   Size: ...',
    '   Quantity: ...',
    '   Price: ৳...',
    '   Delivery Charge: ৳' + deliv.narayanganj_in + ' (নারায়ণগঞ্জের ভিতরে) অথবা ৳' + deliv.narayanganj_out + ' (নারায়ণগঞ্জের বাইরে)',
    '   Total: ৳...',
    '3. ডেলিভারি চার্জ নির্ধারণ: ঠিকানায় "নারায়ণগঞ্জ" শব্দ থাকলে ভিতরে (৳' + deliv.narayanganj_in + '), না থাকলে বাইরে (৳' + deliv.narayanganj_out + ').',
    '',
    'সাধারণ নিয়ম:',
    '- প্রোডাক্ট, সাইজ, দাম সম্পর্কে প্রশ্নের উত্তর দাও।',
    '- স্টক না থাকলে জানাও এবং কাছাকাছি বিকল্প সাজেস্ট করো।',
    '- দাম বা স্টক নিশ্চিত না হলে বলো "আমি মডারেটর টিমের সাথে চেক করে জানাচ্ছি"।',
    '- কাস্টমার "এডমিন/মালিক/owner" বলে ডাকলে মেসেজ ফরওয়ার্ড করো (তুমি বলবে "আপনার মেসেজ মডারেটর টিমকে পাঠানো হয়েছে")।',
    '- কখনো নিজে AI বা চ্যাটবট বলে পরিচয় দিও না।',
    '- একই মেসেজ বারবার দিও না; সংক্ষেপে ও স্পষ্টভাবে উত্তর দাও।'
  ].join('\n');
}

// ----------------------- AI MODEL ADAPTERS -----------------------
/**
 * Normalize memory messages to OpenAI-style {role, content} array.
 * @param {Array<{role: string, message: string}>} messages
 * @returns {Array<{role: string, content: string}>}
 */
function toOpenAIMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(function (m) {
    return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.message || "") };
  });
}

/**
 * Internal fetch wrapper for OpenAI-compatible chat APIs. Returns string reply or {error}.
 * @param {string} url API endpoint
 * @param {string} apiKey Bearer token
 * @param {string} model Model name to send
 * @param {Array<{role: string, content: string}>} oaMessages Normalized messages
 * @param {object} params {max_tokens, temperature}
 * @returns {Promise<string|{error: string}>}
 */
async function callOpenAICompat(url, apiKey, model, oaMessages, params) {
  if (!apiKey) return { error: "API key not configured" };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: oaMessages,
        max_tokens: (params && params.max_tokens) || 1024,
        temperature: (params && params.temperature != null) ? params.temperature : 0.7
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      const errMsg = (data && data.error && (data.error.message || data.error.code || data.error)) || data.message || ("HTTP " + resp.status);
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return text ? String(text).trim() : { error: "Empty response" };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Call Google Gemini API (gemini-2.0-flash by default).
 * @param {Array<{role: string, message: string}>} messages
 * @param {string} systemPrompt
 * @param {string} apiKey
 * @param {object} params
 * @returns {Promise<string|{error: string}>}
 */
async function callGemini(messages, systemPrompt, apiKey, params) {
  if (!apiKey) return { error: "Gemini API key not configured" };
  try {
    const contents = (Array.isArray(messages) ? messages : []).map(function (m) {
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.message || "") }]
      };
    });
    const body = {
      contents: contents,
      systemInstruction: { parts: [{ text: String(systemPrompt || "") }] },
      generationConfig: {
        maxOutputTokens: (params && params.max_tokens) || 1024,
        temperature: (params && params.temperature != null) ? params.temperature : 0.7
      }
    };
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
      ((params && params.model) || "gemini-2.0-flash") +
      ":generateContent?key=" + encodeURIComponent(apiKey);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      const errMsg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    const text = data && data.candidates && data.candidates[0] &&
                 data.candidates[0].content && data.candidates[0].content.parts &&
                 data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    return text ? String(text).trim() : { error: "Empty Gemini response" };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Call Anthropic Claude API (messages endpoint).
 * @param {Array<{role: string, content: string}>} oaMessages
 * @param {string} systemPrompt
 * @param {string} apiKey
 * @param {object} params
 * @returns {Promise<string|{error: string}>}
 */
async function callClaude(oaMessages, systemPrompt, apiKey, params) {
  if (!apiKey) return { error: "Claude API key not configured" };
  try {
    const msgs = (Array.isArray(oaMessages) ? oaMessages : []).map(function (m) {
      return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") };
    });
    const body = {
      model: (params && params.model) || "claude-3-5-sonnet-20241022",
      max_tokens: (params && params.max_tokens) || 1024,
      system: String(systemPrompt || ""),
      messages: msgs,
      temperature: (params && params.temperature != null) ? params.temperature : 0.7
    };
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      const errMsg = (data && data.error && data.error.message) || ("HTTP " + resp.status);
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    if (Array.isArray(data && data.content)) {
      const parts = data.content.filter(function (b) { return b && b.type === "text" && b.text; });
      const text = parts.map(function (b) { return b.text; }).join("\n");
      return text ? text.trim() : { error: "Empty Claude response" };
    }
    return { error: "Unexpected Claude response shape" };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Dispatcher: call the configured AI model with messages + system prompt.
 * @param {string} modelName One of: gemini, minimax, kimi, deepseek, chatgpt, claude.
 * @param {Array<{role: string, message: string}>} messages
 * @param {string} systemPrompt
 * @param {object} env Worker env (provides API keys).
 * @param {object} [params] Optional model_params override.
 * @returns {Promise<string|{error: string}>}
 */
async function callAIModel(modelName, messages, systemPrompt, env, params) {
  const m = String(modelName || "").toLowerCase();
  const oa = toOpenAIMessages(messages);
  const mp = (params && params.model_params) || (DEFAULT_AI_SETTINGS.model_params[m]) || {};
  switch (m) {
    case "gemini":
      return await callGemini(messages, systemPrompt, env.GEMINI_API_KEY, mp);
    case "claude":
      return await callClaude(oa, systemPrompt, env.CLAUDE_API_KEY, mp);
    case "minimax":
      return await callOpenAICompat("https://api.MiniMax.chat/v1/text/chatcompletion_v2", env.MINIMAX_API_KEY, mp.model, oa, mp);
    case "kimi":
      return await callOpenAICompat("https://api.moonshot.cn/v1/chat/completions", env.KIMI_API_KEY || env.MOONSHOT_API_KEY, mp.model, oa, mp);
    case "deepseek":
      return await callOpenAICompat("https://api.deepseek.com/v1/chat/completions", env.DEEPSEEK_API_KEY, mp.model, oa, mp);
    case "chatgpt":
      return await callOpenAICompat("https://api.openai.com/v1/chat/completions", env.OPENAI_API_KEY || env.CHATGPT_API_KEY, mp.model, oa, mp);
    default:
      return { error: "Unknown model: " + modelName };
  }
}

// ----------------------- TELEGRAM HELPER -----------------------
/**
 * Send a message to the configured Telegram chat (for handover / order notifications).
 * @param {object} env Worker env.
 * @param {string} text Plain or HTML text (max 4096 chars).
 * @param {object} [opts] Optional {parse_mode: 'HTML'|'Markdown', chat_id: override}.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function notifyTelegram(env, text, opts) {
  const token = env && env.TELEGRAM_BOT_TOKEN;
  const chatId = (opts && opts.chat_id) || (env && env.TELEGRAM_CHAT_ID);
  if (!token || !chatId) return { success: false, error: "Telegram not configured" };
  try {
    const resp = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text || "").substring(0, 4096),
        parse_mode: (opts && opts.parse_mode) || "HTML"
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || (data && data.ok === false)) {
      return { success: false, error: (data && data.description) || ("HTTP " + resp.status) };
    }
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Forward a handover message to Telegram.
 * @param {object} env
 * @param {{senderId: string, platform: string, message: string, customerName?: string}} info
 * @returns {Promise<void>}
 */
async function forwardToTelegram(env, info) {
  const customerName = info.customerName || "Unknown";
  const platform = info.platform || "unknown";
  const senderId = info.senderId || "";
  const text = [
    "🔔 <b>Human Handover Request</b>",
    "Platform: <code>" + platform + "</code>",
    "Customer: <code>" + customerName + "</code>",
    "Sender ID: <code>" + senderId + "</code>",
    "",
    "Message:",
    String(info.message || "").substring(0, 2000)
  ].join("\n");
  await notifyTelegram(env, text, { parse_mode: "HTML" });
}

// ----------------------- PLATFORM SENDERS -----------------------
/**
 * Send a Messenger reply via Meta Send API.
 * @param {object} env
 * @param {string} recipientId PSID
 * @param {string} text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendMessengerReply(env, recipientId, text) {
  const token = env.MESSENGER_PAGE_TOKEN;
  if (!token) return { success: false, error: "Messenger token not configured" };
  try {
    const resp = await fetch("https://graph.facebook.com/v18.0/me/messages?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: String(text || "").substring(0, 2000) }
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || (data && data.error)) {
      return { success: false, error: (data && data.error && (data.error.message || data.error.code)) || ("HTTP " + resp.status) };
    }
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Send an Instagram reply via Meta Send API (same graph endpoint as Messenger,
 * different access token and recipient.id semantics).
 * @param {object} env
 * @param {string} recipientId IGSID
 * @param {string} text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendInstagramReply(env, recipientId, text) {
  const token = env.INSTAGRAM_PAGE_TOKEN;
  if (!token) return { success: false, error: "Instagram token not configured" };
  try {
    const resp = await fetch("https://graph.facebook.com/v18.0/me/messages?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: String(text || "").substring(0, 2000) }
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || (data && data.error)) {
      return { success: false, error: (data && data.error && (data.error.message || data.error.code)) || ("HTTP " + resp.status) };
    }
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Send a WhatsApp reply via Meta Cloud API.
 * @param {object} env
 * @param {string} recipientPhone E.164 phone (e.g. +8801...)
 * @param {string} text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendWhatsAppReply(env, recipientPhone, text) {
  const token = env.WHATSAPP_TOKEN;
  const phoneId = env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return { success: false, error: "WhatsApp not configured" };
  try {
    const resp = await fetch("https://graph.facebook.com/v18.0/" + encodeURIComponent(phoneId) + "/messages", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipientPhone,
        type: "text",
        text: { body: String(text || "").substring(0, 4000) }
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || (data && data.error)) {
      return { success: false, error: (data && data.error && (data.error.message || data.error.code)) || ("HTTP " + resp.status) };
    }
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Send a TikTok reply (TikTok Messaging API is closed-beta and may change).
 * @param {object} env
 * @param {string} recipientId Open ID / Conversation ID
 * @param {string} text
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendTikTokReply(env, recipientId, text) {
  const token = env.TIKTOK_ACCESS_TOKEN;
  if (!token) return { success: false, error: "TikTok access token not configured" };
  try {
    const resp = await fetch("https://open.tiktokapis.com/v2/message/send/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recipient: { conversation_id: recipientId },
        message: { type: "text", text: String(text || "").substring(0, 4000) }
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || (data && data.error)) {
      const errMsg = data && (typeof data.error === "string" ? data.error : (data.error.message || data.error.code));
      return { success: false, error: errMsg || ("HTTP " + resp.status) };
    }
    return { success: true, data: data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ----------------------- MAIN AGENT HANDLER -----------------------
/**
 * Main agent dispatcher. Takes a normalized message envelope, applies rate-limit
 * / handover / platform-toggle checks, calls the AI model, persists memory,
 * and returns a structured reply.
 * @param {object} env
 * @param {{senderId: string, platform: string, message: string, imageUrl?: string, customerName?: string}} input
 * @returns {Promise<{reply: string|null, reason?: string, error?: string}>}
 */
async function handleAgentMessage(env, input) {
  const senderId = input && input.senderId;
  const platform = String((input && input.platform) || "").toLowerCase();
  const message = String((input && input.message) || "").trim();
  if (!senderId || !platform || !message) {
    return { reply: null, reason: "invalid_input" };
  }
  let settings;
  try {
    settings = await loadSettings(env);
  } catch (e) {
    return { reply: null, reason: "settings_error", error: e.message };
  }
  // Platform toggle
  if (!settings.platforms || !settings.platforms[platform]) {
    return { reply: null, reason: "platform_off" };
  }
  // Rate limit
  if (isRateLimited(senderId, settings.rate_limit_per_min || 10)) {
    return { reply: null, reason: "rate_limited" };
  }
  // Human handover
  if (detectHandover(message, settings.handover_keywords)) {
    try {
      await forwardToTelegram(env, {
        senderId: senderId,
        platform: platform,
        message: message,
        customerName: (input && input.customerName) || ""
      });
    } catch (e) {
      console.error("[handover] forward failed:", e.message);
    }
    const handoverReply = "আপনার মেসেজ আমাদের মডারেটরের কাছে পাঠানো হয়েছে। শিঘ্রই উত্তর দেওয়া হবে।";
    await saveMessage(senderId, platform, "user", message, env);
    await saveMessage(senderId, platform, "assistant", handoverReply, env);
    return { reply: handoverReply, reason: "handover" };
  }
  // Load history
  let history = [];
  try {
    history = await getRecentMessages(senderId, env, settings.max_history || 20);
  } catch (e) {
    console.error("[history] load failed:", e.message);
  }
  const messages = history.concat([{ role: "user", message: message }]);
  // Call AI
  const sys = buildSystemPrompt(settings);
  const aiResp = await callAIModel(settings.active_model, messages, sys, env);
  if (!aiResp || typeof aiResp !== "string") {
    const err = (aiResp && aiResp.error) || "Unknown AI error";
    return { reply: null, reason: "ai_error", error: err };
  }
  // Persist
  await saveMessage(senderId, platform, "user", message, env);
  await saveMessage(senderId, platform, "assistant", aiResp, env);
  return { reply: aiResp };
}

// ----------------------- PLATFORM WEBHOOK HANDLERS -----------------------
/**
 * Handle Meta Messenger webhook (POST). Expected payload: standard Meta webhook
 * envelope with entry[].messaging[] containing sender.id and message.text.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleMessengerWebhook(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const entries = (payload && payload.entry) || [];
  const results = [];
  for (const entry of entries) {
    const events = entry.messaging || [];
    for (const ev of events) {
      const senderId = ev.sender && ev.sender.id;
      const msg = ev.message;
      if (!senderId || !msg) continue;
      const attachmentUrl = (msg.attachments && msg.attachments[0] && msg.attachments[0].payload && msg.attachments[0].payload.url) || "";
      const text = msg.text || attachmentUrl || "";
      const r = await handleAgentMessage(env, {
        senderId: senderId,
        platform: "messenger",
        message: text,
        imageUrl: attachmentUrl || undefined,
        customerName: ""
      });
      if (r && r.reply) {
        await sendMessengerReply(env, senderId, r.reply);
      }
      results.push({ sender_id: senderId, reply: r.reply, reason: r.reason || null });
    }
  }
  return jsonResponse({ success: true, data: results });
}

/**
 * Handle Instagram webhook (POST). Same envelope shape as Messenger.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleInstagramWebhook(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const entries = (payload && payload.entry) || [];
  const results = [];
  for (const entry of entries) {
    const events = entry.messaging || [];
    for (const ev of events) {
      const senderId = ev.sender && ev.sender.id;
      const msg = ev.message;
      if (!senderId || !msg) continue;
      const text = msg.text || "";
      const r = await handleAgentMessage(env, {
        senderId: senderId,
        platform: "instagram",
        message: text,
        customerName: ""
      });
      if (r && r.reply) {
        await sendInstagramReply(env, senderId, r.reply);
      }
      results.push({ sender_id: senderId, reply: r.reply, reason: r.reason || null });
    }
  }
  return jsonResponse({ success: true, data: results });
}

/**
 * Handle WhatsApp Cloud API webhook (POST). Payload shape:
 *   entry[0].changes[0].value.messages[] with from + text.body.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleWhatsAppWebhook(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const changes = (((payload || {}).entry || [])[0] || {}).changes || [];
  const results = [];
  for (const ch of changes) {
    const value = ch.value || {};
    const messages = value.messages || [];
    const contactName = (((value.contacts || [])[0] || {}).profile || {}).name || "";
    for (const m of messages) {
      const senderId = m.from; // phone number
      const text = (m.text && m.text.body) || "";
      if (!senderId || !text) continue;
      const r = await handleAgentMessage(env, {
        senderId: senderId,
        platform: "whatsapp",
        message: text,
        customerName: contactName
      });
      if (r && r.reply) {
        await sendWhatsAppReply(env, senderId, r.reply);
      }
      results.push({ sender_id: senderId, reply: r.reply, reason: r.reason || null });
    }
  }
  return jsonResponse({ success: true, data: results });
}

/**
 * Handle TikTok Messaging webhook (POST). Envelope shape is best-effort and
 * may evolve as the TikTok Messaging API exits closed beta.
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleTikTokWebhook(request, env) {
  let payload;
  try { payload = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const events = (payload && (payload.events || payload.messages)) || [];
  const results = [];
  for (const ev of events) {
    const senderId = (ev.sender && (ev.sender.open_id || ev.sender.id)) || ev.conversation_id;
    const msg = ev.message || ev;
    const text = (msg && (msg.text || (msg.content && msg.content.text))) || "";
    if (!senderId || !text) continue;
    const r = await handleAgentMessage(env, {
      senderId: senderId,
      platform: "tiktok",
      message: text,
      customerName: (ev.sender && ev.sender.display_name) || ""
    });
    if (r && r.reply) {
      await sendTikTokReply(env, senderId, r.reply);
    }
    results.push({ sender_id: senderId, reply: r.reply, reason: r.reason || null });
  }
  return jsonResponse({ success: true, data: results });
}

// ----------------------- AGENT ORDER / FORWARD HANDLERS -----------------------
/**
 * Save a new order to Supabase (website_orders table) and notify Telegram.
 * @param {object} env
 * @param {object} order {order_id?, sender_id, platform, cust_name, cust_phone, cust_addr, deliv_zone, product, size, qty, price, delivery_charge, total?}
 * @returns {Promise<{success: boolean, orderId?: string, error?: string}>}
 */
async function createAgentOrder(env, order) {
  const orderId = (order && order.order_id) || ("AGT-" + Date.now() + "-" + Math.floor(Math.random() * 10000));
  const row = {
    order_id: orderId,
    cust_name: (order && order.cust_name) || "",
    cust_phone: (order && order.cust_phone) || "",
    cust_addr: (order && order.cust_addr) || "",
    product: (order && order.product) || "",
    size: (order && order.size) || "",
    qty: Number(order && order.qty) || 1,
    price: Number(order && order.price) || 0,
    delivery_charge: Number(order && order.delivery_charge) || 0,
    total: Number(order && order.total) ||
           ((Number(order && order.price) || 0) * (Number(order && order.qty) || 1) + (Number(order && order.delivery_charge) || 0)),
    status: "Pending",
    payment: (order && order.payment) || "Cash on Delivery",
    notes: (order && order.notes) || ("AI Agent order from " + ((order && order.platform) || "unknown")),
    created_at: new Date().toISOString(),
    sender_id: (order && order.sender_id) || "",
    platform: (order && order.platform) || "",
    deliv_zone: (order && order.deliv_zone) || ""
  };
  try {
    await supabaseRequest(env, "website_orders", { method: "POST", body: JSON.stringify(row) });
  } catch (e) {
    console.error("[createAgentOrder] DB insert failed:", e.message);
    return { success: false, error: e.message };
  }
  // Telegram notification
  const tgText = [
    "🛒 <b>New AI Agent Order</b>",
    "Order: <code>" + orderId + "</code>",
    "Customer: " + row.cust_name + " (" + row.cust_phone + ")",
    "Product: " + row.product + " / Size " + row.size + " ×" + row.qty,
    "Total: ৳" + row.total + " (Delivery ৳" + row.delivery_charge + ")",
    "Address: " + row.cust_addr,
    "Platform: <code>" + row.platform + "</code>"
  ].join("\n");
  await notifyTelegram(env, tgText, { parse_mode: "HTML" });
  return { success: true, orderId: orderId };
}

// ----------------------- AGENT ROUTE DISPATCHERS -----------------------
/**
 * Generic agent webhook that auto-detects platform from payload and routes
 * the message through the agent pipeline. Sends the reply back via the
 * corresponding platform Send API.
 * Body shape: { platform, sender_id, message, customer_name? }
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentWebhook(request, env) {
  // Auth check: require X-Agent-Secret header
  const providedSecret = request.headers.get("x-agent-secret") || "";
  const expectedSecret = (env && env.AGENT_SECRET) || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const platform = String(body.platform || "").toLowerCase();
  const senderId = body.sender_id || body.senderId;
  const message = body.message || body.text || "";
  const customerName = body.customer_name || body.customerName || "";
  const r = await handleAgentMessage(env, {
    senderId: senderId,
    platform: platform,
    message: message,
    customerName: customerName
  });
  if (r && r.reply) {
    if (platform === "messenger")      await sendMessengerReply(env, senderId, r.reply);
    else if (platform === "instagram") await sendInstagramReply(env, senderId, r.reply);
    else if (platform === "whatsapp")  await sendWhatsAppReply(env, senderId, r.reply);
    else if (platform === "tiktok")    await sendTikTokReply(env, senderId, r.reply);
  }
  return jsonResponse({ success: true, data: r });
}

/**
 * Manually push a message to a customer (used by Telegram bot when a human
 * moderator replies to a handover thread). Body: { platform, recipient, text }
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentSend(request, env) {
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const platform = String(body.platform || "").toLowerCase();
  const recipient = body.recipient || body.sender_id;
  const text = body.text || body.message || "";
  if (!platform || !recipient || !text) {
    return jsonResponse({ success: false, error: "Missing platform/recipient/text" }, 400);
  }
  let r;
  if (platform === "messenger")      r = await sendMessengerReply(env, recipient, text);
  else if (platform === "instagram") r = await sendInstagramReply(env, recipient, text);
  else if (platform === "whatsapp")  r = await sendWhatsAppReply(env, recipient, text);
  else if (platform === "tiktok")    r = await sendTikTokReply(env, recipient, text);
  else return jsonResponse({ success: false, error: "Unknown platform: " + platform }, 400);
  // Persist as assistant message
  await saveMessage(recipient, platform, "assistant", text, env);
  return jsonResponse({ success: !!(r && r.success), data: r });
}

/**
 * GET  -> return current AI settings (DB row merged with defaults).
 * POST -> upsert new settings (replaces ai_settings row id=1).
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentSettings(request, env) {
  if (request.method === "GET") {
    const settings = await loadSettings(env);
    return jsonResponse({ success: true, data: settings });
  }
  if (request.method === "POST") {
    // Auth check: require X-Agent-Secret header (set in Telegram bot + admin panel)
    const providedSecret = request.headers.get("x-agent-secret") || "";
    const expectedSecret = (env && env.AGENT_SECRET) || "";
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    let body;
    try { body = await request.json(); } catch (e) {
      return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
    }
    const r = await saveSettings(env, body || {});
    return jsonResponse(r, r.success ? 200 : 500);
  }
  return jsonResponse({ success: false, error: "Method not allowed" }, 405);
}

/**
 * Admin-panel test chat. Body: { message, model? }
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentTest(request, env) {
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const message = body.message || body.text || "";
  const modelOverride = body.model || "";
  if (!message) return jsonResponse({ success: false, error: "Missing message" }, 400);
  const settings = await loadSettings(env);
  const model = modelOverride || settings.active_model || "gemini";
  const sys = buildSystemPrompt(settings);
  const aiResp = await callAIModel(model, [{ role: "user", message: message }], sys, env);
  return jsonResponse({
    success: !!(aiResp && typeof aiResp === "string"),
    data: { reply: aiResp, model: model }
  });
}

/**
 * AI-confirmed order placement. Body: order fields (cust_phone, product required).
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentOrderNew(request, env) {
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!body.cust_phone || !body.product) {
    return jsonResponse({ success: false, error: "cust_phone and product are required" }, 400);
  }
  const r = await createAgentOrder(env, body);
  return jsonResponse(r, r.success ? 200 : 500);
}

/**
 * Manually forward a message to Telegram. Body: { sender_id, platform, message, customer_name? }
 * @param {Request} request
 * @param {object} env
 * @returns {Promise<Response>}
 */
async function handleAgentForward(request, env) {
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  await forwardToTelegram(env, {
    senderId: body.sender_id || "",
    platform: body.platform || "manual",
    message: body.message || body.text || "",
    customerName: body.customer_name || ""
  });
  return jsonResponse({ success: true });
}

/**
 * Business AI Agent — answers questions about sales, profit, loss, inventory, etc.
 * Body: { question: string }
 */
async function handleAgentAsk(request, env) {
  let body;
  try { body = await request.json(); } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const question = body.question || "";
  if (!question) return jsonResponse({ success: false, error: "Missing question" }, 400);

  try {
    // Fetch today's data from Supabase
    const bdNow = new Date(Date.now() + 6 * 3600000);
    const todayStr = bdNow.toISOString().slice(0, 10);
    const monthStart = bdNow.toISOString().slice(0, 7) + "-01";

    // Fetch ALL relevant data in parallel
    const [todayTx, todayAd, todayExp, monthTx, inventory, monthOrders, monthAd, monthExp, manualOrders, customers, blockedDevices, visitors, newsletters, consignments] = await Promise.all([
      supabaseRequest(env, "transactions?select=product,qty,revenue,cost,profit,type,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "ad_tracker?select=product,spend,reach,impressions,clicks,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "expenses?select=category,description,amount,notes,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "transactions?select=product,qty,revenue,cost,profit,type,date&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "inventory?select=product,status,category,fabric,badge,cost,regular,sale,stk_s,stk_m,stk_l,stk_xl,stk_xxl,stk_3xl,sold_s,sold_m,sold_l,sold_xl,sold_xxl,sold_3xl,invest,revenue,fb_ad,net&status=eq.Active&order=product.asc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "website_orders?select=order_id,product,qty,total,status,date,cust_name,cust_phone,deliv_zone,delivery_charge,payment&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "ad_tracker?select=product,spend,reach,impressions,clicks,date&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "expenses?select=category,description,amount,notes,date&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "orders?select=order_id,product,qty,total,status,date,cust_name,cust_phone,deliv_zone,delivery_charge,payment,size,notes&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "customers?select=phone,name,total_orders,total_spent,risk_score,is_blocked,last_order_at,created_at&order=total_spent.desc&limit=50", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "blocked_devices?select=device_id,block_reason,block_type,status,phones_seen,ips_seen,risk_score,order_attempts,created_at&order=created_at.desc&limit=20", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "website_visitors?select=visit_date,visit_count&order=visit_date.desc&limit=7", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "newsletter_subscribers?select=email,phone,source,subscribed_at&order=subscribed_at.desc", { method: "GET" }).catch(function() { return []; }),
      supabaseRequest(env, "steadfast_consignments?select=consignment_id,tracking_code,recipient_name,recipient_phone,cod_amount,status,item_description,created_at&order=created_at.desc&limit=20", { method: "GET" }).catch(function() { return []; }),
    ]);

    // Calculate today's stats
    const todayRev = (Array.isArray(todayTx) ? todayTx : []).reduce(function(s, t) { return s + (Number(t.revenue) || 0); }, 0);
    const todayCost = (Array.isArray(todayTx) ? todayTx : []).reduce(function(s, t) { return s + (Number(t.cost) || 0); }, 0);
    const todayGross = todayRev - todayCost;
    const todayAdSpend = (Array.isArray(todayAd) ? todayAd : []).reduce(function(s, t) { return s + (Number(t.spend) || 0); }, 0);
    const todayOtherExp = (Array.isArray(todayExp) ? todayExp : []).reduce(function(s, t) { return s + (Number(t.amount) || 0); }, 0);
    const todaySalesCount = (Array.isArray(todayTx) ? todayTx : []).filter(function(t) { return t.type === "Sale"; }).length;
    const todayReturnCount = (Array.isArray(todayTx) ? todayTx : []).filter(function(t) { return t.type === "Return"; }).length;

    // Calculate this month's stats
    const monthRev = (Array.isArray(monthTx) ? monthTx : []).reduce(function(s, t) { return s + (Number(t.revenue) || 0); }, 0);
    const monthCost = (Array.isArray(monthTx) ? monthTx : []).reduce(function(s, t) { return s + (Number(t.cost) || 0); }, 0);
    const monthGross = monthRev - monthCost;

    // Build context for AI
    var context = "=== YARZ CLOTHING BUSINESS DATA ===\n\n";
    context += "TODAY (" + todayStr + "):\n";
    context += "- Total Sales: " + todaySalesCount + " orders, " + todayReturnCount + " returns\n";
    context += "- Revenue: ৳" + todayRev.toLocaleString() + "\n";
    context += "- Cost of Goods: ৳" + todayCost.toLocaleString() + "\n";
    context += "- Gross Profit: ৳" + todayGross.toLocaleString() + "\n";
    context += "- Ad Spend: ৳" + todayAdSpend.toLocaleString() + "\n";
    context += "- Other Expenses: ৳" + todayOtherExp.toLocaleString() + "\n";
    context += "- Today's Products Sold:\n";
    (Array.isArray(todayTx) ? todayTx : []).forEach(function(t) {
      context += "  • " + t.product + " (x" + t.qty + ") — ৳" + t.revenue + " revenue, ৳" + t.cost + " cost, " + t.type + "\n";
    });
    context += "- Today's Ad Spend:\n";
    (Array.isArray(todayAd) ? todayAd : []).forEach(function(a) {
      context += "  • " + a.product + " — ৳" + a.spend + "\n";
    });
    // Product-wise sales breakdown (this month)
    var productSales = {};
    (Array.isArray(monthTx) ? monthTx : []).forEach(function(t) {
      var name = t.product || "Unknown";
      if (!productSales[name]) productSales[name] = { qty: 0, revenue: 0, cost: 0, count: 0 };
      productSales[name].qty += Number(t.qty) || 0;
      productSales[name].revenue += Number(t.revenue) || 0;
      productSales[name].cost += Number(t.cost) || 0;
      productSales[name].count += 1;
    });

    // Ad spend by product (this month)
    var adByProduct = {};
    var monthAdTotal = 0;
    (Array.isArray(monthAd) ? monthAd : []).forEach(function(a) {
      var name = a.product || "General";
      adByProduct[name] = (adByProduct[name] || 0) + (Number(a.spend) || 0);
      monthAdTotal += Number(a.spend) || 0;
    });

    // Monthly expenses total
    var monthExpTotal = 0;
    (Array.isArray(monthExp) ? monthExp : []).forEach(function(e) {
      monthExpTotal += Number(e.amount) || 0;
    });

    // Order stats (this month)
    var orderArr = Array.isArray(monthOrders) ? monthOrders : [];
    var orderPending = orderArr.filter(function(o) { return o.status === "Pending"; });
    var orderProcessing = orderArr.filter(function(o) { return o.status === "Processing"; });
    var orderDelivered = orderArr.filter(function(o) { return o.status === "Delivered"; });
    var orderCancelled = orderArr.filter(function(o) { return o.status === "Cancelled"; });
    var orderTotalRevenue = orderArr.reduce(function(s, o) { return s + (Number(o.total) || 0); }, 0);

    context += "\nTHIS MONTH (since " + monthStart + "):\n";
    context += "- Revenue (Sales): ৳" + monthRev.toLocaleString() + "\n";
    context += "- Cost (Sales): ৳" + monthCost.toLocaleString() + "\n";
    context += "- Gross Profit: ৳" + monthGross.toLocaleString() + "\n";
    context += "- Total Transactions: " + (Array.isArray(monthTx) ? monthTx.length : 0) + "\n";
    context += "- Total Ad Spend: ৳" + monthAdTotal.toLocaleString() + "\n";
    context += "- Total Other Expenses: ৳" + monthExpTotal.toLocaleString() + "\n";
    context += "- Net Profit (after ads+expenses): ৳" + (monthGross - monthAdTotal - monthExpTotal).toLocaleString() + "\n";
    context += "\nORDERS (website orders this month): " + orderArr.length + " total\n";
    context += "- Pending: " + orderPending.length + " orders\n";
    context += "- Processing: " + orderProcessing.length + " orders\n";
    context += "- Delivered: " + orderDelivered.length + " orders\n";
    context += "- Cancelled: " + orderCancelled.length + " orders\n";
    context += "- Order Revenue: ৳" + orderTotalRevenue.toLocaleString() + "\n";
    if (orderPending.length > 0) {
      context += "- PENDING ORDERS:\n";
      orderPending.slice(0, 10).forEach(function(o) {
        context += "  • " + o.order_id + " | " + o.product + " x" + o.qty + " | ৳" + o.total + " | " + (o.cust_name || "N/A") + "\n";
      });
    }
    if (orderProcessing.length > 0) {
      context += "- PROCESSING ORDERS:\n";
      orderProcessing.slice(0, 10).forEach(function(o) {
        context += "  • " + o.order_id + " | " + o.product + " x" + o.qty + " | ৳" + o.total + " | " + (o.cust_name || "N/A") + "\n";
      });
    }
    context += "\nPRODUCT-WISE SALES (this month):\n";
    Object.keys(productSales).sort(function(a, b) { return productSales[b].revenue - productSales[a].revenue; }).forEach(function(name) {
      var p = productSales[name];
      var profit = p.revenue - p.cost;
      context += "  • " + name + ": " + p.count + " orders, " + p.qty + " units, ৳" + p.revenue.toLocaleString() + " revenue, ৳" + profit.toLocaleString() + " profit\n";
    });
    context += "\nAD SPEND BY PRODUCT (this month):\n";
    Object.keys(adByProduct).sort(function(a, b) { return adByProduct[b] - adByProduct[a]; }).forEach(function(name) {
      context += "  • " + name + ": ৳" + adByProduct[name].toLocaleString() + "\n";
    });
    context += "\nINVENTORY (current stock):\n";
    (Array.isArray(inventory) ? inventory : []).forEach(function(p) {
      var stock = (Number(p.stk_s)||0) + (Number(p.stk_m)||0) + (Number(p.stk_l)||0) + (Number(p.stk_xl)||0) + (Number(p.stk_xxl)||0) + (Number(p.stk_3xl)||0);
      var sold = (Number(p.sold_s)||0) + (Number(p.sold_m)||0) + (Number(p.sold_l)||0) + (Number(p.sold_xl)||0) + (Number(p.sold_xxl)||0) + (Number(p.sold_3xl)||0);
      context += "  • " + p.product + ": stock=" + stock + ", sold=" + sold + ", cost=৳" + p.cost + ", regular=৳" + p.regular + ", sale=৳" + (p.sale || "N/A") + ", net=৳" + (p.net || 0) + ", fb_ad=৳" + (p.fb_ad || 0) + "\n";
    });

    // Manual orders (admin panel orders)
    var mOrders = Array.isArray(manualOrders) ? manualOrders : [];
    var mPending = mOrders.filter(function(o) { return o.status === "Pending"; });
    var mConfirmed = mOrders.filter(function(o) { return o.status === "Confirmed"; });
    var mProcessing = mOrders.filter(function(o) { return o.status === "Processing"; });
    var mShipped = mOrders.filter(function(o) { return o.status === "Shipped"; });
    var mDelivered = mOrders.filter(function(o) { return o.status === "Delivered"; });
    var mCancelled = mOrders.filter(function(o) { return o.status === "Cancelled"; });
    var mReturned = mOrders.filter(function(o) { return o.status === "Returned"; });
    var mRevenue = mOrders.reduce(function(s, o) { return s + (Number(o.total) || 0); }, 0);

    context += "\nMANUAL ORDERS (admin panel, this month): " + mOrders.length + " total\n";
    context += "- Pending: " + mPending.length + ", Confirmed: " + mConfirmed.length + ", Processing: " + mProcessing.length + ", Shipped: " + mShipped.length + ", Delivered: " + mDelivered.length + ", Cancelled: " + mCancelled.length + ", Returned: " + mReturned.length + "\n";
    context += "- Manual Order Revenue: ৳" + mRevenue.toLocaleString() + "\n";
    if (mPending.length > 0) {
      context += "- PENDING MANUAL ORDERS:\n";
      mPending.slice(0, 15).forEach(function(o) {
        context += "  • " + o.order_id + " | " + o.product + " " + o.size + " x" + o.qty + " | ৳" + o.total + " | " + (o.cust_name || "N/A") + " | " + (o.cust_phone || "") + "\n";
      });
    }
    if (mConfirmed.length > 0) {
      context += "- CONFIRMED MANUAL ORDERS:\n";
      mConfirmed.slice(0, 15).forEach(function(o) {
        context += "  • " + o.order_id + " | " + o.product + " " + o.size + " x" + o.qty + " | ৳" + o.total + " | " + (o.cust_name || "N/A") + "\n";
      });
    }
    if (mCancelled.length > 0) {
      context += "- CANCELLED MANUAL ORDERS:\n";
      mCancelled.slice(0, 10).forEach(function(o) {
        context += "  • " + o.order_id + " | " + o.product + " | ৳" + o.total + " | " + (o.cust_name || "N/A") + "\n";
      });
    }

    // Customers
    var custArr = Array.isArray(customers) ? customers : [];
    var totalCust = custArr.length;
    var blockedCust = custArr.filter(function(c) { return c.is_blocked; }).length;
    var totalCustSpent = custArr.reduce(function(s, c) { return s + (Number(c.total_spent) || 0); }, 0);
    var topCustomers = custArr.slice(0, 10);

    context += "\nCUSTOMERS: " + totalCust + " total (top 50 by spend)\n";
    context += "- Total Customer Spend: ৳" + totalCustSpent.toLocaleString() + "\n";
    context += "- Blocked Customers: " + blockedCust + "\n";
    if (topCustomers.length > 0) {
      context += "- TOP CUSTOMERS:\n";
      topCustomers.forEach(function(c) {
        context += "  • " + (c.name || "N/A") + " (" + c.phone + "): " + c.total_orders + " orders, ৳" + (Number(c.total_spent)||0).toLocaleString() + " spent" + (c.is_blocked ? " [BLOCKED]" : "") + "\n";
      });
    }

    // Blocked devices (security)
    var bDevices = Array.isArray(blockedDevices) ? blockedDevices : [];
    context += "\nBLOCKED DEVICES (security): " + bDevices.length + " total\n";
    bDevices.slice(0, 10).forEach(function(d) {
      context += "  • " + d.device_id.slice(0, 20) + "... | reason=" + (d.block_reason || "N/A") + " | type=" + (d.block_type || "N/A") + " | attempts=" + (d.order_attempts || 0) + " | phones=" + (d.phones_seen || "N/A") + "\n";
    });

    // Website visitors
    var visArr = Array.isArray(visitors) ? visitors : [];
    if (visArr.length > 0) {
      var todayVis = visArr.find(function(v) { return v.visit_date === todayStr; });
      context += "\nWEBSITE VISITORS: today=" + (todayVis ? todayVis.visit_count : 0) + "\n";
    }

    // Newsletter subscribers
    var nlArr = Array.isArray(newsletters) ? newsletters : [];
    context += "NEWSLETTER SUBSCRIBERS: " + nlArr.length + " total\n";

    // Steadfast consignments
    var consArr = Array.isArray(consignments) ? consignments : [];
    if (consArr.length > 0) {
      var consPending = consArr.filter(function(c) { return c.status === "pending"; });
      var consDelivered = consArr.filter(function(c) { return c.status === "delivered"; });
      context += "\nSTEADFAST DELIVERIES: " + consArr.length + " recent (pending=" + consPending.length + ", delivered=" + consDelivered.length + ")\n";
    }

    // Build system prompt for conversational business partner
    var sys = [
      "তুমি 'YARZ Business AI' — YARZ Clothing ব্র্যান্ডের একজন অভিজ্ঞ বিজনেস পার্টনার।",
      "তুমি মালিক (মারুফ) এর সাথে কথা বলছো — তার ব্যবসার সবকিছু তোমার হাতে।",
      "তোমার কাছে সব ডাটা আছে: সেলস, খরচ, লাভ, অর্ডার (ম্যানুয়াল + ওয়েবসাইট), বিজ্ঞাপন, ইনভেন্টরি, কাস্টমার, ডেলিভারি, সিকিউরিটি — সবকিছু।",
      "ব্যবহারকারী যেকোনো টেবিল সম্পর্কে জিজ্ঞাসা করলে সেই ডাটা দাও।",
      "অর্ডার জানাতে চাইলে অর্ডার আইডি, স্ট্যাটাস, কাস্টমার, প্রোডাক্ট, পরিমাণ, মোট টাকা — সব বলো।",
      "কাস্টমার জানাতে চাইলে নাম, ফোন, অর্ডার সংখ্যা, মোট খরচ, ব্লকড কিনা — সব বলো।",
      "বিজ্ঞাপন জানাতে চাইলে খরচ, রিচ, ইম্প্রেশন, ক্লিক, ROI — সব বলো।",
      "ইনভেন্টরি জানাতে চাইলে স্টক, বিক্রি, লাভ, ক্যাটাগরি, ফ্যাব্রিক — সব বলো।",
      "ডেলিভারি জানাতে চাইলে Steadfast tracking, COD amount — সব বলো।",
      "সিকিউরিটি জানাতে চাইলে ব্লকড ডিভাইস, ফিঙ্গারপ্রিন্ট, রিস্ক স্কোর — সব বলো।",
      "",
      "=== কঠোর নিয়ম (এগুলো ভাঙো না): ===",
      "",
      "1. কোনো মার্কডাউন ফরম্যাটিং ব্যবহার করো না।",
      "   - যেমন: **বোল্ড**, ## হেডিং, --- সেপারেটর, - বুলেট, > ব্লককোয়োট, `কোড`",
      "   - এগুলো দেখলে মনে হয় রোবট কথা বলছে। একদম ব্যবহার করো না।",
      "",
      "2. ইমোজি খুব কম ব্যবহার করো।",
      "   - সম্পূর্ণ ইমোজি-মুক্ত রাখো।",
      "   - একটা প্রশ্নে সর্বোচ্চ ১টা ইমোজি হতে পারে, তাও খুব প্রয়োজন হলে।",
      "   - ইমোজি ছাড়াই উষ্ণ ও বন্ধুসুলভ থাকতে পারো।",
      "",
      "3. সম্পূর্ণ সাধারণ বাংলা ভাষায় লেখো।",
      "   - যেমন একজন বন্ধু ফোনে কথা বলছে।",
      "   - শব্দ বাছাই করে করে লেখো না — স্বাভাবিক কথার ধারায় বলো।",
      "   - ফর্মাল বা প্রিফেশনাল টোন না — বন্ধুর সাথে কথা বলার টোন।",
      "",
      "4. ডাটাকে কথার মধ্যে জুড়ে দাও।",
      "   - আলাদাভাবে তালিকা বানিয়ে দেওয়া যাবে না।",
      "   - যেমন: 'এই মাসে Urban Core Grey থেকে মোট ১ লাখ ২৪ হাজার টাকা সেলস হয়েছে, যেটা মোট সেলসের ৯৯%।'",
      "   - তুলনা করতে চাইলে সাধারণ ভাষায় বলো, টেবিল না।",
      "",
      "5. কোনো কিছু নেগেটিভ হলে সরাসরি বলো, ঘুরিয়ে-পেঁচিয়ে না।",
      "   - যেমন: 'Trendy Cobra Mist-254 থেকে এই মাসে ক্ষতি হয়েছে, এটা বাদ দিলে লাভ আরো বাড়ত।'",
      "",
      "6. প্রশ্ন ছোট হলে ছোট উত্তর দাও।",
      "   - 'আজ কত সেলস?' — 'আজ এখনো ২টি অর্ডার এসেছে, ৩৫০০ টাকা।'",
      "   - বিস্তারিত চাইলে তাহলে বিস্তারিত দাও।",
      "",
      "7. প্রশ্ন অস্পষ্ট হলে সরাসরি জিজ্ঞাসা করো।",
      "   - 'কোন দিনের কথা বলছেন?' বা 'কোন প্রোডাক্টটার কথা বলছেন?'",
      "",
      "=== YARZ CLOTHING REAL-TIME DATA ===",
      context
    ].join("\n");

    // Read model + API key from settings table
    var bizModel = "mimo-v2.5";
    var bizApiKey = env.MIMO_API_KEY || "";
    try {
      var modelRow = await supabaseRequest(env, "settings?select=value&key=eq.biz_ai_model", { method: "GET" });
      if (Array.isArray(modelRow) && modelRow.length > 0 && modelRow[0].value) bizModel = modelRow[0].value;
      var keyRow = await supabaseRequest(env, "settings?select=value&key=eq.biz_ai_apikey", { method: "GET" });
      if (Array.isArray(keyRow) && keyRow.length > 0 && keyRow[0].value && keyRow[0].value.trim()) bizApiKey = keyRow[0].value.trim();
    } catch(e) { console.log("[agent/ask] settings read fallback:", e.message); }

    // Route to correct provider
    var apiUrl, payload;
    var isOpenAICompatible = ["mimo-v2.5", "gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "deepseek-chat"].indexOf(bizModel) !== -1;
    if (isOpenAICompatible) {
      // MiMo / OpenAI / DeepSeek — OpenAI-compatible API
      if (!bizApiKey) return jsonResponse({ success: false, error: "API key not configured for " + bizModel }, 500);
      apiUrl = "https://api.xiaomimimo.com/v1/chat/completions";
      if (bizModel.indexOf("gpt") === 0) apiUrl = "https://api.openai.com/v1/chat/completions";
      if (bizModel === "deepseek-chat") apiUrl = "https://api.deepseek.com/v1/chat/completions";
      payload = {
        model: bizModel,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: question }
        ],
        temperature: 0.8,
        max_tokens: 2048
      };
    } else if (bizModel.indexOf("gemini") === 0) {
      // Google Gemini — native API
      if (!bizApiKey) bizApiKey = env.GEMINI_API_KEY || "";
      if (!bizApiKey) return jsonResponse({ success: false, error: "Gemini API key not configured" }, 500);
      apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + bizModel + ":generateContent?key=" + bizApiKey;
      payload = {
        contents: [{ parts: [{ text: sys + "\n\n" + question }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 2048 }
      };
    } else if (bizModel.indexOf("claude") === 0) {
      // Anthropic Claude
      if (!bizApiKey) return jsonResponse({ success: false, error: "Claude API key not configured" }, 500);
      apiUrl = "https://api.anthropic.com/v1/messages";
      payload = {
        model: bizModel,
        system: sys,
        messages: [{ role: "user", content: question }],
        temperature: 0.8,
        max_tokens: 2048
      };
    } else {
      return jsonResponse({ success: false, error: "Unsupported model: " + bizModel }, 400);
    }

    // Build headers
    var headers = { "Content-Type": "application/json" };
    if (isOpenAICompatible) {
      headers["Authorization"] = "Bearer " + bizApiKey;
    } else if (bizModel.indexOf("claude") === 0) {
      headers["x-api-key"] = bizApiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    var resp = await fetch(apiUrl, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload)
    });

    var data = await resp.json();

    if (!resp.ok) {
      var errMsg = (data.error && data.error.message) ? data.error.message : ("HTTP " + resp.status);
      console.log("[agent/ask] AI API error:", resp.status, errMsg);
      if (resp.status === 429) {
        return jsonResponse({ success: true, answer: "AI সার্ভার ব্যস্ত আছে (rate limit)। কিছুক্ষণ পর আবার চেষ্টা করুন।", model: bizModel });
      }
      return jsonResponse({ success: true, answer: "AI সার্ভারে সমস্যা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।", model: bizModel });
    }

    // Parse response based on provider
    var answer = "";
    if (isOpenAICompatible) {
      if (data.choices && data.choices[0] && data.choices[0].message) {
        answer = data.choices[0].message.content || "";
      }
    } else if (bizModel.indexOf("gemini") === 0) {
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
        answer = data.candidates[0].content.parts.map(function(p) { return p.text || ""; }).join("");
      }
    } else if (bizModel.indexOf("claude") === 0) {
      if (data.content && data.content[0]) {
        answer = data.content[0].text || "";
      }
    }
    if (!answer) answer = "দুঃখিত, উত্তর তৈরি করা যায়নি। আবার চেষ্টা করুন।";

    return jsonResponse({ success: true, answer: answer, model: bizModel });
  } catch (e) {
    console.error("[agent/ask]", e.message);
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}

/**
 * Single dispatcher for all /agent/* paths. Splits the path, picks the right
 * handler, and returns its Response. Registered in the fetch entry handler.
 * @param {Request} request
 * @param {object} env
 * @param {object} ctx
 * @returns {Promise<Response>}
 */
async function handleAgentRoute(request, env, ctx) {
  const url = new URL(request.url);
  const sub = url.pathname.replace(/^\/agent\/?/, "").toLowerCase();
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  // Per-platform webhook aliases: /agent/webhook/messenger etc.
  let handler;
  if (sub === "webhook" || sub === "") {
    handler = handleAgentWebhook;
  } else if (sub === "webhook/messenger" || sub === "messenger") {
    handler = handleMessengerWebhook;
  } else if (sub === "webhook/instagram" || sub === "instagram") {
    handler = handleInstagramWebhook;
  } else if (sub === "webhook/whatsapp" || sub === "whatsapp") {
    handler = handleWhatsAppWebhook;
  } else if (sub === "webhook/tiktok" || sub === "tiktok") {
    handler = handleTikTokWebhook;
  } else if (sub === "send") {
    handler = handleAgentSend;
  } else if (sub === "settings") {
    handler = handleAgentSettings;
  } else if (sub === "test") {
    handler = handleAgentTest;
  } else if (sub === "ask") {
    handler = handleAgentAsk;
  } else if (sub === "orders/new") {
    handler = handleAgentOrderNew;
  } else if (sub === "forward") {
    handler = handleAgentForward;
  } else {
    return jsonResponse({ success: false, error: "Unknown agent route: /agent/" + sub }, 404);
  }
  try {
    return await handler(request, env, ctx);
  } catch (e) {
    console.error("[agent/" + sub + "]", e.message);
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}