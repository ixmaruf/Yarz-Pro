// ════════════════════════════════════════════════════════
// ✅ YARZ PRO v8.1 — API KEY FIXED VERSION
// 🔑 API Key validation matches website's "key" parameter
// ════════════════════════════════════════════════════════

// ===== TOP-LEVEL CONSTANTS (REQUIRED FOR WEB API) =====
const API_KEY = "AIzaSyC2WUoTmJ_nwxZ0gV8BkE0UGgZoEfwyQ5k";
const SPREADSHEET_ID = "1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q";

/**
 * YARZ PRO v8.1 - Complete Rewrite + API Fix
 * Fixed: API Key validation, doGet/doPost robustness, CORS-friendly JSON
 * Preserved: All v8.0 features (Inventory Studio, Order Management, GitHub Sync, etc.)
 */

const C = {
  WHITE:"#FFFFFF", DARK:"#0F172A", TEXT:"#111827", MUTED:"#6B7280",
  BORDER:"#E5E7EB", BG:"#F8FAFC",
  GREEN:"#059669", GREEN_D:"#047857",
  RED:"#DC2626", ORANGE:"#D97706",
  BLUE:"#2563EB", PURPLE:"#7C3AED",
  INDIGO:"#4F46E5", GRAY:"#4B5563",
  FONT:"Roboto"
};

const DEFAULT_CATEGORY_LIST = ["Shirt","T-Shirt","Polo","Formal","Casual","Panjabi","Kurta","Pant","Formal Pant","Jeans","Chinos","Cargo Pant","Trouser","Hoodie","Sweater","Jacket","Blazer","Coat","Waistcoat","Tracksuit","Shorts","Three Quarter","Shoes","Sneakers","Sandals","Belt","Cap","Hat","Watch","Wallet","Sunglasses","Accessories","Other"];
const DEFAULT_FABRIC_LIST = ["Oxford Cotton","Poplin Cotton","Premium Cotton","Cotton","China Fabric","Twill Cotton","Linen","Silk","Denim","Polyester","Rayon","Viscose","Chiffon","Georgette","Khadi","Jersey","Fleece","Wool","Corduroy","Satin","Velvet","Nylon","Spandex","Mixed","Other"];
const DEFAULT_BADGE_LIST = ["","New Arrival","Hot Sale","Best Seller","Limited Edition","Trending","Premium","Sold Out Soon"];
const DISC_TYPE_LIST = ["Normal","Serious","Special","Clearance","Seasonal"];

const ALL_TABS = ["INVENTORY","DRAFT_VIEW","ARCHIVE_VIEW","WEBSITE_SYNC","ORDERS","TRANSACTIONS","AD_TRACKER","EXPENSES","MONTHLY_REPORT","YEARLY_REPORT","SETTINGS","_ACTIVITY","_DRAFT_DATA","_ARCHIVE_DATA"];

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
  UPDATED:38, STATUS:39, TOTAL:45,
  IMG4:40, IMG5:41, IMG6:42, C_ACT:43, C_CODE:44, C_DISC:45
};

const SOLD_COLS = [COL.SOLD_M, COL.SOLD_L, COL.SOLD_XL, COL.SOLD_XXL];
const MANUAL_COLS = [COL.NAME, COL.IMG, COL.IMG2, COL.IMG3, COL.VIDEO, COL.DESC, COL.CATEGORY, COL.FABRIC, COL.BADGE, COL.SIZE_CHART, COL.DELIVERY_DAYS, COL.COST, COL.REG, COL.SALE, COL.DISC_TYPE, COL.DELIVERY_IN, COL.DELIVERY_OUT, COL.STK_M, COL.STK_L, COL.STK_XL, COL.STK_XXL, COL.SOLD_M, COL.SOLD_L, COL.SOLD_XL, COL.SOLD_XXL, COL.IMG4, COL.IMG5, COL.IMG6];

// ============= HELPERS =============
function _ss(){
  // Use the explicit SPREADSHEET_ID constant for Web API requests (no active sheet context)
  try {
    return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch(e){
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }
}
function _ui(){return SpreadsheetApp.getUi();}

function _getActualLastRow(sh, colIndex){
  colIndex = colIndex || 1;
  if(!sh) return 1;
  const vals = sh.getRange(1, colIndex, sh.getMaxRows()).getValues();
  for(let i = vals.length - 1; i >= 0; i--){
    const v = vals[i][0];
    if(v !== "" && v !== null && v !== undefined && String(v).trim() !== "") return i + 1;
  }
  return 1;
}

function _num(v){const n = parseFloat(v); return isNaN(n) ? 0 : n;}
function _int(v){const n = parseInt(v, 10); return isNaN(n) ? 0 : n;}
function _safe(v){return v === null || v === undefined ? "" : v;}

function _safeRowHeights(sh, startRow, count, height){
  if(!sh) return;
  try{
    const maxRows = sh.getMaxRows();
    const needed = startRow + count - 1;
    if(needed > maxRows) sh.insertRowsAfter(maxRows, needed - maxRows);
    const safeCount = Math.max(1, Math.min(count, sh.getMaxRows() - startRow + 1));
    sh.setRowHeights(startRow, safeCount, height);
  }catch(e){}
}

function _ensureRows(sh, needed){
  if(!sh) return;
  try{
    const maxRows = sh.getMaxRows();
    if(needed > maxRows) sh.insertRowsAfter(maxRows, needed - maxRows);
  }catch(e){}
}

function _getSettingsMap(){
  const sh = _ss().getSheetByName("SETTINGS");
  if(!sh) return {};
  const lr = _getActualLastRow(sh, 1);
  if(lr < 2) return {};
  const rows = sh.getRange(2, 1, lr - 1, 2).getValues();
  const map = {};
  rows.forEach(r => {
    const k = String(_safe(r[0])).trim();
    if(k) map[k] = r[1];
  });
  return map;
}

function _getListFromSettings(key, fallback){
  const s = _getSettingsMap();
  const raw = String(_safe(s[key] || "")).trim();
  if(!raw) return fallback.slice();
  const arr = raw.split(",").map(x => x.trim()).filter(Boolean);
  return arr.length ? arr : fallback.slice();
}

function getCategoryList(){return _getListFromSettings("Custom Categories", DEFAULT_CATEGORY_LIST);}
function getFabricList(){return _getListFromSettings("Custom Fabrics", DEFAULT_FABRIC_LIST);}
function getBadgeList(){return _getListFromSettings("Custom Badges", DEFAULT_BADGE_LIST);}

function _getInventoryFormulas(){
  return {
    "O2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(ROUND((M2:M-N2:N)/M2:M*100,0),0)))',
    "AA2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(W2:W+X2:X+Y2:Y+Z2:Z,0)))',
    "AB2": '=MAP(A2:A,LAMBDA(n,IF(n="","",IFERROR(SUMPRODUCT((TRANSACTIONS!B$2:B$5000=n)*(TRANSACTIONS!C$2:C$5000="Return")*TRANSACTIONS!E$2:E$5000),0))))',
    "AC2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR((S2:S+T2:T+U2:U+V2:V)-(AA2:AA-AB2:AB),0)))',
    "AD2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(S2:S+T2:T+U2:U+V2:V,0)))',
    "AE2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(L2:L*(S2:S+T2:T+U2:U+V2:V),0)))',
    "AF2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(N2:N*(AA2:AA-AB2:AB),0)))',
    "AG2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(IF(AE2:AE-AF2:AF>0,AE2:AE-AF2:AF,0),0)))',
    "AH2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR((N2:N-L2:L)*(AA2:AA-AB2:AB),0)))',
    "AI2": '=MAP(A2:A,LAMBDA(n,IF(n="","",IFERROR(SUMPRODUCT((AD_TRACKER!B$2:B$2000=n)*AD_TRACKER!C$2:C$2000),0))))',
    "AJ2": '=ARRAYFORMULA(IF(A2:A="","",IFERROR(AH2:AH-AI2:AI,0)))',
    "AK2": '=ARRAYFORMULA(IF(A2:A="","",IF(P2:P<>"Normal",IFERROR((M2:M-N2:N)*(AA2:AA-AB2:AB),0),0)))'
  };
}

function _restoreInventoryFormulas(inv){
  const formulas = _getInventoryFormulas();
  Object.keys(formulas).forEach(cell => {
    const r = inv.getRange(cell);
    if(!r.getFormula()) r.setFormula(formulas[cell]);
  });
}

function _hdr(sheet, headers, bg){
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground(bg || C.DARK)
    .setFontColor(C.WHITE)
    .setFontWeight("bold")
    .setFontFamily(C.FONT)
    .setFontSize(10)
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);
  sheet.setFrozenRows(1);
}

function _logActivity(product, oldSt, newSt){
  const sh = _ss().getSheetByName("_ACTIVITY");
  if(!sh) return;
  const next = _getActualLastRow(sh, 1) + 1;
  _ensureRows(sh, next);
  sh.getRange(next, 1, 1, 4).setValues([[new Date(), product, oldSt, newSt]]);
}

function _logTransaction(rowData){
  const tx = _ss().getSheetByName("TRANSACTIONS");
  if(!tx) return;
  const next = _getActualLastRow(tx, 1) + 1;
  _ensureRows(tx, next);
  tx.getRange(next, 1, 1, 8).setValues([rowData]);
}

function _buildOptions(arr, selected){
  return arr.map(function(x){
    const v = String(_safe(x));
    const sel = (selected !== undefined && v === selected) ? " selected" : "";
    return '<option value="' + v.replace(/"/g, '&quot;') + '"' + sel + '>' + (v || "—") + '</option>';
  }).join("");
}

// ============= SHARED CSS =============
function _sharedCSS(){
  return '<style>*{box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;background:#F8FAFC;color:#111827}.app{padding:16px}.appbar{margin:-16px -16px 16px;padding:14px 16px;background:linear-gradient(135deg,#059669,#047857);color:#fff;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.appbar h1{margin:0;font-size:16px;font-weight:700;flex:1}.badge{background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700}.card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.04)}.section-title{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;margin:18px 0 10px}.launcher-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.tool{background:#fff;border:1.5px solid #E5E7EB;border-radius:16px;padding:16px 12px;text-align:center;cursor:pointer;transition:all .18s ease;box-shadow:0 3px 10px rgba(0,0,0,.04)}.tool:hover{transform:translateY(-2px);border-color:#059669;box-shadow:0 10px 22px rgba(5,150,105,.14)}.tool .icon{font-size:28px;display:block;margin-bottom:6px}.tool .label{font-size:12px;font-weight:800;color:#111827}.tool .sub{font-size:10px;color:#6B7280;margin-top:3px}.field{margin-bottom:12px}.field label{display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:5px}.req{color:#DC2626;margin-left:2px}.input,.select,.textarea{width:100%;padding:10px 12px;border:1.5px solid #E5E7EB;border-radius:10px;background:#fff;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s}.input:focus,.select:focus,.textarea:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.1)}.textarea{min-height:70px;resize:vertical}.row{display:flex;gap:10px}.row>*{flex:1}.btn{border:none;border-radius:10px;padding:11px 14px;font-size:14px;font-weight:700;cursor:pointer;width:100%;font-family:inherit;transition:all .15s}.btn-primary{background:linear-gradient(135deg,#059669,#047857);color:#fff;box-shadow:0 4px 12px rgba(5,150,105,.25)}.btn-primary:hover{box-shadow:0 6px 18px rgba(5,150,105,.35)}.btn-secondary{background:#F3F4F6;color:#374151;border:1px solid #E5E7EB}.btn-danger{background:#DC2626;color:#fff}.btn-blue{background:#2563EB;color:#fff}.actions{display:flex;gap:10px;margin-top:16px}.search-wrap{position:relative;margin-bottom:12px}.search-wrap .sicon{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:15px;color:#9CA3AF;pointer-events:none}.search-wrap .input{padding-left:36px}.search-count{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:#F3F4F6;color:#6B7280;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px}.list{max-height:380px;overflow:auto}.list-item{display:flex;gap:10px;align-items:center;padding:10px;border:1px solid #E5E7EB;background:#fff;border-radius:12px;margin-bottom:8px;cursor:pointer;transition:all .15s}.list-item:hover{border-color:#10B981;background:#ECFDF5}.thumb{width:46px;height:46px;border-radius:10px;background:#F3F4F6 center/cover no-repeat;display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:18px;flex-shrink:0}.li-body{flex:1;min-width:0}.li-title{font-size:13px;font-weight:700;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.li-sub{font-size:11px;color:#6B7280;margin-top:2px}.li-right{text-align:right;flex-shrink:0}.price{font-size:13px;font-weight:800;color:#059669}.chip{display:inline-block;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:700}.chip-green{background:#D1FAE5;color:#065F46}.chip-amber{background:#FEF3C7;color:#92400E}.chip-red{background:#FEE2E2;color:#991B1B}.chip-blue{background:#DBEAFE;color:#1E40AF}.chip-gray{background:#F3F4F6;color:#374151}.empty{text-align:center;padding:32px 20px;color:#9CA3AF}.empty .ei{font-size:36px;opacity:.5;margin-bottom:8px}.view-btn,.edit-btn{border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap}.view-btn{background:#059669;color:#fff}.edit-btn{background:#2563EB;color:#fff}.stat-card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:12px;text-align:center}.stat-card .lbl{font-size:10px;font-weight:800;color:#6B7280;text-transform:uppercase;letter-spacing:.05em}.stat-card .val{font-size:18px;font-weight:900;margin-top:4px}.stat-green{color:#059669}.stat-red{color:#DC2626}.stat-amber{color:#D97706}.stat-blue{color:#2563EB}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.bar-chart{display:flex;align-items:flex-end;gap:8px;height:130px;padding:18px 0 0}.bar{flex:1;background:linear-gradient(180deg,#10B981,#059669);border-radius:6px 6px 0 0;position:relative;min-height:6px}.bar .bv{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:700;color:#111827;white-space:nowrap}.bar .bl{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:9px;color:#6B7280;font-weight:600;white-space:nowrap}.bar-red{background:linear-gradient(180deg,#F87171,#DC2626)}.bar-amber{background:linear-gradient(180deg,#FBBF24,#D97706)}.bar-blue{background:linear-gradient(180deg,#60A5FA,#2563EB)}.bar-purple{background:linear-gradient(180deg,#A78BFA,#7C3AED)}.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:opacity .2s;white-space:nowrap}.toast.show{opacity:1}.toast.success{background:#059669}.toast.error{background:#DC2626}.toast.info{background:#2563EB}.success-screen{text-align:center;padding:50px 20px}.success-screen .ic{font-size:56px;margin-bottom:10px}.success-screen h2{color:#059669;margin:0 0 6px}.success-screen p{color:#6B7280;margin:0}.hint{font-size:11px;color:#9CA3AF;margin-top:4px}.alert-box{background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:10px 12px;font-size:12px;color:#92400E;margin-bottom:10px}.alert-red{background:#FEE2E2;border-color:#FCA5A5;color:#991B1B}.alert-green{background:#D1FAE5;border-color:#6EE7B7;color:#065F46}.divider{height:1px;background:#F3F4F6;margin:12px 0}table.data-table{width:100%;border-collapse:collapse;font-size:12px}table.data-table th{padding:8px;text-align:left;background:#F9FAFB;border-bottom:2px solid #E5E7EB;font-weight:700;color:#374151}table.data-table td{padding:8px;border-bottom:1px solid #F3F4F6;color:#111827}table.data-table tr:last-child td{border-bottom:none}.low-stock{background:#FEE2E2 !important}.no-stock{background:#F3F4F6 !important;color:#9CA3AF}</style>';
}

function _sharedJS(){
  return '<script>function $(id){return document.getElementById(id);}function toast(msg,type){var t=document.createElement("div");t.className="toast "+(type||"success");t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.classList.add("show");},10);setTimeout(function(){t.classList.remove("show");setTimeout(function(){t.remove();},250);},2400);}function showSuccess(msg){document.body.innerHTML=\'<div class="success-screen"><div class="ic">✅</div><h2>\'+msg+\'</h2><p>সফলভাবে সেভ হয়েছে</p></div>\';setTimeout(function(){google.script.host.close();},1200);}function showError(msg){toast(msg||"সমস্যা হয়েছে","error");}function validateRequired(ids){var ok=true;ids.forEach(function(id){var el=$(id);if(!el)return;if(!el.value||!String(el.value).trim()){el.style.borderColor="#DC2626";ok=false;}else{el.style.borderColor="#E5E7EB";}});if(!ok)toast("প্রয়োজনীয় ফিল্ড পূরণ করুন","error");return ok;}function setLoading(btnId,on){var b=$(btnId);if(!b)return;if(on){b.disabled=true;b.dataset.orig=b.textContent;b.textContent="⏳ ...";}else{b.disabled=false;b.textContent=b.dataset.orig||b.textContent;}}function go(fn){google.script.run[fn]();}</script>';
}


// ===== PART 3: SETUP FUNCTIONS =====
function createFullSystem(){var ui=_ui();var ok=ui.alert("🚀 YARZ PRO v8.1","সম্পূর্ণ Inventory App তৈরি হবে।\n⚠️ পুরনো YARZ tabs reset হবে।\nচালিয়ে যেতে চান?",ui.ButtonSet.YES_NO);if(ok!==ui.Button.YES)return;var ss=_ss();var existing=ss.getSheets();var toDelete=existing.filter(function(s){return ALL_TABS.includes(s.getName());});if(toDelete.length>=existing.length)ss.insertSheet("__tmp__");toDelete.forEach(function(s){try{ss.deleteSheet(s);}catch(e){}});ALL_TABS.forEach(function(n){if(!ss.getSheetByName(n))ss.insertSheet(n);});["Sheet1","__tmp__"].forEach(function(n){var sh=ss.getSheetByName(n);if(sh&&ss.getSheets().length>1){try{ss.deleteSheet(sh);}catch(e){}}});try{_setupInventory();}catch(e){}try{_setupDraftView();}catch(e){}try{_setupArchiveView();}catch(e){}try{_setupWebsiteSync();}catch(e){}try{_setupOrders();}catch(e){}try{_setupWebsiteOrders();}catch(e){}try{_setupTransactions();}catch(e){}try{_setupAdTracker();}catch(e){}try{_setupExpenses();}catch(e){}try{_setupMonthlyReport();}catch(e){}try{_setupYearlyReport();}catch(e){}try{_setupSettings();}catch(e){}try{_setupActivity();}catch(e){}try{_setupDraftData();}catch(e){}try{_setupArchiveData();}catch(e){}["_ACTIVITY","_DRAFT_DATA","_ARCHIVE_DATA"].forEach(function(n){var sh=ss.getSheetByName(n);if(sh)try{sh.hideSheet();}catch(e){}});ss.setActiveSheet(ss.getSheetByName("INVENTORY"));ui.alert("✅ YARZ PRO v8.1 Ready!","মেনু থেকে:\n🔧 YARZ PRO → 🎛️ Inventory Studio",ui.ButtonSet.OK);}
function _setupInventory(){var sh=_ss().getSheetByName("INVENTORY");sh.clear();sh.clearConditionalFormatRules();_ensureRows(sh,1000);var H=["📦 Product","🖼️ Image 1","🖼️ Image 2","🖼️ Image 3","🎥 Video URL","📝 Description","🏷️ Category","🧵 Fabric","🏆 Badge","📏 Size Chart","📅 Delivery Days","💵 Cost","🏷️ Regular","💰 Sale","📊 Disc%","📋 Disc Type","🚚 Dhaka ৳","🚛 Outside ৳","M","L","XL","XXL","M","L","XL","XXL","📊 Sold","🔄 Returns","📉 Left","📦 Stock","💸 Invest","💵 Revenue","🎯 Recover","💰 Profit","📢 FB Ad","💵 Net","🏷️ Disc P/L","🕐 Updated","⚡ Status","🖼️ Image 4","🖼️ Image 5","🖼️ Image 6","🎟️ Coupon Active","🎟️ Coupon Code","💰 Coupon Disc %"];_hdr(sh,H,C.INDIGO);var widths=[200,100,100,100,110,180,110,120,110,130,100,85,85,85,65,90,80,90,55,55,55,55,55,55,55,55,70,70,70,70,90,90,90,90,80,90,90,130,90,100,100,100,100,120,100];widths.forEach(function(w,i){sh.setColumnWidth(i+1,w);});_safeRowHeights(sh,2,999,32);sh.getRange("A2:AP1000").setFontFamily(C.FONT).setFontSize(10).setVerticalAlignment("middle").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);sh.getRange("L2:N1000").setNumberFormat("#,##0");sh.getRange("O2:O1000").setNumberFormat('0"%"');sh.getRange("Q2:AK1000").setNumberFormat("#,##0");sh.getRange("AL2:AL1000").setNumberFormat("dd/MM/yy hh:mm");sh.getRange("G2:G1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getCategoryList(),true).setAllowInvalid(true).build());sh.getRange("H2:H1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getFabricList(),true).setAllowInvalid(true).build());sh.getRange("I2:I1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getBadgeList(),true).setAllowInvalid(true).build());sh.getRange("P2:P1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DISC_TYPE_LIST,true).build());sh.getRange("AM2:AM1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Active","Draft","Archived"],true).build());var formulas=_getInventoryFormulas();Object.keys(formulas).forEach(function(cell){sh.getRange(cell).setFormula(formulas[cell]);});var rules=[];rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Active").setBackground("#D1FAE5").setFontColor("#065F46").setRanges([sh.getRange("AM2:AM1000")]).build());rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Draft").setBackground("#FEF3C7").setFontColor("#92400E").setRanges([sh.getRange("AM2:AM1000")]).build());rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Archived").setBackground("#F3F4F6").setFontColor("#374151").setRanges([sh.getRange("AM2:AM1000")]).build());sh.setConditionalFormatRules(rules);}
function _setupDraftData(){var sh=_ss().getSheetByName("_DRAFT_DATA");sh.clear();_hdr(sh,["Name","Note"],C.GRAY);sh.getRange("A2").setValue("Legacy - data in INVENTORY");}
function _setupArchiveData(){var sh=_ss().getSheetByName("_ARCHIVE_DATA");sh.clear();_hdr(sh,["Name","Note"],C.GRAY);sh.getRange("A2").setValue("Legacy - data in INVENTORY");}
function _setupDraftView(){var sh=_ss().getSheetByName("DRAFT_VIEW");sh.clear();_ensureRows(sh,500);_hdr(sh,["#","📦 Product","🖼️ Image","🏷️ Category","🧵 Fabric","🏆 Badge","💵 Cost","🏷️ Regular","💰 Sale","📊 Stock","🛒 Sold","📉 Left","🔄 Action"],C.ORANGE);var cond='INVENTORY!AM2:AM="Draft",INVENTORY!A2:A<>""';sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!L2:L,'+cond+'),"")');sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!AD2:AD,'+cond+'),"")');sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!AA2:AA,'+cond+'),"")');sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!AC2:AC,'+cond+'),"")');sh.getRange("A2").setFormula('=ARRAYFORMULA(IF(B2:B="","",ROW(B2:B)-1))');sh.getRange("M2:M500").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["→ Activate","→ Archive"],true).build());sh.setColumnWidths(1,13,100);sh.setColumnWidth(2,180);_safeRowHeights(sh,2,499,32);}
function _setupArchiveView(){var sh=_ss().getSheetByName("ARCHIVE_VIEW");sh.clear();_ensureRows(sh,500);_hdr(sh,["#","📦 Product","🖼️ Image","🏷️ Category","🧵 Fabric","🏆 Badge","💵 Cost","🏷️ Regular","💰 Sale","📊 Stock","🛒 Sold","📉 Left","🔄 Action"],C.GRAY);var cond='INVENTORY!AM2:AM="Archived",INVENTORY!A2:A<>""';sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!L2:L,'+cond+'),"")');sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!AD2:AD,'+cond+'),"")');sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!AA2:AA,'+cond+'),"")');sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!AC2:AC,'+cond+'),"")');sh.getRange("A2").setFormula('=ARRAYFORMULA(IF(B2:B="","",ROW(B2:B)-1))');sh.getRange("M2:M500").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["→ Activate","→ Restore"],true).build());sh.setColumnWidths(1,13,100);sh.setColumnWidth(2,180);_safeRowHeights(sh,2,499,32);}
function _setupWebsiteSync(){var sh=_ss().getSheetByName("WEBSITE_SYNC");sh.clear();_ensureRows(sh,500);_hdr(sh,["Product","Image1","Image2","Image3","Video","Description","Category","Fabric","Badge","SizeChart","DeliveryDays","Regular","Sale","Disc%","DiscType","Delivery(Dhaka)","Delivery(Outside)","M_Left","L_Left","XL_Left","XXL_Left","Status","Image4","Image5","Image6","CouponActive","CouponCode","CouponDisc"],C.GREEN);var cond='INVENTORY!AM2:AM="Active",INVENTORY!A2:A<>""';sh.getRange("A2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!C2:C,'+cond+'),"")');sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!D2:D,'+cond+'),"")');sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!E2:E,'+cond+'),"")');sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!F2:F,'+cond+'),"")');sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!J2:J,'+cond+'),"")');sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!K2:K,'+cond+'),"")');sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');sh.getRange("M2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');sh.getRange("N2").setFormula('=IFERROR(FILTER(INVENTORY!O2:O,'+cond+'),"")');sh.getRange("O2").setFormula('=IFERROR(FILTER(INVENTORY!P2:P,'+cond+'),"")');sh.getRange("P2").setFormula('=IFERROR(FILTER(INVENTORY!Q2:Q,'+cond+'),"")');sh.getRange("Q2").setFormula('=IFERROR(FILTER(INVENTORY!R2:R,'+cond+'),"")');sh.getRange("R2").setFormula('=IFERROR(FILTER(INVENTORY!S2:S-INVENTORY!W2:W,'+cond+'),"")');sh.getRange("S2").setFormula('=IFERROR(FILTER(INVENTORY!T2:T-INVENTORY!X2:X,'+cond+'),"")');sh.getRange("T2").setFormula('=IFERROR(FILTER(INVENTORY!U2:U-INVENTORY!Y2:Y,'+cond+'),"")');sh.getRange("U2").setFormula('=IFERROR(FILTER(INVENTORY!V2:V-INVENTORY!Z2:Z,'+cond+'),"")');sh.getRange("V2").setFormula('=IFERROR(FILTER(INVENTORY!AM2:AM,'+cond+'),"")');sh.getRange("W2").setFormula('=IFERROR(FILTER(INVENTORY!AN2:AN,'+cond+'),"")');sh.getRange("X2").setFormula('=IFERROR(FILTER(INVENTORY!AO2:AO,'+cond+'),"")');sh.getRange("Y2").setFormula('=IFERROR(FILTER(INVENTORY!AP2:AP,'+cond+'),"")');sh.getRange("Z2").setFormula('=IFERROR(FILTER(INVENTORY!AQ2:AQ,'+cond+'),"")');sh.getRange("AA2").setFormula('=IFERROR(FILTER(INVENTORY!AR2:AR,'+cond+'),"")');sh.getRange("AB2").setFormula('=IFERROR(FILTER(INVENTORY!AS2:AS,'+cond+'),"")');_safeRowHeights(sh,2,499,32);}
function _setupOrders(){var sh=_ss().getSheetByName("ORDERS");sh.clear();_ensureRows(sh,2000);_hdr(sh,["📅 Date","🆔 Order ID","👤 Customer","📱 Phone","🏠 Address","📍 Location","📦 Product","📐 Size","🔢 Qty","💰 Price","🚚 Delivery","💵 Total","💳 Payment","📊 Status","🚀 Courier","📝 Notes"],C.BLUE);sh.getRange("A2:A2000").setNumberFormat("dd/MM/yy hh:mm");sh.getRange("H2:H2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["M","L","XL","XXL"],true).build());sh.getRange("M2:M2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["COD","bKash","Nagad","Rocket","Bank","Paid"],true).build());sh.getRange("N2:N2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Pending","Processing","Shipped","Delivered","Cancelled","Returned"],true).build());sh.getRange("O2:O2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["SteadFast","Pathao","Redex","PaperFly","ParcelDex","CarryBee","Self Delivery","Other"],true).setAllowInvalid(true).build());_safeRowHeights(sh,2,1999,32);}
function _setupWebsiteOrders(){var sh=_ss().getSheetByName("Website_Orders");if(!sh)sh=_ss().insertSheet("Website_Orders");sh.clear();_ensureRows(sh,2000);_hdr(sh,["🆔 Order ID","📅 Date & Time","👤 Customer","📱 Phone","📧 Email","🏠 Address","📍 Location","🌐 City/Area","📦 Product","📐 Size","🔢 Qty","💰 Unit Price","🚚 Delivery ৳","💵 Total","💳 Payment","📊 Status","🚀 Courier","📝 Notes","🔗 Source"],"#7C3AED");sh.getRange("B2:B2000").setNumberFormat("dd/MM/yy hh:mm:ss");sh.getRange("L2:N2000").setNumberFormat("#,##0");sh.getRange("P2:P2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled","Returned"],true).build());sh.getRange("Q2:Q2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["SteadFast","Pathao","Redex","PaperFly","ParcelDex","CarryBee","Self Delivery","Other"],true).setAllowInvalid(true).build());var rules=[];rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Pending").setBackground("#FEF3C7").setFontColor("#92400E").setRanges([sh.getRange("P2:P2000")]).build());rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Confirmed").setBackground("#DBEAFE").setFontColor("#1E40AF").setRanges([sh.getRange("P2:P2000")]).build());rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Delivered").setBackground("#D1FAE5").setFontColor("#065F46").setRanges([sh.getRange("P2:P2000")]).build());rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Cancelled").setBackground("#FEE2E2").setFontColor("#991B1B").setRanges([sh.getRange("P2:P2000")]).build());sh.setConditionalFormatRules(rules);sh.setColumnWidth(1,130);sh.setColumnWidth(2,150);sh.setColumnWidth(3,150);sh.setColumnWidth(4,130);sh.setColumnWidth(5,180);sh.setColumnWidth(6,220);sh.setColumnWidth(7,100);sh.setColumnWidth(8,120);sh.setColumnWidth(9,180);_safeRowHeights(sh,2,1999,32);}
function _setupTransactions(){var sh=_ss().getSheetByName("TRANSACTIONS");sh.clear();_ensureRows(sh,5000);_hdr(sh,["📅 Date","📦 Product","📋 Type","📐 Size","🔢 Qty","💰 Revenue","💵 Cost","📊 Profit"],C.PURPLE);sh.getRange("A2:A5000").setNumberFormat("dd/MM/yy hh:mm");_safeRowHeights(sh,2,4999,32);}
function _setupAdTracker(){var sh=_ss().getSheetByName("AD_TRACKER");sh.clear();_ensureRows(sh,2000);_hdr(sh,["📅 Date","📦 Product","💰 Amount","📢 Campaign","📝 Notes"],C.BLUE);sh.getRange("A2:A2000").setNumberFormat("dd/MM/yyyy");_safeRowHeights(sh,2,1999,32);}
function _setupExpenses(){var sh=_ss().getSheetByName("EXPENSES");sh.clear();_ensureRows(sh,2000);_hdr(sh,["📅 Date","📋 Category","💰 Amount","📝 Description","👤 Paid To"],C.RED);sh.getRange("A2:A2000").setNumberFormat("dd/MM/yyyy");sh.getRange("B2:B2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Courier","Packaging","Office","Electricity","Internet","Rent","Salary","Transport","Marketing","Supplier","Other"],true).build());_safeRowHeights(sh,2,1999,32);}
function _setupMonthlyReport(){var sh=_ss().getSheetByName("MONTHLY_REPORT");sh.clear();_hdr(sh,["📅 Month","🛒 Orders","💰 Revenue","💵 Product Cost","📢 Ad Spend","📦 Other Exp","📊 Net Profit","📈 Margin%","🔄 Returns"],"#DB2777");}
function _setupYearlyReport(){var sh=_ss().getSheetByName("YEARLY_REPORT");sh.clear();_hdr(sh,["📅 Year","🛒 Orders","💰 Revenue","💵 Product Cost","📢 Ad Spend","📦 Other Exp","📊 Net Profit","📈 Margin%","🔄 Returns"],"#EA580C");}
function _setupSettings(){var sh=_ss().getSheetByName("SETTINGS");sh.clear();_ensureRows(sh,40);_hdr(sh,["⚙️ Setting","💡 Value","📝 Description"],C.PURPLE);var settings=[["Store Name","YARZ","স্টোরের নাম"],["Store Tagline","Premium Men's Fashion","ট্যাগলাইন"],["Brand Logo URL","","ব্র্যান্ড লোগো"],["Contact Phone","+8801XXXXXXXXX","ফোন"],["Contact Email","info@example.com","ইমেইল"],["Website URL","","ওয়েবসাইট"],["Facebook Page","","Facebook"],["Instagram","","Instagram"],["WhatsApp","+8801XXXXXXXXX","WhatsApp"],["YouTube","","YouTube"],["TikTok","","TikTok"],["Business Address","","ঠিকানা"],["Currency","৳","কারেন্সি"],["Country","Bangladesh","দেশ"],["Default Delivery (Dhaka)","60","ডেলিভারি"],["Default Delivery (Outside)","120","ডেলিভারি"],["Default Delivery Days","2-3 days","দিন"],["Free Delivery Minimum","2000","limit"],["Return Policy Days","7","policy"],["Return Policy Description","7 দিনের মধ্যে রিটার্ন","বিস্তারিত"],["Shipping Policy","ঢাকায় ২-৩ দিন, বাইরে ৩-৫ দিন","শিপিং"],["Low Stock Threshold","5","low stock alert"],["Tax Rate","0","ট্যাক্স"],["Payment Methods","COD, bKash, Nagad","পেমেন্ট"],["Custom Categories",DEFAULT_CATEGORY_LIST.join(", "),"কমা দিয়ে edit"],["Custom Fabrics",DEFAULT_FABRIC_LIST.join(", "),"কমা দিয়ে edit"],["Custom Badges",DEFAULT_BADGE_LIST.join(", "),"কমা দিয়ে edit"],["GitHub Token","","token"],["GitHub Owner","","owner"],["GitHub Repo","","repo"],["GitHub Branch","main","branch"],["GitHub File Path","data/products.json","path"],["GitHub Auto Sync","No","Yes/No"]];sh.getRange(2,1,settings.length,3).setValues(settings);sh.setColumnWidth(1,240);sh.setColumnWidth(2,300);sh.setColumnWidth(3,320);}
function _setupActivity(){var sh=_ss().getSheetByName("_ACTIVITY");sh.clear();_ensureRows(sh,5000);_hdr(sh,["📅 Date","📦 Product","🔄 Old Status","⚡ New Status"],C.GRAY);sh.getRange("A2:A5000").setNumberFormat("dd/MM/yy hh:mm");}


// ===== INVENTORY STUDIO =====
function openInventoryStudio(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;var active=0,draft=0,totalRevenue=0,totalNet=0;if(lr>=2){var data=inv.getRange(2,COL.STATUS,lr-1,1).getValues().flat();data.forEach(function(s){if(s==="Active")active++;else if(s==="Draft")draft++;});try{var revData=inv.getRange(2,COL.REVENUE,lr-1,1).getValues().flat();var netData=inv.getRange(2,COL.NET,lr-1,1).getValues().flat();revData.forEach(function(v){totalRevenue+=_num(v);});netData.forEach(function(v){totalNet+=_num(v);});}catch(e){}}var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🎛️</span><h1>YARZ PRO v8.1</h1><span class="badge">Dashboard</span></div><div class="grid4" style="margin-bottom:12px"><div class="stat-card"><div class="lbl">Active</div><div class="val stat-green">'+active+'</div></div><div class="stat-card"><div class="lbl">Draft</div><div class="val stat-amber">'+draft+'</div></div><div class="stat-card"><div class="lbl">Revenue</div><div class="val stat-blue" style="font-size:13px">৳'+Math.round(totalRevenue).toLocaleString()+'</div></div><div class="stat-card"><div class="lbl">Net</div><div class="val '+(totalNet>=0?'stat-green':'stat-red')+'" style="font-size:13px">৳'+Math.round(totalNet).toLocaleString()+'</div></div></div><div class="section-title">⚡ Inventory Tools</div><div class="launcher-grid"><div class="tool" onclick="go(\'openProductForm\')"><span class="icon">📦</span><div class="label">Quick Add</div><div class="sub">নতুন প্রোডাক্ট</div></div><div class="tool" onclick="go(\'openProductEditSearch\')"><span class="icon">✏️</span><div class="label">Product Edit</div></div><div class="tool" onclick="go(\'openProductAnalytics\')"><span class="icon">📊</span><div class="label">Analytics</div></div><div class="tool" onclick="go(\'openStockManager\')"><span class="icon">📉</span><div class="label">Stock Manager</div></div><div class="tool" onclick="go(\'openBulkEditor\')"><span class="icon">🗂️</span><div class="label">Bulk Editor</div></div><div class="tool" onclick="go(\'openSmartSearch\')"><span class="icon">🔍</span><div class="label">Smart Search</div></div><div class="tool" onclick="go(\'openLowStockAlert\')"><span class="icon">⚠️</span><div class="label">Low Stock</div></div><div class="tool" onclick="go(\'openQuickStatusUpdate\')"><span class="icon">⚡</span><div class="label">Status Update</div></div></div><div class="section-title">🛒 Orders & Entry</div><div class="launcher-grid"><div class="tool" onclick="go(\'openOrderForm\')"><span class="icon">🛒</span><div class="label">New Order</div></div><div class="tool" onclick="go(\'openOrderSearch\')"><span class="icon">🔎</span><div class="label">Order Search</div></div><div class="tool" onclick="go(\'openWebsiteOrdersView\')"><span class="icon">🌐</span><div class="label">Website Orders</div></div><div class="tool" onclick="go(\'openCustomerSearch\')"><span class="icon">👤</span><div class="label">Customer</div></div><div class="tool" onclick="go(\'openAdForm\')"><span class="icon">📢</span><div class="label">Ad Spend</div></div><div class="tool" onclick="go(\'openExpenseForm\')"><span class="icon">💸</span><div class="label">Expense</div></div><div class="tool" onclick="go(\'openReturnForm\')"><span class="icon">↩️</span><div class="label">Return</div></div><div class="tool" onclick="go(\'openGitHubConnect\')"><span class="icon">🔗</span><div class="label">GitHub Connect</div></div></div><div class="section-title">📋 Reports</div><div class="launcher-grid"><div class="tool" onclick="go(\'generateMonthlyReport\')"><span class="icon">📅</span><div class="label">Monthly</div></div><div class="tool" onclick="go(\'generateYearlyReport\')"><span class="icon">📈</span><div class="label">Yearly</div></div></div></div>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(750);_ui().showModalDialog(out,"🎛️ Inventory Studio");}
// ===== QUICK ADD =====
function openProductForm(){var catOpts=_buildOptions(getCategoryList());var fabOpts=_buildOptions(getFabricList());var badOpts=_buildOptions(getBadgeList());var discOpts=_buildOptions(DISC_TYPE_LIST,"Normal");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📦</span><h1>Quick Add Product</h1></div><div class="field"><label>প্রোডাক্ট নাম<span class="req">*</span></label><input id="name" class="input" autofocus></div><div class="row"><div class="field"><label>Category</label><select id="cat" class="select">'+catOpts+'</select></div><div class="field"><label>Fabric</label><select id="fab" class="select">'+fabOpts+'</select></div></div><div class="row"><div class="field"><label>Badge</label><select id="bad" class="select">'+badOpts+'</select></div><div class="field"><label>Status<span class="req">*</span></label><select id="status" class="select"><option value="Draft">Draft</option><option value="Active">Active</option><option value="Archived">Archived</option></select></div></div><div class="row"><div class="field"><label>Disc Type</label><select id="dt" class="select">'+discOpts+'</select></div><div class="field"><label>Delivery Days</label><input id="ddays" class="input" value="2-3 days"></div></div><div class="section-title">🖼️ মিডিয়া</div><div class="field"><label>Image 1 URL</label><input id="img1" class="input"></div><div class="row"><div class="field"><label>Image 2</label><input id="img2" class="input"></div><div class="field"><label>Image 3</label><input id="img3" class="input"></div></div><div class="row"><div class="field"><label>Image 4</label><input id="img4" class="input"></div><div class="field"><label>Image 5</label><input id="img5" class="input"></div><div class="field"><label>Image 6</label><input id="img6" class="input"></div></div><div class="field"><label>Video URL</label><input id="vid" class="input"></div><div class="section-title">📝 বিবরণ</div><div class="field"><label>Description</label><textarea id="desc" class="textarea"></textarea></div><div class="field"><label>Size Chart</label><textarea id="sc" class="textarea" style="min-height:50px"></textarea></div><div class="section-title">💰 মূল্য</div><div class="row"><div class="field"><label>Cost ৳<span class="req">*</span></label><input id="cost" type="number" class="input"></div><div class="field"><label>Regular ৳<span class="req">*</span></label><input id="reg" type="number" class="input"></div><div class="field"><label>Sale ৳<span class="req">*</span></label><input id="sale" type="number" class="input"></div></div><div class="section-title">🚚 ডেলিভারি</div><div class="row"><div class="field"><label>Dhaka ৳</label><input id="din" type="number" class="input" value="60"></div><div class="field"><label>Outside ৳</label><input id="dout" type="number" class="input" value="120"></div></div><div class="section-title">📊 স্টক</div><div class="row"><div class="field"><label>M</label><input id="sM" type="number" class="input" value="0"></div><div class="field"><label>L</label><input id="sL" type="number" class="input" value="0"></div><div class="field"><label>XL</label><input id="sXL" type="number" class="input" value="0"></div><div class="field"><label>XXL</label><input id="sXXL" type="number" class="input" value="0"></div></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖ বাতিল</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 সেভ করো</button></div></div><script>function save(){if(!validateRequired(["name","cost","reg","sale"]))return;setLoading("saveBtn",true);var d={name:$("name").value.trim(),cat:$("cat").value,fab:$("fab").value,bad:$("bad").value,status:$("status").value,dt:$("dt").value,img1:$("img1").value.trim(),img2:$("img2").value.trim(),img3:$("img3").value.trim(),img4:($("img4")?$("img4").value.trim():""),img5:($("img5")?$("img5").value.trim():""),img6:($("img6")?$("img6").value.trim():""),vid:$("vid").value.trim(),desc:$("desc").value,sc:$("sc").value,cost:parseFloat($("cost").value)||0,reg:parseFloat($("reg").value)||0,sale:parseFloat($("sale").value)||0,din:parseFloat($("din").value)||60,dout:parseFloat($("dout").value)||120,ddays:$("ddays").value,sM:parseInt($("sM").value)||0,sL:parseInt($("sL").value)||0,sXL:parseInt($("sXL").value)||0,sXXL:parseInt($("sXXL").value)||0};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("প্রোডাক্ট সেভ হয়েছে!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).withFailureHandler(function(e){setLoading("saveBtn",false);showError(e.message);}).saveProductFromForm(d);}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(820);_ui().showModalDialog(out,"📦 Quick Add");}
function saveProductFromForm(d){try{var ss=_ss();var inv=ss.getSheetByName("INVENTORY");if(!inv)return{ok:false,msg:"INVENTORY নেই"};if(!d.name)return{ok:false,msg:"নাম দরকার"};var lr=_getActualLastRow(inv,1);if(lr>=2){var names=inv.getRange(2,1,lr-1,1).getValues().flat();if(names.indexOf(d.name)!==-1)return{ok:false,msg:"এই নামে already আছে"};}var row=lr+1;_ensureRows(inv,row);inv.getRange(row,COL.NAME).setValue(d.name);inv.getRange(row,COL.IMG).setValue(d.img1);inv.getRange(row,COL.IMG2).setValue(d.img2);inv.getRange(row,COL.IMG3).setValue(d.img3);inv.getRange(row,COL.IMG4).setValue(d.img4||"");inv.getRange(row,COL.IMG5).setValue(d.img5||"");inv.getRange(row,COL.IMG6).setValue(d.img6||"");inv.getRange(row,COL.VIDEO).setValue(d.vid);inv.getRange(row,COL.DESC).setValue(d.desc);inv.getRange(row,COL.CATEGORY).setValue(d.cat);inv.getRange(row,COL.FABRIC).setValue(d.fab);inv.getRange(row,COL.BADGE).setValue(d.bad);inv.getRange(row,COL.SIZE_CHART).setValue(d.sc);inv.getRange(row,COL.DELIVERY_DAYS).setValue(d.ddays);inv.getRange(row,COL.COST).setValue(d.cost);inv.getRange(row,COL.REG).setValue(d.reg);inv.getRange(row,COL.SALE).setValue(d.sale);inv.getRange(row,COL.DISC_TYPE).setValue(d.dt||"Normal");inv.getRange(row,COL.DELIVERY_IN).setValue(d.din);inv.getRange(row,COL.DELIVERY_OUT).setValue(d.dout);inv.getRange(row,COL.STK_M).setValue(d.sM);inv.getRange(row,COL.STK_L).setValue(d.sL);inv.getRange(row,COL.STK_XL).setValue(d.sXL);inv.getRange(row,COL.STK_XXL).setValue(d.sXXL);inv.getRange(row,COL.SOLD_M).setValue(0);inv.getRange(row,COL.SOLD_L).setValue(0);inv.getRange(row,COL.SOLD_XL).setValue(0);inv.getRange(row,COL.SOLD_XXL).setValue(0);inv.getRange(row,COL.UPDATED).setValue(new Date());inv.getRange(row,COL.C_ACT).setValue(d.cAct||"No");inv.getRange(row,COL.C_CODE).setValue(d.cCode||"");inv.getRange(row,COL.C_DISC).setValue(d.cDisc||0);var status=d.status||"Draft";inv.getRange(row,COL.STATUS).setValue(status);_restoreInventoryFormulas(inv);_logActivity(d.name,"",status);return{ok:true};}catch(err){return{ok:false,msg:err.message};}}
// ===== QUICK STATUS UPDATE =====
function openQuickStatusUpdate(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",status:r[COL.STATUS-1]||""};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">⚡</span><h1>Quick Status Update</h1></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="প্রোডাক্ট খুঁজুন..." oninput="render()" autofocus></div><div id="list" class="list"></div></div><script>var LIST='+json+';function chipClr(s){return s==="Active"?"chip-green":s==="Draft"?"chip-amber":"chip-gray";}function render(){var q=($("q").value||"").toLowerCase().trim();var h="";LIST.forEach(function(x,i){if(q&&(x.name+" "+x.cat).toLowerCase().indexOf(q)===-1)return;var img=x.img?"background-image:url(\'"+x.img+"\')":"";h+=\'<div class="list-item"><div class="thumb" style="\'+img+\'">\'+(x.img?"":"📦")+\'</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub"><span class="chip \'+chipClr(x.status)+\'">\'+x.status+\'</span></div></div><div class="li-right"><select class="select" style="width:100px;padding:4px 6px;font-size:11px" onchange="upd(\'+i+\',this.value)"><option value="">- Change -</option><option value="Active">Active</option><option value="Draft">Draft</option><option value="Archived">Archived</option></select></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🔍</div>নেই</div>\';}function upd(i,newSt){if(!newSt)return;var name=LIST[i].name;google.script.run.withSuccessHandler(function(r){if(r&&r.ok){LIST[i].status=newSt;toast(name+" → "+newSt,"success");render();}else showError(r&&r.msg);}).updateProductStatus({name:name,status:newSt});}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(640);_ui().showModalDialog(out,"⚡ Quick Status Update");}
function updateProductStatus(d){try{var inv=_ss().getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(d.name);if(idx===-1)return{ok:false,msg:"Not found"};var row=idx+2;var old=inv.getRange(row,COL.STATUS).getValue();inv.getRange(row,COL.STATUS).setValue(d.status);inv.getRange(row,COL.UPDATED).setValue(new Date());_logActivity(d.name,old,d.status);return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
// ===== WEBSITE ORDERS VIEW =====
function openWebsiteOrdersView(){var ss=_ss();var wos=ss.getSheetByName("Website_Orders");if(!wos){_setupWebsiteOrders();wos=ss.getSheetByName("Website_Orders");}var lr=wos?_getActualLastRow(wos,1):1;if(lr<2){_ui().alert("এখনো কোনো Website Order আসেনি!");ss.setActiveSheet(wos);return;}var data=wos.getRange(2,1,lr-1,19).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{oid:String(_safe(r[0])),date:r[1]?Utilities.formatDate(new Date(r[1]),Session.getScriptTimeZone(),"dd/MM/yy HH:mm"):"",name:String(_safe(r[2])),phone:String(_safe(r[3])),email:String(_safe(r[4])),product:String(_safe(r[8])),size:String(_safe(r[9])),qty:_int(r[10]),total:_num(r[13]),payment:String(_safe(r[14])),status:String(_safe(r[15])),courier:String(_safe(r[16]))};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar" style="background:linear-gradient(135deg,#7C3AED,#5B21B6)"><span style="font-size:22px">🌐</span><h1>Website Orders</h1><span class="badge">'+items.length+'</span></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Order ID বা Phone..." oninput="render()" autofocus><span class="search-count" id="cnt">'+items.length+'</span></div><div id="list" class="list" style="max-height:500px"></div></div><script>var LIST='+json+';var SC={Pending:"chip-amber",Confirmed:"chip-blue",Processing:"chip-blue",Shipped:"chip-blue",Delivered:"chip-green",Cancelled:"chip-red",Returned:"chip-red"};function render(){var q=($("q").value||"").toLowerCase().trim();var h="";var n=0;LIST.forEach(function(x){if(q&&(x.oid+x.phone+x.name).toLowerCase().indexOf(q)===-1)return;n++;var sc=SC[x.status]||"chip";h+=\'<div class="list-item"><div class="thumb" style="font-size:20px;background:#EDE9FE">🌐</div><div class="li-body"><div class="li-title">#\'+x.oid+\' — \'+x.name+\'</div><div class="li-sub">📱\'+x.phone+\' • 📦\'+x.product+\' (\'+x.size+\'×\'+x.qty+\')</div><div class="li-sub">📅\'+x.date+\' • \'+x.payment+(x.courier?" • 🚀"+x.courier:"")+\'</div></div><div class="li-right"><div class="price">৳\'+x.total.toLocaleString()+\'</div><span class="chip \'+sc+\'">\'+x.status+\'</span></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🌐</div>কোনো মিল নেই</div>\';$("cnt").textContent=n;}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(680);_ui().showModalDialog(out,"🌐 Website Orders");}


// ===== PRODUCT EDIT SEARCH =====
function openProductEditSearch(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",sale:_num(r[COL.SALE-1]),status:r[COL.STATUS-1]||""};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">✏️</span><h1>Product Edit</h1><span class="badge">'+items.length+'</span></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="প্রোডাক্ট খুঁজুন..." oninput="render()" autofocus><span class="search-count" id="cnt">'+items.length+'</span></div><div id="list" class="list"></div></div><script>var LIST='+json+';function chipClr(s){return s==="Active"?"chip-green":s==="Draft"?"chip-amber":"chip-gray";}function render(){var q=($("q").value||"").toLowerCase().trim();var h="";var n=0;LIST.forEach(function(x){if(q&&x.name.toLowerCase().indexOf(q)===-1)return;n++;var img=x.img?"background-image:url(\'"+x.img+"\')":"";h+=\'<div class="list-item"><div class="thumb" style="\'+img+\'">\'+(x.img?"":"📦")+\'</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub"><span class="chip \'+chipClr(x.status)+\'">\'+x.status+\'</span> \'+x.cat+\'</div></div><div class="li-right"><div class="price">৳\'+x.sale+\'</div><button class="edit-btn" style="margin-top:5px" onclick="edit(\\\'\'+x.name.replace(/\'/g,"&apos;")+\'\\\')">✏ Edit</button></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🔍</div>নেই</div>\';$("cnt").textContent=n+"/"+LIST.length;}function edit(name){google.script.run.openProductEditForm(name);}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(640);_ui().showModalDialog(out,"✏️ Product Edit");}
function openProductEditForm(productName){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);if(lr<2){_ui().alert("Not found");return;}var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(productName);if(idx===-1){_ui().alert("পাওয়া যায়নি!");return;}var row=idx+2;var r=inv.getRange(row,1,1,COL.TOTAL+10).getValues()[0];var p={name:r[COL.NAME-1],img1:r[COL.IMG-1]||"",img2:r[COL.IMG2-1]||"",img3:r[COL.IMG3-1]||"",img4:r[COL.IMG4-1]||"",img5:r[COL.IMG5-1]||"",img6:r[COL.IMG6-1]||"",vid:r[COL.VIDEO-1]||"",desc:r[COL.DESC-1]||"",cat:r[COL.CATEGORY-1]||"",fab:r[COL.FABRIC-1]||"",bad:r[COL.BADGE-1]||"",sc:r[COL.SIZE_CHART-1]||"",ddays:r[COL.DELIVERY_DAYS-1]||"2-3 days",cost:_num(r[COL.COST-1]),reg:_num(r[COL.REG-1]),sale:_num(r[COL.SALE-1]),dt:r[COL.DISC_TYPE-1]||"Normal",din:_num(r[COL.DELIVERY_IN-1])||60,dout:_num(r[COL.DELIVERY_OUT-1])||120,sM:_int(r[COL.STK_M-1]),sL:_int(r[COL.STK_L-1]),sXL:_int(r[COL.STK_XL-1]),sXXL:_int(r[COL.STK_XXL-1]),status:r[COL.STATUS-1]||"Draft"};var catOpts=_buildOptions(getCategoryList(),p.cat);var fabOpts=_buildOptions(getFabricList(),p.fab);var badOpts=_buildOptions(getBadgeList(),p.bad);var discOpts=_buildOptions(DISC_TYPE_LIST,p.dt);var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">✏️</span><h1>Edit: '+p.name.substring(0,20)+'</h1></div><div class="field"><label>নাম<span class="req">*</span></label><input id="name" class="input" value="'+p.name.replace(/"/g,'&quot;')+'"></div><div class="row"><div class="field"><label>Category</label><select id="cat" class="select">'+catOpts+'</select></div><div class="field"><label>Fabric</label><select id="fab" class="select">'+fabOpts+'</select></div></div><div class="row"><div class="field"><label>Badge</label><select id="bad" class="select">'+badOpts+'</select></div><div class="field"><label>Status</label><select id="status" class="select"><option value="Active"'+(p.status==="Active"?" selected":"")+'>Active</option><option value="Draft"'+(p.status==="Draft"?" selected":"")+'>Draft</option><option value="Archived"'+(p.status==="Archived"?" selected":"")+'>Archived</option></select></div></div><div class="row"><div class="field"><label>Disc Type</label><select id="dt" class="select">'+discOpts+'</select></div><div class="field"><label>Days</label><input id="ddays" class="input" value="'+p.ddays+'"></div></div><div class="section-title">🖼️ মিডিয়া</div><div class="field"><label>Image 1</label><input id="img1" class="input" value="'+p.img1.replace(/"/g,'&quot;')+'"></div><div class="row"><div class="field"><label>Image 2</label><input id="img2" class="input" value="'+p.img2.replace(/"/g,'&quot;')+'"></div><div class="field"><label>Image 3</label><input id="img3" class="input" value="'+p.img3.replace(/"/g,'&quot;')+'"></div></div><div class="row"><div class="field"><label>Image 4</label><input id="img4" class="input" value="'+p.img4.replace(/"/g,'&quot;')+'"></div><div class="field"><label>Image 5</label><input id="img5" class="input" value="'+p.img5.replace(/"/g,'&quot;')+'"></div><div class="field"><label>Image 6</label><input id="img6" class="input" value="'+p.img6.replace(/"/g,'&quot;')+'"></div></div><div class="field"><label>Video</label><input id="vid" class="input" value="'+p.vid.replace(/"/g,'&quot;')+'"></div><div class="section-title">📝 বিবরণ</div><div class="field"><label>Description</label><textarea id="desc" class="textarea">'+p.desc.replace(/</g,'&lt;')+'</textarea></div><div class="field"><label>Size Chart</label><textarea id="sc" class="textarea" style="min-height:50px">'+p.sc.replace(/</g,'&lt;')+'</textarea></div><div class="section-title">💰 মূল্য</div><div class="row"><div class="field"><label>Cost ৳</label><input id="cost" type="number" class="input" value="'+p.cost+'"></div><div class="field"><label>Regular ৳</label><input id="reg" type="number" class="input" value="'+p.reg+'"></div><div class="field"><label>Sale ৳</label><input id="sale" type="number" class="input" value="'+p.sale+'"></div></div><div class="section-title">🚚 ডেলিভারি</div><div class="row"><div class="field"><label>Dhaka ৳</label><input id="din" type="number" class="input" value="'+p.din+'"></div><div class="field"><label>Outside ৳</label><input id="dout" type="number" class="input" value="'+p.dout+'"></div></div><div class="section-title">📊 স্টক</div><div class="row"><div class="field"><label>M</label><input id="sM" type="number" class="input" value="'+p.sM+'"></div><div class="field"><label>L</label><input id="sL" type="number" class="input" value="'+p.sL+'"></div><div class="field"><label>XL</label><input id="sXL" type="number" class="input" value="'+p.sXL+'"></div><div class="field"><label>XXL</label><input id="sXXL" type="number" class="input" value="'+p.sXXL+'"></div></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.run.openProductEditSearch()">← Back</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Update</button></div></div><script>var ORIG_NAME="'+productName.replace(/"/g,'\\"')+'";function save(){if(!validateRequired(["name"]))return;setLoading("saveBtn",true);var d={origName:ORIG_NAME,name:$("name").value.trim(),cat:$("cat").value,fab:$("fab").value,bad:$("bad").value,status:$("status").value,dt:$("dt").value,img1:$("img1").value.trim(),img2:$("img2").value.trim(),img3:$("img3").value.trim(),img4:($("img4")?$("img4").value.trim():""),img5:($("img5")?$("img5").value.trim():""),img6:($("img6")?$("img6").value.trim():""),vid:$("vid").value.trim(),desc:$("desc").value,sc:$("sc").value,cost:parseFloat($("cost").value)||0,reg:parseFloat($("reg").value)||0,sale:parseFloat($("sale").value)||0,din:parseFloat($("din").value)||60,dout:parseFloat($("dout").value)||120,ddays:$("ddays").value,sM:parseInt($("sM").value)||0,sL:parseInt($("sL").value)||0,sXL:parseInt($("sXL").value)||0,sXXL:parseInt($("sXXL").value)||0};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Updated!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).withFailureHandler(function(e){setLoading("saveBtn",false);showError(e.message);}).saveProductEditFromForm(d);}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(840);_ui().showModalDialog(out,"✏️ Edit: "+productName);}
function saveProductEditFromForm(d){try{var ss=_ss();var inv=ss.getSheetByName("INVENTORY");if(!inv)return{ok:false,msg:"INVENTORY নেই"};var lr=_getActualLastRow(inv,1);if(lr<2)return{ok:false,msg:"নেই"};var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(d.origName);if(idx===-1)return{ok:false,msg:"পাওয়া যায়নি"};var row=idx+2;var oldStatus=inv.getRange(row,COL.STATUS).getValue();inv.getRange(row,COL.NAME).setValue(d.name);inv.getRange(row,COL.IMG).setValue(d.img1);inv.getRange(row,COL.IMG2).setValue(d.img2);inv.getRange(row,COL.IMG3).setValue(d.img3);inv.getRange(row,COL.IMG4).setValue(d.img4||"");inv.getRange(row,COL.IMG5).setValue(d.img5||"");inv.getRange(row,COL.IMG6).setValue(d.img6||"");inv.getRange(row,COL.VIDEO).setValue(d.vid);inv.getRange(row,COL.DESC).setValue(d.desc);inv.getRange(row,COL.CATEGORY).setValue(d.cat);inv.getRange(row,COL.FABRIC).setValue(d.fab);inv.getRange(row,COL.BADGE).setValue(d.bad);inv.getRange(row,COL.SIZE_CHART).setValue(d.sc);inv.getRange(row,COL.DELIVERY_DAYS).setValue(d.ddays);inv.getRange(row,COL.COST).setValue(d.cost);inv.getRange(row,COL.REG).setValue(d.reg);inv.getRange(row,COL.SALE).setValue(d.sale);inv.getRange(row,COL.DISC_TYPE).setValue(d.dt||"Normal");inv.getRange(row,COL.DELIVERY_IN).setValue(d.din);inv.getRange(row,COL.DELIVERY_OUT).setValue(d.dout);inv.getRange(row,COL.STK_M).setValue(d.sM);inv.getRange(row,COL.STK_L).setValue(d.sL);inv.getRange(row,COL.STK_XL).setValue(d.sXL);inv.getRange(row,COL.STK_XXL).setValue(d.sXXL);inv.getRange(row,COL.STATUS).setValue(d.status);inv.getRange(row,COL.UPDATED).setValue(new Date());inv.getRange(row,COL.C_ACT).setValue(d.cAct||"No");inv.getRange(row,COL.C_CODE).setValue(d.cCode||"");inv.getRange(row,COL.C_DISC).setValue(d.cDisc||0);_restoreInventoryFormulas(inv);if(oldStatus!==d.status)_logActivity(d.name,oldStatus,d.status);return{ok:true};}catch(err){return{ok:false,msg:err.message};}}


// ===== ANALYTICS =====
function openProductAnalytics(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",sale:_num(r[COL.SALE-1]),status:r[COL.STATUS-1]||"",sold:_num(r[COL.TOT_SOLD-1]),remaining:_num(r[COL.REMAINING-1])};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📊</span><h1>Product Analytics</h1><span class="badge">'+items.length+'</span></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="খুঁজুন..." oninput="render()" autofocus><span class="search-count" id="cnt">'+items.length+'</span></div><div id="list" class="list"></div></div><script>var LIST='+json+';function chipClr(s){return s==="Active"?"chip-green":s==="Draft"?"chip-amber":"chip-gray";}function render(){var q=($("q").value||"").toLowerCase().trim();var h="";var n=0;LIST.forEach(function(x){if(q&&(x.name+" "+x.cat).toLowerCase().indexOf(q)===-1)return;n++;var img=x.img?"background-image:url(\'"+x.img+"\')":"";h+=\'<div class="list-item"><div class="thumb" style="\'+img+\'">\'+(x.img?"":"📦")+\'</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub"><span class="chip \'+chipClr(x.status)+\'">\'+x.status+\'</span> Stock:\'+x.remaining+\' Sold:\'+x.sold+\'</div></div><button class="view-btn" onclick="view(\\\'\'+x.name.replace(/\'/g,"&apos;")+\'\\\')">👁 View</button></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🔍</div>নেই</div>\';$("cnt").textContent=n+"/"+LIST.length;}function view(name){google.script.run.openProductDetailModal(name);}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(660);_ui().showModalDialog(out,"📊 Analytics");}
function openProductDetailModal(productName){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(productName);if(idx===-1){_ui().alert("Not found");return;}var row=idx+2;var r=inv.getRange(row,1,1,COL.TOTAL).getValues()[0];var p={name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",fab:r[COL.FABRIC-1]||"",cost:_num(r[COL.COST-1]),sale:_num(r[COL.SALE-1]),stkM:_int(r[COL.STK_M-1]),stkL:_int(r[COL.STK_L-1]),stkXL:_int(r[COL.STK_XL-1]),stkXXL:_int(r[COL.STK_XXL-1]),soldM:_int(r[COL.SOLD_M-1]),soldL:_int(r[COL.SOLD_L-1]),soldXL:_int(r[COL.SOLD_XL-1]),soldXXL:_int(r[COL.SOLD_XXL-1]),totSold:_num(r[COL.TOT_SOLD-1]),returns:_num(r[COL.RETURNS-1]),remaining:_num(r[COL.REMAINING-1]),revenue:_num(r[COL.REVENUE-1]),fbAd:_num(r[COL.FB_AD-1]),net:_num(r[COL.NET-1]),status:r[COL.STATUS-1]||"",badge:r[COL.BADGE-1]||"",desc:r[COL.DESC-1]||"",sc:r[COL.SIZE_CHART-1]||"",vid:r[COL.VIDEO-1]||"",img2:r[COL.IMG2-1]||"",img3:r[COL.IMG3-1]||"",ddays:r[COL.DELIVERY_DAYS-1]||"",din:_num(r[COL.DELIVERY_IN-1]),dout:_num(r[COL.DELIVERY_OUT-1]),dt:r[COL.DISC_TYPE-1]||""};var netSold=p.totSold-p.returns;var totalSales=p.sale*netSold;var imgStyle=p.img?"background-image:url('"+p.img+"')":"";var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📈</span><h1>Product Details</h1><span class="badge">'+p.status+'</span></div><div class="card" style="display:flex;gap:12px;align-items:center"><div class="thumb" style="width:64px;height:64px;'+imgStyle+'">'+(p.img?"":"📦")+'</div><div style="flex:1"><div style="font-size:15px;font-weight:800">'+p.name+'</div><div style="font-size:11px;color:#6B7280;margin-top:3px">'+p.cat+' • '+p.fab+(p.badge?" • "+p.badge:"")+'</div><div style="margin-top:6px"><span class="chip chip-blue">৳'+p.sale+'</span> <span class="chip chip-gray">Cost ৳'+p.cost+'</span>'+(p.dt?' <span class="chip chip-amber">'+p.dt+'</span>':"")+'</div></div></div>';if(p.desc)html+='<div class="card"><b>📝 Description:</b><br>'+p.desc.replace(/</g,"&lt;")+'</div>';if(p.sc)html+='<div class="card"><b>📏 Size Chart:</b><br>'+p.sc.replace(/</g,"&lt;")+'</div>';if(p.vid)html+='<div class="card"><b>🎥 Video:</b> <a href="'+p.vid+'" target="_blank">Open Video</a></div>';html+='<div class="card"><b>🚚 Delivery:</b> Dhaka ৳'+p.din+' | Outside ৳'+p.dout+' | '+p.ddays+'</div>';html+='<div class="grid2"><div class="stat-card"><div class="lbl">Revenue</div><div class="val stat-blue">৳'+Math.round(totalSales).toLocaleString()+'</div></div><div class="stat-card"><div class="lbl">Net Profit</div><div class="val '+(p.net>=0?"stat-green":"stat-red")+'">৳'+Math.round(p.net).toLocaleString()+'</div></div><div class="stat-card"><div class="lbl">Sold</div><div class="val stat-green">'+p.totSold+'</div></div><div class="stat-card"><div class="lbl">Remaining</div><div class="val stat-amber">'+p.remaining+'</div></div></div><div class="card"><table class="data-table"><tr><th>Size</th><th>Stock</th><th>Sold</th><th>Left</th></tr><tr><td><b>M</b></td><td>'+p.stkM+'</td><td>'+p.soldM+'</td><td style="color:#059669;font-weight:700">'+(p.stkM-p.soldM)+'</td></tr><tr><td><b>L</b></td><td>'+p.stkL+'</td><td>'+p.soldL+'</td><td style="color:#059669;font-weight:700">'+(p.stkL-p.soldL)+'</td></tr><tr><td><b>XL</b></td><td>'+p.stkXL+'</td><td>'+p.soldXL+'</td><td style="color:#059669;font-weight:700">'+(p.stkXL-p.soldXL)+'</td></tr><tr><td><b>XXL</b></td><td>'+p.stkXXL+'</td><td>'+p.soldXXL+'</td><td style="color:#059669;font-weight:700">'+(p.stkXXL-p.soldXXL)+'</td></tr></table></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖ বন্ধ</button><button class="btn btn-blue" onclick="google.script.run.openProductEditForm(\''+productName.replace(/'/g,"\\'")+'\')">✏ Edit</button><button class="btn btn-primary" onclick="google.script.run.openProductAnalytics()">← Back</button></div></div>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(760);_ui().showModalDialog(out,"📈 "+p.name);}
// ===== STOCK MANAGER =====
function openStockManager(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",stkM:_int(r[COL.STK_M-1]),stkL:_int(r[COL.STK_L-1]),stkXL:_int(r[COL.STK_XL-1]),stkXXL:_int(r[COL.STK_XXL-1]),soldM:_int(r[COL.SOLD_M-1]),soldL:_int(r[COL.SOLD_L-1]),soldXL:_int(r[COL.SOLD_XL-1]),soldXXL:_int(r[COL.SOLD_XXL-1])};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📉</span><h1>Stock Manager</h1></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Search..." oninput="render()" autofocus></div><div id="list" class="list"></div><div id="editor" style="display:none"></div></div><script>var LIST='+json+';var active=null;function render(){var q=($("q").value||"").toLowerCase().trim();var h="";LIST.forEach(function(x,i){if(q&&(x.name+" "+x.cat).toLowerCase().indexOf(q)===-1)return;var left=(x.stkM+x.stkL+x.stkXL+x.stkXXL)-(x.soldM+x.soldL+x.soldXL+x.soldXXL);h+=\'<div class="list-item" onclick="edit(\'+i+\')"><div class="thumb">📦</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub">Left:\'+left+\' M:\'+(x.stkM-x.soldM)+\' L:\'+(x.stkL-x.soldL)+\' XL:\'+(x.stkXL-x.soldXL)+\' XXL:\'+(x.stkXXL-x.soldXXL)+\'</div></div><button class="edit-btn">✏</button></div>\';});$("list").innerHTML=h||\'<div class="empty">নেই</div>\';}function edit(i){active=LIST[i];$("list").style.display="none";$("editor").style.display="block";$("editor").innerHTML=\'<div class="card"><h3 style="margin:0 0 10px;color:#059669">\'+active.name+\'</h3><div class="hint" style="margin-bottom:10px">+5 = যোগ, -3 = কমানো</div><div class="row"><div class="field"><label>M (\'+active.stkM+\')</label><input id="aM" type="number" class="input" value="0"></div><div class="field"><label>L (\'+active.stkL+\')</label><input id="aL" type="number" class="input" value="0"></div></div><div class="row"><div class="field"><label>XL (\'+active.stkXL+\')</label><input id="aXL" type="number" class="input" value="0"></div><div class="field"><label>XXL (\'+active.stkXXL+\')</label><input id="aXXL" type="number" class="input" value="0"></div></div><div class="actions"><button class="btn btn-secondary" onclick="back()">← Back</button><button id="applyBtn" class="btn btn-primary" onclick="apply()">💾 Apply</button></div></div>\';}function back(){$("editor").style.display="none";$("list").style.display="block";}function apply(){setLoading("applyBtn",true);var d={name:active.name,dM:parseInt($("aM").value)||0,dL:parseInt($("aL").value)||0,dXL:parseInt($("aXL").value)||0,dXXL:parseInt($("aXXL").value)||0};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Stock Updated!");else{setLoading("applyBtn",false);showError(r&&r.msg);}}).applyStockChange(d);}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(660);_ui().showModalDialog(out,"📉 Stock Manager");}
function applyStockChange(d){try{var inv=_ss().getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(d.name);if(idx===-1)return{ok:false,msg:"Not found"};var row=idx+2;inv.getRange(row,COL.STK_M).setValue(Math.max(0,_int(inv.getRange(row,COL.STK_M).getValue())+d.dM));inv.getRange(row,COL.STK_L).setValue(Math.max(0,_int(inv.getRange(row,COL.STK_L).getValue())+d.dL));inv.getRange(row,COL.STK_XL).setValue(Math.max(0,_int(inv.getRange(row,COL.STK_XL).getValue())+d.dXL));inv.getRange(row,COL.STK_XXL).setValue(Math.max(0,_int(inv.getRange(row,COL.STK_XXL).getValue())+d.dXXL));inv.getRange(row,COL.UPDATED).setValue(new Date());return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
// ===== LOW STOCK =====
function openLowStockAlert(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("নেই!");return;}var settings=_getSettingsMap();var threshold=_int(settings["Low Stock Threshold"]||5);var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var lowItems=[];data.filter(function(r){return r[0]&&r[COL.STATUS-1]==="Active";}).forEach(function(r){var sizes=[{sz:"M",left:_int(r[COL.STK_M-1])-_int(r[COL.SOLD_M-1])},{sz:"L",left:_int(r[COL.STK_L-1])-_int(r[COL.SOLD_L-1])},{sz:"XL",left:_int(r[COL.STK_XL-1])-_int(r[COL.SOLD_XL-1])},{sz:"XXL",left:_int(r[COL.STK_XXL-1])-_int(r[COL.SOLD_XXL-1])}];var alerts=[];sizes.forEach(function(s){if(s.left<=0)alerts.push(s.sz+":⛔");else if(s.left<=threshold)alerts.push(s.sz+":"+s.left);});if(alerts.length)lowItems.push({name:r[COL.NAME-1],alerts:alerts});});var listHTML="";lowItems.forEach(function(x){listHTML+='<div class="list-item low-stock"><div class="thumb">⚠️</div><div class="li-body"><div class="li-title">'+x.name+'</div></div><div class="li-right">'+x.alerts.map(function(a){return'<span class="chip chip-amber">'+a+'</span>';}).join(" ")+'</div></div>';});var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">⚠️</span><h1>Low Stock Alert</h1><span class="badge">≤'+threshold+'</span></div>'+(lowItems.length?'<div class="alert-box">⚠️ '+lowItems.length+'টি প্রোডাক্টের stock কম</div><div class="list">'+listHTML+'</div>':'<div class="alert-green alert-box">✅ সব ঠিক আছে!</div>')+'<div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button class="btn btn-primary" onclick="go(\'openStockManager\')">📉 Stock Manager</button></div></div>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(600);_ui().showModalDialog(out,"⚠️ Low Stock");}
// ===== BULK EDITOR =====
function openBulkEditor(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],sale:_num(r[COL.SALE-1]),status:r[COL.STATUS-1]||""};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🗂️</span><h1>Bulk Editor</h1></div><div class="card"><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Search..." oninput="render()"></div><div style="display:flex;gap:10px;margin-bottom:8px"><button class="btn btn-secondary" style="padding:6px;font-size:11px" onclick="selAll()">✅ All</button><button class="btn btn-secondary" style="padding:6px;font-size:11px" onclick="selNone()">❌ None</button></div><div id="list" class="list" style="max-height:220px"></div><div class="hint" id="sel">0 selected</div></div><div class="card"><div class="field"><label>Status</label><select id="st" class="select"><option value="">— Skip —</option><option>Active</option><option>Draft</option><option>Archived</option></select></div><div class="row"><div class="field"><label>Discount %</label><input id="disc" type="number" class="input" placeholder="10"></div><div class="field"><label>Badge</label><select id="bd" class="select"><option value="">— Skip —</option>'+_buildOptions(getBadgeList())+'</select></div></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="applyBtn" class="btn btn-primary" onclick="apply()">💾 Apply</button></div></div></div><script>var LIST='+json+';var SEL={};function render(){var q=($("q").value||"").toLowerCase().trim();var h="";LIST.forEach(function(x,i){if(q&&x.name.toLowerCase().indexOf(q)===-1)return;var chk=SEL[i]?"checked":"";h+=\'<label style="display:flex;gap:10px;align-items:center;padding:8px;border:1px solid #E5E7EB;border-radius:10px;margin-bottom:6px;cursor:pointer"><input type="checkbox" onchange="tog(\'+i+\',this)" \'+chk+\'><div style="flex:1"><div style="font-size:13px;font-weight:700">\'+x.name+\'</div><div style="font-size:11px;color:#6B7280">\'+x.status+\' ৳\'+x.sale+\'</div></div></label>\';});$("list").innerHTML=h||\'<div class="empty">নেই</div>\';}function tog(i,el){SEL[i]=el.checked;updCount();}function updCount(){var c=0;for(var k in SEL)if(SEL[k])c++;$("sel").textContent=c+" selected";}function selAll(){LIST.forEach(function(x,i){SEL[i]=true;});render();updCount();}function selNone(){SEL={};render();updCount();}function apply(){var ids=[];for(var k in SEL)if(SEL[k])ids.push(LIST[k].name);if(!ids.length){toast("সিলেক্ট করুন","error");return;}setLoading("applyBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess(r.n+" updated!");else{setLoading("applyBtn",false);showError(r&&r.msg);}}).applyBulkEdit({names:ids,st:$("st").value,disc:parseFloat($("disc").value)||0,bd:$("bd").value});}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(700);_ui().showModalDialog(out,"🗂️ Bulk Editor");}
function applyBulkEdit(d){try{var inv=_ss().getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var n=0;d.names.forEach(function(name){var idx=names.indexOf(name);if(idx===-1)return;var row=idx+2;if(d.st){var old=inv.getRange(row,COL.STATUS).getValue();inv.getRange(row,COL.STATUS).setValue(d.st);if(old!==d.st)_logActivity(name,old,d.st);}if(d.bd)inv.getRange(row,COL.BADGE).setValue(d.bd);if(d.disc>0){var reg=_num(inv.getRange(row,COL.REG).getValue());inv.getRange(row,COL.SALE).setValue(Math.round(reg*(1-d.disc/100)));}inv.getRange(row,COL.UPDATED).setValue(new Date());n++;});_restoreInventoryFormulas(inv);return{ok:true,n:n};}catch(e){return{ok:false,msg:e.message};}}
// ===== SMART SEARCH =====
function openSmartSearch(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("নেই!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",fab:r[COL.FABRIC-1]||"",sale:_num(r[COL.SALE-1]),status:r[COL.STATUS-1]||"",remaining:_num(r[COL.REMAINING-1])};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var cats=["All"].concat(Array.from(new Set(items.map(function(x){return x.cat;}).filter(Boolean))));var fabs=["All"].concat(Array.from(new Set(items.map(function(x){return x.fab;}).filter(Boolean))));var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🔍</span><h1>Smart Search</h1></div><div class="card"><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Name..." oninput="render()" autofocus></div><div class="row"><div class="field"><label>Category</label><select id="c" class="select" onchange="render()">'+_buildOptions(cats)+'</select></div><div class="field"><label>Fabric</label><select id="f" class="select" onchange="render()">'+_buildOptions(fabs)+'</select></div></div><div class="row"><div class="field"><label>Min ৳</label><input id="pmin" type="number" class="input" oninput="render()"></div><div class="field"><label>Max ৳</label><input id="pmax" type="number" class="input" oninput="render()"></div><div class="field"><label>Status</label><select id="s" class="select" onchange="render()"><option>All</option><option>Active</option><option>Draft</option><option>Archived</option></select></div></div></div><div class="hint" id="cnt">0</div><div id="list" class="list"></div></div><script>var LIST='+json+';function chipClr(s){return s==="Active"?"chip-green":s==="Draft"?"chip-amber":"chip-gray";}function render(){var q=($("q").value||"").toLowerCase().trim();var c=$("c").value,f=$("f").value,s=$("s").value;var pmin=parseFloat($("pmin").value),pmax=parseFloat($("pmax").value);var h="";var n=0;LIST.forEach(function(x){if(q&&(x.name+" "+x.cat+" "+x.fab).toLowerCase().indexOf(q)===-1)return;if(c!=="All"&&x.cat!==c)return;if(f!=="All"&&x.fab!==f)return;if(s!=="All"&&x.status!==s)return;if(!isNaN(pmin)&&x.sale<pmin)return;if(!isNaN(pmax)&&x.sale>pmax)return;n++;var img=x.img?"background-image:url(\'"+x.img+"\')":"";h+=\'<div class="list-item"><div class="thumb" style="\'+img+\'">\'+(x.img?"":"📦")+\'</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub"><span class="chip \'+chipClr(x.status)+\'">\'+x.status+\'</span> Stock:\'+x.remaining+\'</div></div><div class="li-right"><div class="price">৳\'+x.sale+\'</div><button class="view-btn" style="margin-top:5px" onclick="google.script.run.openProductDetailModal(\\\'\'+x.name.replace(/\'/g,"&apos;")+\'\\\')">👁</button></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🔍</div>নেই</div>\';$("cnt").textContent=n+" results";}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(700);_ui().showModalDialog(out,"🔍 Smart Search");}


// ===== ORDER FORM =====
function openOrderForm(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;if(lr<2){_ui().alert("আগে প্রোডাক্ট যোগ করুন!");return;}var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();var products=data.filter(function(r){return r[0]&&r[COL.STATUS-1]==="Active";}).map(function(r){return{name:r[COL.NAME-1],sale:_num(r[COL.SALE-1]),din:_num(r[COL.DELIVERY_IN-1])||60,dout:_num(r[COL.DELIVERY_OUT-1])||120,cat:r[COL.CATEGORY-1]||""};});if(!products.length){_ui().alert("Active প্রোডাক্ট নেই!");return;}var json=JSON.stringify(products).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🛒</span><h1>New Order</h1></div><div class="field"><label>Order ID<span class="req">*</span></label><input id="oid" class="input" autofocus></div><div class="field"><label>Customer<span class="req">*</span></label><input id="cn" class="input"></div><div class="row"><div class="field"><label>ফোন<span class="req">*</span></label><input id="ph" class="input"></div><div class="field"><label>Location</label><select id="lo" class="select" onchange="calc()"><option>Dhaka</option><option>Outside</option></select></div></div><div class="field"><label>ঠিকানা<span class="req">*</span></label><textarea id="ad" class="textarea" style="min-height:50px"></textarea></div><div class="section-title">📦 প্রোডাক্ট</div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Search..." oninput="rnd()" onfocus="showList()"></div><div id="plist" class="list" style="max-height:150px"></div><div id="sel" style="display:none" class="card"></div><div class="row" style="margin-top:10px"><div class="field"><label>Size</label><select id="sz" class="select"><option>M</option><option>L</option><option>XL</option><option>XXL</option></select></div><div class="field"><label>Qty</label><input id="qt" type="number" class="input" value="1" onchange="calc()" min="1"></div></div><div class="row"><div class="field"><label>Payment</label><select id="pm" class="select"><option>COD</option><option>bKash</option><option>Nagad</option><option>Rocket</option><option>Bank</option><option>Paid</option></select></div><div class="field"><label>🚀 Courier</label><select id="cr" class="select"><option>SteadFast</option><option>Pathao</option><option>Redex</option><option>PaperFly</option><option>ParcelDex</option><option>CarryBee</option><option>Self Delivery</option><option>Other</option></select></div></div><div class="field"><label>Notes</label><input id="nt" class="input"></div><div class="card" style="background:#FEF3C7"><div style="display:flex;justify-content:space-between"><span>Subtotal:</span><b id="sb">৳0</b></div><div style="display:flex;justify-content:space-between"><span>Delivery:</span><b id="dl">৳0</b></div><div style="display:flex;justify-content:space-between;font-size:15px;margin-top:8px;padding-top:8px;border-top:1px dashed #D97706;color:#92400E"><span>TOTAL:</span><b id="tt">৳0</b></div></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">✅ সেভ</button></div></div><script>var PRODS='+json+';var picked=null;function rnd(){var q=($("q").value||"").toLowerCase();var h="";PRODS.forEach(function(p,i){if(q&&(p.name+" "+p.cat).toLowerCase().indexOf(q)===-1)return;h+=\'<div class="list-item" onclick="pk(\'+i+\')"><div class="thumb">📦</div><div class="li-body"><div class="li-title">\'+p.name+\'</div></div><div class="price">৳\'+p.sale+\'</div></div>\';});$("plist").innerHTML=h||\'<div class="empty">নেই</div>\';}function showList(){$("plist").style.display="";}function pk(i){picked=PRODS[i];$("sel").style.display="block";$("sel").innerHTML="✅ <b>"+picked.name+"</b> ৳"+picked.sale;$("plist").style.display="none";calc();}function calc(){if(!picked)return;var q=parseInt($("qt").value)||1;var s=picked.sale*q;var d=$("lo").value==="Dhaka"?picked.din:picked.dout;$("sb").textContent="৳"+s.toLocaleString();$("dl").textContent="৳"+d.toLocaleString();$("tt").textContent="৳"+(s+d).toLocaleString();}function save(){if(!picked){toast("প্রোডাক্ট সিলেক্ট করুন","error");return;}if(!validateRequired(["oid","cn","ph","ad"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Order সেভ!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).withFailureHandler(function(e){setLoading("saveBtn",false);showError(e.message);}).saveOrderFromForm({oid:$("oid").value,cn:$("cn").value,ph:$("ph").value,ad:$("ad").value,lo:$("lo").value,product:picked.name,size:$("sz").value,qty:parseInt($("qt").value)||1,price:picked.sale,delivery:$("lo").value==="Dhaka"?picked.din:picked.dout,pm:$("pm").value,courier:$("cr").value,notes:$("nt").value});}rnd();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(820);_ui().showModalDialog(out,"🛒 New Order");}
function saveOrderFromForm(d){try{var sh=_ss().getSheetByName("ORDERS");var total=(d.price*d.qty)+d.delivery;var next=_getActualLastRow(sh,1)+1;_ensureRows(sh,next);sh.getRange(next,1,1,16).setValues([[new Date(),d.oid,d.cn,d.ph,d.ad,d.lo,d.product,d.size,d.qty,d.price,d.delivery,total,d.pm,"Pending",d.courier||"",d.notes||""]]);return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
// ===== ORDER SEARCH =====
function openOrderSearch(){var ss=_ss();var orders=ss.getSheetByName("ORDERS");var lr=orders?_getActualLastRow(orders,1):1;if(lr<2){_ui().alert("কোনো অর্ডার নেই!");return;}var data=orders.getRange(2,1,lr-1,16).getValues();var items=data.filter(function(r){return r[1];}).map(function(r){return{date:r[0]?Utilities.formatDate(new Date(r[0]),Session.getScriptTimeZone(),"dd/MM/yy HH:mm"):"",oid:String(_safe(r[1])),name:String(_safe(r[2])),phone:String(_safe(r[3])),product:String(_safe(r[6])),size:String(_safe(r[7])),qty:_int(r[8]),total:_num(r[11]),payment:String(_safe(r[12])),status:String(_safe(r[13])),courier:String(_safe(r[14]))};});var json=JSON.stringify(items).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🔎</span><h1>Order Search</h1><span class="badge">'+items.length+'</span></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="Order ID, Phone, Name..." oninput="render()" autofocus><span class="search-count" id="cnt">0</span></div><div id="list" class="list"></div></div><script>var LIST='+json+';var SC={Pending:"chip-amber",Processing:"chip-blue",Shipped:"chip-blue",Delivered:"chip-green",Cancelled:"chip-red",Returned:"chip-red"};function render(){var q=($("q").value||"").toLowerCase().trim();if(q.length<2){$("list").innerHTML=\'<div class="empty"><div class="ei">🔍</div>২ অক্ষর দিন</div>\';$("cnt").textContent="0";return;}var h="";var n=0;LIST.forEach(function(x){if(x.oid.toLowerCase().indexOf(q)===-1&&x.phone.toLowerCase().indexOf(q)===-1&&x.name.toLowerCase().indexOf(q)===-1)return;n++;h+=\'<div class="list-item"><div class="thumb" style="font-size:20px;background:#F0FDF4">🛒</div><div class="li-body"><div class="li-title">#\'+x.oid+\' — \'+x.name+\'</div><div class="li-sub">📱\'+x.phone+\' • 📦\'+x.product+\' (\'+x.size+\'×\'+x.qty+\')</div><div class="li-sub">📅\'+x.date+\' • \'+x.payment+(x.courier?" • 🚀"+x.courier:"")+\'</div></div><div class="li-right"><div class="price">৳\'+x.total.toLocaleString()+\'</div><span class="chip \'+SC[x.status]+\'">\'+x.status+\'</span></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">🔍</div>নেই</div>\';$("cnt").textContent=n;}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(500).setHeight(660);_ui().showModalDialog(out,"🔎 Order Search");}
// ===== CUSTOMER SEARCH =====
function openCustomerSearch(){var ss=_ss();var orders=ss.getSheetByName("ORDERS");var lr=orders?_getActualLastRow(orders,1):1;if(lr<2){_ui().alert("অর্ডার নেই!");return;}var data=orders.getRange(2,1,lr-1,16).getValues();var custMap={};data.filter(function(r){return r[2];}).forEach(function(r){var phone=String(_safe(r[3]));if(!custMap[phone])custMap[phone]={name:String(_safe(r[2])),phone:phone,orders:0,total:0,lastDate:r[0]};custMap[phone].orders++;custMap[phone].total+=_num(r[11]);if(r[0]>custMap[phone].lastDate)custMap[phone].lastDate=r[0];});var customers=Object.values(custMap).sort(function(a,b){return b.total-a.total;});var json=JSON.stringify(customers.map(function(c){return{name:c.name,phone:c.phone,orders:c.orders,total:c.total,lastDate:c.lastDate?Utilities.formatDate(new Date(c.lastDate),Session.getScriptTimeZone(),"dd/MM/yy"):""};})).replace(/</g,"\\u003c");var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">👤</span><h1>Customer Search</h1><span class="badge">'+customers.length+'</span></div><div class="search-wrap"><span class="sicon">🔍</span><input id="q" class="input" placeholder="নাম বা ফোন..." oninput="render()" autofocus><span class="search-count" id="cnt">'+customers.length+'</span></div><div id="list" class="list"></div></div><script>var LIST='+json+';function render(){var q=($("q").value||"").toLowerCase().trim();var h="";var n=0;LIST.forEach(function(x){if(q&&(x.name+x.phone).toLowerCase().indexOf(q)===-1)return;n++;h+=\'<div class="list-item"><div class="thumb" style="background:#EDE9FE;font-size:22px">👤</div><div class="li-body"><div class="li-title">\'+x.name+\'</div><div class="li-sub">📱\'+x.phone+\' • Last: \'+x.lastDate+\'</div></div><div class="li-right"><div class="price">৳\'+x.total.toLocaleString()+\'</div><div style="font-size:11px;color:#6B7280">Orders: \'+x.orders+\'</div></div></div>\';});$("list").innerHTML=h||\'<div class="empty"><div class="ei">👤</div>নেই</div>\';$("cnt").textContent=n+"/"+LIST.length;}render();</script>';var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(640);_ui().showModalDialog(out,"👤 Customer");}
// ===== AD / EXPENSE / RETURN =====
function openAdForm(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;var products=lr>=2?inv.getRange(2,1,lr-1,1).getValues().flat().filter(Boolean):[];if(!products.length){_ui().alert("প্রোডাক্ট নেই!");return;}var json=JSON.stringify(products);var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📢</span><h1>Ad Spend</h1></div><div class="field"><label>প্রোডাক্ট<span class="req">*</span></label><select id="p" class="select">'+_buildOptions(products)+'</select></div><div class="field"><label>খরচ ৳<span class="req">*</span></label><input id="amt" type="number" class="input" autofocus></div><div class="field"><label>ক্যাম্পেইন</label><input id="cp" class="input"></div><div class="field"><label>নোট</label><input id="nt" class="input"></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💰 সেভ</button></div></div><script>function save(){if(!validateRequired(["amt"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("সেভ!");else{setLoading("saveBtn",false);showError();}}).saveAdFromForm({p:$("p").value,amt:parseFloat($("amt").value),cp:$("cp").value,nt:$("nt").value});}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(440).setHeight(480);_ui().showModalDialog(out,"📢 Ad Spend");}
function saveAdFromForm(d){try{var sh=_ss().getSheetByName("AD_TRACKER");var next=_getActualLastRow(sh,1)+1;_ensureRows(sh,next);sh.getRange(next,1,1,5).setValues([[new Date(),d.p,d.amt,d.cp||"",d.nt||""]]);return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
function openExpenseForm(){var cats=["Courier","Packaging","Office","Electricity","Internet","Rent","Salary","Transport","Marketing","Supplier","Other"];var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">💸</span><h1>Expense</h1></div><div class="field"><label>Category<span class="req">*</span></label><select id="c" class="select">'+_buildOptions(cats)+'</select></div><div class="field"><label>পরিমাণ ৳<span class="req">*</span></label><input id="a" type="number" class="input" autofocus></div><div class="field"><label>বিবরণ</label><textarea id="d" class="textarea"></textarea></div><div class="field"><label>কাকে</label><input id="p" class="input"></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 সেভ</button></div></div><script>function save(){if(!validateRequired(["a"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("সেভ!");else{setLoading("saveBtn",false);showError();}}).saveExpenseFromForm({c:$("c").value,a:parseFloat($("a").value),d:$("d").value,p:$("p").value});}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(440).setHeight(480);_ui().showModalDialog(out,"💸 Expense");}
function saveExpenseFromForm(d){try{var sh=_ss().getSheetByName("EXPENSES");var next=_getActualLastRow(sh,1)+1;_ensureRows(sh,next);sh.getRange(next,1,1,5).setValues([[new Date(),d.c,d.a,d.d||"",d.p||""]]);return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
function openReturnForm(){var ss=_ss();var inv=ss.getSheetByName("INVENTORY");var lr=inv?_getActualLastRow(inv,1):1;var products=lr>=2?inv.getRange(2,1,lr-1,1).getValues().flat().filter(Boolean):[];if(!products.length){_ui().alert("নেই!");return;}var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">↩️</span><h1>Return</h1></div><div class="field"><label>প্রোডাক্ট<span class="req">*</span></label><select id="p" class="select">'+_buildOptions(products)+'</select></div><div class="row"><div class="field"><label>Size</label><select id="s" class="select"><option>M</option><option>L</option><option>XL</option><option>XXL</option></select></div><div class="field"><label>Qty</label><input id="q2" type="number" class="input" value="1" min="1"></div></div><div class="field"><label>কারণ</label><input id="r" class="input"></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-danger" onclick="save()">↩️ Return</button></div></div><script>function save(){setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Return সেভ!");else{setLoading("saveBtn",false);showError();}}).saveReturnFromForm({p:$("p").value,s:$("s").value,q:parseInt($("q2").value)||1,r:$("r").value});}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(440).setHeight(450);_ui().showModalDialog(out,"↩️ Return");}
function saveReturnFromForm(d){try{var inv=_ss().getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(d.p);if(idx===-1)return{ok:false,msg:"Not found"};var row=idx+2;var sale=_num(inv.getRange(row,COL.SALE).getValue());var cost=_num(inv.getRange(row,COL.COST).getValue());_logTransaction([new Date(),d.p,"Return",d.s,d.q,-(d.q*sale),-(d.q*cost),-(d.q*(sale-cost))]);return{ok:true};}catch(e){return{ok:false,msg:e.message};}}


// ===== REPORTS =====
function generateMonthlyReport(){var ss=_ss();var tx=ss.getSheetByName("TRANSACTIONS");var adT=ss.getSheetByName("AD_TRACKER");var exp=ss.getSheetByName("EXPENSES");var orders=ss.getSheetByName("ORDERS");var reportSh=ss.getSheetByName("MONTHLY_REPORT");if(!reportSh){_ui().alert("MONTHLY_REPORT নেই!");return;}var tz=Session.getScriptTimeZone();var txMap={},adMap={},expMap={},orderMap={};if(tx){var lr=_getActualLastRow(tx,1);if(lr>=2){tx.getRange(2,1,lr-1,8).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy-MM");if(!txMap[key])txMap[key]={rev:0,cost:0,returns:0};if(r[2]==="Return")txMap[key].returns++;txMap[key].rev+=_num(r[5]);txMap[key].cost+=_num(r[6]);});}}if(adT){var lr=_getActualLastRow(adT,1);if(lr>=2)adT.getRange(2,1,lr-1,3).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy-MM");adMap[key]=(adMap[key]||0)+_num(r[2]);});}if(exp){var lr=_getActualLastRow(exp,1);if(lr>=2)exp.getRange(2,1,lr-1,3).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy-MM");expMap[key]=(expMap[key]||0)+_num(r[2]);});}if(orders){var lr=_getActualLastRow(orders,1);if(lr>=2)orders.getRange(2,1,lr-1,1).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy-MM");orderMap[key]=(orderMap[key]||0)+1;});}var allKeys=Array.from(new Set([].concat(Object.keys(txMap),Object.keys(adMap),Object.keys(expMap)))).sort();if(!allKeys.length){_ui().alert("ডেটা নেই!");return;}var rows=allKeys.map(function(key){var t=txMap[key]||{rev:0,cost:0,returns:0};var ad=adMap[key]||0;var ex=expMap[key]||0;var oc=orderMap[key]||0;var net=t.rev-t.cost-ad-ex;var margin=t.rev>0?Math.round((net/t.rev)*100):0;return[key,oc,Math.round(t.rev),Math.round(t.cost),Math.round(ad),Math.round(ex),Math.round(net),margin+"%",t.returns];});reportSh.clearContents();_hdr(reportSh,["📅 Month","🛒 Orders","💰 Revenue","💵 Product Cost","📢 Ad Spend","📦 Other Exp","📊 Net Profit","📈 Margin%","🔄 Returns"],"#DB2777");if(rows.length){reportSh.getRange(2,1,rows.length,9).setValues(rows);reportSh.getRange(2,3,rows.length,5).setNumberFormat("#,##0");}ss.setActiveSheet(reportSh);_ui().alert("✅ Monthly Report — "+rows.length+"টি মাস");}
function generateYearlyReport(){var ss=_ss();var tx=ss.getSheetByName("TRANSACTIONS");var adT=ss.getSheetByName("AD_TRACKER");var exp=ss.getSheetByName("EXPENSES");var orders=ss.getSheetByName("ORDERS");var reportSh=ss.getSheetByName("YEARLY_REPORT");if(!reportSh){_ui().alert("YEARLY_REPORT নেই!");return;}var tz=Session.getScriptTimeZone();var txMap={},adMap={},expMap={},orderMap={};if(tx){var lr=_getActualLastRow(tx,1);if(lr>=2)tx.getRange(2,1,lr-1,8).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy");if(!txMap[key])txMap[key]={rev:0,cost:0,returns:0};txMap[key].rev+=_num(r[5]);txMap[key].cost+=_num(r[6]);if(r[2]==="Return")txMap[key].returns++;});}if(adT){var lr=_getActualLastRow(adT,1);if(lr>=2)adT.getRange(2,1,lr-1,3).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy");adMap[key]=(adMap[key]||0)+_num(r[2]);});}if(exp){var lr=_getActualLastRow(exp,1);if(lr>=2)exp.getRange(2,1,lr-1,3).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy");expMap[key]=(expMap[key]||0)+_num(r[2]);});}if(orders){var lr=_getActualLastRow(orders,1);if(lr>=2)orders.getRange(2,1,lr-1,1).getValues().filter(function(r){return r[0];}).forEach(function(r){var key=Utilities.formatDate(new Date(r[0]),tz,"yyyy");orderMap[key]=(orderMap[key]||0)+1;});}var allKeys=Array.from(new Set([].concat(Object.keys(txMap),Object.keys(adMap),Object.keys(expMap)))).sort();if(!allKeys.length){_ui().alert("ডেটা নেই!");return;}var rows=allKeys.map(function(key){var t=txMap[key]||{rev:0,cost:0,returns:0};var ad=adMap[key]||0;var ex=expMap[key]||0;var oc=orderMap[key]||0;var net=t.rev-t.cost-ad-ex;var margin=t.rev>0?Math.round((net/t.rev)*100):0;return[key,oc,Math.round(t.rev),Math.round(t.cost),Math.round(ad),Math.round(ex),Math.round(net),margin+"%",t.returns];});reportSh.clearContents();_hdr(reportSh,["📅 Year","🛒 Orders","💰 Revenue","💵 Product Cost","📢 Ad Spend","📦 Other Exp","📊 Net Profit","📈 Margin%","🔄 Returns"],"#EA580C");if(rows.length){reportSh.getRange(2,1,rows.length,9).setValues(rows);reportSh.getRange(2,3,rows.length,5).setNumberFormat("#,##0");}ss.setActiveSheet(reportSh);_ui().alert("✅ Yearly Report — "+rows.length+"টি বছর");}
// ===== GITHUB SYNC =====
function githubSyncNow(){var ui=_ui();var s=_getSettingsMap();var token=String(s["GitHub Token"]||"").trim();var owner=String(s["GitHub Owner"]||"").trim();var repo=String(s["GitHub Repo"]||"").trim();var branch=String(s["GitHub Branch"]||"main").trim();var path=String(s["GitHub File Path"]||"data/products.json").trim();if(!token||!owner||!repo){ui.alert("⚙️ SETTINGS-এ GitHub Token, Owner, Repo দিন");return;}var web=_ss().getSheetByName("WEBSITE_SYNC");if(!web){ui.alert("WEBSITE_SYNC নেই");return;}var lr=_getActualLastRow(web,1);if(lr<2){ui.alert("Active প্রোডাক্ট নেই");return;}var headers=web.getRange(1,1,1,web.getLastColumn()).getValues()[0];var data=web.getRange(2,1,lr-1,web.getLastColumn()).getValues();var products=data.filter(function(r){return r[0];}).map(function(r){var o={};headers.forEach(function(h,i){o[String(h).replace(/[^a-zA-Z0-9]/g,'')]=r[i];});return o;});var storeName=String(s["Store Name"]||"YARZ");var payload={store:{name:storeName,tagline:String(s["Store Tagline"]||""),phone:String(s["Contact Phone"]||"")},products:products,total:products.length,updated:new Date().toISOString()};var content=Utilities.base64Encode(JSON.stringify(payload,null,2),Utilities.Charset.UTF_8);var apiUrl="https://api.github.com/repos/"+owner+"/"+repo+"/contents/"+encodeURIComponent(path);var sha=null;try{var get=UrlFetchApp.fetch(apiUrl+"?ref="+branch,{method:"get",headers:{Authorization:"token "+token,"User-Agent":"YARZ-PRO"},muteHttpExceptions:true});if(get.getResponseCode()===200)sha=JSON.parse(get.getContentText()).sha;}catch(e){}var body={message:"YARZ PRO sync - "+new Date().toISOString(),content:content,branch:branch};if(sha)body.sha=sha;var put=UrlFetchApp.fetch(apiUrl,{method:"put",contentType:"application/json",headers:{Authorization:"token "+token,"User-Agent":"YARZ-PRO"},payload:JSON.stringify(body),muteHttpExceptions:true});var code=put.getResponseCode();if(code===200||code===201)ui.alert("✅ GitHub Sync সফল! "+products.length+"টি প্রোডাক্ট");else ui.alert("❌ Sync ব্যর্থ — HTTP "+code);}
function openGitHubConnect(){var s=_getSettingsMap();var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar" style="background:linear-gradient(135deg,#111827,#374151)"><span style="font-size:22px">🔗</span><h1>GitHub Connect</h1></div><div class="card"><div class="field"><label>GitHub Token<span class="req">*</span></label><input id="t" class="input" value="'+String(_safe(s["GitHub Token"])).replace(/"/g,'&quot;')+'" type="password"></div><div class="field"><label>Owner<span class="req">*</span></label><input id="o" class="input" value="'+String(_safe(s["GitHub Owner"]))+'"></div><div class="field"><label>Repo<span class="req">*</span></label><input id="r" class="input" value="'+String(_safe(s["GitHub Repo"]))+'"></div><div class="row"><div class="field"><label>Branch</label><input id="b" class="input" value="'+(String(_safe(s["GitHub Branch"]))||"main")+'"></div><div class="field"><label>File Path</label><input id="p" class="input" value="'+(String(_safe(s["GitHub File Path"]))||"data/products.json")+'"></div></div></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Save & Sync</button></div></div><script>function save(){if(!validateRequired(["t","o","r"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("GitHub Connected!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).saveGitHubSettings({t:$("t").value,o:$("o").value,r:$("r").value,b:$("b").value,p:$("p").value});}</script>';var out=HtmlService.createHtmlOutput(html).setWidth(460).setHeight(480);_ui().showModalDialog(out,"🔗 GitHub Connect");}
function saveGitHubSettings(d){try{var sh=_ss().getSheetByName("SETTINGS");var lr=_getActualLastRow(sh,1);var data=sh.getRange(2,1,lr-1,2).getValues();var map={"GitHub Token":d.t,"GitHub Owner":d.o,"GitHub Repo":d.r,"GitHub Branch":d.b||"main","GitHub File Path":d.p||"data/products.json"};for(var i=0;i<data.length;i++){var key=String(data[i][0]).trim();if(map[key]!==undefined){sh.getRange(i+2,2).setValue(map[key]);}}try{githubSyncNow();}catch(e){}return{ok:true};}catch(e){return{ok:false,msg:e.message};}}
// ===== CLEANUP =====
function cleanupSystem(){var ui=_ui();var ok=ui.alert("🧹 System Cleanup","পুরনো Activity Log (90+ দিন) মুছবে?\nEmpty rows কমাবে?",ui.ButtonSet.YES_NO);if(ok!==ui.Button.YES)return;var ss=_ss();var act=ss.getSheetByName("_ACTIVITY");if(act){var lr=_getActualLastRow(act,1);if(lr>1){var cutoff=new Date();cutoff.setDate(cutoff.getDate()-90);var data=act.getRange(2,1,lr-1,4).getValues();var keep=data.filter(function(r){return r[0]&&new Date(r[0])>=cutoff;});act.getRange(2,1,lr-1,4).clearContent();if(keep.length)act.getRange(2,1,keep.length,4).setValues(keep);}}var inv=ss.getSheetByName("INVENTORY");if(inv)_restoreInventoryFormulas(inv);ui.alert("✅ Cleanup সম্পূর্ণ!");}
function fixRowHeights(){ALL_TABS.forEach(function(n){var sh=_ss().getSheetByName(n);if(sh)try{var max=sh.getMaxRows();if(max>1)_safeRowHeights(sh,2,max-1,32);}catch(e){}});_ui().alert("✅ Row Heights ঠিক হয়েছে।");}
function refreshFormulas(){var inv=_ss().getSheetByName("INVENTORY");if(inv){var f=_getInventoryFormulas();Object.keys(f).forEach(function(cell){inv.getRange(cell).setFormula(f[cell]);});}_ui().alert("✅ Formulas Refreshed।");}
function viewActivityLog(){var sh=_ss().getSheetByName("_ACTIVITY");if(!sh){_ui().alert("নেই।");return;}sh.showSheet();_ss().setActiveSheet(sh);}
function showHelp(){_ui().alert("📖 YARZ PRO v8.1","🎛️ Inventory Studio → সব টুল\n📦 Quick Add → নতুন প্রোডাক্ট\n✏️ Product Edit → edit করুন\n📊 Analytics → Insights + View\n📉 Stock Manager → Size-wise stock\n🗂️ Bulk Editor → Multiple edit\n🔍 Smart Search → Filter & find\n⚠️ Low Stock → Alert panel\n⚡ Status Update → Quick toggle\n🛒 New Order → অর্ডার (Courier সহ)\n🌐 Website Orders → ওয়েবসাইট অর্ডার\n🔎 Order Search → খোঁজো\n👤 Customer → History\n📅 Monthly/Yearly → Report\n🔗 GitHub Connect → সেটআপ\n☁️ GitHub Sync → এখনই sync\n🧹 Cleanup → System পরিষ্কার",_ui().ButtonSet.OK);}
// ===== onEdit =====
function onEdit(e){if(!e||!e.range)return;var ss=e.source;var sh=ss.getActiveSheet();var name=sh.getName();var row=e.range.getRow();var col=e.range.getColumn();if(row<2)return;if(name==="INVENTORY"){if(col===COL.NAME&&e.value&&!e.oldValue){if(!sh.getRange(row,COL.STATUS).getValue())sh.getRange(row,COL.STATUS).setValue("Draft");return;}if(SOLD_COLS.indexOf(col)!==-1){sh.getRange(row,COL.UPDATED).setValue(new Date());var diff=_int(e.value)-_int(e.oldValue);if(diff<=0)return;var product=sh.getRange(row,COL.NAME).getValue();if(!product)return;var sale=_num(sh.getRange(row,COL.SALE).getValue());var cost=_num(sh.getRange(row,COL.COST).getValue());var sizeMap={};sizeMap[COL.SOLD_M]="M";sizeMap[COL.SOLD_L]="L";sizeMap[COL.SOLD_XL]="XL";sizeMap[COL.SOLD_XXL]="XXL";_logTransaction([new Date(),product,"Sale",sizeMap[col],diff,diff*sale,diff*cost,diff*(sale-cost)]);return;}if(col===COL.STATUS&&e.value&&e.oldValue&&e.oldValue!==e.value){var product=sh.getRange(row,COL.NAME).getValue();_logActivity(product,e.oldValue,e.value);}}if(name==="DRAFT_VIEW"&&col===13&&row>=2){var action=e.value;var product=sh.getRange(row,2).getValue();if(!product||!action)return;var inv=ss.getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(product);if(idx===-1)return;var r=idx+2;if(action==="→ Activate"){inv.getRange(r,COL.STATUS).setValue("Active");inv.getRange(r,COL.UPDATED).setValue(new Date());_logActivity(product,"Draft","Active");}else if(action==="→ Archive"){inv.getRange(r,COL.STATUS).setValue("Archived");inv.getRange(r,COL.UPDATED).setValue(new Date());_logActivity(product,"Draft","Archived");}e.range.clearContent();}if(name==="ARCHIVE_VIEW"&&col===13&&row>=2){var action=e.value;var product=sh.getRange(row,2).getValue();if(!product||!action)return;var inv=ss.getSheetByName("INVENTORY");var lr=_getActualLastRow(inv,1);var names=inv.getRange(2,1,lr-1,1).getValues().flat();var idx=names.indexOf(product);if(idx===-1)return;var r=idx+2;var newSt=(action==="→ Activate")?"Active":"Draft";inv.getRange(r,COL.STATUS).setValue(newSt);inv.getRange(r,COL.UPDATED).setValue(new Date());_logActivity(product,"Archived",newSt);e.range.clearContent();}}
// ===== onOpen MENU =====
function onOpen(){var ui=_ui();ui.createMenu("🔧 YARZ PRO").addItem("🎛️ Inventory Studio (Dashboard)","openInventoryStudio").addSeparator().addSubMenu(ui.createMenu("📦 Inventory").addItem("📦 Quick Add Product","openProductForm").addItem("✏️ Product Edit","openProductEditSearch").addItem("📊 Analytics","openProductAnalytics").addItem("📉 Stock Manager","openStockManager").addItem("⚡ Quick Status Update","openQuickStatusUpdate").addItem("⚠️ Low Stock Alert","openLowStockAlert").addItem("🗂️ Bulk Editor","openBulkEditor").addItem("🔍 Smart Search","openSmartSearch")).addSubMenu(ui.createMenu("🛒 Orders & Customers").addItem("🛒 New Order","openOrderForm").addItem("🔎 Order Search","openOrderSearch").addItem("🌐 Website Orders","openWebsiteOrdersView").addItem("👤 Customer Search","openCustomerSearch")).addSubMenu(ui.createMenu("💸 Expenses").addItem("📢 Ad Spend","openAdForm").addItem("💸 Expense Entry","openExpenseForm").addItem("↩️ Return Entry","openReturnForm")).addSubMenu(ui.createMenu("📋 Reports").addItem("📅 Monthly Report","generateMonthlyReport").addItem("📈 Yearly Report","generateYearlyReport")).addSeparator().addItem("🔗 GitHub Connect","openGitHubConnect").addItem("☁️ GitHub Sync Now","githubSyncNow").addSeparator().addSubMenu(ui.createMenu("🔧 Tools & Fix").addItem("📏 Fix Row Heights","fixRowHeights").addItem("🔄 Refresh Formulas","refreshFormulas").addItem("🧹 System Cleanup","cleanupSystem").addItem("📋 View Activity Log","viewActivityLog")).addSeparator().addItem("🚀 সম্পূর্ণ System তৈরি (v8.1)","createFullSystem").addItem("📖 Help","showHelp").addToUi();}


// ════════════════════════════════════════════════════════
// ===== WEB API (doGet / doPost) — v8.1 FIXED =====
// ════════════════════════════════════════════════════════

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
// REMOVED: var API_KEY = 'AIzaSyC2WUoTmJ_nwxZ0gV8BkE0UGgZoEfwyQ5k';
// ⚠️ Above line removed in v8.2 — was causing "Identifier already declared" error.
// API_KEY is already declared as `const` at the top of this file (line 7).

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
    if (key !== API_KEY) return _webErr_("Invalid API Key", 401);

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
    var contents = e.postData.contents;
    var body = JSON.parse(contents);
    if (body.key !== API_KEY) return _webErr_("Invalid API Key", 401);

    var action = String(body.action || "").trim();
    var lowerAction = action.toLowerCase();

    switch (lowerAction) {
      // Public
      case "place_order":                 return _placeWebsiteOrder(body.order || body);
      case "update_order_status":         return _updateWebOrderStatus(body);

      // Dashboard - Products
      case "saveproductfromform":         return _webJson_(saveProductFromForm(body));
      case "saveproducteditfromform":     return _webJson_(saveProductEditFromForm(body));
      case "updateproductstatus":         return _webJson_(updateProductStatus(body));
      case "applystockchange":            return _webJson_(applyStockChange(body));
      case "applybulkedit":               return _webJson_(applyBulkEdit(body));
      case "recordsale":                  return _webJson_(_webRecordSale(body));

      // Dashboard - Orders
      case "saveorderfromform":           return _webJson_(_webSaveOrderWithStatus(body));
      case "updatewebsiteorderstatus":    return _webJson_(_webUpdateWebsiteOrderStatus(body));
      case "updatemanualorderstatus":     return _webJson_(_webUpdateManualOrderStatus(body));
      
      case "deletewebsiteorder":          return _webJson_(_webDeleteWebsiteOrder(body));
      case "deletemanualorder":           return _webJson_(_webDeleteManualOrder(body));
      
      case "deleteproduct":               return _webJson_(_webDeleteProduct(body));
      
      // Cleanup Actions (The ones user reported)
      case "fullfactoryreset":            return _webJson_(_webFullFactoryReset());
      case "clearfinancialsonly":         return _webJson_(_webClearFinancialsOnly());
      case "clearinventoryonly":          return _webJson_(_webClearInventoryOnly());

      // Dashboard - Finance
      case "saveadfromform":              return _webJson_(saveAdFromForm(body));
      case "saveexpensefromform":         return _webJson_(saveExpenseFromForm(body));
      case "savereturnfromform":          return _webJson_(saveReturnFromForm(body));

      // Dashboard - Settings
      case "updatesettings":              return _webJson_(_webUpdateSettings(body));
      case "savegithubsettings":          return _webJson_(saveGitHubSettings(body));
      case "githubsyncnow":               try { githubSyncNow(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }

      // Dashboard - Reports
      case "generatemonthlyreport":       try { generateMonthlyReport(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }
      case "generateyearlyreport":        try { generateYearlyReport(); return _webJson_({ ok:true, success:true }); } catch(x){ return _webErr_(x.message); }

      default: return _webErr_("Unknown action: " + action);
    }
  } catch (err) {
    return _webErr_("Server error: " + err.message, 500);
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
    "Image4":"image4","Image5":"image5","Image6":"image6",
    "Video":"video","Description":"description","Category":"category",
    "Fabric":"fabric","Badge":"badge","SizeChart":"sizeChart",
    "DeliveryDays":"deliveryDays","Regular":"regularPrice","Sale":"salePrice",
    "Disc%":"discountPercent","DiscType":"discountType",
    "Delivery(Dhaka)":"deliveryDhaka","Delivery(Outside)":"deliveryOutside",
    "M_Left":"stock_M","L_Left":"stock_L","XL_Left":"stock_XL","XXL_Left":"stock_XXL",
    "Status":"status", "CouponActive":"couponActive", "CouponCode":"couponCode", "CouponDisc":"couponDisc"
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
    "Announcement Text", "Announcement Active", "Store Status", "Maintenance Mode",
    "Promo Popup Image", "Promo Popup Link", "Promo Popup Active", "Enable COD"];

  var info = {};
  rows.forEach(function(r){
    var k = String(r[0]||"").trim();
    if (allowedPrefixes.indexOf(k) !== -1 || k.startsWith("Hero Banner ") || k.startsWith("Banner Link ") || k.startsWith("Banner Title ") || k.startsWith("Section ")) {
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
    var sheetsToClear = ["INVENTORY"]; // WEBSITE_SYNC excluded: formula-driven, auto-clears
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
    var sheetsToClear = ["INVENTORY", "WEBSITE_SYNC", "TRANSACTIONS", "Website_Orders", "ORDERS", "AD_TRACKER", "EXPENSES", "MONTHLY_REPORT", "YEARLY_REPORT", "_ACTIVITY"];
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

