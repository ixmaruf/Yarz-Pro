var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker-supabase.js
function getTtls(env) {
  const fresh = parseInt(env.FRESHT_TTL || "") || 30 * 60;
  const swr = parseInt(env.SWR_TTL || "") || 5 * 60;
  const hard = parseInt(env.HARD_TTL || "") || 24 * 60 * 60;
  return { fresh, swr, hard };
}
__name(getTtls, "getTtls");
var PUBLIC_CACHEABLE = /* @__PURE__ */ new Set([
  "products",
  "product",
  "categories",
  "store_info",
  "delivery_charges",
  "fb_feed",
  "health"
]);
var PUBLIC_POST = /* @__PURE__ */ new Set([
  "place_order",
  "subscribe_newsletter",
  "subscribenewsletter",
  "capi",
  "fbcapi",
  "ttapi",
  "ttevents"
]);
var ADMIN_ACTIONS = /* @__PURE__ */ new Set([
  "adminlogin",
  "admin_login",
  "adminlogout",
  "admin_logout",
  "verify_auth",
  "saveproductfromform",
  "saveproducteditfromform",
  "updateproductstatus",
  "applystockchange",
  "applybulkedit",
  "recordsale",
  "deleteproduct",
  "saveorderfromform",
  "updatewebsiteorderstatus",
  "updatemanualorderstatus",
  "deletewebsiteorder",
  "deletemanualorder",
  "archivecompletedorders",
  "saveadfromform",
  "saveexpensefromform",
  "savereturnfromform",
  "generatemonthlyreport",
  "generateyearlyreport",
  "updatesettings",
  "updatedeliverycharges",
  "savegithubsettings",
  "githubsyncnow",
  "getcurrentmonthsnapshot",
  "getproductanalytics6m",
  "getcustomerltv",
  "snapshotmonth",
  "fullfactoryreset",
  "clearfinancialsonly",
  "clearinventoryonly",
  "steadfastcreate",
  "steadfastbulk",
  "steadfaststatus",
  "steadfastbalance",
  "steadfastsavekeys",
  "steadfastgetreturn",
  "steadfastlistreturns",
  "steadfastlistpayments",
  "steadfastgetpayment",
  "steadfastlistpolicestations",
  "__fortress_lookup",
  "__fortress_block",
  "__fortress_unblock",
  "__fortress_clear_all",
  "__fortress_log_event",
  "sheet_read",
  "sheet_read_formatted",
  "migrate",
  "diagnoses3xl",
  "repairwebsiteordersstatus",
  "repaircouponactivevalidation",
  "publish_to_cloudflare",
  "changeadminpassword",
  "changeadminusername",
  "setadminpin",
  "verifyadminpin",
  "hasadminpin",
  "changeadminpin"
]);
var ACTIONS_SUPABASE = {
  // ---- Public reads (cached at edge) ----
  products: { kind: "view", view: "website_sync_view" },
  product: { kind: "table", table: "inventory", filter: "?product=eq.{name}", single: true },
  categories: { kind: "passthrough" },
  // uses SETTINGS in GAS
  store_info: { kind: "passthrough" },
  // aggregate over settings+delivery
  delivery_charges: { kind: "table", table: "delivery_charges", filter: "?active=eq.true&order=sort_order" },
  fb_feed: { kind: "passthrough" },
  // CSV generation needs GAS logic
  health: { kind: "passthrough" },
  // ---- Public reads (NOT cached -- PII) ----
  orders_by_phone: { kind: "table", table: "website_orders", filter: "?cust_phone=eq.{phone}", order: "created_at.desc" },
  // ---- Public POSTs (not cached) ----
  place_order: { kind: "passthrough" },
  // complex, keep in GAS for now
  subscribe_newsletter: { kind: "table", table: "newsletter_subscribers", op: "insert" },
  subscribenewsletter: { kind: "table", table: "newsletter_subscribers", op: "insert" },
  capi: { kind: "passthrough" },
  ttapi: { kind: "passthrough" },
  // ---- Admin reads ----
  sheet_read: { kind: "table_or_view" },
  // dynamic based on range
  sheet_read_formatted: { kind: "passthrough" },
  verify_auth: { kind: "passthrough" },
  // ---- Admin writes (most can be done via Supabase; some need GAS logic) ----
  saveproductfromform: { kind: "table", table: "inventory", op: "insert" },
  saveproducteditfromform: { kind: "table", table: "inventory", op: "update", key: "product" },
  updateproductstatus: { kind: "table", table: "inventory", op: "update", key: "product" },
  applystockchange: { kind: "rpc", fn: "atomic_adjust_stock", args: {
    p_product: "$product",
    p_size: "$size",
    p_delta: "$delta",
    p_kind: "$kind"
  } },
  applybulkedit: { kind: "passthrough" },
  recordsale: { kind: "passthrough" },
  deleteproduct: { kind: "table", table: "inventory", op: "delete", key: "product" },
  saveorderfromform: { kind: "rpc", fn: "create_manual_order", args: {
    p_order_id: "$order_id",
    p_cust_name: "$cust_name",
    p_cust_phone: "$cust_phone",
    p_cust_addr: "$cust_addr",
    p_deliv_dist: "$deliv_dist",
    p_deliv_zone: "$deliv_zone",
    p_product: "$product",
    p_size: "$size",
    p_qty: "$qty",
    p_price: "$price",
    p_delivery_charge: "$delivery_charge",
    p_total: "$total",
    p_payment: "$payment",
    p_status: "$status",
    p_courier: "$courier",
    p_notes: "$notes"
  } },
  updatewebsiteorderstatus: { kind: "table", table: "website_orders", op: "update", key: "order_id" },
  updatemanualorderstatus: { kind: "table", table: "orders", op: "update", key: "order_id" },
  deletewebsiteorder: { kind: "rpc", fn: "delete_website_order", args: { p_order_id: "$orderId" } },
  deletemanualorder: { kind: "table", table: "orders", op: "delete", key: "order_id" },
  archivecompletedorders: { kind: "passthrough" },
  saveadfromform: { kind: "table", table: "ad_tracker", op: "insert" },
  saveexpensefromform: { kind: "table", table: "expenses", op: "insert" },
  savereturnfromform: { kind: "passthrough" },
  updatesettings: { kind: "table", table: "settings", op: "upsert" },
  updatedeliverycharges: { kind: "table", table: "delivery_charges", op: "upsert" },
  savegithubsettings: { kind: "table", table: "settings", op: "upsert" },
  githubsyncnow: { kind: "passthrough" },
  // ---- Analytics (compute in DB is more efficient) ----
  generatemonthlyreport: { kind: "rpc", fn: "generate_monthly_report", args: {
    p_year: "$year",
    p_month: "$month"
  } },
  generateyearlyreport: { kind: "rpc", fn: "generate_yearly_report", args: { p_year: "$year" } },
  getcurrentmonthsnapshot: { kind: "passthrough" },
  getproductanalytics6m: { kind: "passthrough" },
  getcustomerltv: { kind: "view", view: "customer_ltv_view" },
  snapshotmonth: { kind: "passthrough" },
  // ---- Cleanup (DANGER; double-auth via upstream + here we still verify session) ----
  fullfactoryreset: { kind: "passthrough" },
  clearfinancialsonly: { kind: "passthrough" },
  clearinventoryonly: { kind: "passthrough" },
  // ---- Courier (external HTTP — keep in GAS until Edge Function migrated) ----
  steadfastcreate: { kind: "passthrough" },
  steadfastbulk: { kind: "passthrough" },
  steadfaststatus: { kind: "passthrough" },
  steadfastbalance: { kind: "passthrough" },
  steadfastsavekeys: { kind: "passthrough" },
  // ---- Fortress (anti-fraud) — custom handlers in fetch() ----
  __fortress_save_fingerprint: { kind: "custom" },
  __fortress_public_blocklist: { kind: "custom" },
  __fortress_lookup: { kind: "custom" },
  __fortress_block: { kind: "custom" },
  __fortress_unblock: { kind: "custom" },
  __fortress_clear_all: { kind: "custom" },
  __fortress_log_event: { kind: "custom" },
  // ---- Admin self-service (credential change) ----
  // ✅ v11.4: routed via Supabase RPCs. Worker is a passthrough shim that
  // forwards the POST body to the change_admin_password / change_admin_username
  // functions defined in supabase/rpc.sql. Body must include sessionToken,
  // currentPassword, newPassword (and newUsername for the username RPC).
  changeadminpassword: { kind: "rpc", fn: "change_admin_password", args: {
    p_token: "$sessionToken",
    p_current_password: "$currentPassword",
    p_new_password: "$newPassword"
  } },
  changeadminusername: { kind: "rpc", fn: "change_admin_username", args: {
    p_token: "$sessionToken",
    p_new_username: "$newUsername"
  } },
  // ---- Admin PIN protection ----
  // v11.5: routes for setting, verifying, checking, and changing the admin PIN.
  // Body must include sessionToken and pin (and oldPin/newPin for change).
  setadminpin: { kind: "rpc", fn: "set_admin_pin", args: {
    p_token: "$sessionToken",
    p_pin: "$pin"
  } },
  verifyadminpin: { kind: "rpc", fn: "verify_admin_pin", args: {
    p_token: "$sessionToken",
    p_pin: "$pin"
  } },
  hasadminpin: { kind: "rpc", fn: "has_admin_pin", args: {
    p_token: "$sessionToken"
  } },
  changeadminpin: { kind: "rpc", fn: "change_admin_pin", args: {
    p_token: "$sessionToken",
    p_old_pin: "$oldPin",
    p_new_pin: "$newPin"
  } }
};
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Purge-Key",
    "Access-Control-Max-Age": "86400"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(corsHeaders(), {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    })
  });
}
__name(jsonResponse, "jsonResponse");
async function supabaseRequest(env, path, init) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured (URL or service_role key missing)");
  const fullUrl = url.replace(/\/+$/, "") + "/rest/v1/" + path;
  const defaultHeaders = {
    "apikey": key,
    "Authorization": "Bearer " + key,
    "Content-Type": "application/json"
  };
  const mergedHeaders = Object.assign({}, defaultHeaders, init && init.headers || {});
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
__name(supabaseRequest, "supabaseRequest");
async function handleSupabase(env, action, payload, request) {
  const def = ACTIONS_SUPABASE[action];
  if (!def || def.kind === "passthrough") {
    if (action === "steadfastcreate") return await steadfastCreateOrder(env, payload || {});
    if (action === "steadfastbulk") return await steadfastBulkCreate(env, payload || {});
    if (action === "steadfaststatus") return await steadfastStatus(env, payload || {});
    if (action === "steadfastbalance") return await steadfastBalance(env);
    if (action === "steadfastcreatereturn") return await steadfastCreateReturn(env, payload || {});
    if (action === "steadfastgetreturn") return await steadfastGetReturn(env, payload || {});
    if (action === "steadfastlistreturns") return await steadfastListReturns(env);
    if (action === "steadfastlistpayments") return await steadfastListPayments(env);
    if (action === "steadfastgetpayment") return await steadfastGetPayment(env, payload || {});
    if (action === "steadfastlistpolicestations") return await steadfastPoliceStations(env);
    if (action === "steadfastsavekeys") return await steadfastSaveKeys(env, payload || {});
    if (action === "steadfastlistkeys") return await steadfastKeysList(env);
    return null;
  }
  try {
    switch (def.kind) {
      case "view": {
        const data = await supabaseRequest(env, def.view + "?select=*", { method: "GET" });
        const mapped = Array.isArray(data) ? data.map((p) => {
          if (!p || typeof p !== "object") return p;
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
            discPct: p.discPct ?? p["Disc%"],
            disc_type: p.disc_type ?? p.DiscType,
            dhaka_delivery: p.dhaka_delivery ?? p["Delivery(Dhaka)"],
            outside_delivery: p.outside_delivery ?? p["Delivery(Outside)"],
            stockS: p.stockS ?? p.S_Left,
            stockM: p.stockM ?? p.M_Left,
            stockL: p.stockL ?? p.L_Left,
            stockXL: p.stockXL ?? p.XL_Left,
            stockXXL: p.stockXXL ?? p.XXL_Left,
            stock3XL: p.stock3XL ?? p["3XL_Left"],
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
          const m = def.filter && def.filter.match(/\{(\w+)\}/);
          if (m) {
            const v = payload[m[1]];
            if (v === void 0) throw new Error("Missing param: " + m[1]);
            path = path.replace("{" + m[1] + "}", encodeURIComponent(v));
          }
          let data = await supabaseRequest(env, path, { method: "GET" });
          if (def.single && Array.isArray(data)) data = data[0] || null;
          return { success: true, ok: true, data };
        }
        if (request.method === "POST" && def.op === "insert") {
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
            {
              method: "POST",
              headers: { "Prefer": "resolution=merge-duplicates" },
              body: JSON.stringify(rows)
            }
          );
          return { success: true, ok: true, data: r };
        }
        break;
      }
      case "rpc": {
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
    return null;
  }
  return null;
}
__name(handleSupabase, "handleSupabase");
async function placeOrderSupabase(env, body) {
  const orderData = body.order || body;
  if (!orderData || typeof orderData !== "object") return null;
  if (!orderData.phone) orderData.phone = orderData.cust_phone || orderData.customerPhone || orderData.contactPhone || "";
  if (!orderData.customerName) orderData.customerName = orderData.cust_name || orderData.name || "";
  if (!orderData.address) orderData.address = orderData.cust_addr || "";
  if (!orderData.location) orderData.location = orderData.deliv_zone || orderData.city || "";
  if (!orderData.phone) return null;
  let items = orderData.cartItems || [];
  if (items.length === 0) {
    const singleProduct = orderData.product || orderData.p || "";
    if (singleProduct) {
      items = [{ product: singleProduct, name: singleProduct, size: orderData.size || orderData.s || "", qty: Number(orderData.qty || orderData.q) || 1, price: Number(orderData.price) || 0 }];
    }
  }
  if (items.length === 0) return null;
  const orderIds = [];
  const ts = Date.now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const orderId = items.length === 1 ? orderData.orderId || "WEB-" + ts + "-" + Math.floor(Math.random() * 1e4) : orderData.orderId + "-" + (i + 1);
    const args = {
      p_order_id: orderId,
      p_cust_name: orderData.customerName || orderData.name || "",
      p_cust_phone: orderData.phone || "",
      p_cust_addr: orderData.address || "",
      p_deliv_zone: orderData.location || orderData.city || "",
      p_product: it.product || it.name || "",
      p_size: it.size || "",
      p_qty: it.qty || 1,
      p_price: it.price || 0,
      p_delivery_charge: orderData.deliveryCharge || 0,
      p_total: orderData.total || 0,
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
      return null;
    }
  }
  return {
    success: true,
    ok: true,
    orderId: orderIds[0],
    orderIds,
    timestamp: ts,
    bdTime: new Date(ts).toISOString().replace("T", " ").substring(0, 19),
    total: orderData.total || 0,
    qty: items.reduce((s, it) => s + (it.qty || 1), 0),
    status: "Pending"
  };
}
__name(placeOrderSupabase, "placeOrderSupabase");
async function storeInfoSupabase(env) {
  const EXCLUDED_FROM_SPREAD = /* @__PURE__ */ new Set(["currency", "currency symbol", "store name", "store phone", "store email", "store address", "link facebook", "link instagram", "link whatsapp", "link messenger", "link tiktok", "link youtube", "custom categories", "custom fabrics", "custom badges", "github repo", "github branch", "github path"]);
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
        currency: settings["Currency Symbol"] || settings["Currency"] || "\u09F3",
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
          Object.keys(settings).filter(function(k) {
            return !EXCLUDED_FROM_SPREAD.has(k.toLowerCase());
          }).map(function(k) {
            return [k.toLowerCase(), settings[k]];
          })
        )
      }
    };
    if (!result.data.hero_banner_1) {
      result.data.hero_banner_1 = "https://yarzclothing.xyz/images/og-banner.png";
    }
    if (!result.data.banner_title_1) {
      result.data.banner_title_1 = (result.data.name ? String(result.data.name) : "YARZ") + " \u2014 Premium Men\u2019s Fashion";
    }
    return result;
  } catch (e) {
    console.error("[store_info] failed:", e.message);
    return null;
  }
}
__name(storeInfoSupabase, "storeInfoSupabase");
async function categoriesSupabase(env) {
  try {
    const r = await supabaseRequest(env, "settings?key=eq.Custom Categories&select=value", { method: "GET" });
    if (!r || r.length === 0) return { success: true, ok: true, data: [] };
    const cats = (r[0].value || "").split(",").map(function(s) {
      return s.trim();
    }).filter(Boolean);
    return { success: true, ok: true, data: cats };
  } catch (e) {
    console.error("[categories] failed:", e.message);
    return null;
  }
}
__name(categoriesSupabase, "categoriesSupabase");
async function currentMonthSnapshotSupabase(env) {
  try {
    const now = /* @__PURE__ */ new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const [web, man] = await Promise.all([
      supabaseRequest(env, "website_orders?date=gte." + firstOfMonth + "&select=order_id,product,qty,price,total,status,cust_phone", { method: "GET" }).catch(() => []),
      supabaseRequest(env, "orders?date=gte." + firstOfMonth + "&select=order_id,product,qty,price,total,status,cust_phone", { method: "GET" }).catch(() => [])
    ]);
    const wArr = Array.isArray(web) ? web : [];
    const mArr = Array.isArray(man) ? man : [];
    const all = wArr.concat(mArr);
    const sum = /* @__PURE__ */ __name((arr, key) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0), "sum");
    const counts = {};
    for (const r of all) {
      const k = (r.product || "Unknown").trim() || "Unknown";
      counts[k] = (counts[k] || 0) + (Number(r.qty) || 1);
    }
    const topProducts = Object.keys(counts).map((k) => ({ product: k, qty: counts[k] })).sort((a, b) => b.qty - a.qty).slice(0, 5);
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
        unique_customers_website: new Set(wArr.map((r) => r.cust_phone).filter(Boolean)).size,
        unique_customers_manual: new Set(mArr.map((r) => r.cust_phone).filter(Boolean)).size,
        top_products: topProducts
      }
    };
  } catch (e) {
    console.error("[currentMonthSnapshot] failed:", e.message);
    return { success: true, ok: true, data: { month_start: (/* @__PURE__ */ new Date()).toISOString(), website_orders: 0, manual_orders: 0, total_orders: 0, revenue_total: 0, top_products: [], error: e.message } };
  }
}
__name(currentMonthSnapshotSupabase, "currentMonthSnapshotSupabase");
async function productAnalytics6mSupabase(env) {
  try {
    const sixMonthsAgo = /* @__PURE__ */ new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const since = sixMonthsAgo.toISOString();
    const rows = await supabaseRequest(
      env,
      "transactions?date=gte." + since + "&select=product,qty,revenue,cost&order=date.asc",
      { method: "GET" }
    );
    const arr = Array.isArray(rows) ? rows : [];
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
__name(productAnalytics6mSupabase, "productAnalytics6mSupabase");
function gasUpstream(env) {
  const id = env && env.GAS_DEPLOYMENT_ID;
  if (!id) throw new Error("GAS_DEPLOYMENT_ID not set; cannot route to legacy GAS fallback. Set it via `wrangler secret put GAS_DEPLOYMENT_ID` if you need GAS fallback.");
  return "https://script.google.com/macros/s/" + id + "/exec";
}
__name(gasUpstream, "gasUpstream");
var GH_PAGES_BASE = "https://ixmaruf.github.io/Yarz";
function isStaticRequest(url) {
  if (url.searchParams.has("action")) return false;
  if (url.searchParams.has("key")) return false;
  if (url.searchParams.has("__purge")) return false;
  const p = url.pathname;
  if (p.startsWith("/__")) return false;
  if (p === "/purge" || p === "/tg-webhook") return false;
  if (p.startsWith("/api/")) return false;
  return true;
}
__name(isStaticRequest, "isStaticRequest");
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
      if (ghResp.status === 404 && !pathHasExtension(url.pathname)) {
        const fallback = await fetch(GH_PAGES_BASE + "/index.html", {
          headers: { "User-Agent": "YARZ-Worker/1.0" }
        });
        if (fallback.ok) return new Response(fallback.body, fallback);
      }
      return new Response("Static asset not found: " + url.pathname, { status: ghResp.status });
    }
    const respHeaders = new Headers(ghResp.headers);
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    return new Response(ghResp.body, { status: ghResp.status, headers: respHeaders });
  } catch (e) {
    return new Response("Static proxy error: " + e.message, { status: 502 });
  }
}
__name(fetchFromGitHubPages, "fetchFromGitHubPages");
function pathHasExtension(p) {
  return /\.[a-z0-9]{1,5}$/i.test(p);
}
__name(pathHasExtension, "pathHasExtension");
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
    init.body = void 0;
    return fetch(upstream + url.search, init);
  }
  return fetch(upstream, init);
}
__name(routeToGas, "routeToGas");
async function handle(request, env, ctx) {
  const { fresh: FRESH_TTL, swr: SWR_TTL, hard: HARD_TTL } = getTtls(env);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
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
    try {
      for (const [k, v] of url.searchParams.entries()) {
        body[k] = v;
      }
    } catch (e) {
    }
  } else {
    const txt = await request.text();
    try {
      body = txt ? JSON.parse(txt) : {};
    } catch (e) {
      body = {};
    }
    try {
      for (const [k, v] of url.searchParams.entries()) {
        if (!(k in body) || body[k] === "" || body[k] == null) body[k] = v;
      }
    } catch (e) {
    }
    action = String(body.action || url.searchParams.get("action") || "").toLowerCase();
  }
  const supabaseEnabled = env.SUPABASE_ENABLED !== "false";
  if (supabaseEnabled && path === "/__analytics" && request.method === "GET") {
    try {
      const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-real-ip") || "unknown";
      const bdNow = new Date(Date.now() + 6 * 3600 * 1e3);
      const today = bdNow.toISOString().slice(0, 10);
      await supabaseRequest(env, "rpc/track_visit", {
        method: "POST",
        body: JSON.stringify({ p_ip: clientIp, p_date: today })
      });
      return jsonResponse({ success: true, tracked: true });
    } catch (e) {
      return jsonResponse({ success: true, tracked: false });
    }
  }
  if (supabaseEnabled && action === "__fortress_save_fingerprint" && request.method === "POST") {
    try {
      const fp = body;
      const visitorId = fp.visitorId || fp.visitor_id || "";
      if (!visitorId) return jsonResponse({ ok: true, msg: "no visitorId" });
      const row = {
        visitor_id: visitorId,
        composite_hash: fp.compositeHash || fp.composite_hash || "",
        raw_components: fp,
        ip_address: fp.ip || "",
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
        fingerprintjs_confidence: fp.fpjsConfidence || 0,
        last_seen_at: (/* @__PURE__ */ new Date()).toISOString(),
        visit_count: 1
      };
      await supabaseRequest(env, "device_fingerprints?on_conflict=visitor_id", {
        method: "POST",
        headers: { "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify([row])
      });
      return jsonResponse({ ok: true });
    } catch (e) {
      console.error("[fortress] save_fingerprint error:", e.message);
      return jsonResponse({ ok: true });
    }
  }
  if (supabaseEnabled && action === "__fortress_public_blocklist" && request.method === "GET") {
    try {
      const data = await supabaseRequest(env, "blocked_devices?select=device_id&status=eq.active", { method: "GET" });
      const devices = Array.isArray(data) ? data.map((d) => d.device_id) : [];
      return jsonResponse({ ok: true, devices });
    } catch (e) {
      return jsonResponse({ ok: true, devices: [] });
    }
  }
  if (supabaseEnabled && action === "__fortress_lookup" && request.method === "POST") {
    try {
      const blocked = await supabaseRequest(env, "blocked_devices?select=*&status=eq.active&order=created_at.desc", { method: "GET" });
      const fingerprints = await supabaseRequest(env, "device_fingerprints?select=*&order=last_seen_at.desc&limit=100", { method: "GET" });
      return jsonResponse({ ok: true, devices: blocked || [], fingerprints: fingerprints || [], threats: [] });
    } catch (e) {
      return jsonResponse({ ok: true, devices: [], fingerprints: [], threats: [] });
    }
  }
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
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }
  if (supabaseEnabled && action === "__fortress_unblock" && request.method === "POST") {
    try {
      const deviceId = body.device_id || body.deviceId || "";
      if (!deviceId) return jsonResponse({ ok: false, msg: "device_id required" });
      await supabaseRequest(env, "blocked_devices?device_id=eq." + encodeURIComponent(deviceId), {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive", updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }
  if (supabaseEnabled && action === "__fortress_clear_all" && request.method === "POST") {
    try {
      await supabaseRequest(env, "blocked_devices?status=eq.active", {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive", updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
      return jsonResponse({ ok: true, success: true });
    } catch (e) {
      return jsonResponse({ ok: false, msg: e.message });
    }
  }
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
      return jsonResponse({ ok: true });
    }
  }
  if (supabaseEnabled && action === "place_order" && request.method === "POST") {
    const r = await placeOrderSupabase(env, body);
    if (r) {
      ctx.waitUntil(purgeCacheForAction("products", caches.default));
      return jsonResponse(r);
    }
  }
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
  if (supabaseEnabled && action === "getcurrentmonthsnapshot") {
    const r = await currentMonthSnapshotSupabase(env);
    return jsonResponse(r);
  }
  if (supabaseEnabled && action === "getproductanalytics6m") {
    const r = await productAnalytics6mSupabase(env);
    return jsonResponse(r);
  }
  if (supabaseEnabled && PUBLIC_CACHEABLE.has(action) && request.method === "GET") {
    const cache = caches.default;
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
  }
  if (supabaseEnabled && ADMIN_ACTIONS.has(action) && request.method === "POST") {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      ctx.waitUntil(purgeCacheForAction(action, caches.default));
      return jsonResponse(r);
    }
  }
  if (supabaseEnabled && PUBLIC_POST.has(action) && request.method === "POST") {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      return jsonResponse(r);
    }
  }
  if (supabaseEnabled && request.method === "GET" && ACTIONS_SUPABASE[action] && ACTIONS_SUPABASE[action].kind !== "passthrough" && !PUBLIC_CACHEABLE.has(action)) {
    const r = await handleSupabase(env, action, body, request);
    if (r) {
      return jsonResponse(r);
    }
  }
  const gasResp = await routeToGas(request, body, env, ctx);
  const headers = new Headers(gasResp.headers);
  Object.entries(corsHeaders()).forEach(function(kv) {
    headers.set(kv[0], kv[1]);
  });
  return new Response(gasResp.body, { status: gasResp.status, headers });
}
__name(handle, "handle");
async function purgeCacheForAction(action, cache) {
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
    try {
      await cache.delete(new Request("https://yarzclothing.xyz/" + q));
    } catch (e) {
    }
  }));
}
__name(purgeCacheForAction, "purgeCacheForAction");
async function handlePurgeWebhook(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/purge" && url.pathname !== "/__purge") return null;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  const expected = env && env.PURGE_SECRET || "";
  if (expected) {
    const provided = request.headers.get("x-purge-secret") || url.searchParams.get("secret") || "";
    if (provided !== expected) {
      return new Response(JSON.stringify({ success: false, error: "Invalid purge secret" }), {
        status: 401,
        headers: corsHeaders({ "Content-Type": "application/json" })
      });
    }
  }
  const cache = caches.default;
  const purgeRequests = [
    new Request("https://yarzclothing.xyz/?action=products"),
    new Request("https://yarzclothing.xyz/?action=delivery_charges"),
    new Request("https://yarzclothing.xyz/?action=store_info"),
    new Request("https://yarzclothing.xyz/?action=categories")
  ];
  let purged = 0;
  await Promise.all(purgeRequests.map(async function(r) {
    try {
      if (await cache.delete(r)) purged++;
    } catch (e) {
    }
  }));
  return new Response(JSON.stringify({ success: true, purged, note: "best-effort (known endpoints)" }), {
    status: 200,
    headers: corsHeaders({ "Content-Type": "application/json" })
  });
}
__name(handlePurgeWebhook, "handlePurgeWebhook");
async function tgApiCall(botToken, method, body) {
  return fetch("https://api.telegram.org/bot" + botToken + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
__name(tgApiCall, "tgApiCall");
async function listRecentOrders(env, since) {
  try {
    let hours = 24;
    const m = String(since || "24h").match(/^(\d+)h?$/);
    if (m) hours = parseInt(m[1], 10);
    const sinceIso = new Date(Date.now() - hours * 3600 * 1e3).toISOString();
    const r = await supabaseRequest(env, "website_orders?created_at=gt." + sinceIso + "&order=created_at.desc&limit=10&select=order_id,created_at,cust_name,cust_phone,product,size,qty,price,total,status", { method: "GET" });
    if (!Array.isArray(r) || r.length === 0) return "\u{1F4ED} No orders in last " + hours + "h.";
    let lines = ["\u{1F4E6} <b>Last " + r.length + " orders (last " + hours + "h):</b>\n"];
    for (const o of r) {
      lines.push("\u2022 <code>" + o.order_id + "</code> \u2014 " + o.product + " " + o.size + " \xD7" + o.qty + " = \u09F3" + o.total + " (" + o.status + ")");
    }
    return lines.join("\n");
  } catch (e) {
    return "\u274C Error: " + e.message;
  }
}
__name(listRecentOrders, "listRecentOrders");
async function getOrderStats(env) {
  try {
    const r = await supabaseRequest(env, "website_orders?order=created_at.desc&limit=200&select=created_at,total,status", { method: "GET" });
    if (!Array.isArray(r) || r.length === 0) return "\u{1F4CA} No orders yet.";
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
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
    return "\u{1F4CA} <b>YARZ Stats</b>\n\n\u2022 Total orders: " + totalOrders + "\n\u2022 Today: " + todayOrders + " orders, \u09F3" + todayRevenue.toFixed(2) + "\n\u2022 Total revenue: \u09F3" + totalRevenue.toFixed(2) + "\n\n\u2022 Pending: " + pending + " | Confirmed: " + confirmed + "\n\u2022 Shipped: " + shipped + " | Delivered: " + delivered + "\n\u2022 Cancelled: " + cancelled;
  } catch (e) {
    return "\u274C Error: " + e.message;
  }
}
__name(getOrderStats, "getOrderStats");
async function handleTelegramWebhook(request, env) {
  const TG_BOT_TOKEN = env && env.TG_BOT_TOKEN;
  const TG_OWNER_ID = String(env && env.TG_OWNER_ID || "6409729183");
  if (!TG_BOT_TOKEN) return new Response("Bot token not configured", { status: 500 });
  let update;
  try {
    update = await request.json();
  } catch (e) {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = String(cb.data || "");
    const colon = data.indexOf(":");
    const action = colon > 0 ? data.substring(0, colon) : data;
    const orderId = colon > 0 ? data.substring(colon + 1) : "";
    if (String(cb.from.id) !== TG_OWNER_ID) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "\u26D4 \u0985\u09A8\u09C1\u09AE\u09A4\u09BF \u09A8\u09C7\u0987!",
        show_alert: true
      });
      return new Response("ok");
    }
    const statusMap = {
      "confirm": "Processing",
      "shipped": "Shipped",
      "delivered": "Delivered",
      "cancel": "Cancelled"
    };
    const newStatus = statusMap[action];
    if (!newStatus) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "\u274C Unknown action",
        show_alert: true
      });
      return new Response("ok");
    }
    if (!orderId) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "\u274C Missing order id",
        show_alert: true
      });
      return new Response("ok");
    }
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await supabaseRequest(
        env,
        "website_orders?order_id=eq." + encodeURIComponent(orderId),
        {
          method: "PATCH",
          body: JSON.stringify({
            status: newStatus,
            updated_at: now,
            activity: (cb.message && cb.message.text || "") + " | " + newStatus + " @ " + now
          })
        }
      );
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: newStatus + " \u2014 " + orderId,
        show_alert: true
      });
      if (cb.message) {
        const editText = ((cb.message.text || "") + "\n\n<b>" + newStatus + "</b> \u2014 " + now).substring(0, 4096);
        await tgApiCall(TG_BOT_TOKEN, "editMessageText", {
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: editText
        });
      }
    } catch (e) {
      await tgApiCall(TG_BOT_TOKEN, "answerCallbackQuery", {
        callback_query_id: cb.id,
        text: "\u274C " + e.message,
        show_alert: true
      });
    }
    return new Response("ok");
  }
  if (update.message && update.message.text) {
    const txt = update.message.text.trim();
    const fromId = String(update.message.from.id);
    if (txt === "/start" || txt === "/help") {
      await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "\u{1F6D2} <b>YARZ Orders Bot</b>\n\n\u2705 Bot is online.\n\nOrder notifications will be sent here when customers place orders on yarzclothing.xyz.\nYou'll get buttons to confirm/cancel/ship/deliver each order.\n\nUse /whoami to see your Telegram user ID.",
        parse_mode: "HTML"
      });
    } else if (txt === "/whoami") {
      await tgApiCall(TG_BOT_TOKEN, "sendMessage", {
        chat_id: update.message.chat.id,
        text: "\u{1F464} Your Telegram user ID: <code>" + fromId + "</code>\n\nOwner-only commands work if this ID matches TG_OWNER_ID in the worker config.\nCurrent TG_OWNER_ID: <code>" + TG_OWNER_ID + "</code>",
        parse_mode: "HTML"
      });
    } else if (fromId === TG_OWNER_ID) {
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
__name(handleTelegramWebhook, "handleTelegramWebhook");
var BACKUP_TABLES = {
  // Rolling window: backup THEN delete old rows
  orders: { days: 60, dateCol: "created_at" },
  website_orders: { days: 60, dateCol: "created_at" },
  transactions: { days: 60, dateCol: "created_at" },
  customers: { days: 180, dateCol: "created_at" },
  expenses: { days: 180, dateCol: "created_at" },
  ad_tracker: { days: 180, dateCol: "created_at" },
  delivery_charges: { days: 365, dateCol: null },
  // yearly full backup only
  device_fingerprints: { days: 10, dateCol: "created_at" },
  // backup + cleanup: 10k visitors/day
  device_models: { days: 10, dateCol: "created_at" }
  // backup + cleanup: device info
};
var CLEANUP_TABLES = {
  // Cleanup only (no backup needed)
  admin_sessions: { days: 10, dateCol: "created_at" },
  admin_login_attempts: { days: 10, dateCol: "ts" },
  rate_limit_log: { days: 10, dateCol: "ts" },
  audit_log: { days: 10, dateCol: "ts" },
  _activity: { days: 10, dateCol: "ts" },
  steadfast_balance_cache: { days: 7, dateCol: "fetched_at" },
  steadfast_consignments: { days: 90, dateCol: "created_at" }
};
var YEARLY_TABLES = ["delivery_charges"];
var PERMANENT_BACKUP_TABLES = [
  "inventory",
  // 3500+ products — most critical
  "settings",
  // 570+ business settings
  "blocked_devices",
  // security: blocked fraudsters
  "admin_users",
  // login credentials
  "_draft_data",
  // product drafts
  "_archive_data"
  // archived products
];
async function runDailyBackup(env) {
  const now = /* @__PURE__ */ new Date();
  const bdNow = new Date(now.getTime() + 6 * 60 * 60 * 1e3);
  const dateStr = bdNow.toISOString().slice(0, 10);
  const month = bdNow.getMonth() + 1;
  const results = [];
  for (const [table, cfg] of Object.entries(BACKUP_TABLES)) {
    try {
      const rows = await supaQueryAll(env, table);
      if (!rows.length) {
        results.push({ table, action: "skip", reason: "no rows" });
        continue;
      }
      const key = `rolling/${table}/${dateStr}.json`;
      await r2Put(env, key, JSON.stringify(rows));
      if (cfg.dateCol) {
        const cutoff = new Date(now.getTime() - cfg.days * 864e5).toISOString();
        await supaDelete(env, table, cfg.dateCol, "lt", cutoff);
      }
      results.push({ table, action: "backup+cleanup", rows: rows.length, key });
    } catch (e) {
      results.push({ table, action: "error", msg: e.message });
    }
  }
  for (const [table, cfg] of Object.entries(CLEANUP_TABLES)) {
    try {
      const cutoff = new Date(now.getTime() - cfg.days * 864e5).toISOString();
      const deleted = await supaDelete(env, table, cfg.dateCol, "lt", cutoff);
      results.push({ table, action: "cleanup", deleted });
    } catch (e) {
      results.push({ table, action: "error", msg: e.message });
    }
  }
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
  for (const table of PERMANENT_BACKUP_TABLES) {
    try {
      const rows = await supaQueryAll(env, table);
      if (!rows.length) {
        results.push({ table, action: "skip", reason: "no rows" });
        continue;
      }
      const key = `permanent/${table}/${dateStr}.json`;
      await r2Put(env, key, JSON.stringify(rows));
      results.push({ table, action: "permanent-backup", rows: rows.length, key });
    } catch (e) {
      results.push({ table, action: "error", msg: e.message });
    }
  }
  console.log("[BACKUP]", dateStr, JSON.stringify(results));
  return results;
}
__name(runDailyBackup, "runDailyBackup");
async function handleBackupDownload(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (key) {
    const data = await env.YARZ_BACKUPS.get(key);
    if (!data) {
      return jsonResponse({ error: "File not found" }, 404);
    }
    const json = await data.json();
    return jsonResponse({ success: true, key, data: json });
  }
  const listed = await env.YARZ_BACKUPS.list();
  if (!listed.objects.length) {
    return jsonResponse({ error: "No backups found" }, 404);
  }
  const byTable = {};
  for (const obj of listed.objects) {
    const parts = obj.key.split("/");
    const table = parts[1] || parts[0];
    if (!byTable[table]) byTable[table] = [];
    byTable[table].push({ key: obj.key, size: obj.size, uploaded: obj.uploaded });
  }
  return jsonResponse({ success: true, backups: byTable, totalFiles: listed.objects.length });
}
__name(handleBackupDownload, "handleBackupDownload");
async function handleBackupList(request, env) {
  const auth = request.headers.get("Authorization");
  if (auth !== "Bearer yarz-admin-2026") {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const listed = await env.YARZ_BACKUPS.list();
  const files = listed.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded }));
  return jsonResponse({ success: true, files, totalSize: files.reduce((a, f) => a + f.size, 0) });
}
__name(handleBackupList, "handleBackupList");
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
__name(handleBackupRun, "handleBackupRun");
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
__name(handleBackupClear, "handleBackupClear");
async function supaQueryAll(env, table) {
  const allRows = [];
  let offset = 0;
  const batchSize = 1e3;
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
__name(supaQueryAll, "supaQueryAll");
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
__name(supaDelete, "supaDelete");
async function r2Put(env, key, value) {
  await env.YARZ_BACKUPS.put(key, value, {
    httpMetadata: { contentType: "application/json" }
  });
}
__name(r2Put, "r2Put");
async function r2DeleteAll(env, prefix) {
  const listed = await env.YARZ_BACKUPS.list({ prefix });
  for (const obj of listed.objects) {
    await env.YARZ_BACKUPS.delete(obj.key);
  }
  return listed.objects.length;
}
__name(r2DeleteAll, "r2DeleteAll");
var worker_supabase_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
      } catch (e) {
      }
      return new Response("Not Found", { status: 404 });
    }
    if (url.pathname === "/purge" || url.pathname === "/__purge") {
      return handlePurgeWebhook(request, env, ctx);
    }
    if (url.pathname === "/tg-webhook") {
      return handleTelegramWebhook(request, env, ctx);
    }
    if (url.pathname.startsWith("/agent/")) {
      return handleAgentRoute(request, env, ctx);
    }
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
    try {
      data = await resp.json();
    } catch (e) {
      data = { raw: await resp.text().catch(function() {
        return "";
      }) };
    }
    return { success: resp.ok, ok: resp.ok, status: resp.status, data };
  } catch (e) {
    return { success: false, ok: false, msg: "Steadfast request failed: " + e.message };
  }
}
__name(steadfastRequest, "steadfastRequest");
async function steadfastSaveConsignments(env, rows) {
  if (!rows || !rows.length) return;
  try {
    await supabaseRequest(env, "steadfast_consignments", { method: "POST", body: JSON.stringify(rows) });
  } catch (e) {
    console.error("[steadfastSave] error:", e.message);
  }
}
__name(steadfastSaveConsignments, "steadfastSaveConsignments");
async function steadfastCreateOrder(env, p) {
  const r = await steadfastRequest(env, "/create_order", "POST", p);
  if (r.data && r.data.consignment) {
    const c = r.data.consignment;
    await steadfastSaveConsignments(env, [{
      consignment_id: c.consignment_id,
      invoice: c.invoice,
      tracking_code: c.tracking_code,
      recipient_name: c.recipient_name || "",
      recipient_phone: c.recipient_phone || "",
      recipient_address: c.recipient_address || "",
      cod_amount: Number(c.cod_amount) || 0,
      status: c.status || "in_review",
      note: c.note || "",
      api_response: JSON.stringify(r.data),
      created_at: c.created_at || (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: c.updated_at || (/* @__PURE__ */ new Date()).toISOString()
    }]);
  }
  return r;
}
__name(steadfastCreateOrder, "steadfastCreateOrder");
async function steadfastBulkCreate(env, p) {
  const orders = p && (p.orders || p.data) || (Array.isArray(p) ? p : []);
  const r = await steadfastRequest(env, "/create_order/bulk-order", "POST", { data: JSON.stringify(orders) });
  if (Array.isArray(r.data)) {
    const rows = r.data.filter(function(c) {
      return c && c.consignment_id;
    }).map(function(c) {
      return {
        consignment_id: c.consignment_id,
        invoice: c.invoice,
        tracking_code: c.tracking_code,
        recipient_name: c.recipient_name || "",
        recipient_phone: c.recipient_phone || "",
        recipient_address: c.recipient_address || "",
        cod_amount: Number(c.cod_amount) || 0,
        status: c.status || (c.consignment_id ? "success" : "error"),
        note: c.note || "",
        api_response: JSON.stringify(c),
        created_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      };
    });
    await steadfastSaveConsignments(env, rows);
  }
  return r;
}
__name(steadfastBulkCreate, "steadfastBulkCreate");
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
      const col = t === "invoice" ? "invoice" : t.startsWith("tracking") ? "tracking_code" : "consignment_id";
      await supabaseRequest(env, "steadfast_consignments?" + col + "=eq." + encodeURIComponent(v), {
        method: "PATCH",
        body: JSON.stringify({ status: r.data.delivery_status, updated_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
    } catch (e) {
    }
  }
  return r;
}
__name(steadfastStatus, "steadfastStatus");
async function steadfastBalance(env) {
  const r = await steadfastRequest(env, "/get_balance", "GET");
  if (r.data && typeof r.data.current_balance !== "undefined") {
    try {
      await supabaseRequest(env, "steadfast_balance_cache", {
        method: "POST",
        body: JSON.stringify({ balance: Number(r.data.current_balance) || 0, fetched_at: (/* @__PURE__ */ new Date()).toISOString() })
      });
    } catch (e) {
    }
  }
  return r;
}
__name(steadfastBalance, "steadfastBalance");
async function steadfastCreateReturn(env, p) {
  return await steadfastRequest(env, "/create_return_request", "POST", p);
}
__name(steadfastCreateReturn, "steadfastCreateReturn");
async function steadfastListReturns(env) {
  return await steadfastRequest(env, "/get_return_requests", "GET");
}
__name(steadfastListReturns, "steadfastListReturns");
async function steadfastGetReturn(env, p) {
  const id = p && (p.id || p.return_id);
  if (!id) return { success: false, ok: false, msg: "Missing return id" };
  return await steadfastRequest(env, "/get_return_request/" + encodeURIComponent(id), "GET");
}
__name(steadfastGetReturn, "steadfastGetReturn");
async function steadfastListPayments(env) {
  return await steadfastRequest(env, "/payments", "GET");
}
__name(steadfastListPayments, "steadfastListPayments");
async function steadfastGetPayment(env, p) {
  const id = p && (p.id || p.payment_id);
  if (!id) return { success: false, ok: false, msg: "Missing payment id" };
  return await steadfastRequest(env, "/payments/" + encodeURIComponent(id), "GET");
}
__name(steadfastGetPayment, "steadfastGetPayment");
async function steadfastPoliceStations(env) {
  return await steadfastRequest(env, "/police_stations", "GET");
}
__name(steadfastPoliceStations, "steadfastPoliceStations");
async function steadfastSaveKeys(env, p) {
  const r = await getWriteDb();
  await ensureAuth();
  const rows = (p.keys || [{ api_key: p.apiKey, secret_key: p.secretKey }]).map(function(k) {
    return { name: k.name || "default", api_key: k.api_key || k.apiKey || "", secret_key: k.secret_key || k.secretKey || "", updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  });
  const up = await r.from("steadfast_keys").upsert(rows, { onConflict: "name" });
  if (up.error) throw new Error(up.error.message);
  return ok({ msg: "Keys saved", count: rows.length });
}
__name(steadfastSaveKeys, "steadfastSaveKeys");
async function steadfastKeysList(env) {
  const r = await supabaseRequest(env, "steadfast_keys?select=name,updated_at&order=updated_at.desc", { method: "GET" });
  return { success: true, ok: true, data: r };
}
__name(steadfastKeysList, "steadfastKeysList");
var DEFAULT_AI_SETTINGS = {
  active_model: "gemini",
  platforms: { messenger: true, instagram: false, whatsapp: false, tiktok: false },
  rate_limit_per_min: 10,
  handover_keywords: ["admin", "owner", "human", "\u09AE\u09BE\u09B2\u09BF\u0995", "\u098F\u09A1\u09AE\u09BF\u09A8"],
  delivery: { narayanganj_in: 80, narayanganj_out: 125 },
  greeting: "\u0986\u09B8\u09B8\u09BE\u09B2\u09BE\u09AE\u09C1 \u0986\u09B2\u09BE\u0987\u0995\u09C1\u09AE! YARZ Clothing-\u098F \u09B8\u09CD\u09AC\u09BE\u0997\u09A4\u09AE\u0964 \u0995\u09C0\u09AD\u09BE\u09AC\u09C7 \u09B8\u09BE\u09B9\u09BE\u09AF\u09CD\u09AF \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09BF?",
  max_history: 20,
  model_params: {
    gemini: { model: "gemini-2.0-flash", max_tokens: 1024, temperature: 0.7 },
    minimax: { model: "MiniMax", max_tokens: 1024, temperature: 0.7 },
    kimi: { model: "moonshot-v1-8k", max_tokens: 1024, temperature: 0.7 },
    deepseek: { model: "deepseek-chat", max_tokens: 1024, temperature: 0.7 },
    chatgpt: { model: "gpt-4o-mini", max_tokens: 1024, temperature: 0.7 },
    claude: { model: "claude-3-5-sonnet-20241022", max_tokens: 1024, temperature: 0.7 }
  }
};
var rateLimitMap = /* @__PURE__ */ new Map();
var memoryMap = /* @__PURE__ */ new Map();
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
      merged.delivery = Object.assign({}, DEFAULT_AI_SETTINGS.delivery, db.delivery || {});
      merged.handover_keywords = Array.isArray(db.handover_keywords) && db.handover_keywords.length > 0 ? db.handover_keywords : DEFAULT_AI_SETTINGS.handover_keywords;
      merged.model_params = Object.assign({}, DEFAULT_AI_SETTINGS.model_params, db.model_params || {});
      return merged;
    }
  } catch (e) {
    console.error("[loadSettings] failed, using defaults:", e.message);
  }
  return DEFAULT_AI_SETTINGS;
}
__name(loadSettings, "loadSettings");
async function saveSettings(env, settings) {
  try {
    const payload = Object.assign({ id: 1, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, settings || {});
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
__name(saveSettings, "saveSettings");
function isRateLimited(senderId, maxPerMin) {
  if (!senderId || !maxPerMin || maxPerMin <= 0) return false;
  const now = Date.now();
  const cutoff = now - 6e4;
  const arr = (rateLimitMap.get(senderId) || []).filter(function(t) {
    return t > cutoff;
  });
  if (arr.length >= maxPerMin) {
    rateLimitMap.set(senderId, arr);
    return true;
  }
  arr.push(now);
  rateLimitMap.set(senderId, arr);
  return false;
}
__name(isRateLimited, "isRateLimited");
function detectHandover(message, keywords) {
  if (!message || !Array.isArray(keywords) || keywords.length === 0) return false;
  const lower = String(message).toLowerCase();
  for (let i = 0; i < keywords.length; i++) {
    if (lower.includes(String(keywords[i]).toLowerCase())) return true;
  }
  return false;
}
__name(detectHandover, "detectHandover");
async function getRecentMessages(senderId, env, limit) {
  const max = limit || 20;
  if (!senderId) return [];
  try {
    if (env && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      const r = await supabaseRequest(
        env,
        "ai_messages?sender_id=eq." + encodeURIComponent(senderId) + "&order=created_at.desc&limit=" + max + "&select=role,message,created_at",
        { method: "GET" }
      );
      if (Array.isArray(r)) {
        return r.reverse().map(function(m) {
          return { role: m.role, message: m.message, created_at: m.created_at };
        });
      }
    }
  } catch (e) {
    console.error("[getRecentMessages] DB fallback:", e.message);
  }
  const arr = memoryMap.get(senderId) || [];
  return arr.slice(-max);
}
__name(getRecentMessages, "getRecentMessages");
async function saveMessage(senderId, platform, role, message, env) {
  if (!senderId || !role) return;
  const row = {
    sender_id: senderId,
    platform: platform || "unknown",
    role,
    message: String(message || "").substring(0, 8e3),
    // cap length
    created_at: (/* @__PURE__ */ new Date()).toISOString()
  };
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
  const arr = memoryMap.get(senderId) || [];
  arr.push({ role: row.role, message: row.message, created_at: row.created_at });
  if (arr.length > 40) arr.splice(0, arr.length - 40);
  memoryMap.set(senderId, arr);
}
__name(saveMessage, "saveMessage");
function buildSystemPrompt(settings, inventorySummary) {
  const deliv = settings && settings.delivery || DEFAULT_AI_SETTINGS.delivery;
  const inv = inventorySummary || "YARZ Clothing-\u098F\u09B0 \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8\u09C7 \u09AC\u09BF\u09AD\u09BF\u09A8\u09CD\u09A8 \u09B8\u09BE\u0987\u099C\u09C7\u09B0 (S, M, L, XL, XXL, 3XL) \u09AA\u09CD\u09B0\u09BF\u09AE\u09BF\u09AF\u09BC\u09BE\u09AE \u09AA\u09CB\u09B6\u09BE\u0995 \u09B8\u09CD\u099F\u0995\u09C7 \u0986\u099B\u09C7\u0964";
  return [
    '\u09A4\u09C1\u09AE\u09BF \u09B9\u09B2\u09C7 YARZ Clothing-\u098F\u09B0 \u098F\u0995\u099C\u09A8 \u09AE\u09BE\u09A8\u09C1\u09B7 \u09AE\u09A1\u09BE\u09B0\u09C7\u099F\u09B0\u0964 \u09A4\u09CB\u09AE\u09BE\u09B0 \u09A8\u09BE\u09AE "YARZ Support"\u0964',
    "\u0997\u09C1\u09B0\u09C1\u09A4\u09CD\u09AC\u09AA\u09C2\u09B0\u09CD\u09A3: \u0995\u0996\u09A8\u09CB \u09AC\u09B2\u09AC\u09C7 \u09A8\u09BE \u09AF\u09C7 \u09A4\u09C1\u09AE\u09BF AI, \u09B0\u09CB\u09AC\u099F, \u09AC\u09BE \u099A\u09CD\u09AF\u09BE\u099F\u09AC\u099F\u0964 \u09A4\u09C1\u09AE\u09BF \u098F\u0995\u099C\u09A8 \u09B8\u09B9\u09BE\u09A8\u09C1\u09AD\u09C2\u09A4\u09BF\u09B6\u09C0\u09B2 \u09AC\u09BE\u0982\u09B2\u09BE\u09A6\u09C7\u09B6\u09BF \u09AE\u09A1\u09BE\u09B0\u09C7\u099F\u09B0\u0964",
    "",
    "\u09AD\u09BE\u09B7\u09BE: \u09AA\u09CD\u09B0\u09A7\u09BE\u09A8\u09A4 \u09AC\u09BE\u0982\u09B2\u09BE\u09AF\u09BC \u0995\u09A5\u09BE \u09AC\u09B2\u09AC\u09C7\u0964 \u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u09C7 \u0987\u0982\u09B0\u09C7\u099C\u09BF \u09AC\u09BE \u09AC\u09BE\u0982\u09B2\u09BE+\u0987\u0982\u09B0\u09C7\u099C\u09BF \u09AE\u09BF\u0995\u09CD\u09B8 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09CB\u0964",
    "\u099F\u09CB\u09A8: \u0989\u09B7\u09CD\u09A3, \u09AA\u09C7\u09B6\u09BE\u09A6\u09BE\u09B0, \u09B8\u0982\u0995\u09CD\u09B7\u09BF\u09AA\u09CD\u09A4 \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 \u09B8\u09B9\u09BE\u09AF\u09BC\u0995\u0964 \u0985\u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u09C0\u09AF\u09BC \u09B2\u09AE\u09CD\u09AC\u09BE \u09AE\u09C7\u09B8\u09C7\u099C \u09B2\u09BF\u0996\u09AC\u09C7 \u09A8\u09BE\u0964",
    "",
    "\u0987\u09A8\u09AD\u09C7\u09A8\u09CD\u099F\u09B0\u09BF (\u09B8\u09CD\u099F\u0995\u09C7 \u0986\u099B\u09C7):",
    inv,
    "",
    "\u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u09A8\u09C7\u0993\u09AF\u09BC\u09BE\u09B0 \u09A8\u09BF\u09AF\u09BC\u09AE:",
    "1. \u09AF\u0996\u09A8 \u0995\u09C7\u0989 \u0985\u09B0\u09CD\u09A1\u09BE\u09B0/\u0995\u09C7\u09A8\u09BE\u0995\u09BE\u099F\u09BE \u0995\u09B0\u09A4\u09C7 \u099A\u09BE\u0987\u09AC\u09C7, \u09A4\u0996\u09A8 \u09A8\u09BF\u099A\u09C7\u09B0 \u09AB\u09B0\u09AE\u09CD\u09AF\u09BE\u099F\u09C7 \u09A4\u09A5\u09CD\u09AF \u099A\u09BE\u0987\u09AC\u09C7 (\u09AC\u09BE\u0982\u09B2\u09BE\u09AF\u09BC):",
    "   Name:",
    "   Phone Number:",
    "   Full Address:",
    "   Product Size:",
    "   Quantity:",
    "2. \u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 \u09B8\u09AC \u09A4\u09A5\u09CD\u09AF \u09A6\u09BF\u09B2\u09C7 \u09A8\u09BF\u099A\u09C7\u09B0 \u09AB\u09B0\u09AE\u09CD\u09AF\u09BE\u099F\u09C7 \u0995\u09A8\u09AB\u09BE\u09B0\u09CD\u09AE\u09C7\u09B6\u09A8 \u09A6\u09C7\u09AC\u09C7:",
    "   Name: ...",
    "   Phone Number: ...",
    "   Full Address: ...",
    "   Product: ...",
    "   Size: ...",
    "   Quantity: ...",
    "   Price: \u09F3...",
    "   Delivery Charge: \u09F3" + deliv.narayanganj_in + " (\u09A8\u09BE\u09B0\u09BE\u09AF\u09BC\u09A3\u0997\u099E\u09CD\u099C\u09C7\u09B0 \u09AD\u09BF\u09A4\u09B0\u09C7) \u0985\u09A5\u09AC\u09BE \u09F3" + deliv.narayanganj_out + " (\u09A8\u09BE\u09B0\u09BE\u09AF\u09BC\u09A3\u0997\u099E\u09CD\u099C\u09C7\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7)",
    "   Total: \u09F3...",
    '3. \u09A1\u09C7\u09B2\u09BF\u09AD\u09BE\u09B0\u09BF \u099A\u09BE\u09B0\u09CD\u099C \u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09A3: \u09A0\u09BF\u0995\u09BE\u09A8\u09BE\u09AF\u09BC "\u09A8\u09BE\u09B0\u09BE\u09AF\u09BC\u09A3\u0997\u099E\u09CD\u099C" \u09B6\u09AC\u09CD\u09A6 \u09A5\u09BE\u0995\u09B2\u09C7 \u09AD\u09BF\u09A4\u09B0\u09C7 (\u09F3' + deliv.narayanganj_in + "), \u09A8\u09BE \u09A5\u09BE\u0995\u09B2\u09C7 \u09AC\u09BE\u0987\u09B0\u09C7 (\u09F3" + deliv.narayanganj_out + ").",
    "",
    "\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3 \u09A8\u09BF\u09AF\u09BC\u09AE:",
    "- \u09AA\u09CD\u09B0\u09CB\u09A1\u09BE\u0995\u09CD\u099F, \u09B8\u09BE\u0987\u099C, \u09A6\u09BE\u09AE \u09B8\u09AE\u09CD\u09AA\u09B0\u09CD\u0995\u09C7 \u09AA\u09CD\u09B0\u09B6\u09CD\u09A8\u09C7\u09B0 \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BE\u0993\u0964",
    "- \u09B8\u09CD\u099F\u0995 \u09A8\u09BE \u09A5\u09BE\u0995\u09B2\u09C7 \u099C\u09BE\u09A8\u09BE\u0993 \u098F\u09AC\u0982 \u0995\u09BE\u099B\u09BE\u0995\u09BE\u099B\u09BF \u09AC\u09BF\u0995\u09B2\u09CD\u09AA \u09B8\u09BE\u099C\u09C7\u09B8\u09CD\u099F \u0995\u09B0\u09CB\u0964",
    '- \u09A6\u09BE\u09AE \u09AC\u09BE \u09B8\u09CD\u099F\u0995 \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u09A8\u09BE \u09B9\u09B2\u09C7 \u09AC\u09B2\u09CB "\u0986\u09AE\u09BF \u09AE\u09A1\u09BE\u09B0\u09C7\u099F\u09B0 \u099F\u09BF\u09AE\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u099A\u09C7\u0995 \u0995\u09B0\u09C7 \u099C\u09BE\u09A8\u09BE\u099A\u09CD\u099B\u09BF"\u0964',
    '- \u0995\u09BE\u09B8\u09CD\u099F\u09AE\u09BE\u09B0 "\u098F\u09A1\u09AE\u09BF\u09A8/\u09AE\u09BE\u09B2\u09BF\u0995/owner" \u09AC\u09B2\u09C7 \u09A1\u09BE\u0995\u09B2\u09C7 \u09AE\u09C7\u09B8\u09C7\u099C \u09AB\u09B0\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u0995\u09B0\u09CB (\u09A4\u09C1\u09AE\u09BF \u09AC\u09B2\u09AC\u09C7 "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AE\u09C7\u09B8\u09C7\u099C \u09AE\u09A1\u09BE\u09B0\u09C7\u099F\u09B0 \u099F\u09BF\u09AE\u0995\u09C7 \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7")\u0964',
    "- \u0995\u0996\u09A8\u09CB \u09A8\u09BF\u099C\u09C7 AI \u09AC\u09BE \u099A\u09CD\u09AF\u09BE\u099F\u09AC\u099F \u09AC\u09B2\u09C7 \u09AA\u09B0\u09BF\u099A\u09AF\u09BC \u09A6\u09BF\u0993 \u09A8\u09BE\u0964",
    "- \u098F\u0995\u0987 \u09AE\u09C7\u09B8\u09C7\u099C \u09AC\u09BE\u09B0\u09AC\u09BE\u09B0 \u09A6\u09BF\u0993 \u09A8\u09BE; \u09B8\u0982\u0995\u09CD\u09B7\u09C7\u09AA\u09C7 \u0993 \u09B8\u09CD\u09AA\u09B7\u09CD\u099F\u09AD\u09BE\u09AC\u09C7 \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BE\u0993\u0964"
  ].join("\n");
}
__name(buildSystemPrompt, "buildSystemPrompt");
function toOpenAIMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(function(m) {
    return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.message || "") };
  });
}
__name(toOpenAIMessages, "toOpenAIMessages");
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
        max_tokens: params && params.max_tokens || 1024,
        temperature: params && params.temperature != null ? params.temperature : 0.7
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok) {
      const errMsg = data && data.error && (data.error.message || data.error.code || data.error) || data.message || "HTTP " + resp.status;
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return text ? String(text).trim() : { error: "Empty response" };
  } catch (e) {
    return { error: e.message };
  }
}
__name(callOpenAICompat, "callOpenAICompat");
async function callGemini(messages, systemPrompt, apiKey, params) {
  if (!apiKey) return { error: "Gemini API key not configured" };
  try {
    const contents = (Array.isArray(messages) ? messages : []).map(function(m) {
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.message || "") }]
      };
    });
    const body = {
      contents,
      systemInstruction: { parts: [{ text: String(systemPrompt || "") }] },
      generationConfig: {
        maxOutputTokens: params && params.max_tokens || 1024,
        temperature: params && params.temperature != null ? params.temperature : 0.7
      }
    };
    const url = "https://generativelanguage.googleapis.com/v1beta/models/" + (params && params.model || "gemini-2.0-flash") + ":generateContent?key=" + encodeURIComponent(apiKey);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok) {
      const errMsg = data && data.error && data.error.message || "HTTP " + resp.status;
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    return text ? String(text).trim() : { error: "Empty Gemini response" };
  } catch (e) {
    return { error: e.message };
  }
}
__name(callGemini, "callGemini");
async function callClaude(oaMessages, systemPrompt, apiKey, params) {
  if (!apiKey) return { error: "Claude API key not configured" };
  try {
    const msgs = (Array.isArray(oaMessages) ? oaMessages : []).map(function(m) {
      return { role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "") };
    });
    const body = {
      model: params && params.model || "claude-3-5-sonnet-20241022",
      max_tokens: params && params.max_tokens || 1024,
      system: String(systemPrompt || ""),
      messages: msgs,
      temperature: params && params.temperature != null ? params.temperature : 0.7
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
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok) {
      const errMsg = data && data.error && data.error.message || "HTTP " + resp.status;
      return { error: typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg) };
    }
    if (Array.isArray(data && data.content)) {
      const parts = data.content.filter(function(b) {
        return b && b.type === "text" && b.text;
      });
      const text = parts.map(function(b) {
        return b.text;
      }).join("\n");
      return text ? text.trim() : { error: "Empty Claude response" };
    }
    return { error: "Unexpected Claude response shape" };
  } catch (e) {
    return { error: e.message };
  }
}
__name(callClaude, "callClaude");
async function callAIModel(modelName, messages, systemPrompt, env, params) {
  const m = String(modelName || "").toLowerCase();
  const oa = toOpenAIMessages(messages);
  const mp = params && params.model_params || DEFAULT_AI_SETTINGS.model_params[m] || {};
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
__name(callAIModel, "callAIModel");
async function notifyTelegram(env, text, opts) {
  const token = env && env.TELEGRAM_BOT_TOKEN;
  const chatId = opts && opts.chat_id || env && env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { success: false, error: "Telegram not configured" };
  try {
    const resp = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text || "").substring(0, 4096),
        parse_mode: opts && opts.parse_mode || "HTML"
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok || data && data.ok === false) {
      return { success: false, error: data && data.description || "HTTP " + resp.status };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(notifyTelegram, "notifyTelegram");
async function forwardToTelegram(env, info) {
  const customerName = info.customerName || "Unknown";
  const platform = info.platform || "unknown";
  const senderId = info.senderId || "";
  const text = [
    "\u{1F514} <b>Human Handover Request</b>",
    "Platform: <code>" + platform + "</code>",
    "Customer: <code>" + customerName + "</code>",
    "Sender ID: <code>" + senderId + "</code>",
    "",
    "Message:",
    String(info.message || "").substring(0, 2e3)
  ].join("\n");
  await notifyTelegram(env, text, { parse_mode: "HTML" });
}
__name(forwardToTelegram, "forwardToTelegram");
async function sendMessengerReply(env, recipientId, text) {
  const token = env.MESSENGER_PAGE_TOKEN;
  if (!token) return { success: false, error: "Messenger token not configured" };
  try {
    const resp = await fetch("https://graph.facebook.com/v18.0/me/messages?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: String(text || "").substring(0, 2e3) }
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok || data && data.error) {
      return { success: false, error: data && data.error && (data.error.message || data.error.code) || "HTTP " + resp.status };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(sendMessengerReply, "sendMessengerReply");
async function sendInstagramReply(env, recipientId, text) {
  const token = env.INSTAGRAM_PAGE_TOKEN;
  if (!token) return { success: false, error: "Instagram token not configured" };
  try {
    const resp = await fetch("https://graph.facebook.com/v18.0/me/messages?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: String(text || "").substring(0, 2e3) }
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok || data && data.error) {
      return { success: false, error: data && data.error && (data.error.message || data.error.code) || "HTTP " + resp.status };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(sendInstagramReply, "sendInstagramReply");
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
        text: { body: String(text || "").substring(0, 4e3) }
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok || data && data.error) {
      return { success: false, error: data && data.error && (data.error.message || data.error.code) || "HTTP " + resp.status };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(sendWhatsAppReply, "sendWhatsAppReply");
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
        message: { type: "text", text: String(text || "").substring(0, 4e3) }
      })
    });
    const data = await resp.json().catch(function() {
      return {};
    });
    if (!resp.ok || data && data.error) {
      const errMsg = data && (typeof data.error === "string" ? data.error : data.error.message || data.error.code);
      return { success: false, error: errMsg || "HTTP " + resp.status };
    }
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
__name(sendTikTokReply, "sendTikTokReply");
async function handleAgentMessage(env, input) {
  const senderId = input && input.senderId;
  const platform = String(input && input.platform || "").toLowerCase();
  const message = String(input && input.message || "").trim();
  if (!senderId || !platform || !message) {
    return { reply: null, reason: "invalid_input" };
  }
  let settings;
  try {
    settings = await loadSettings(env);
  } catch (e) {
    return { reply: null, reason: "settings_error", error: e.message };
  }
  if (!settings.platforms || !settings.platforms[platform]) {
    return { reply: null, reason: "platform_off" };
  }
  if (isRateLimited(senderId, settings.rate_limit_per_min || 10)) {
    return { reply: null, reason: "rate_limited" };
  }
  if (detectHandover(message, settings.handover_keywords)) {
    try {
      await forwardToTelegram(env, {
        senderId,
        platform,
        message,
        customerName: input && input.customerName || ""
      });
    } catch (e) {
      console.error("[handover] forward failed:", e.message);
    }
    const handoverReply = "\u0986\u09AA\u09A8\u09BE\u09B0 \u09AE\u09C7\u09B8\u09C7\u099C \u0986\u09AE\u09BE\u09A6\u09C7\u09B0 \u09AE\u09A1\u09BE\u09B0\u09C7\u099F\u09B0\u09C7\u09B0 \u0995\u09BE\u099B\u09C7 \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u09B6\u09BF\u0998\u09CD\u09B0\u0987 \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09AC\u09C7\u0964";
    await saveMessage(senderId, platform, "user", message, env);
    await saveMessage(senderId, platform, "assistant", handoverReply, env);
    return { reply: handoverReply, reason: "handover" };
  }
  let history = [];
  try {
    history = await getRecentMessages(senderId, env, settings.max_history || 20);
  } catch (e) {
    console.error("[history] load failed:", e.message);
  }
  const messages = history.concat([{ role: "user", message }]);
  const sys = buildSystemPrompt(settings);
  const aiResp = await callAIModel(settings.active_model, messages, sys, env);
  if (!aiResp || typeof aiResp !== "string") {
    const err = aiResp && aiResp.error || "Unknown AI error";
    return { reply: null, reason: "ai_error", error: err };
  }
  await saveMessage(senderId, platform, "user", message, env);
  await saveMessage(senderId, platform, "assistant", aiResp, env);
  return { reply: aiResp };
}
__name(handleAgentMessage, "handleAgentMessage");
async function handleMessengerWebhook(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const entries = payload && payload.entry || [];
  const results = [];
  for (const entry of entries) {
    const events = entry.messaging || [];
    for (const ev of events) {
      const senderId = ev.sender && ev.sender.id;
      const msg = ev.message;
      if (!senderId || !msg) continue;
      const attachmentUrl = msg.attachments && msg.attachments[0] && msg.attachments[0].payload && msg.attachments[0].payload.url || "";
      const text = msg.text || attachmentUrl || "";
      const r = await handleAgentMessage(env, {
        senderId,
        platform: "messenger",
        message: text,
        imageUrl: attachmentUrl || void 0,
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
__name(handleMessengerWebhook, "handleMessengerWebhook");
async function handleInstagramWebhook(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const entries = payload && payload.entry || [];
  const results = [];
  for (const entry of entries) {
    const events = entry.messaging || [];
    for (const ev of events) {
      const senderId = ev.sender && ev.sender.id;
      const msg = ev.message;
      if (!senderId || !msg) continue;
      const text = msg.text || "";
      const r = await handleAgentMessage(env, {
        senderId,
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
__name(handleInstagramWebhook, "handleInstagramWebhook");
async function handleWhatsAppWebhook(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const changes = (((payload || {}).entry || [])[0] || {}).changes || [];
  const results = [];
  for (const ch of changes) {
    const value = ch.value || {};
    const messages = value.messages || [];
    const contactName = (((value.contacts || [])[0] || {}).profile || {}).name || "";
    for (const m of messages) {
      const senderId = m.from;
      const text = m.text && m.text.body || "";
      if (!senderId || !text) continue;
      const r = await handleAgentMessage(env, {
        senderId,
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
__name(handleWhatsAppWebhook, "handleWhatsAppWebhook");
async function handleTikTokWebhook(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const events = payload && (payload.events || payload.messages) || [];
  const results = [];
  for (const ev of events) {
    const senderId = ev.sender && (ev.sender.open_id || ev.sender.id) || ev.conversation_id;
    const msg = ev.message || ev;
    const text = msg && (msg.text || msg.content && msg.content.text) || "";
    if (!senderId || !text) continue;
    const r = await handleAgentMessage(env, {
      senderId,
      platform: "tiktok",
      message: text,
      customerName: ev.sender && ev.sender.display_name || ""
    });
    if (r && r.reply) {
      await sendTikTokReply(env, senderId, r.reply);
    }
    results.push({ sender_id: senderId, reply: r.reply, reason: r.reason || null });
  }
  return jsonResponse({ success: true, data: results });
}
__name(handleTikTokWebhook, "handleTikTokWebhook");
async function createAgentOrder(env, order) {
  const orderId = order && order.order_id || "AGT-" + Date.now() + "-" + Math.floor(Math.random() * 1e4);
  const row = {
    order_id: orderId,
    cust_name: order && order.cust_name || "",
    cust_phone: order && order.cust_phone || "",
    cust_addr: order && order.cust_addr || "",
    product: order && order.product || "",
    size: order && order.size || "",
    qty: Number(order && order.qty) || 1,
    price: Number(order && order.price) || 0,
    delivery_charge: Number(order && order.delivery_charge) || 0,
    total: Number(order && order.total) || (Number(order && order.price) || 0) * (Number(order && order.qty) || 1) + (Number(order && order.delivery_charge) || 0),
    status: "Pending",
    payment: order && order.payment || "Cash on Delivery",
    notes: order && order.notes || "AI Agent order from " + (order && order.platform || "unknown"),
    created_at: (/* @__PURE__ */ new Date()).toISOString(),
    sender_id: order && order.sender_id || "",
    platform: order && order.platform || "",
    deliv_zone: order && order.deliv_zone || ""
  };
  try {
    await supabaseRequest(env, "website_orders", { method: "POST", body: JSON.stringify(row) });
  } catch (e) {
    console.error("[createAgentOrder] DB insert failed:", e.message);
    return { success: false, error: e.message };
  }
  const tgText = [
    "\u{1F6D2} <b>New AI Agent Order</b>",
    "Order: <code>" + orderId + "</code>",
    "Customer: " + row.cust_name + " (" + row.cust_phone + ")",
    "Product: " + row.product + " / Size " + row.size + " \xD7" + row.qty,
    "Total: \u09F3" + row.total + " (Delivery \u09F3" + row.delivery_charge + ")",
    "Address: " + row.cust_addr,
    "Platform: <code>" + row.platform + "</code>"
  ].join("\n");
  await notifyTelegram(env, tgText, { parse_mode: "HTML" });
  return { success: true, orderId };
}
__name(createAgentOrder, "createAgentOrder");
async function handleAgentWebhook(request, env) {
  const providedSecret = request.headers.get("x-agent-secret") || "";
  const expectedSecret = env && env.AGENT_SECRET || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ success: false, error: "Unauthorized" }, 401);
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const platform = String(body.platform || "").toLowerCase();
  const senderId = body.sender_id || body.senderId;
  const message = body.message || body.text || "";
  const customerName = body.customer_name || body.customerName || "";
  const r = await handleAgentMessage(env, {
    senderId,
    platform,
    message,
    customerName
  });
  if (r && r.reply) {
    if (platform === "messenger") await sendMessengerReply(env, senderId, r.reply);
    else if (platform === "instagram") await sendInstagramReply(env, senderId, r.reply);
    else if (platform === "whatsapp") await sendWhatsAppReply(env, senderId, r.reply);
    else if (platform === "tiktok") await sendTikTokReply(env, senderId, r.reply);
  }
  return jsonResponse({ success: true, data: r });
}
__name(handleAgentWebhook, "handleAgentWebhook");
async function handleAgentSend(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const platform = String(body.platform || "").toLowerCase();
  const recipient = body.recipient || body.sender_id;
  const text = body.text || body.message || "";
  if (!platform || !recipient || !text) {
    return jsonResponse({ success: false, error: "Missing platform/recipient/text" }, 400);
  }
  let r;
  if (platform === "messenger") r = await sendMessengerReply(env, recipient, text);
  else if (platform === "instagram") r = await sendInstagramReply(env, recipient, text);
  else if (platform === "whatsapp") r = await sendWhatsAppReply(env, recipient, text);
  else if (platform === "tiktok") r = await sendTikTokReply(env, recipient, text);
  else return jsonResponse({ success: false, error: "Unknown platform: " + platform }, 400);
  await saveMessage(recipient, platform, "assistant", text, env);
  return jsonResponse({ success: !!(r && r.success), data: r });
}
__name(handleAgentSend, "handleAgentSend");
async function handleAgentSettings(request, env) {
  if (request.method === "GET") {
    const settings = await loadSettings(env);
    return jsonResponse({ success: true, data: settings });
  }
  if (request.method === "POST") {
    const providedSecret = request.headers.get("x-agent-secret") || "";
    const expectedSecret = env && env.AGENT_SECRET || "";
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
    }
    const r = await saveSettings(env, body || {});
    return jsonResponse(r, r.success ? 200 : 500);
  }
  return jsonResponse({ success: false, error: "Method not allowed" }, 405);
}
__name(handleAgentSettings, "handleAgentSettings");
async function handleAgentTest(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const message = body.message || body.text || "";
  const modelOverride = body.model || "";
  if (!message) return jsonResponse({ success: false, error: "Missing message" }, 400);
  const settings = await loadSettings(env);
  const model = modelOverride || settings.active_model || "gemini";
  const sys = buildSystemPrompt(settings);
  const aiResp = await callAIModel(model, [{ role: "user", message }], sys, env);
  return jsonResponse({
    success: !!(aiResp && typeof aiResp === "string"),
    data: { reply: aiResp, model }
  });
}
__name(handleAgentTest, "handleAgentTest");
async function handleAgentOrderNew(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  if (!body.cust_phone || !body.product) {
    return jsonResponse({ success: false, error: "cust_phone and product are required" }, 400);
  }
  const r = await createAgentOrder(env, body);
  return jsonResponse(r, r.success ? 200 : 500);
}
__name(handleAgentOrderNew, "handleAgentOrderNew");
async function handleAgentForward(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
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
__name(handleAgentForward, "handleAgentForward");
async function handleAgentAsk(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ success: false, error: "Invalid JSON" }, 400);
  }
  const question = body.question || "";
  if (!question) return jsonResponse({ success: false, error: "Missing question" }, 400);
  try {
    const bdNow = new Date(Date.now() + 6 * 36e5);
    const todayStr = bdNow.toISOString().slice(0, 10);
    const monthStart = bdNow.toISOString().slice(0, 7) + "-01";
    const [todayTx, todayAd, todayExp, monthTx, inventory] = await Promise.all([
      supabaseRequest(env, "transactions?select=product,qty,revenue,cost,profit,type,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() {
        return [];
      }),
      supabaseRequest(env, "ad_tracker?select=product,spend,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() {
        return [];
      }),
      supabaseRequest(env, "expenses?select=category,description,amount,date&date=gte." + todayStr + "T00:00:00&date=lt." + todayStr + "T23:59:59&order=date.desc", { method: "GET" }).catch(function() {
        return [];
      }),
      supabaseRequest(env, "transactions?select=product,qty,revenue,cost,profit,type,date&date=gte." + monthStart + "T00:00:00&order=date.desc", { method: "GET" }).catch(function() {
        return [];
      }),
      supabaseRequest(env, "inventory?select=product,status,stk_s,stk_m,stk_l,stk_xl,stk_xxl,stk_3xl,sold_s,sold_m,sold_l,sold_xl,sold_xxl,sold_3xl,cost,regular,sale&status=eq.Active&order=product.asc", { method: "GET" }).catch(function() {
        return [];
      })
    ]);
    const todayRev = (Array.isArray(todayTx) ? todayTx : []).reduce(function(s, t) {
      return s + (Number(t.revenue) || 0);
    }, 0);
    const todayCost = (Array.isArray(todayTx) ? todayTx : []).reduce(function(s, t) {
      return s + (Number(t.cost) || 0);
    }, 0);
    const todayGross = todayRev - todayCost;
    const todayAdSpend = (Array.isArray(todayAd) ? todayAd : []).reduce(function(s, t) {
      return s + (Number(t.spend) || 0);
    }, 0);
    const todayOtherExp = (Array.isArray(todayExp) ? todayExp : []).reduce(function(s, t) {
      return s + (Number(t.amount) || 0);
    }, 0);
    const todaySalesCount = (Array.isArray(todayTx) ? todayTx : []).filter(function(t) {
      return t.type === "Sale";
    }).length;
    const todayReturnCount = (Array.isArray(todayTx) ? todayTx : []).filter(function(t) {
      return t.type === "Return";
    }).length;
    const monthRev = (Array.isArray(monthTx) ? monthTx : []).reduce(function(s, t) {
      return s + (Number(t.revenue) || 0);
    }, 0);
    const monthCost = (Array.isArray(monthTx) ? monthTx : []).reduce(function(s, t) {
      return s + (Number(t.cost) || 0);
    }, 0);
    const monthGross = monthRev - monthCost;
    const totalProducts = (Array.isArray(inventory) ? inventory : []).length;
    const totalUnits = (Array.isArray(inventory) ? inventory : []).reduce(function(s, p) {
      return s + (Number(p.stk_s) || 0) + (Number(p.stk_m) || 0) + (Number(p.stk_l) || 0) + (Number(p.stk_xl) || 0) + (Number(p.stk_xxl) || 0) + (Number(p.stk_3xl) || 0);
    }, 0);
    const totalSold = (Array.isArray(inventory) ? inventory : []).reduce(function(s, p) {
      return s + (Number(p.sold_s) || 0) + (Number(p.sold_m) || 0) + (Number(p.sold_l) || 0) + (Number(p.sold_xl) || 0) + (Number(p.sold_xxl) || 0) + (Number(p.sold_3xl) || 0);
    }, 0);
    var context = "=== YARZ CLOTHING BUSINESS DATA ===\n\n";
    context += "TODAY (" + todayStr + "):\n";
    context += "- Total Sales: " + todaySalesCount + " orders, " + todayReturnCount + " returns\n";
    context += "- Revenue: \u09F3" + todayRev.toLocaleString() + "\n";
    context += "- Cost of Goods: \u09F3" + todayCost.toLocaleString() + "\n";
    context += "- Gross Profit: \u09F3" + todayGross.toLocaleString() + "\n";
    context += "- Ad Spend: \u09F3" + todayAdSpend.toLocaleString() + "\n";
    context += "- Other Expenses: \u09F3" + todayOtherExp.toLocaleString() + "\n";
    context += "- Today's Products Sold:\n";
    (Array.isArray(todayTx) ? todayTx : []).forEach(function(t) {
      context += "  \u2022 " + t.product + " (x" + t.qty + ") \u2014 \u09F3" + t.revenue + " revenue, \u09F3" + t.cost + " cost, " + t.type + "\n";
    });
    context += "- Today's Ad Spend:\n";
    (Array.isArray(todayAd) ? todayAd : []).forEach(function(a) {
      context += "  \u2022 " + a.product + " \u2014 \u09F3" + a.spend + "\n";
    });
    context += "\nTHIS MONTH (since " + monthStart + "):\n";
    context += "- Revenue: \u09F3" + monthRev.toLocaleString() + "\n";
    context += "- Cost: \u09F3" + monthCost.toLocaleString() + "\n";
    context += "- Gross Profit: \u09F3" + monthGross.toLocaleString() + "\n";
    context += "- Total Transactions: " + (Array.isArray(monthTx) ? monthTx.length : 0) + "\n";
    context += "\nINVENTORY:\n";
    context += "- Active Products: " + totalProducts + "\n";
    context += "- Total Units in Stock: " + totalUnits + "\n";
    context += "- Total Units Sold (all time): " + totalSold + "\n";
    var sys = [
      "\u09A4\u09C1\u09AE\u09BF 'YARZ Business AI' \u2014 YARZ Clothing \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09C7\u09B0 \u098F\u0995\u099C\u09A8 \u0985\u09AD\u09BF\u099C\u09CD\u099E \u09AC\u09BF\u099C\u09A8\u09C7\u09B8 \u09AA\u09BE\u09B0\u09CD\u099F\u09A8\u09BE\u09B0\u0964",
      "\u09A4\u09C1\u09AE\u09BF \u09AE\u09BE\u09B2\u09BF\u0995 (\u09AE\u09BE\u09B0\u09C1\u09AB) \u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u0995\u09A5\u09BE \u09AC\u09B2\u099B\u09CB \u2014 \u09A4\u09BE\u09B0 \u09AC\u09CD\u09AF\u09AC\u09B8\u09BE\u09B0 \u09B8\u09AC\u0995\u09BF\u099B\u09C1 \u09A4\u09CB\u09AE\u09BE\u09B0 \u09B9\u09BE\u09A4\u09C7\u0964",
      "",
      "\u09A4\u09CB\u09AE\u09BE\u09B0 \u09B8\u09CD\u099F\u09BE\u0987\u09B2:",
      "- \u09AE\u09BE\u09A8\u09C1\u09B7\u09C7\u09B0 \u09AE\u09A4\u09CB \u0995\u09A5\u09BE \u09AC\u09B2\u09CB, \u099F\u09C7\u09AE\u09AA\u09CD\u09B2\u09C7\u099F \u09AC\u09BE \u099F\u09C7\u09AC\u09BF\u09B2 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09CB \u09A8\u09BE\u0964",
      "- \u0989\u09B7\u09CD\u09A3, \u09AC\u09A8\u09CD\u09A7\u09C1\u09B8\u09C1\u09B2\u09AD \u09AD\u09BE\u09B7\u09BE\u09AF\u09BC \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BE\u0993 \u2014 \u09AF\u09C7\u09A8 \u0986\u09AA\u09A8\u09BE\u09B0 \u098F\u0995\u099C\u09A8 \u09AC\u09BF\u09B6\u09CD\u09AC\u09B8\u09CD\u09A4 \u09AA\u09BE\u09B0\u09CD\u099F\u09A8\u09BE\u09B0 \u0995\u09A5\u09BE \u09AC\u09B2\u099B\u09C7\u0964",
      "- \u09B8\u09AC \u09A1\u09BE\u099F\u09BE \u099A\u09C7\u0995 \u0995\u09B0\u09C7 \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09BE\u0993\u0964 \u09B6\u09C1\u09A7\u09C1 '\u09E6' \u09AC\u09B2\u09C7 \u09A5\u09BE\u09AE\u09CB \u09A8\u09BE \u2014 \u09AA\u09B0\u09BE\u09AE\u09B0\u09CD\u09B6 \u09A6\u09BE\u0993\u0964",
      "- \u09AF\u09A6\u09BF \u0986\u099C \u09B8\u09C7\u09B2\u09B8 \u09A8\u09BE \u09A5\u09BE\u0995\u09C7, \u09AC\u09B2\u09CB '\u0986\u099C \u098F\u0996\u09A8\u09CB \u0995\u09CB\u09A8\u09CB \u0985\u09B0\u09CD\u09A1\u09BE\u09B0 \u0986\u09B8\u09C7\u09A8\u09BF' \u2014 \u09A4\u09BE\u09B0\u09AA\u09B0 \u09AC\u09BF\u0997\u09A4 \u09A6\u09BF\u09A8\u09C7\u09B0 \u09A4\u09A5\u09CD\u09AF \u09A6\u09BE\u0993\u0964",
      "- \u09AA\u09CD\u09B0\u09CB\u09A1\u09BE\u0995\u09CD\u099F \u09AC\u09BF\u09B6\u09CD\u09B2\u09C7\u09B7\u09A3 \u0995\u09B0\u09B2\u09C7 \u09B8\u09BE\u099C\u09C7\u09B6\u09A8 \u09A6\u09BE\u0993 \u2014 \u0995\u09CB\u09A8\u099F\u09BE \u09AD\u09BE\u09B2\u09CB \u09AC\u09BF\u0995\u09CD\u09B0\u09BF \u09B9\u099A\u09CD\u099B\u09C7, \u0995\u09CB\u09A8\u099F\u09BE \u0995\u09AE\u0964",
      "- \u09B2\u09BE\u09AD-\u0995\u09CD\u09B7\u09A4\u09BF \u09AC\u09CB\u099D\u09BE\u09B2\u09C7 \u09B8\u09B9\u099C \u09AD\u09BE\u09B7\u09BE\u09AF\u09BC \u09AC\u09CD\u09AF\u09BE\u0996\u09CD\u09AF\u09BE \u0995\u09B0\u09CB\u0964",
      "- \u099B\u09CB\u099F \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09B0\u0995\u09BE\u09B0 \u09B9\u09B2\u09C7 \u099B\u09CB\u099F \u09A6\u09BE\u0993, \u09AC\u09BF\u09B8\u09CD\u09A4\u09BE\u09B0\u09BF\u09A4 \u099A\u09BE\u0987\u09B2\u09C7 \u09AC\u09BF\u09B8\u09CD\u09A4\u09BE\u09B0\u09BF\u09A4 \u09A6\u09BE\u0993\u0964",
      "- \u09AA\u09CD\u09B0\u09B6\u09CD\u09A8 \u0985\u09B8\u09CD\u09AA\u09B7\u09CD\u099F \u09B9\u09B2\u09C7 \u09AC\u09A8\u09CD\u09A7\u09C1\u09B0 \u09AE\u09A4\u09CB \u099C\u09BF\u099C\u09CD\u099E\u09BE\u09B8\u09BE \u0995\u09B0\u09CB \u2014 '\u0995\u09CB\u09A8 \u09A6\u09BF\u09A8\u09C7\u09B0 \u0995\u09A5\u09BE \u09AC\u09B2\u099B\u09C7\u09A8?' \u09AC\u09BE '\u09AA\u09CD\u09B0\u09CB\u09A1\u09BE\u0995\u09CD\u099F \u09A8\u09BE\u09AE \u09AC\u09B2\u09C1\u09A8'\u0964",
      "- \u0995\u0996\u09A8\u09CB \u0995\u0996\u09A8\u09CB \u09AE\u099C\u09BE\u09B0 \u0995\u09A5\u09BE \u09AC\u09B2\u09CB, \u0987\u09AE\u09CB\u099C\u09BF \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09CB\u0964",
      "",
      "\u09A4\u09C1\u09AE\u09BF \u09B8\u09AC\u0995\u09BF\u099B\u09C1 \u099C\u09BE\u09A8\u09CB \u2014 \u0986\u099C\u0995\u09C7\u09B0 \u09B8\u09C7\u09B2\u09B8, \u09AE\u09BE\u09B8\u09BF\u0995 \u0986\u09AF\u09BC, \u0996\u09B0\u099A, \u09AA\u09CD\u09B0\u09CB\u09A1\u09BE\u0995\u09CD\u099F \u09B8\u09CD\u099F\u0995, \u0985\u09CD\u09AF\u09BE\u09A1 \u09B8\u09CD\u09AA\u09C7\u09A8\u09CD\u09A1, \u09B8\u09AC\u0964",
      "\u09AE\u09BE\u09B2\u09BF\u0995 \u09AF\u0996\u09A8 \u09AA\u09CD\u09B0\u09B6\u09CD\u09A8 \u0995\u09B0\u09AC\u09C7, \u09A4\u09C1\u09AE\u09BF \u09B8\u09AC \u09A1\u09BE\u099F\u09BE \u09A6\u09C7\u0996\u09C7 \u09B8\u09C7\u09B0\u09BE \u0989\u09A4\u09CD\u09A4\u09B0 \u09A6\u09C7\u09AC\u09C7\u0964",
      "",
      "=== YARZ CLOTHING REAL-TIME DATA ===",
      context
    ].join("\n");
    var apiKey = env.MIMO_API_KEY;
    if (!apiKey) return jsonResponse({ success: false, error: "MiMo API key not configured" }, 500);
    var apiUrl = "https://api.xiaomimimo.com/v1/chat/completions";
    var payload = {
      model: "mimo-v2.5",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: question }
      ],
      temperature: 0.8,
      max_tokens: 2048
    };
    var resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify(payload)
    });
    var data = await resp.json();
    if (!resp.ok) {
      var errMsg = data.error && data.error.message ? data.error.message : "HTTP " + resp.status;
      console.log("[agent/ask] MiMo API error:", resp.status, errMsg);
      if (resp.status === 429) {
        return jsonResponse({ success: true, answer: "AI \u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0 \u09AC\u09CD\u09AF\u09B8\u09CD\u09A4 \u0986\u099B\u09C7 (rate limit)\u0964 \u0995\u09BF\u099B\u09C1\u0995\u09CD\u09B7\u09A3 \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964", model: "mimo-v2.5" });
      }
      return jsonResponse({ success: true, answer: "AI \u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0995\u09BF\u099B\u09C1\u0995\u09CD\u09B7\u09A3 \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964", model: "mimo-v2.5" });
    }
    var answer = "";
    if (data.choices && data.choices[0] && data.choices[0].message) {
      answer = data.choices[0].message.content || "";
    }
    if (!answer) answer = "\u09A6\u09C1\u0983\u0996\u09BF\u09A4, \u0989\u09A4\u09CD\u09A4\u09B0 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964";
    return jsonResponse({ success: true, answer, model: "mimo-v2.5" });
  } catch (e) {
    console.error("[agent/ask]", e.message);
    return jsonResponse({ success: false, error: e.message }, 500);
  }
}
__name(handleAgentAsk, "handleAgentAsk");
async function handleAgentRoute(request, env, ctx) {
  const url = new URL(request.url);
  const sub = url.pathname.replace(/^\/agent\/?/, "").toLowerCase();
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
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
__name(handleAgentRoute, "handleAgentRoute");
export {
  worker_supabase_default as default
};
//# sourceMappingURL=worker-supabase.js.map
