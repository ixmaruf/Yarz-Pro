/* YARZ PRO - Apps Script Backend Update (Case-Insensitive Fix) */

// ১. এই API KEY টি যদি আগে থেকেই উপরে থাকে, তবে এটি ডিলিট করে দিতে পারেন
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

// ═════════ doGet — Public read endpoints ═════════
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
      case "health":      return _webJson_({ success:true, status:"online", version:"YARZ v8.0" });
      default:            return _webErr_("Unknown action: " + action);
    }
  } catch (err) {
    return _webErr_("Server error: " + err.message, 500);
  }
}

// ═════════ doPost — Dashboard write actions ═════════
function doPost(e) {
  try {
    var contents = e.postData.contents;
    var body = JSON.parse(contents);
    if (body.key !== WEB_API_KEY) return _webErr_("Invalid API Key", 401);

    var action = String(body.action || "").trim();
    var lowerAction = action.toLowerCase();

    switch (lowerAction) {
      case "place_order":                 return _placeWebsiteOrder(body.order || body);
      case "update_order_status":         return _updateWebOrderStatus(body);
      case "saveproductfromform":         return _webJson_(saveProductFromForm(body));
      case "saveproducteditfromform":     return _webJson_(saveProductEditFromForm(body));
      case "updateproductstatus":         return _webJson_(updateProductStatus(body));
      case "applystockchange":            return _webJson_(applyStockChange(body));
      case "applybulkedit":               return _webJson_(applyBulkEdit(body));
      case "recordsale":                  return _webJson_(_webRecordSale(body));
      case "saveorderfromform":           return _webJson_(_webSaveOrderWithStatus(body));
      case "updatewebsiteorderstatus":    return _webJson_(_webUpdateWebsiteOrderStatus(body));
      case "updatemanualorderstatus":     return _webJson_(_webUpdateManualOrderStatus(body));
      case "deletewebsiteorder":          return _webJson_(_webDeleteWebsiteOrder(body));
      case "deletemanualorder":           return _webJson_(_webDeleteManualOrder(body));
      case "deleteproduct":               return _webJson_(_webDeleteProduct(body));
      case "fullfactoryreset":            return _webJson_(_webFullFactoryReset());
      case "clearfinancialsonly":         return _webJson_(_webClearFinancialsOnly());
      case "clearinventoryonly":          return _webJson_(_webClearInventoryOnly());
      case "updatesettings":              return _webJson_(_webUpdateSettings(body));
      case "savegithubsettings":          return _webJson_(saveGitHubSettings(body));
      case "githubsyncnow":               try { githubSyncNow(); return _webJson_({ ok:true }); } catch(x){ return _webErr_(x.message); }
      case "generatemonthlyreport":       try { generateMonthlyReport(); return _webJson_({ ok:true }); } catch(x){ return _webErr_(x.message); }
      case "generateyearlyreport":        try { generateYearlyReport(); return _webJson_({ ok:true }); } catch(x){ return _webErr_(x.message); }
      default: return _webErr_("Unknown action: " + action);
    }
  } catch (err) {
    return _webErr_("Server error: " + err.message, 500);
  }
}

/* 
  বাকি সব _web... ফাংশনগুলো (যেমন: _webFullFactoryReset, _webDeleteProduct ইত্যাদি) 
  যেগুলো আমি আগেরবার দিয়েছিলাম, সেগুলো আপনার স্ক্রিপ্টের নিচে আগে থেকেই থাকলে নতুন করে দরকার নেই।
*/
