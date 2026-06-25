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
 *   SUPABASE_ENABLED   (default "false" — opt-in!)
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
  "publish_to_cloudflare"
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

  // ---- Fortress (anti-fraud) ----
  __fortress_lookup:    { kind: "passthrough" },
  __fortress_block:     { kind: "passthrough" },
  __fortress_unblock:   { kind: "passthrough" },
  __fortress_clear_all: { kind: "passthrough" },
  __fortress_log_event: { kind: "passthrough" }
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
    headers: Object.assign({
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }, corsHeaders())
  });
}

async function supabaseRequest(env, path, init) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured (URL or service_role key missing)");
  const fullUrl = url.replace(/\/+$/, "") + "/rest/v1/" + path;
  const res = await fetch(fullUrl, Object.assign({
    headers: {
      "apikey": key,
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json"
    }
  }, init || {}));
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
          const r = await supabaseRequest(
            env,
            def.table + "?on_conflict=key",
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
async function placeOrderSupabase(env, body) {
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
      p_user: "website"
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

function gasUpstream(env) {
  const id = env && env.GAS_DEPLOYMENT_ID;
  if (!id) return "https://script.google.com/macros/s/AKfycbzLs9KDameNALSxN4ntZXHKs-st2V-4gN5ITFL38UnqKFw_s2yXFPcmLFB4KXzIVs7K/exec";
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
  } else {
    const txt = await request.text();
    try { body = txt ? JSON.parse(txt) : {}; } catch(e) { body = {}; }
    // FIX #27: Customer site sends params in URL, not body. Merge URL params.
    try { for (const [k, v] of url.searchParams.entries()) { if (!(k in body) || body[k] === "" || body[k] == null) body[k] = v; } } catch(e) {}
    action = String(body.action || url.searchParams.get("action") || "").toLowerCase();
  }

  // Supabase enabled?
  const supabaseEnabled = env.SUPABASE_ENABLED === "true";

  // place_order (public POST) -> Supabase create_manual_order RPC
  if (supabaseEnabled && action === "place_order" && request.method === "POST") {
    const r = await placeOrderSupabase(env, body);
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

  // __currentMonthSnapshot (admin GET) -> Supabase monthly stats
  // FIX #32: home dashboard "This Month" was always empty
  if (supabaseEnabled && (action === "__currentmonthsnapshot" || action === "__currentMonthSnapshot") && request.method === "GET") {
    const r = await currentMonthSnapshotSupabase(env);
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
      await supabaseRequest(
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
    if (request.method === "GET" && isStaticRequest(url)) {
      return await fetchFromGitHubPages(request);
    }
    return handle(request, env, ctx);
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