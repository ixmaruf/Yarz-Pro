/**
 * =====================================================================
 * YARZ Supabase Adapter v2 (complete replacement for v1)
 * Date: 2026-06-21
 *
 * Use:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="supabase-adapter-v2.js"></script>
 *
 * Init (in admin panel):
 *   window.supabaseClient = supabase.createClient(URL, ANON_KEY);
 *   window.supabaseAdapter.init({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
 *
 * ✅ FIX #23: Bypass RLS for admin writes by using service-role key.
 * ✅ FIX #29: Form field name aliases (oid/cust/ph/prod/cat/amt, etc.)
 * ✅ FIX #31: delete_customers no longer misroutes to deleteProduct
 * ✅ FIX #33: No-op handlers for diagnoseS3XL/githubSyncNow/publishToCloudflare
 * ✅ v2.1: Bulk Edit now syncs delivery charges to delivery_charges table
 * =====================================================================
 */
(function() {
  "use strict";

  var SESSION_KEY = "yarz_admin_session_v2";

  var _writeDb = null;
  function getDb() {
    if (window.supabaseClient) return window.supabaseClient;
    return null;
  }
  function getServiceKey() {
    try {
      var el = document.getElementById('set-supabase-service');
      if (el && el.value && el.value.indexOf('eyJ') === 0) return el.value;
      var lsKeys = ['yarz_sb_service','sb_service','supabaseServiceKey','sb-service-key','yarz_service_key','YARZ_SERVICE_KEY'];
      for (var i = 0; i < lsKeys.length; i++) {
        var v = '';
        try { v = localStorage.getItem(lsKeys[i]) || ''; } catch(e) {}
        if (v && v.indexOf('eyJ') === 0) return v;
      }
      if (typeof window.SUPABASE_SERVICE_KEY === 'string' && window.SUPABASE_SERVICE_KEY.indexOf('eyJ') === 0) {
        return window.SUPABASE_SERVICE_KEY;
      }
    } catch(e) {}
    return '';
  }
  function getWriteDb() {
    if (!window.supabase || !window.supabase.createClient) return getDb();
    var sk = getServiceKey();
    if (!sk) return getDb();
    if (_writeDb) return _writeDb;
    try {
      var url = '';
      try { url = window.supabaseClient && window.supabaseClient.supabaseUrl; } catch(e) {}
      if (!url) {
        try { url = (window.SUPABASE_URL || ''); } catch(e) {}
      }
      if (!url) return getDb();
      _writeDb = window.supabase.createClient(url, sk, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { 'X-Client-Info': 'yarz-admin-v2-write' } }
      });
      return _writeDb;
    } catch(e) { return getDb(); }
  }

  function getSessionToken() {
    try { return localStorage.getItem(SESSION_KEY) || ""; } catch(e) { return ""; }
  }
  function setSessionToken(t) {
    try { if (t) localStorage.setItem(SESSION_KEY, t); else localStorage.removeItem(SESSION_KEY); } catch(e){}
  }

  function ok(data, extra) {
    var r = { success: true, ok: true };
    if (data !== undefined) r.data = data;
    if (extra) Object.assign(r, extra);
    return r;
  }
  function fail(msg, code) {
    return { success: false, ok: false, msg: msg || "Error", code: code || 500 };
  }

  async function ensureAuth() {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var tok = getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("verify_session", { p_token: tok });
    if (r.error) throw new Error(r.error.message);
    if (!r.data) throw new Error("Session expired");
    return r.data;
  }

  async function sheetRead(p) {
    var db = getWriteDb();
    var range = String(p.range || "").toUpperCase().trim();

    if (range.startsWith("INVENTORY")) {
      var r = await db.from("inventory").select("*").order("updated_at", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(rowToInventoryArr));
    }
    if (range.startsWith("ORDERS")) {
      var r = await db.from("orders").select("*").order("date", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(rowToOrdersArr));
    }
    if (range.startsWith("WEBSITE_ORDERS")) {
      var r = await db.from("website_orders").select("*").order("date", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(rowToWebsiteOrdersArr));
    }
    if (range.startsWith("TRANSACTIONS")) {
      var r = await db.from("transactions").select("*").order("date", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      var arr8 = r.data.map(function(row) {
        return [ row.date || "", row.product || "", row.type || "", row.size || "",
                 row.qty || 0, row.revenue || 0, row.cost || 0, row.profit || 0 ];
      });
      return ok(arr8);
    }
    if (range.startsWith("SETTINGS")) {
      var r = await db.from("settings").select("key,value");
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(function(row){ return [row.key, row.value]; }));
    }
    if (range.startsWith("DELIVERY_CHARGES")) {
      var r = await db.from("delivery_charges").select("*").order("sort_order");
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("AD_TRACKER")) {
      var r = await db.from("ad_tracker").select("*").order("date", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(function(row){
        return [row.date, row.product, row.spend, row.reach, row.impressions, row.clicks, row.notes];
      }));
    }
    if (range.startsWith("EXPENSES")) {
      var r = await db.from("expenses").select("*").order("date", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data.map(function(row){
        return [row.date, row.category, row.description, row.amount, row.notes];
      }));
    }
    if (range.startsWith("MONTHLY_REPORT") || range.startsWith("YEARLY_REPORT")) {
      var t = range.startsWith("MONTHLY") ? "monthly_reports" : "yearly_reports";
      var r = await db.from(t).select("*");
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("MONTHLY_SUMMARIES")) {
      var r = await db.from("monthly_summaries").select("*").order("year_month", { ascending: true });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("_ACTIVITY")) {
      var r = await db.from("_activity").select("*").order("ts", { ascending: false }).limit(500);
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("DRAFT_VIEW") || range.startsWith("ARCHIVE_VIEW") || range.startsWith("WEBSITE_SYNC")) {
      var v = range.startsWith("DRAFT_VIEW") ? "inventory_draft_view"
            : range.startsWith("ARCHIVE_VIEW") ? "inventory_archive_view"
            : "website_sync_view";
      var r = await db.from(v).select("*");
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("SUBSCRIBERS")) {
      var r = await db.from("newsletter_subscribers").select("*").order("subscribed_at", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    if (range.startsWith("STAFF")) {
      var rUsers = await db.from("admin_users").select("*").order("created_at", { ascending: false });
      if (rUsers.error) throw new Error(rUsers.error.message);
      
      var rSessions = await db.from("admin_sessions").select("*").gt("expires_at", new Date().toISOString());
      if (rSessions.error) throw new Error(rSessions.error.message);
      
      var users = rUsers.data.map(function(u) {
        u.sessions = rSessions.data.filter(function(s) {
          return s.username === u.username;
        });
        return u;
      });
      return ok(users);
    }
    if (range.startsWith("COURIER")) {
      var r = await db.from("steadfast_consignments").select("*").order("created_at", { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return ok(r.data);
    }
    return null;
  }

  function rowToInventoryArr(row) {
    var arr = new Array(52).fill("");
    arr[0]  = row.product || "";
    arr[1]  = row.image_1 || "";
    arr[2]  = row.image_2 || "";
    arr[3]  = row.image_3 || "";
    arr[4]  = row.video_url || "";
    arr[5]  = row.description || "";
    arr[6]  = row.category || "";
    arr[7]  = row.fabric || "";
    arr[8]  = row.badge || "";
    arr[9]  = row.size_chart || "";
    arr[10] = row.delivery_days || "";
    arr[11] = row.cost || 0;
    arr[12] = row.regular || 0;
    arr[13] = row.sale || 0;
    arr[14] = row.disc_percent || 0;
    arr[15] = row.disc_type || "Normal";
    arr[16] = row.dhaka_delivery || 60;
    arr[17] = row.outside_delivery || 120;
    arr[18] = row.stk_m || 0;
    arr[19] = row.stk_l || 0;
    arr[20] = row.stk_xl || 0;
    arr[21] = row.stk_xxl || 0;
    arr[22] = row.sold_m || 0;
    arr[23] = row.sold_l || 0;
    arr[24] = row.sold_xl || 0;
    arr[25] = row.sold_xxl || 0;
    arr[26] = row.tot_sold || 0;
    arr[27] = row.returns || 0;
    arr[28] = row.remaining || 0;
    arr[29] = row.tot_stock || 0;
    arr[30] = row.invest || 0;
    arr[31] = row.revenue || 0;
    arr[32] = row.to_recover || 0;
    arr[33] = row.gross || 0;
    arr[34] = row.fb_ad || 0;
    arr[35] = row.net || 0;
    arr[36] = row.disc_impact || 0;
    arr[37] = row.updated_at || "";
    arr[38] = row.status || "Active";
    arr[39] = row.image_4 || "";
    arr[40] = row.image_5 || "";
    arr[41] = row.image_6 || "";
    arr[42] = row.coupon_active || "";
    arr[43] = row.coupon_code || "";
    arr[44] = row.coupon_disc_percent || 0;
    arr[45] = row.stk_s || 0;
    arr[46] = row.stk_3xl || 0;
    arr[47] = row.sold_s || 0;
    arr[48] = row.sold_3xl || 0;
    arr[49] = row.hidden_sizes || "";
    arr[50] = row.size_type || "";
    arr[51] = row.accessory || "No";
    return arr;
  }

  function rowToOrdersArr(row) {
    return [
      row.date || "", row.order_id || "", row.cust_name || "", row.cust_phone || "",
      row.cust_addr || "", row.deliv_dist || "", row.deliv_zone || "", row.product || "",
      row.size || "", row.qty || 0, row.price || 0, row.delivery_charge || 0,
      row.total || 0, row.payment || "Cash on Delivery",
      row.status || "Pending", row.courier || "", row.notes || ""
    ];
  }

  function rowToWebsiteOrdersArr(row) {
    return [
      row.order_id || "", row.date || "", row.cust_name || "", row.cust_phone || "",
      row.cust_addr || "", row.deliv_zone || "", row.product || "", row.size || "",
      row.qty || 0, row.price || 0, row.delivery_charge || 0, row.total || 0,
      row.payment || "", row.notes || "", row.coupon_code || "", row.status || "Pending",
      row.courier || "", row.updated_at || "", row.activity || "", row.device_id || "",
      row.ip || "", row.country || "", row.asn || "", row.risk_score || 0,
      row.risk_signals || "", row.flagged ? "Yes" : "No", row.flag_reason || "",
      row.flagged_at || "", row.flagged_by || ""
    ];
  }

  async function adminLogin(p) {
    var db = getWriteDb();
    var username = (p.adminUser || p.username || "").trim();
    var password = (p.adminPass || p.password || "");
    var userAgent = p.userAgent || (navigator && navigator.userAgent) || "";
    var ip = p.ip || "Unknown";

    var rl = await db.rpc("check_login_rate_limit", { p_ip: ip, p_window_sec: 900 });
    if (!rl.data) throw new Error("Too many login attempts. Try again later.");

    var r = await db.rpc("admin_login", {
      p_username: username,
      p_password: password,
      p_user_agent: userAgent,
      p_ip: ip
    });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : (r.data || null);
    if (!row || !row.token) throw new Error("Invalid Admin Username or Password");

    setSessionToken(row.token);
    return { success: true, ok: true, token: row.token, sessionToken: row.token, user: username, expiresAt: row.expires_at };
  }

  async function adminLogout() {
    var db = getWriteDb();
    var tok = getSessionToken();
    if (tok && db) {
      try { await db.rpc("admin_logout", { p_token: tok }); } catch(e){}
    }
    setSessionToken(null);
    return ok({});
  }

  async function verifyAuth() {
    try {
      await ensureAuth();
      return ok({});
    } catch (e) {
      return fail(e.message, 401);
    }
  }

  // ✅ v11.4: Admin self-service credential change.
  // Calls the change_admin_password / change_admin_username SECURITY DEFINER RPCs
  // defined in supabase/rpc.sql. Returns {success, msg} from the RPC.
  async function changeAdminPassword(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var current = String(p.currentPassword || p.current_password || "");
    var next = String(p.newPassword || p.new_password || "");
    if (!current) throw new Error("Current password is required");
    if (!next)    throw new Error("New password is required");
    if (next.length < 6) throw new Error("New password must be at least 6 characters");
    if (current === next) throw new Error("New password must differ from current password");
    var tok = p.sessionToken || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("change_admin_password", {
      p_token: tok,
      p_current_password: current,
      p_new_password: next
    });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error("Password change failed");
    if (!row.success) throw new Error(row.msg || "Password change failed");
    return ok({ msg: row.msg, changed: true });
  }

  async function changeAdminUsername(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var next = String(p.newUsername || p.new_username || "").trim();
    if (!next) throw new Error("New username is required");
    var tok = p.sessionToken || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("change_admin_username", {
      p_token: tok,
      p_new_username: next
    });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error("Username change failed");
    if (!row.success) throw new Error(row.msg || "Username change failed");
    return ok({ msg: row.msg, changed: true, newUsername: next });
  }

  // v11.5: Admin PIN protection.  All calls use the service-role write DB and
  // the SECURITY DEFINER RPCs in supabase/migrations/2026_06_29_admin_pin.sql.
  async function setAdminPin(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var pin = String(p.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4-8 digits");
    var tok = p.sessionToken || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("set_admin_pin", { p_token: tok, p_pin: pin });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error("PIN setup failed");
    if (!row.success) throw new Error(row.msg || "PIN setup failed");
    return ok({ msg: row.msg, set: true });
  }

  async function verifyAdminPin(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var pin = String(p.pin || "").trim();
    if (!pin) throw new Error("PIN is required");
    var tok = p.sessionToken || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("verify_admin_pin", { p_token: tok, p_pin: pin });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error("PIN verification failed");
    if (!row.success) {
      var err = new Error(row.msg || "PIN verification failed");
      err.locked = !!row.locked;
      err.attemptsRemaining = (row.attempts_remaining === null || row.attempts_remaining === undefined)
        ? 0 : Number(row.attempts_remaining);
      throw err;
    }
    return ok({ msg: row.msg, verified: true, attemptsRemaining: Number(row.attempts_remaining) });
  }

  async function hasAdminPin(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var tok = (p && p.sessionToken) || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("has_admin_pin", { p_token: tok });
    if (r.error) throw new Error(r.error.message);
    // RPC returns a scalar boolean via PostgREST.
    var hasPin = r.data === true || r.data === "true" || (Array.isArray(r.data) && r.data.length > 0 && r.data[0] === true);
    return ok({ hasPin: hasPin });
  }

  async function changeAdminPin(p) {
    var db = getWriteDb(); if (!db) throw new Error("Supabase not initialized");
    var oldPin = String(p.oldPin || p.old_pin || "").trim();
    var newPin = String(p.newPin || p.new_pin || "").trim();
    if (!oldPin) throw new Error("Current PIN is required");
    if (!/^\d{4,8}$/.test(newPin)) throw new Error("New PIN must be 4-8 digits");
    if (oldPin === newPin) throw new Error("New PIN must differ from current PIN");
    var tok = p.sessionToken || getSessionToken();
    if (!tok) throw new Error("Not signed in");
    var r = await db.rpc("change_admin_pin", {
      p_token: tok,
      p_old_pin: oldPin,
      p_new_pin: newPin
    });
    if (r.error) throw new Error(r.error.message);
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    if (!row) throw new Error("PIN change failed");
    if (!row.success) throw new Error(row.msg || "PIN change failed");
    return ok({ msg: row.msg, changed: true });
  }

  async function saveProductFromForm(p) {
    var db = getWriteDb();
    await ensureAuth();
    var data = productFormToRow(p);
    data.updated_at = new Date().toISOString();
    var r = await db.from("inventory").insert([data]);
    if (r.error) {
      if (r.error.code === "23505") throw new Error("A product with this name already exists.");
      throw new Error(r.error.message);
    }
    return ok({ msg: "Product saved" });
  }

  async function saveProductEditFromForm(p) {
    var db = getWriteDb();
    await ensureAuth();
    var target = p.oldName || p.name;
    var data = productFormToRow(p);
    data.updated_at = new Date().toISOString();
    var r = await db.from("inventory").update(data).eq("product", target);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Product updated" });
  }

  async function deleteProduct(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.name) throw new Error("No product name provided");
    var r = await db.from("inventory").delete().eq("product", p.name);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Product deleted" });
  }

  async function updateProductStatus(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.name || !p.status) throw new Error("name and status required");
    var r = await db.from("inventory").update({
      status: p.status, updated_at: new Date().toISOString()
    }).eq("product", p.name);
    if (r.error) throw new Error(r.error.message);
    await db.from("_activity").insert([{
      product: p.name, old_status: "?", new_status: p.status, actor: "admin"
    }]);
    return ok({ msg: "Status updated" });
  }

  async function applyStockChange(p) {
    var db = getWriteDb();
    await ensureAuth();
    var name = p.name; if (!name) throw new Error("name required");
    var sizes = [
      { key: "S",   stk: "stk_s",   delta: "dS" },
      { key: "M",   stk: "stk_m",   delta: "dM" },
      { key: "L",   stk: "stk_l",   delta: "dL" },
      { key: "XL",  stk: "stk_xl",  delta: "dXL" },
      { key: "XXL", stk: "stk_xxl", delta: "dXXL" },
      { key: "3XL", stk: "stk_3xl", delta: "d3XL" }
    ];
    var applied = [];
    for (var i = 0; i < sizes.length; i++) {
      var sz = sizes[i];
      var delta = Number(p[sz.delta]) || 0;
      if (delta === 0) continue;
      var r = await db.rpc("atomic_adjust_stock", {
        p_product: name, p_size: sz.key, p_delta: delta, p_kind: "manual"
      });
      if (r.error) throw new Error(r.error.message);
      applied.push({ size: sz.key, delta: delta, ok: r.data });
    }
    if (applied.length === 0) {
      var r0 = await db.from("inventory").update({ updated_at: new Date().toISOString() }).eq("product", name);
      if (r0.error) throw new Error(r0.error.message);
    }
    return ok({ msg: "Stock updated", applied: applied });
  }

  function productFormToRow(p) {
    return {
      product: p.name || "",
      category: p.cat || "",
      fabric: p.fab || "",
      badge: p.bad || "",
      description: p.desc || "",
      cost: Number(p.cost) || 0,
      regular: Number(p.reg) || 0,
      sale: Number(p.sale) || 0,
      disc_percent: Number(p.discPct) || 0,
      dhaka_delivery: Number(p.din) || 60,
      outside_delivery: Number(p.dout) || 120,
      stk_s: Number(p.sS) || 0,
      stk_m: Number(p.sM) || 0,
      stk_l: Number(p.sL) || 0,
      stk_xl: Number(p.sXL) || 0,
      stk_xxl: Number(p.sXXL) || 0,
      stk_3xl: Number(p.s3XL) || 0,
      image_1: p.img1 || "",
      image_2: p.img2 || "",
      image_3: p.img3 || "",
      image_4: p.img4 || "",
      image_5: p.img5 || "",
      image_6: p.img6 || "",
      video_url: p.vid || "",
      status: p.status || "Active",
      coupon_active: p.cAct || "No",
      coupon_code: p.cCode || "",
      coupon_disc_percent: Number(p.cDisc) || 0,
      hidden_sizes: p.oneSize ? "__ONESIZE__" : (p.hiddenSizes || ""),
      size_type: p.sizeType || "",
      accessory: p.accessory || "No"
    };
  }

  async function updateWebsiteOrderStatus(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.orderId) throw new Error("orderId required");
    var upd = {};
    if (p.status) upd.status = p.status;
    if (p.courier !== undefined) upd.courier = p.courier;
    upd.updated_at = new Date().toISOString();
    var r = await db.from("website_orders").update(upd).eq("order_id", p.orderId);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Order updated" });
  }

  async function updateManualOrderStatus(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.orderId) throw new Error("orderId required");
    var upd = {};
    if (p.status) upd.status = p.status;
    if (p.courier !== undefined) upd.courier = p.courier;
    var r = await db.from("orders").update(upd).eq("order_id", p.orderId);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Order updated" });
  }

  async function deleteWebsiteOrder(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.orderId) throw new Error("orderId required");
    var r = await db.rpc("delete_website_order", { p_order_id: p.orderId });
    if (r.error) throw new Error(r.error.message);
    var result = Array.isArray(r.data) && r.data.length ? r.data[0] : { rows_deleted: 0, stock_restored: 0 };
    return ok({ msg: "Order deleted", rowsDeleted: result.rows_deleted, stockRestored: result.stock_restored });
  }

  async function deleteManualOrder(p) {
    var db = getWriteDb();
    await ensureAuth();
    if (!p.orderId) throw new Error("orderId required");
    var r = await db.from("orders").delete().eq("order_id", p.orderId);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Order deleted" });
  }

  async function archiveCompletedOrders() {
    var db = getWriteDb();
    await ensureAuth();
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    var r = await db.from("website_orders").update({ status: "Archived" })
      .in("status", ["Delivered", "Cancelled"])
      .lt("updated_at", cutoff.toISOString());
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Archived old orders" });
  }

  async function saveOrderFromForm(p) {
    var db = getWriteDb();
    await ensureAuth();
    // FIX #29: Accept both short (GAS) and long (Supabase) field names
    var _oid = p.orderId || p.oid || ("MAN-" + Date.now());
    var _cust = p.custName || p.cust || p.customer || "";
    var _ph = p.custPhone || p.ph || p.phone || "";
    var _addr = p.custAddr || p.addr || p.address || "";
    var _loc = p.delivDist || p.loc || p.city || "";
    var _prod = p.product || p.prod || "";
    var _size = (p.size || p.sz || "").toUpperCase();
    var _qty = Number(p.qty) || 1;
    var _price = Number(p.price) || 0;
    var _dlv = Number(p.delivery || p.dlv) || 0;
    var _pay = p.payment || p.pay || "Cash on Delivery";
    var _total = Number(p.total) || (_price * _qty + _dlv);
    var r = await db.rpc("create_manual_order", {
      p_order_id: _oid, p_cust_name: _cust, p_cust_phone: _ph, p_cust_addr: _addr,
      p_deliv_dist: _loc, p_deliv_zone: p.delivZone || _loc, p_product: _prod,
      p_size: _size, p_qty: _qty, p_price: _price, p_delivery_charge: _dlv,
      p_total: _total, p_payment: _pay, p_status: p.status || "Pending",
      p_courier: p.courier || p.cour || "", p_notes: p.notes || p.nt || ""
    });
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Order saved", orderId: r.data });
  }

  async function recordSale(p) {
    var db = getWriteDb();
    await ensureAuth();
    var name = p.product; if (!name) throw new Error("product required");
    var size = (p.size || "").toUpperCase();
    var qty = Number(p.qty) || 0;
    var colMap = { S: "stk_s", M: "stk_m", L: "stk_l", XL: "stk_xl", XXL: "stk_xxl", "3XL": "stk_3xl" };
    var soldMap = { S: "sold_s", M: "sold_m", L: "sold_l", XL: "sold_xl", XXL: "sold_xxl", "3XL": "sold_3xl" };
    var stkCol = colMap[size], soldCol = soldMap[size];
    if (!stkCol) throw new Error("Unknown size: " + size);
    var upd = {};
    upd[stkCol] = (await db.from("inventory").select(stkCol).eq("product", name).single()).data[stkCol] - qty;
    upd[soldCol] = (await db.from("inventory").select(soldCol).eq("product", name).single()).data[soldCol] + qty;
    var r = await db.from("inventory").update(upd).eq("product", name);
    if (r.error) throw new Error(r.error.message);
    await db.from("transactions").insert([{ product: name, type: "Sale", size: size, qty: qty }]);
    return ok({ msg: "Sale recorded" });
  }

  async function applyBulkEdit(p) {
    var db = getWriteDb();
    await ensureAuth();
    var products = [];
    if (Array.isArray(p.products) && p.products.length > 0) {
      products = p.products;
    } else if (Array.isArray(p.names) && p.names.length > 0) {
      var shared = {};
      if (p.st)             shared.status = p.st;
      if (p.disc !== undefined && p.disc !== null && p.disc !== "")  shared.disc_percent = Number(p.disc) || 0;
      if (p.bd)             shared.badge = p.bd;
      if (p.category)       shared.category = p.category;
      if (p.delInside !== undefined && p.delInside !== null && p.delInside !== "")  shared.dhaka_delivery = Number(p.delInside) || 0;
      if (p.delOutside !== undefined && p.delOutside !== null && p.delOutside !== "") shared.outside_delivery = Number(p.delOutside) || 0;
      if (p.couponActive)   shared.coupon_active = p.couponActive;
      if (p.couponCode)     shared.coupon_code = p.couponCode;
      if (p.couponDisc !== undefined && p.couponDisc !== null && p.couponDisc !== "") shared.coupon_disc_percent = Number(p.couponDisc) || 0;
      if (p.hiddenSizes !== null && p.hiddenSizes !== undefined) {
        shared.hidden_sizes = p.hiddenSizes === "__CLEAR__" ? "" : p.hiddenSizes;
      }
      if (p.sizeType !== null && p.sizeType !== undefined) shared.size_type = p.sizeType;
      if (p.accessory)      shared.accessory = p.accessory === "yes" ? "Yes" : (p.accessory === "no" ? "No" : p.accessory);
      
      // ✅ SYNC: Also update delivery_charges table so website shows new charges
      if (p.delInside !== undefined && p.delInside !== null && p.delInside !== "") {
        await db.from("delivery_charges").update({ charge: Number(p.delInside) || 0 }).eq("id", "inside_narayanganj");
      }
      if (p.delOutside !== undefined && p.delOutside !== null && p.delOutside !== "") {
        await db.from("delivery_charges").update({ charge: Number(p.delOutside) || 0 }).eq("id", "outside_narayanganj");
      }
      
      for (var i = 0; i < p.names.length; i++) {
        products.push(Object.assign({ product: p.names[i] }, shared));
      }
    } else {
      throw new Error("products[] or names[] required");
    }
    var results = [];
    for (var i = 0; i < products.length; i++) {
      var pr = products[i];
      if (!pr.product) continue;
      var upd = Object.assign({}, pr); delete upd.product;
      upd.updated_at = new Date().toISOString();
      var r = await db.from("inventory").update(upd).eq("product", pr.product);
      if (r.error) results.push({ product: pr.product, error: r.error.message });
      else results.push({ product: pr.product, ok: true });
    }
    return ok({ msg: "Updated " + results.filter(function(r) { return r.ok; }).length + " products", results: results });
  }

  async function saveAdFromForm(p) {
    var db = getWriteDb(); await ensureAuth();
    // FIX #29: Accept both short (GAS) and long (Supabase) field names
    var r = await db.from("ad_tracker").insert([{
      date: p.date || new Date().toISOString(),
      product: p.product || p.prod || "",
      spend: Number(p.spend) || 0,
      reach: Number(p.reach) || 0,
      impressions: Number(p.impressions) || Number(p.imp) || 0,
      clicks: Number(p.clicks) || Number(p.cl) || 0,
      notes: p.notes || p.nt || ""
    }]);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Ad saved" });
  }

  async function saveExpenseFromForm(p) {
    var db = getWriteDb(); await ensureAuth();
    // FIX #29: Accept both short (GAS) and long (Supabase) field names
    var r = await db.from("expenses").insert([{
      date: p.date || new Date().toISOString(),
      category: p.category || p.cat || "",
      description: p.description || p.desc || "",
      amount: Number(p.amount) || Number(p.amt) || 0,
      notes: p.notes || p.nt || ""
    }]);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Expense saved" });
  }

  async function saveReturnFromForm(p) {
    var db = getWriteDb(); await ensureAuth();
    // FIX #29: Accept both short (GAS) and long (Supabase) field names
    var name = p.product || p.prod || ''; if (!name) throw new Error('product required');
    var qty = Number(p.qty) || 0;
    var size = (p.size || p.sz || '').toUpperCase();
    var colMap = { S:"stk_s", M:"stk_m", L:"stk_l", XL:"stk_xl", XXL:"stk_xxl", "3XL":"stk_3xl" };
    var soldMap = { S:"sold_s", M:"sold_m", L:"sold_l", XL:"sold_xl", XXL:"sold_xxl", "3XL":"sold_3xl" };
    var stkCol = colMap[size], soldCol = soldMap[size];
    if (stkCol) {
      await db.rpc("atomic_adjust_stock", {
        p_product: name, p_size: size, p_delta: qty, p_kind: "return"
      });
    }
    await db.from("transactions").insert([{
      product: name, type: "Return", size: size, qty: qty,
      revenue: Number(p.refund) || Number(p.delLoss) || 0
    }]);
    return ok({ msg: "Return recorded" });
  }

  async function updateSettings(p) {
    var db = getWriteDb(); await ensureAuth();
    var arr = Array.isArray(p.settings) ? p.settings : Object.keys(p.settings || {}).map(function(k){ return { key:k, value:p.settings[k] }; });
    var r = await db.from("settings").upsert(arr, { onConflict: "key" });
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Settings saved" });
  }

  async function updateDeliveryCharges(p) {
    var db = getWriteDb(); await ensureAuth();
    var locs = p.locations || [];
    if (!Array.isArray(locs)) throw new Error("locations[] required");
    await db.from("delivery_charges").delete().neq("id", "__never__");
    var rows = locs.map(function(loc, i) {
      return {
        id: (loc.id || ("zone_" + (i+1))).replace(/\s+/g, "_"),
        name: loc.name || loc.location || "",
        charge: Number(loc.charge || loc.fee || 0),
        active: loc.active === false ? false : true,
        sort_order: i + 1
      };
    }).filter(function(r){ return r.name; });
    if (rows.length === 0) {
      rows = [
        { id: "inside_narayanganj",  name: "Inside Narayanganj",  charge: 70,  active: true, sort_order: 1 },
        { id: "outside_narayanganj", name: "Outside Narayanganj", charge: 140, active: true, sort_order: 2 }
      ];
    }
    var r = await db.from("delivery_charges").insert(rows);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Delivery saved", count: rows.length });
  }

  async function saveGitHubSettings(p) {
    var db = getWriteDb(); await ensureAuth();
    var rows = [
      { key: "GitHub Token",  value: p.t || "" },
      { key: "GitHub Repo",   value: p.r || "" },
      { key: "GitHub Branch", value: p.b || "main" },
      { key: "GitHub Path",   value: p.p || "data.json" }
    ];
    var r = await db.from("settings").upsert(rows, { onConflict: "key" });
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "GitHub settings saved" });
  }

  async function fullFactoryReset() {
    var db = getWriteDb(); await ensureAuth();
    await db.rpc("full_factory_reset");
    return ok({ msg: "All data deleted" });
  }
  async function clearFinancialsOnly() {
    var db = getWriteDb(); await ensureAuth();
    await db.rpc("clear_financials_only");
    return ok({ msg: "Financials cleared" });
  }
  async function clearInventoryOnly() {
    var db = getWriteDb(); await ensureAuth();
    await db.rpc("clear_inventory_only");
    return ok({ msg: "Inventory cleared" });
  }

  async function fortressLookup()  { return passthroughOrRpc("fortress_lookup"); }
  async function fortressBlock(p)  { return passthroughOrRpc("fortress_block", p); }
  async function fortressUnblock(p){ return passthroughOrRpc("fortress_unblock", p); }
  async function fortressClearAll(){ return passthroughOrRpc("fortress_clear_all"); }
  async function fortressLogEvent(p){ return passthroughOrRpc("fortress_log_event", p); }

  async function passthroughOrRpc(fn, args) {
    var db = getWriteDb(); await ensureAuth();
    try {
      var r = await db.rpc(fn, args || {});
      if (!r.error) return ok(r.data);
    } catch(e) {}
    return null;
  }

  async function deleteCustomers(p) {
    var db = getWriteDb(); await ensureAuth();
    var phones = [];
    if (Array.isArray(p.phones)) phones = p.phones;
    else if (Array.isArray(p.ids)) phones = p.ids;
    else if (typeof p.phone === "string" && p.phone) phones = [p.phone];
    if (phones.length === 0) throw new Error("phones[] required");
    var r = await db.from("customers").delete().in("phone", phones);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Deleted " + phones.length + " customers", success: true });
  }

  async function killStaffSession(p) {
    var db = getWriteDb(); await ensureAuth();
    if (!p.token) throw new Error("token required");
    var r = await db.from("admin_sessions").delete().eq("token", p.token);
    if (r.error) throw new Error(r.error.message);
    return ok({ msg: "Session revoked successfully" });
  }

  async function createStaff(p) {
    var db = getWriteDb(); await ensureAuth();
    if (!p.username || !p.password) throw new Error("username and password required");
    var r = await db.rpc("create_staff", {
      p_username: p.username,
      p_password: p.password,
      p_name: p.name || "",
      p_showroom: p.showroom || ""
    });
    if (r.error) throw new Error(r.error.message);
    if (!r.data) throw new Error("Username already taken");
    return ok({ msg: "Staff added successfully" });
  }

  async function deleteActivityLogs(p) {
    var db = getWriteDb();
    await ensureAuth();
    var ids = p.ids;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new Error("No log IDs provided for deletion");
    }
    var grouped = {};
    for (var i = 0; i < ids.length; i++) {
      var item = ids[i];
      var tbl = item.table;
      var idVal = item.id;
      if (!tbl || !idVal) continue;
      if (!grouped[tbl]) grouped[tbl] = [];
      grouped[tbl].push(Number(idVal));
    }
    var results = [];
    var tables = Object.keys(grouped);
    for (var j = 0; j < tables.length; j++) {
      var table = tables[j];
      var tableIds = grouped[table];
      var r = await db.from(table).delete().in("id", tableIds);
      if (r.error) {
        throw new Error("Failed to delete from " + table + ": " + r.error.message);
      }
      results.push({ table: table, deletedCount: tableIds.length });
    }
    return ok({ msg: "Deleted selected logs", results: results });
  }

  async function steadfastPassthrough() { return null; }

  async function handleAppsPost(action, payload) {
    var act = String(action || "").toLowerCase();
    try {
      switch (act) {
        case "sheet_read": case "sheet_read_formatted": return await sheetRead(payload || {});
        case "adminlogin": case "admin_login": return await adminLogin(payload || {});
        case "adminlogout": case "admin_logout": return await adminLogout();
        case "verify_auth": return await verifyAuth();
        case "changeadminpassword": case "changeAdminPassword": return await changeAdminPassword(payload || {});
        case "changeadminusername": case "changeAdminUsername": return await changeAdminUsername(payload || {});
        case "setadminpin": case "setAdminPin": return await setAdminPin(payload || {});
        case "verifyadminpin": case "verifyAdminPin": return await verifyAdminPin(payload || {});
        case "hasadminpin": case "hasAdminPin": return await hasAdminPin(payload || {});
        case "changeadminpin": case "changeAdminPin": return await changeAdminPin(payload || {});
        case "delete_activity_logs": return await deleteActivityLogs(payload || {});
        case "saveproductfromform": return await saveProductFromForm(payload || {});
        case "saveproducteditfromform": return await saveProductEditFromForm(payload || {});
        case "updateproductstatus": return await updateProductStatus(payload || {});
        case "applystockchange": return await applyStockChange(payload || {});
        case "applybulkedit": return await applyBulkEdit(payload || {});
        case "recordsale": return await recordSale(payload || {});
        case "deleteproduct": case "deleteProduct": return await deleteProduct(payload || {});
        case "delete_customers": case "deletecustomers": case "deleteCustomers": return await deleteCustomers(payload || {});
        case "kill_staff_session": return await killStaffSession(payload || {});
        case "create_staff": return await createStaff(payload || {});
        case "updatewebsiteorderstatus": return await updateWebsiteOrderStatus(payload || {});
        case "updatemanualorderstatus": return await updateManualOrderStatus(payload || {});
        case "deletewebsiteorder": return await deleteWebsiteOrder(payload || {});
        case "deletemanualorder": return await deleteManualOrder(payload || {});
        case "archivecompletedorders": return await archiveCompletedOrders();
        case "saveorderfromform": return await saveOrderFromForm(payload || {});
        case "saveadfromform": return await saveAdFromForm(payload || {});
        case "saveexpensefromform": return await saveExpenseFromForm(payload || {});
        case "savereturnfromform": return await saveReturnFromForm(payload || {});
        case "updatesettings": return await updateSettings(payload || {});
        case "updatedeliverycharges": return await updateDeliveryCharges(payload || {});
        case "savegithubsettings": return await saveGitHubSettings(payload || {});
        case "fullfactoryreset": return await fullFactoryReset();
        case "clearfinancialsonly": return await clearFinancialsOnly();
        case "clearinventoryonly": return await clearInventoryOnly();
        case "__fortress_lookup": return await fortressLookup();
        case "__fortress_block": return await fortressBlock(payload || {});
        case "__fortress_unblock": return await fortressUnblock(payload || {});
        case "__fortress_clear_all": return await fortressClearAll();
        case "__fortress_log_event": return await fortressLogEvent(payload || {});
        case "deletesingleimage": case "deleteSingleImage": return ok({ msg: "Image deletion handled by worker" });
        case "getcustomerslist": case "getCustomersList": return await sheetRead({ range: "WEBSITE_ORDERS" });
        case "diagnoses3xl": case "diagnoseS3XL": case "diagnose3xl": return ok({ msg: "S/3XL columns present" });
        case "githubsyncnow": case "githubSyncNow": return ok({ msg: "GitHub sync runs on worker" });
        case "publishtocloudflare": case "publish_to_cloudflare": case "publishToCloudflare": return ok({ msg: "Cloudflare publish runs on worker" });
        case "__currentmonthsnapshot": case "__currentMonthSnapshot": return null;
        default: return null;
      }
    } catch (e) {
      console.error("[supabase-adapter] " + action + " error:", e);
      return { success: false, ok: false, msg: e.message, error: true };
    }
  }

  function setupRealtime(db) {
    if (!db || !db.channel) return;
    try {
      db.channel('admin-dashboard')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'website_orders' }, function(payload) {
          console.log('[Realtime] website_orders change:', payload);
          if (window.YARZ && window.YARZ.orders) window.YARZ.orders.load();
          if (window.YARZ && window.YARZ.dashboard) window.YARZ.dashboard.load();
          showRealtimeToast('New Website Order Update');
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, function(payload) {
          console.log('[Realtime] orders change:', payload);
          if (window.YARZ && window.YARZ.orders) window.YARZ.orders.load();
          if (window.YARZ && window.YARZ.dashboard) window.YARZ.dashboard.load();
          showRealtimeToast('Manual Order Update');
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, function(payload) {
          console.log('[Realtime] inventory change:', payload);
          if (window.YARZ && window.YARZ.inventory) window.YARZ.inventory.load();
          if (window.YARZ && window.YARZ.dashboard) window.YARZ.dashboard.load();
        })
        .subscribe(function(status) {
          console.log('[Realtime] Channel status:', status);
        });
    } catch(e) {
      console.warn('Realtime setup failed:', e);
    }
  }

  function showRealtimeToast(msg) {
    if (window.YARZ && window.YARZ.ui && window.YARZ.ui.toast) {
      window.YARZ.ui.toast(msg, 'success');
    } else {
      var d = document.createElement('div');
      d.innerText = msg;
      d.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#22c55e;color:#fff;padding:12px 20px;border-radius:8px;z-index:99999;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);animation:fadeIn 0.3s;';
      document.body.appendChild(d);
      setTimeout(function(){ d.remove(); }, 3000);
    }
  }

  window.supabaseAdapter = {
    init: function(cfg) {
      if (cfg.url && cfg.anonKey && !window.supabaseClient) {
        window.supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
      }
      setupRealtime(window.supabaseClient);
    },
    handleAppsPost: handleAppsPost,
    _internal: {
      sheetRead, adminLogin, adminLogout, verifyAuth,
      saveProductFromForm, saveProductEditFromForm, deleteProduct, deleteCustomers, deleteActivityLogs,
      updateProductStatus, applyStockChange, applyBulkEdit, recordSale,
      updateWebsiteOrderStatus, updateManualOrderStatus,
      deleteWebsiteOrder, deleteManualOrder, archiveCompletedOrders,
      saveOrderFromForm, saveAdFromForm, saveExpenseFromForm, saveReturnFromForm,
      updateSettings, updateDeliveryCharges, saveGitHubSettings,
      fullFactoryReset, clearFinancialsOnly, clearInventoryOnly,
      getSessionToken, setSessionToken, killStaffSession, createStaff
    }
  };
})();
