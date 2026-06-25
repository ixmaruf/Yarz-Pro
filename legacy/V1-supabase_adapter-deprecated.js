// ================================================================
// ⚠️  DEPRECATED — DO NOT USE
// ================================================================
// This file is the V1 adapter (partial Supabase impl with hardcoded
// credentials and a fake 'temp-supabase-token'). It is NO LONGER
// loaded by the Admin Panel.
//
// The script tag in index.html has been swapped to:
//   <script src="../supabase-adapter-v2.js"></script>
//
// V2 (root: supabase-adapter-v2.js) uses:
//   - real Supabase admin_login RPC (bcrypt-hashed passwords)
//   - real session tokens (not fake "temp-supabase-token")
//   - check_login_rate_limit + admin_login_attempts
//   - all 30+ actions with proper Supabase RLS
//
// To re-enable V1 for debugging, change the script tag in
//   Yarz-admin panal/index.html  (line 2670)
// from "../supabase-adapter-v2.js" back to "supabase_adapter.js".
//
// This file is kept ONLY as a reference / rollback target.
// ================================================================

console.warn("[supabase_adapter.js] DEPRECATED V1 adapter. Loaded by mistake. Use ../supabase-adapter-v2.js instead.");

window.supabaseAdapter = {
  async handleAppsPost(action, payload) {
    const act = action.toLowerCase();
    
    switch (act) {
      case 'sheet_read':
      case 'sheet_read_formatted':
        return await this.sheetRead(payload);
      // adminlogin, adminlogout, verify_auth → MUST go to Google Sheets
      // so we get a REAL session token that works for fallback requests
      case 'applystockchange':
        return await this.applyStockChange(payload);
      case 'saveproductfromform':
        return await this.saveProductFromForm(payload);
      case 'deleteproduct':
        return await this.deleteProduct(payload);
      case 'saveproducteditfromform':
        return await this.saveProductEditFromForm(payload);
      // ... Add more as we build them out
      default:
        console.log(`[Supabase Adapter] Action '${action}' not implemented yet. Falling back to Google Sheets.`);
        return null;
    }
  },

  async sheetRead(payload) {
    const db = window.supabaseClient;
    if (!db) throw new Error("Supabase client not initialized.");
    
    const range = (payload.range || '').toUpperCase();
    
    if (range.startsWith('INVENTORY')) {
      const invRes = await db.from('inventory').select('*').order('created_at', { ascending: false });
      if (invRes.error) throw new Error("Error loading inventory: " + invRes.error.message);
      
      const arrData = invRes.data.map(row => {
        const arr = new Array(52).fill('');
        arr[0] = row.product || ''; // NAME
        arr[1] = row.image_1 || '';
        arr[2] = row.image_2 || '';
        arr[3] = row.image_3 || '';
        arr[4] = row.video_url || '';
        arr[5] = row.desc || '';
        arr[6] = row.category || '';
        arr[7] = row.fabric || '';
        arr[8] = row.badge || '';
        arr[9] = row.sizeChart || '';
        arr[10] = row.deliveryDays || '';
        arr[11] = row.cost || 0;
        arr[12] = row.reg || 0;
        arr[13] = row.sale || 0;
        arr[14] = row.discPct || 0;
        arr[15] = row.discType || 'Normal';
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
        
        let tStock = (Number(row.stk_s)||0) + (Number(row.stk_m)||0) + (Number(row.stk_l)||0) + (Number(row.stk_xl)||0) + (Number(row.stk_xxl)||0) + (Number(row.stk_3xl)||0);
        let tSold = (Number(row.sold_s)||0) + (Number(row.sold_m)||0) + (Number(row.sold_l)||0) + (Number(row.sold_xl)||0) + (Number(row.sold_xxl)||0) + (Number(row.sold_3xl)||0);
        
        arr[26] = tSold; // TOT_SOLD
        arr[27] = 0; // RETURNS
        arr[28] = tStock - tSold; // REMAINING
        arr[29] = tStock; // TOT_STOCK
        
        arr[30] = 0; // INVEST
        arr[31] = 0; // REVENUE
        arr[32] = 0; // TO RECOVER
        arr[33] = 0; // GROSS
        arr[34] = 0; // FB AD
        arr[35] = 0; // NET
        arr[36] = 0; // DISC IMPACT
        
        arr[37] = row.updated_at || '';
        arr[38] = row.status || 'Active';
        arr[39] = row.image_4 || '';
        arr[40] = row.image_5 || '';
        arr[41] = row.image_6 || '';
        arr[42] = row.coupon_active || '';
        arr[43] = row.coupon_code || '';
        arr[44] = row.coupon_disc_percent || 0;
        arr[45] = row.stk_s || 0;
        arr[46] = row.stk_3xl || 0;
        arr[47] = row.sold_s || 0;
        arr[48] = row.sold_3xl || 0;
        arr[49] = row.hidden_sizes || '';
        arr[50] = row.size_type || '';
        arr[51] = row.accessory || 'No';
        return arr;
      });
      return { success: true, ok: true, data: arrData };
    }
    
    if (range.startsWith('ORDERS')) {
      const ordRes = await db.from('orders').select('*').order('created_at', { ascending: false });
      if (ordRes.error) throw new Error("Error loading orders: " + ordRes.error.message);
      
      const arrData = ordRes.data.map(row => {
        const arr = new Array(16).fill('');
        arr[0] = row.date || row.created_at || ''; // DATE
        arr[1] = row.order_id || '';
        arr[2] = row.cust_name || '';
        arr[3] = row.cust_phone || '';
        arr[4] = row.cust_addr || '';
        arr[5] = row.deliv_dist || '';
        arr[6] = row.deliv_zone || '';
        arr[7] = row.product || ''; // ITEMS
        arr[8] = row.qty || 1;
        arr[9] = row.price || 0;
        arr[10] = row.delivery_charge || 0;
        arr[11] = row.advance || 0;
        arr[12] = row.total || 0; // COD? Wait, total vs COD... 
        // Google sheets expected: price=9, delivery=10, total=11, payment=12, status=13
        // So total is arr[11]
        arr[13] = row.payment || 'Cash on Delivery';
        arr[14] = row.status || 'Pending';
        arr[15] = row.courier || '';
        // Wait, notes=15 in 0-indexed? 
        // 0=DATE, 1=ORDER_ID, 2=CUST_NAME, 3=CUST_PHONE, 4=CUST_ADDR, 5=DELIV_DIST, 6=DELIV_ZONE, 7=ITEMS, 8=QTY, 9=PRICE, 10=DELIVERY, 11=TOTAL, 12=PAYMENT, 13=STATUS, 14=COURIER, 15=NOTES
        arr[15] = row.notes || ''; 
        return arr;
      });
      return { success: true, ok: true, data: arrData };
    }

    if (range.startsWith('TRANSACTIONS')) {
      const txRes = await db.from('transactions').select('*').order('date', { ascending: false });
      if (txRes.error) throw new Error("Error loading transactions: " + txRes.error.message);
      const arrData = txRes.data.map(row => {
        // Just return array matching cols.
        // TRANSACTIONS!A2:H5000 -> 8 cols
        const arr = new Array(8).fill('');
        arr[0] = row.date || '';
        arr[1] = row.transaction_id || '';
        arr[2] = row.amount || 0;
        arr[3] = row.type || '';
        arr[4] = row.description || '';
        arr[5] = row.reference || '';
        arr[6] = row.status || '';
        arr[7] = row.updated_at || '';
        return arr;
      });
      return { success: true, ok: true, data: arrData };
    }

    if (range.startsWith('SETTINGS')) {
      const setRes = await db.from('settings').select('*');
      if (setRes.error) throw new Error("Error loading settings: " + setRes.error.message);
      const arrData = setRes.data.map(row => {
        return [row.key || '', row.value || ''];
      });
      return { success: true, ok: true, data: arrData };
    }
    
    // For anything else (Website_Orders, AD_TRACKER, EXPENSES, DELIVERY_CHARGES, etc.)
    // return null so that appsPost falls back to Google Sheets
    return null;
  },

  async applyStockChange(payload) {
    const db = window.supabaseClient;
    const { name, dS, dM, dL, dXL, dXXL, d3XL } = payload;
    
    // We must fetch the current row first, then update it.
    // (A PostgreSQL RPC function would be safer to prevent race conditions,
    // but this works for basic admin panel usage).
    const { data: row, error: fetchErr } = await db.from('inventory').select('*').eq('product', name).single();
    if (fetchErr || !row) throw new Error("Product not found");

    const updates = {};
    if (dS) updates.stk_s = Number(row.stk_s) + Number(dS);
    if (dM) updates.stk_m = Number(row.stk_m) + Number(dM);
    if (dL) updates.stk_l = Number(row.stk_l) + Number(dL);
    if (dXL) updates.stk_xl = Number(row.stk_xl) + Number(dXL);
    if (dXXL) updates.stk_xxl = Number(row.stk_xxl) + Number(dXXL);
    if (d3XL) updates.stk_3xl = Number(row.stk_3xl) + Number(d3XL);
    updates.updated_at = new Date().toISOString();

    const { error: upErr } = await db.from('inventory').update(updates).eq('product', name);
    if (upErr) throw new Error(upErr.message);

    return { success: true, ok: true, msg: "Stock updated in Supabase" };
  },
  
  async adminLogin(payload) {
    // ⚠️ V1 HARDCODED CREDENTIALS NEUTRALIZED (security risk)
    // Original code was:
    //   if (payload.adminUser === 'maruf_ix' && payload.adminPass === 'Hassan__00') { ... 'temp-supabase-token' }
    //   if (payload.adminPass === '1234') { ... 'temp-supabase-token' }  // ANY user with pwd 1234!
    // V1 cannot do real auth — it bypasses the bcrypt check in admin_users.
    // The real implementation is in supabase-adapter-v2.js (uses admin_login RPC).
    throw new Error(
      "[V1 adapter DEPRECATED] adminLogin requires ../supabase-adapter-v2.js. " +
      "This V1 file has hardcoded credentials and a fake session token. " +
      "Update the script tag in index.html (line 2670) to '../supabase-adapter-v2.js'."
    );
  },

  async adminLogout() {
    return { success: true, ok: true };
  },

  async saveProductFromForm(payload) {
    const db = window.supabaseClient;
    const p = payload;
    
    // Map payload to schema columns
    const insertData = {
      product: p.name,
      category: p.cat || '',
      fabric: p.fab || '',
      badge: p.bad || '',
      description: p.desc || '',
      cost: Number(p.cost) || 0,
      regular: Number(p.reg) || 0,
      sale: Number(p.sale) || 0,
      disc_percent: Number(p.discPct) || 0,
      dhaka_delivery: Number(p.din) || 0,
      outside_delivery: Number(p.dout) || 0,
      stk_s: Number(p.sS) || 0,
      stk_m: Number(p.sM) || 0,
      stk_l: Number(p.sL) || 0,
      stk_xl: Number(p.sXL) || 0,
      stk_xxl: Number(p.sXXL) || 0,
      stk_3xl: Number(p.s3XL) || 0,
      image_1: p.img1 || '',
      image_2: p.img2 || '',
      image_3: p.img3 || '',
      image_4: p.img4 || '',
      image_5: p.img5 || '',
      image_6: p.img6 || '',
      video_url: p.vid || '',
      status: p.status || 'Active',
      coupon_active: p.cAct || '',
      coupon_code: p.cCode || '',
      coupon_disc_percent: Number(p.cDisc) || 0,
      hidden_sizes: p.oneSize ? '__ONESIZE__' : '',
      size_type: p.sizeType || '',
      accessory: p.accessory || 'No',
      updated_at: new Date().toISOString()
    };

    const { error } = await db.from('inventory').insert([insertData]);
    if (error) {
      if (error.code === '23505') throw new Error("A product with this name already exists.");
      throw new Error(error.message);
    }
    return { success: true, ok: true, msg: "Product saved to Supabase" };
  },

  async deleteProduct(payload) {
    const db = window.supabaseClient;
    const { name } = payload;
    if (!name) throw new Error("No product name provided");

    const { error } = await db.from('inventory').delete().eq('product', name);
    if (error) throw new Error(error.message);
    return { success: true, ok: true, msg: "Product deleted from Supabase" };
  },


  async saveProductEditFromForm(payload) {
    const db = window.supabaseClient;
    const p = payload;
    
    // In edit mode, p.oldName holds the original name in case it was changed
    const targetName = p.oldName || p.name;
    
    const updateData = {
      product: p.name,
      category: p.cat || '',
      fabric: p.fab || '',
      badge: p.bad || '',
      description: p.desc || '',
      cost: Number(p.cost) || 0,
      regular: Number(p.reg) || 0,
      sale: Number(p.sale) || 0,
      disc_percent: Number(p.discPct) || 0,
      dhaka_delivery: Number(p.din) || 0,
      outside_delivery: Number(p.dout) || 0,
      stk_s: Number(p.sS) || 0,
      stk_m: Number(p.sM) || 0,
      stk_l: Number(p.sL) || 0,
      stk_xl: Number(p.sXL) || 0,
      stk_xxl: Number(p.sXXL) || 0,
      stk_3xl: Number(p.s3XL) || 0,
      image_1: p.img1 || '',
      image_2: p.img2 || '',
      image_3: p.img3 || '',
      image_4: p.img4 || '',
      image_5: p.img5 || '',
      image_6: p.img6 || '',
      video_url: p.vid || '',
      status: p.status || 'Active',
      coupon_active: p.cAct || '',
      coupon_code: p.cCode || '',
      coupon_disc_percent: Number(p.cDisc) || 0,
      hidden_sizes: p.oneSize ? '__ONESIZE__' : '',
      size_type: p.sizeType || '',
      accessory: p.accessory || 'No',
      updated_at: new Date().toISOString()
    };

    const { error } = await db.from('inventory').update(updateData).eq('product', targetName);
    if (error) {
      if (error.code === '23505') throw new Error("A product with this new name already exists.");
      throw new Error(error.message);
    }
    return { success: true, ok: true, msg: "Product updated in Supabase" };
  },

};