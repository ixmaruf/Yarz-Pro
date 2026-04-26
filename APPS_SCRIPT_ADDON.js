/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  YARZ PRO Web Dashboard — Apps Script ADD-ON CODE  (v2.3)     ║
 * ║  মারুফ ভাই: এই কোডটি আপনার বর্তমান Apps Script-এর             ║
 * ║  একদম নিচে paste করে Save করুন, তারপর Deploy → New Deployment ║
 * ║  → Web app → Who has access: Anyone → Deploy                  ║
 * ║  যে URL পাবেন, সেটি web dashboard-এর Settings-এ বসাবেন।       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * এই ADD-ON ফাইলটি আপনার existing doGet/doPost কে upgrade করে।
 * পুরনো doGet/doPost ফাংশন দুটি **মুছে ফেলুন** তারপর এই পুরো
 * কোডটি পেস্ট করুন।
 *
 * v2.3 UPDATES:
 *  + বাগ ফিক্স: clearFinancialsOnly এ SOLD columns reset logic ঠিক হয়েছে
 *  + fullFactoryReset আরো robust করা হয়েছে
 *  + deleteWebsiteOrder, deleteManualOrder — row remove বেড fixes
 */

// ============ API KEY (existing global থেকে নেয়) ============
var WEB_API_KEY = 'AIzaSyC2WUoTmJ_nwxZ0gV8BkE0UGgZoEfwyQ5k';

function _webCors_() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function _webJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _webErr_(msg, code) {
  return _webJson_({ success:false, ok:false, error:msg, msg:msg, code:code||400 });
}

// ═════════ doGet — Public read endpoints + Dashboard ═════════
function doGet(e) {
  try {
    var key = (e && e.parameter && e.parameter.key) ? e.parameter.key : "";
    if (key !== WEB_API_KEY) return _webErr_("Invalid API Key", 401);

    var action = (e.parameter.action || "products").toLowerCase();
    switch (action) {
      case "products":    return _getProducts(e);
      case "product":     return _getSingleProduct(e);
      case "categories":  return _getCategories();
      case "store_info":  return _getStoreInfo();
      case "health":      return _webJson_({ success:true, status:"online", version:"YARZ v8.0", timestamp:new Date().toISOString() });
      default:            return _webErr_("Unknown action: "+action);
    }
  } catch (err) {
    return _webErr_("Server error: "+err.message, 500);
  }
}

// ═════════ doPost — Dashboard write actions ═════════
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.key !== WEB_API_KEY) return _webErr_("Invalid API Key", 401);

    var action = String(body.action || "").trim();
    var lowerAction = action.toLowerCase();

    switch (action) {
      // Public
      case "place_order":                 return _placeWebsiteOrder(body.order || body);
      case "update_order_status":         return _updateWebOrderStatus(body);

      // Dashboard - Products
      case "saveProductFromForm":         return _webJson_(saveProductFromForm(body));
      case "saveProductEditFromForm":     return _webJson_(saveProductEditFromForm(body));
      case "updateProductStatus":         return _webJson_(updateProductStatus(body));
      case "applyStockChange":            return _webJson_(applyStockChange(body));
      case "applyBulkEdit":               return _webJson_(applyBulkEdit(body));
      case "recordSale":                  return _webJson_(_webRecordSale(body));

      // Dashboard - Orders
      case "saveOrderFromForm":           return _webJson_(_webSaveOrderWithStatus(body));
      case "updateWebsiteOrderStatus":    return _webJson_(_webUpdateWebsiteOrderStatus(body));
      case "updateManualOrderStatus":     return _webJson_(_webUpdateManualOrderStatus(body));
      case "deleteWebsiteOrder":          
      case "deletewebsiteorder":          return _webJson_(_webDeleteWebsiteOrder(body));
      case "deleteManualOrder":           
      case "deletemanualorder":           return _webJson_(_webDeleteManualOrder(body));
      case "deleteProduct":               
      case "deleteproduct":               return _webJson_(_webDeleteProduct(body));
      case "fullFactoryReset":            
      case "fullfactoryreset":            return _webJson_(_webFullFactoryReset());
      case "clearFinancialsOnly":         
      case "clearfinancialsonly":         return _webJson_(_webClearFinancialsOnly());
      case "clearInventoryOnly":
      case "clearinventoryonly":          return _webJson_(_webClearInventoryOnly());

      // Dashboard - Finance
      case "saveAdFromForm":              return _webJson_(saveAdFromForm(body));
      case "saveExpenseFromForm":         return _webJson_(saveExpenseFromForm(body));
      case "saveReturnFromForm":          return _webJson_(saveReturnFromForm(body));

      // Dashboard - Settings
      case "updateSettings":              return _webJson_(_webUpdateSettings(body));
      case "saveGitHubSettings":          return _webJson_(saveGitHubSettings(body));
      case "githubSyncNow":               try { githubSyncNow(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }

      // Dashboard - Reports
      case "generateMonthlyReport":       try { generateMonthlyReport(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }
      case "generateYearlyReport":        try { generateYearlyReport(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }

      default: return _webErr_("Unknown action: "+action);
    }
  } catch (err) {
    return _webErr_("Server error: "+err.message, 500);
  }
}

// ═════════ NEW: Record Sale (increments SOLD_* columns) ═════════
function _webRecordSale(d) {
  try {
    var inv = _ss().getSheetByName("INVENTORY");
    if (!inv) return { ok:false, msg:"INVENTORY not found" };
    var lr = _getActualLastRow(inv, 1);
    if (lr < 2) return { ok:false, msg:"No products" };
    var names = inv.getRange(2, 1, lr-1, 1).getValues().flat();
    var idx = names.indexOf(d.product);
    if (idx === -1) return { ok:false, msg:"Product not found" };
    var row = idx + 2;
    var sizeCol = { M:COL.SOLD_M, L:COL.SOLD_L, XL:COL.SOLD_XL, XXL:COL.SOLD_XXL }[d.size];
    if (!sizeCol) return { ok:false, msg:"Invalid size" };
    var qty = parseInt(d.qty, 10) || 1;
    var cur = parseInt(inv.getRange(row, sizeCol).getValue(), 10) || 0;
    inv.getRange(row, sizeCol).setValue(cur + qty);
    inv.getRange(row, COL.UPDATED).setValue(new Date());
    var sale = _num(inv.getRange(row, COL.SALE).getValue());
    var cost = _num(inv.getRange(row, COL.COST).getValue());
    _logTransaction([new Date(), d.product, "Sale", d.size, qty, qty*sale, qty*cost, qty*(sale-cost)]);
    return { ok:true, success:true };
  } catch (e) { return { ok:false, msg:e.message }; }
}

// ═════════ NEW: Website Order Status Update (uses dashboard status flow) ═════════
function _webUpdateWebsiteOrderStatus(body) {
  try {
    var wos = _ss().getSheetByName("Website_Orders");
    if (!wos) return { ok:false, msg:"Website_Orders not found" };
    var lr = _getActualLastRow(wos, 1);
    if (lr < 2) return { ok:false, msg:"No orders" };
    var ids = wos.getRange(2, 1, lr-1, 1).getValues().flat();
    var idx = ids.indexOf(body.orderId);
    if (idx === -1) return { ok:false, msg:"Order not found" };
    var row = idx + 2;
    // Check if target column P (16) exists — new layout 19 cols
    var statusCol = 16; // Column P = Status in full Website_Orders schema
    // fallback: if only 14 cols (legacy), use 14
    if (wos.getLastColumn() < 16) statusCol = 14;
    wos.getRange(row, statusCol).setValue(body.status);
    // If we provided courier update, also set it
    if (body.courier && wos.getLastColumn() >= 17) {
      wos.getRange(row, 17).setValue(body.courier);
    }
    return { ok:true, success:true };
  } catch (e) { return { ok:false, msg:e.message }; }
}

// ═════════ NEW: Update Settings (batch) ═════════
function _webUpdateSettings(body) {
  try {
    var sh = _ss().getSheetByName("SETTINGS");
    if (!sh) return { ok:false, msg:"SETTINGS not found" };
    var updates = body.settings || {};
    var lr = _getActualLastRow(sh, 1);
    if (lr < 2) return { ok:false, msg:"SETTINGS empty" };
    var data = sh.getRange(2, 1, lr-1, 2).getValues();
    var keys = Object.keys(updates);
    keys.forEach(function(k){
      var found = false;
      for (var i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === k) {
          sh.getRange(i+2, 2).setValue(updates[k]);
          found = true;
          break;
        }
      }
      if (!found) {
        // append
        var next = _getActualLastRow(sh, 1) + 1;
        _ensureRows(sh, next);
        sh.getRange(next, 1, 1, 3).setValues([[k, updates[k], ""]]);
      }
    });
    return { ok:true, success:true };
  } catch (e) { return { ok:false, msg:e.message }; }
}

// ═════════ Helpers used above: _ss, _getActualLastRow, _num, _ensureRows,
//           _logTransaction, COL — all defined in main script ═════════

// ═════════ Public Read helpers (Product/Store/Category) ═════════
function _getProducts(e) {
  var ws = _ss().getSheetByName("WEBSITE_SYNC");
  if (!ws) return _webErr_("Website_Sync tab not found", 500);
  var lr = ws.getLastRow();
  if (lr < 2) return _webJson_({ success:true, products:[], total:0 });
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var data = ws.getRange(2, 1, lr-1, ws.getLastColumn()).getValues();
  var category = e.parameter.category || "";
  var search = (e.parameter.search || "").toLowerCase();
  var products = [];
  for (var i = 0; i < data.length; i++) {
    if (!data[i][0]) continue;
    var p = _buildProductObject(headers, data[i]);
    if (category && p.category !== category) continue;
    if (search && p.name.toLowerCase().indexOf(search) === -1) continue;
    products.push(p);
  }
  return _webJson_({ success:true, products:products, total:products.length, timestamp:new Date().toISOString() });
}

function _getSingleProduct(e) {
  var name = e.parameter.name || "";
  if (!name) return _webErr_("Product name required");
  var ws = _ss().getSheetByName("WEBSITE_SYNC");
  if (!ws) return _webErr_("Website_Sync tab not found", 500);
  var lr = ws.getLastRow();
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var data = ws.getRange(2, 1, lr-1, ws.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === name.trim()) {
      return _webJson_({ success:true, product:_buildProductObject(headers, data[i]) });
    }
  }
  return _webErr_("Product not found", 404);
}

function _buildProductObject(headers, row) {
  var obj = {};
  var map = {
    "Product":"name","Image1":"image1","Image2":"image2","Image3":"image3",
    "Video":"video","Description":"description","Category":"category",
    "Fabric":"fabric","Badge":"badge","SizeChart":"sizeChart",
    "DeliveryDays":"deliveryDays","Regular":"regularPrice","Sale":"salePrice",
    "Disc%":"discountPercent","DiscType":"discountType",
    "Delivery(Dhaka)":"deliveryDhaka","Delivery(Outside)":"deliveryOutside",
    "M_Left":"stock_M","L_Left":"stock_L","XL_Left":"stock_XL","XXL_Left":"stock_XXL",
    "Status":"status"
  };
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).replace(/[^\x20-\x7E]/g, "").trim();
    var key = map[h];
    if (key) obj[key] = (row[i] == null) ? "" : row[i];
  }
  var m = parseFloat(obj.stock_M)||0, l = parseFloat(obj.stock_L)||0, xl = parseFloat(obj.stock_XL)||0, xxl = parseFloat(obj.stock_XXL)||0;
  obj.totalStock = m+l+xl+xxl;
  obj.inStock = obj.totalStock > 0;
  obj.sizes = {};
  if (m>0) obj.sizes.M = true;
  if (l>0) obj.sizes.L = true;
  if (xl>0) obj.sizes.XL = true;
  if (xxl>0) obj.sizes.XXL = true;
  return obj;
}

function _getCategories() {
  var ws = _ss().getSheetByName("WEBSITE_SYNC");
  if (!ws) return _webJson_({ success:true, categories:[] });
  var lr = ws.getLastRow();
  if (lr < 2) return _webJson_({ success:true, categories:[] });
  var headers = ws.getRange(1, 1, 1, ws.getLastColumn()).getValues()[0];
  var catCol = -1;
  for (var i = 0; i < headers.length; i++) if (String(headers[i]).indexOf("Category") !== -1) { catCol = i; break; }
  if (catCol === -1) return _webJson_({ success:true, categories:[] });
  var data = ws.getRange(2, catCol+1, lr-1, 1).getValues();
  var cats = {};
  data.forEach(function(r){ var v = String(r[0]||"").trim(); if(v) cats[v] = (cats[v]||0)+1; });
  var list = Object.keys(cats).map(function(k){ return { name:k, count:cats[k] }; });
  list.sort(function(a,b){ return b.count-a.count; });
  return _webJson_({ success:true, categories:list });
}

function _getStoreInfo() {
  var sh = _ss().getSheetByName("SETTINGS");
  if (!sh) return _webJson_({ success:true, store:{} });
  var lr = sh.getLastRow();
  if (lr < 2) return _webJson_({ success:true, store:{} });
  var rows = sh.getRange(2, 1, lr-1, 2).getValues();
  var allowedPrefixes = ["Store Name","Store Tagline","Brand Logo URL","Contact Phone","Contact Email",
    "Website URL","Facebook Page","Instagram","WhatsApp","YouTube","TikTok","Currency","Country",
    "Default Delivery (Dhaka)","Default Delivery (Outside)","Default Delivery Days",
    "Free Delivery Minimum","Return Policy Days","Return Policy Description","Shipping Policy","Payment Methods",
    "Announcement Text", "Announcement Active", "Store Status", "Promo Popup Image", "Promo Popup Link", "Promo Popup Active"];

  var info = {};
  rows.forEach(function(r){
    var k = String(r[0]||"").trim();
    if (allowedPrefixes.indexOf(k) !== -1 || k.startsWith("Hero Banner ") || k.startsWith("Banner Link ") || k.startsWith("Section ")) {
      info[k.replace(/[^a-zA-Z0-9 ]/g,"").replace(/ +/g,"_").toLowerCase()] = r[1];
    }
  });
  return _webJson_({ success:true, store:info });
}

function _placeWebsiteOrder(order) {
  if (!order || !order.customerName || !order.phone || !order.product)
    return _webErr_("customerName, phone, product required");
  var ss = _ss();
  var wos = ss.getSheetByName("Website_Orders");
  if (!wos) { _setupWebsiteOrders(); wos = ss.getSheetByName("Website_Orders"); }
  var oid = "WEB-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMdd") + "-" + Math.floor(Math.random()*9000+1000);
  var qty = parseInt(order.qty)||1, price = parseFloat(order.price)||0, delivery = parseFloat(order.delivery)||0;
  var total = price*qty + delivery;
  var next = _getActualLastRow(wos, 1) + 1;
  _ensureRows(wos, next);
  // Use 19-column schema (setup in _setupWebsiteOrders)
  wos.getRange(next, 1, 1, 19).setValues([[
    oid, new Date(),
    String(order.customerName||""), String(order.phone||""), String(order.email||""),
    String(order.address||""), String(order.location||""), String(order.city||""),
    String(order.product||""), String(order.size||""), qty,
    price, delivery, total,
    String(order.payment||"COD"), "Pending", String(order.courier||""),
    String(order.notes||""), "Website"
  ]]);
  return _webJson_({ success:true, ok:true, message:"Order placed", orderId:oid, total:total });
}

function _updateWebOrderStatus(body) {
  return _webJson_(_webUpdateWebsiteOrderStatus(body));
}

// ═════════ NEW v2.1: Delete Website Order (removes the row entirely) ═════════
function _webDeleteWebsiteOrder(body) {
  try {
    var wos = _ss().getSheetByName("Website_Orders");
    if (!wos) return { ok:false, success:false, msg:"Website_Orders not found" };
    var lr = _getActualLastRow(wos, 1);
    if (lr < 2) return { ok:false, success:false, msg:"No orders" };
    var ids = wos.getRange(2, 1, lr-1, 1).getValues().flat();
    var idx = ids.indexOf(body.orderId);
    if (idx === -1) return { ok:false, success:false, msg:"Order not found" };
    wos.deleteRow(idx + 2);
    return { ok:true, success:true, message:"Order deleted" };
  } catch (e) { return { ok:false, success:false, msg:e.message }; }
}

// ═════════ NEW v2.1: Delete Manual Order ═════════
function _webDeleteManualOrder(body) {
  try {
    var sh = _ss().getSheetByName("ORDERS");
    if (!sh) return { ok:false, success:false, msg:"ORDERS not found" };
    var lr = _getActualLastRow(sh, 2);  // col 2 = OrderID in ORDERS tab (col A is Date)
    if (lr < 2) return { ok:false, success:false, msg:"No orders" };
    // ORDERS schema: A=Date, B=OrderID, C=Customer, D=Phone, ...
    var ids = sh.getRange(2, 2, lr-1, 1).getValues().flat();
    var idx = ids.indexOf(body.orderId);
    if (idx === -1) return { ok:false, success:false, msg:"Order not found" };
    sh.deleteRow(idx + 2);
    return { ok:true, success:true, message:"Order deleted" };
  } catch (e) { return { ok:false, success:false, msg:e.message }; }
}

// ═════════ NEW v2.2: Save Manual Order with Status (wrapper over existing saveOrderFromForm) ═════════
function _webSaveOrderWithStatus(body) {
  try {
    // Call the existing saveOrderFromForm (which returns whatever shape it uses)
    var result = saveOrderFromForm(body);

    // If status was provided and isn't the default Pending, update the just-added row
    var desiredStatus = body.status || '';
    if (desiredStatus && desiredStatus !== 'Pending') {
      var sh = _ss().getSheetByName("ORDERS");
      if (sh) {
        var lr = _getActualLastRow(sh, 2);
        if (lr >= 2) {
          // Find the order we just saved by orderId (body.oid)
          var ids = sh.getRange(2, 2, lr-1, 1).getValues().flat();
          var idx = ids.indexOf(body.oid);
          if (idx !== -1) {
            sh.getRange(idx + 2, 14).setValue(desiredStatus); // col N = Status
          }
        }
      }
    }
    return result;
  } catch (e) {
    return { ok:false, success:false, msg:e.message };
  }
}

// ═════════ NEW v2.2: Update Manual Order Status ═════════
// ORDERS schema: A=Date, B=OrderID, C=Customer, D=Phone,
// E=Address, F=Location, G=Product, H=Size, I=Qty,
// J=Price, K=Delivery, L=Total, M=Payment, N=Status, O=Courier, P=Notes
function _webUpdateManualOrderStatus(body) {
  try {
    var sh = _ss().getSheetByName("ORDERS");
    if (!sh) return { ok:false, success:false, msg:"ORDERS not found" };
    var lr = _getActualLastRow(sh, 2);
    if (lr < 2) return { ok:false, success:false, msg:"No orders" };
    var ids = sh.getRange(2, 2, lr-1, 1).getValues().flat();
    var idx = ids.indexOf(body.orderId);
    if (idx === -1) return { ok:false, success:false, msg:"Order not found" };
    var row = idx + 2;
    // Column N = 14 = Status
    sh.getRange(row, 14).setValue(body.status || 'Pending');
    if (body.courier) {
      sh.getRange(row, 15).setValue(body.courier);
    }
    return { ok:true, success:true, message:"Status updated" };
  } catch (e) { return { ok:false, success:false, msg:e.message }; }
}

// ═════════ NEW: Delete Product ═════════
function _webDeleteProduct(body) {
  try {
    var name = body.name;
    var keepFin = body.keepFinancials;
    if (!name) return { ok:false, msg:"Name required" };
    
    // Delete from INVENTORY
    var inv = _ss().getSheetByName("INVENTORY");
    if (inv) {
      var lr = inv.getLastRow();
      if (lr >= 2) {
        var names = inv.getRange(2, 1, lr-1, 1).getValues().flat();
        var idx = names.indexOf(name);
        if (idx !== -1) inv.deleteRow(idx + 2);
      }
    }
    
    // Delete from WEBSITE_SYNC
    var ws = _ss().getSheetByName("WEBSITE_SYNC");
    if (ws) {
      var lr2 = ws.getLastRow();
      if (lr2 >= 2) {
        var wnames = ws.getRange(2, 1, lr2-1, 1).getValues().flat();
        var widx = wnames.indexOf(name);
        if (widx !== -1) ws.deleteRow(widx + 2);
      }
    }
    
    // If keepFinancials is false, delete from TRANSACTIONS, Website_Orders, ORDERS
    if (!keepFin) {
      _deleteRowsByProduct("TRANSACTIONS", 2, name); // Assuming Col 2 is Product
      _deleteRowsByProduct("Website_Orders", 9, name); // Col 9 is Product
      _deleteRowsByProduct("ORDERS", 7, name); // Col 7 is Product
    }
    
    return { ok:true, success:true, message:"Product deleted successfully" };
  } catch(e) {
    return { ok:false, msg:e.message };
  }
}

function _deleteRowsByProduct(sheetName, prodColIdx, productName) {
  var sh = _ss().getSheetByName(sheetName);
  if (!sh) return;
  var lr = sh.getLastRow();
  if (lr < 2) return;
  var data = sh.getRange(2, prodColIdx, lr-1, 1).getValues();
  // Delete from bottom to top
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]).trim() === productName) {
      sh.deleteRow(i + 2);
    }
  }
}

// শুধু Financial ডেটা মুছে ফেলে। ইনভেন্টরি বাঁচিয়ে রাখে।
// INVENTORY-তে SOLD_M(23),SOLD_L(24),SOLD_XL(25),SOLD_XXL(26),RETURNS(28) কলাম শুধু 0 হয়
function _webClearFinancialsOnly() {
  try {
    var ss = _ss();

    // 1. এই 5টি Sheet-এর header row (row 1) রেখে বাকি সব রো মুছে ফেলা হবে
    var sheetsToClear = ["TRANSACTIONS", "Website_Orders", "ORDERS", "AD_TRACKER", "EXPENSES"];
    sheetsToClear.forEach(function(s) {
      var sh = ss.getSheetByName(s);
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
      }
    });

    // 2. INVENTORY-তে Sold ও Returns কলামগুলো 0 হবে (কিন্তু Stock থাকবে)
    //    Column indices (1-based): SOLD_M=23, SOLD_L=24, SOLD_XL=25, SOLD_XXL=26, RETURNS=28
    //    Financial summary cols: REVENUE=32, TO_RECOVER=33, GROSS=34, FB_AD=35, NET=36, DISC_IMPACT=37
    var inv = ss.getSheetByName("INVENTORY");
    if (inv && inv.getLastRow() > 1) {
      var rowCount = inv.getLastRow() - 1;
      var zeroCol = function(col) {
        var vals = [];
        for (var i = 0; i < rowCount; i++) vals.push([0]);
        inv.getRange(2, col, rowCount, 1).setValues(vals);
      };
      // Sold columns
      [23, 24, 25, 26].forEach(zeroCol);
      // Returns column
      zeroCol(28);
      // Financial summary columns (only if they exist)
      var maxCol = inv.getLastColumn();
      [32, 33, 34, 35, 36, 37].forEach(function(c) {
        if (c <= maxCol) zeroCol(c);
      });
    }
    return { ok:true, success:true, message:"Financial data cleared successfully" };
  } catch(e) {
    return { ok:false, success:false, msg:e.message };
  }
}

// শুধু প্রোডাক্ট এবং ইনভেন্টরি মুছে ফেলে। আর্থিক হিসাব ও লেনদেন ঠিক রাখে।
function _webClearInventoryOnly() {
  try {
    var ss = _ss();
    var sheetsToClear = ["INVENTORY", "WEBSITE_SYNC"];
    var cleared = [];
    sheetsToClear.forEach(function(s) {
      var sh = ss.getSheetByName(s);
      if (!sh) return;
      var lr = sh.getLastRow();
      var lc = sh.getLastColumn();
      if (lr > 1 && lc > 0) {
        sh.getRange(2, 1, lr - 1, lc).clearContent();
        cleared.push(s);
      }
    });
    return { ok:true, success:true, message:"Products and Inventory cleared successfully", cleared: cleared };
  } catch(e) {
    return { ok:false, success:false, msg:e.message };
  }
}

// সম্পূর্ণ ডেটা মুছে ফেলে (header row বাঁচায়)
function _webFullFactoryReset() {
  try {
    var ss = _ss();
    var sheetsToClear = ["INVENTORY", "WEBSITE_SYNC", "TRANSACTIONS", "Website_Orders", "ORDERS", "AD_TRACKER", "EXPENSES"];
    var cleared = [];
    sheetsToClear.forEach(function(s) {
      var sh = ss.getSheetByName(s);
      if (!sh) return;
      var lr = sh.getLastRow();
      var lc = sh.getLastColumn();
      if (lr > 1 && lc > 0) {
        sh.getRange(2, 1, lr - 1, lc).clearContent();
        cleared.push(s);
      }
    });
    // Also reset REPORTS sheet if it exists
    var rsh = ss.getSheetByName("REPORTS");
    if (rsh && rsh.getLastRow() > 1) {
      rsh.getRange(2, 1, rsh.getLastRow() - 1, rsh.getLastColumn()).clearContent();
      cleared.push("REPORTS");
    }
    return { ok:true, success:true, message:"Factory reset complete", cleared: cleared };
  } catch(e) {
    return { ok:false, success:false, msg:e.message };
  }
}

/* END OF ADD-ON v2.3 */
