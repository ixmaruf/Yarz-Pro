// ════════════════════════════════════════════════════════
// ✅ YARZ PRO v9.3 — DELIVERY MANAGER (Narayanganj) + ORDER FIX
// 🔑 API Key validation matches website's "key" parameter
// 📦 Properly handles: img1-6, video, coupon (active/code/disc%)
// 🔄 WEBSITE_SYNC includes ALL new columns
// 🚚 v9.3 changes:
//    • Default DELIVERY_CHARGES → Inside/Outside Narayanganj (70/140 ৳)
//    • _placeWebsiteOrder accepts customerName/email/city (legacy "customer" works)
//    • Email + City auto-appended into address column for record-keeping
//    • _webUpdateDeliveryCharges fallback → Narayanganj defaults
//    • _getFullStoreInfoObj inlines delivery_locations JSON for ≤10s sync
// ════════════════════════════════════════════════════════

// ===== TOP-LEVEL CONSTANTS =====
const API_KEY = "AIzaSyApMtjj2baO6u19AvppjLtJ1GT1G61qo9k";
const SPREADSHEET_ID = "1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q";

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

const ALL_TABS = ["INVENTORY","DRAFT_VIEW","ARCHIVE_VIEW","WEBSITE_SYNC","ORDERS","Website_Orders","TRANSACTIONS","AD_TRACKER","EXPENSES","MONTHLY_REPORT","YEARLY_REPORT","SETTINGS","DELIVERY_CHARGES","_ACTIVITY","_DRAFT_DATA","_ARCHIVE_DATA"];

// ============= COLUMN MAP =============
// INVENTORY columns 1-45
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
  TOTAL:45
};

const SOLD_COLS = [COL.SOLD_M, COL.SOLD_L, COL.SOLD_XL, COL.SOLD_XXL];

// ============= HELPERS =============
function _ss(){
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
function _str(v){return String(_safe(v));}

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

function _ensureColumns(sh, needed){
  if(!sh) return;
  try {
    const maxCols = sh.getMaxColumns();
    if (needed > maxCols) sh.insertColumnsAfter(maxCols, needed - maxCols);
  } catch(e){}
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
  _ensureColumns(sheet, headers.length);
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

// ============= SHARED CSS / JS (for Apps Script native dialogs) =============
function _sharedCSS(){
  return '<style>*{box-sizing:border-box}body{margin:0;font-family:Roboto,Arial,sans-serif;background:#F8FAFC;color:#111827}.app{padding:16px}.appbar{margin:-16px -16px 16px;padding:14px 16px;background:linear-gradient(135deg,#059669,#047857);color:#fff;display:flex;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,.12)}.appbar h1{margin:0;font-size:16px;font-weight:700;flex:1}.badge{background:rgba(255,255,255,.2);padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700}.card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 2px 8px rgba(0,0,0,.04)}.section-title{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6B7280;margin:18px 0 10px}.field{margin-bottom:12px}.field label{display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:5px}.req{color:#DC2626;margin-left:2px}.input,.select,.textarea{width:100%;padding:10px 12px;border:1.5px solid #E5E7EB;border-radius:10px;background:#fff;font-size:14px;outline:none;font-family:inherit;transition:border-color .15s}.input:focus,.select:focus,.textarea:focus{border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.1)}.textarea{min-height:70px;resize:vertical}.row{display:flex;gap:10px}.row>*{flex:1}.btn{border:none;border-radius:10px;padding:11px 14px;font-size:14px;font-weight:700;cursor:pointer;width:100%;font-family:inherit;transition:all .15s}.btn-primary{background:linear-gradient(135deg,#059669,#047857);color:#fff}.btn-secondary{background:#F3F4F6;color:#111827;border:1px solid #E5E7EB}.actions{display:flex;gap:10px;margin-top:14px}.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(60px);background:#111827;color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:700;opacity:0;transition:all .25s;z-index:9999}.toast.show{transform:translateX(-50%) translateY(0);opacity:1}.toast.error{background:#DC2626}.success-screen{padding:40px 20px;text-align:center}.success-screen .ic{font-size:64px;margin-bottom:12px}</style>';
}

function _sharedJS(){
  return '<script>function $(id){return document.getElementById(id);}function toast(msg,type){var t=document.createElement("div");t.className="toast "+(type||"success");t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.classList.add("show");},10);setTimeout(function(){t.classList.remove("show");setTimeout(function(){t.remove();},250);},2400);}function showSuccess(msg){document.body.innerHTML=\'<div class="success-screen"><div class="ic">✅</div><h2>\'+msg+\'</h2><p>সফলভাবে সেভ হয়েছে</p></div>\';setTimeout(function(){google.script.host.close();},1200);}function showError(msg){toast(msg||"সমস্যা হয়েছে","error");}function validateRequired(ids){var ok=true;ids.forEach(function(id){var el=$(id);if(!el)return;if(!el.value||!String(el.value).trim()){el.style.borderColor="#DC2626";ok=false;}else{el.style.borderColor="#E5E7EB";}});if(!ok)toast("প্রয়োজনীয় ফিল্ড পূরণ করুন","error");return ok;}function setLoading(btnId,on){var b=$(btnId);if(!b)return;if(on){b.disabled=true;b.dataset.orig=b.textContent;b.textContent="⏳ ...";}else{b.disabled=false;b.textContent=b.dataset.orig||b.textContent;}}</script>';
}

// ════════════════════════════════════════════════════════
// ===== SETUP / CREATE SYSTEM =====
// ════════════════════════════════════════════════════════
function createFullSystem(){
  var ui=_ui();
  var ok=ui.alert("🚀 YARZ PRO v9.0","সম্পূর্ণ Inventory App তৈরি হবে।\n⚠️ পুরনো YARZ tabs reset হবে।\nচালিয়ে যেতে চান?",ui.ButtonSet.YES_NO);
  if(ok!==ui.Button.YES)return;
  var ss=_ss();
  var existing=ss.getSheets();
  var toDelete=existing.filter(function(s){return ALL_TABS.includes(s.getName());});
  if(toDelete.length>=existing.length)ss.insertSheet("__tmp__");
  toDelete.forEach(function(s){try{ss.deleteSheet(s);}catch(e){}});
  ALL_TABS.forEach(function(n){if(!ss.getSheetByName(n))ss.insertSheet(n);});
  ["Sheet1","__tmp__"].forEach(function(n){var sh=ss.getSheetByName(n);if(sh&&ss.getSheets().length>1){try{ss.deleteSheet(sh);}catch(e){}}});
  try{_setupInventory();}catch(e){}
  try{_setupDraftView();}catch(e){}
  try{_setupArchiveView();}catch(e){}
  try{_setupWebsiteSync();}catch(e){}
  try{_setupOrders();}catch(e){}
  try{_setupWebsiteOrders();}catch(e){}
  try{_setupTransactions();}catch(e){}
  try{_setupAdTracker();}catch(e){}
  try{_setupExpenses();}catch(e){}
  try{_setupMonthlyReport();}catch(e){}
  try{_setupYearlyReport();}catch(e){}
  try{_setupSettings();}catch(e){}
  try{_setupDeliveryCharges();}catch(e){}
  try{_setupActivity();}catch(e){}
  try{_setupDraftData();}catch(e){}
  try{_setupArchiveData();}catch(e){}
  ["_ACTIVITY","_DRAFT_DATA","_ARCHIVE_DATA"].forEach(function(n){var sh=ss.getSheetByName(n);if(sh)try{sh.hideSheet();}catch(e){}});
  ss.setActiveSheet(ss.getSheetByName("INVENTORY"));
  ui.alert("✅ YARZ PRO v9.0 Ready!","মেনু থেকে:\n🔧 YARZ PRO → 🎛️ Inventory Studio",ui.ButtonSet.OK);
}

function _setupInventory(){
  var sh=_ss().getSheetByName("INVENTORY");
  sh.clear();
  sh.clearConditionalFormatRules();
  _ensureRows(sh,1000);
  _ensureColumns(sh, 45);
  var H=[
    "📦 Product","🖼️ Image 1","🖼️ Image 2","🖼️ Image 3","🎥 Video URL",
    "📝 Description","🏷️ Category","🧵 Fabric","🏆 Badge","📏 Size Chart",
    "📅 Delivery Days","💵 Cost","🏷️ Regular","💰 Sale","📊 Disc%","📋 Disc Type",
    "🚚 Dhaka ৳","🚛 Outside ৳","M","L","XL","XXL","M","L","XL","XXL",
    "📊 Sold","🔄 Returns","📉 Left","📦 Stock","💸 Invest","💵 Revenue",
    "🎯 Recover","💰 Profit","📢 FB Ad","💵 Net","🏷️ Disc P/L",
    "🕐 Updated","⚡ Status",
    "🖼️ Image 4","🖼️ Image 5","🖼️ Image 6",
    "🎟️ Coupon Active","🎟️ Coupon Code","💰 Coupon Disc %"
  ];
  _hdr(sh,H,C.INDIGO);
  var widths=[200,100,100,100,110,180,110,120,110,130,100,85,85,85,65,90,80,90,55,55,55,55,55,55,55,55,70,70,70,70,90,90,90,90,80,90,90,130,90,100,100,100,100,120,100];
  widths.forEach(function(w,i){sh.setColumnWidth(i+1,w);});
  _safeRowHeights(sh,2,999,32);
  sh.getRange("A2:AS1000").setFontFamily(C.FONT).setFontSize(10).setVerticalAlignment("middle").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sh.getRange("L2:N1000").setNumberFormat("#,##0");
  sh.getRange("O2:O1000").setNumberFormat('0"%"');
  sh.getRange("Q2:AK1000").setNumberFormat("#,##0");
  sh.getRange("AL2:AL1000").setNumberFormat("dd/MM/yy hh:mm");
  sh.getRange("AS2:AS1000").setNumberFormat('0"%"');
  sh.getRange("G2:G1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getCategoryList(),true).setAllowInvalid(true).build());
  sh.getRange("H2:H1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getFabricList(),true).setAllowInvalid(true).build());
  sh.getRange("I2:I1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(getBadgeList(),true).setAllowInvalid(true).build());
  sh.getRange("P2:P1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DISC_TYPE_LIST,true).build());
  sh.getRange("AM2:AM1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Active","Draft","Archived"],true).build());
  sh.getRange("AQ2:AQ1000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Yes","No"],true).build());
  var formulas=_getInventoryFormulas();
  Object.keys(formulas).forEach(function(cell){sh.getRange(cell).setFormula(formulas[cell]);});
  var rules=[];
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Active").setBackground("#D1FAE5").setFontColor("#065F46").setRanges([sh.getRange("AM2:AM1000")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Draft").setBackground("#FEF3C7").setFontColor("#92400E").setRanges([sh.getRange("AM2:AM1000")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Archived").setBackground("#F3F4F6").setFontColor("#374151").setRanges([sh.getRange("AM2:AM1000")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Yes").setBackground("#DCFCE7").setFontColor("#166534").setRanges([sh.getRange("AQ2:AQ1000")]).build());
  sh.setConditionalFormatRules(rules);
}

function _setupDraftView(){
  var sh=_ss().getSheetByName("DRAFT_VIEW");sh.clear();_ensureRows(sh,500);
  _hdr(sh,["#","📦 Product","🖼️ Image","🏷️ Category","🧵 Fabric","🏆 Badge","💵 Cost","🏷️ Regular","💰 Sale","📊 Stock","🛒 Sold","📉 Left","🔄 Action"],C.ORANGE);
  var cond='INVENTORY!AM2:AM="Draft",INVENTORY!A2:A<>""';
  sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');
  sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');
  sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');
  sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');
  sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');
  sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!L2:L,'+cond+'),"")');
  sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');
  sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');
  sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!AD2:AD,'+cond+'),"")');
  sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!AA2:AA,'+cond+'),"")');
  sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!AC2:AC,'+cond+'),"")');
  sh.getRange("A2").setFormula('=ARRAYFORMULA(IF(B2:B="","",ROW(B2:B)-1))');
  sh.getRange("M2:M500").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["→ Activate","→ Archive"],true).build());
  sh.setColumnWidths(1,13,100);sh.setColumnWidth(2,180);_safeRowHeights(sh,2,499,32);
}

function _setupArchiveView(){
  var sh=_ss().getSheetByName("ARCHIVE_VIEW");sh.clear();_ensureRows(sh,500);
  _hdr(sh,["#","📦 Product","🖼️ Image","🏷️ Category","🧵 Fabric","🏆 Badge","💵 Cost","🏷️ Regular","💰 Sale","📊 Stock","🛒 Sold","📉 Left","🔄 Action"],C.GRAY);
  var cond='INVENTORY!AM2:AM="Archived",INVENTORY!A2:A<>""';
  sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');
  sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');
  sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');
  sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');
  sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');
  sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!L2:L,'+cond+'),"")');
  sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');
  sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');
  sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!AD2:AD,'+cond+'),"")');
  sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!AA2:AA,'+cond+'),"")');
  sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!AC2:AC,'+cond+'),"")');
  sh.getRange("A2").setFormula('=ARRAYFORMULA(IF(B2:B="","",ROW(B2:B)-1))');
  sh.getRange("M2:M500").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["→ Activate","→ Restore"],true).build());
  sh.setColumnWidths(1,13,100);sh.setColumnWidth(2,180);_safeRowHeights(sh,2,499,32);
}

// ════════ WEBSITE_SYNC — INCLUDES Image 4/5/6 + Coupon ════════
function _setupWebsiteSync(){
  var sh=_ss().getSheetByName("WEBSITE_SYNC");
  sh.clear();
  _ensureRows(sh,500);
  _ensureColumns(sh, 28);
  _hdr(sh,[
    "Product","Image1","Image2","Image3","Video","Description",
    "Category","Fabric","Badge","SizeChart","DeliveryDays",
    "Regular","Sale","Disc%","DiscType",
    "Delivery(Dhaka)","Delivery(Outside)",
    "M_Left","L_Left","XL_Left","XXL_Left",
    "Status",
    "Image4","Image5","Image6",
    "CouponActive","CouponCode","CouponDisc"
  ],C.GREEN);
  var cond='INVENTORY!AM2:AM="Active",INVENTORY!A2:A<>""';
  // A=Product (col 1)
  sh.getRange("A2").setFormula('=IFERROR(FILTER(INVENTORY!A2:A,'+cond+'),"")');
  sh.getRange("B2").setFormula('=IFERROR(FILTER(INVENTORY!B2:B,'+cond+'),"")');
  sh.getRange("C2").setFormula('=IFERROR(FILTER(INVENTORY!C2:C,'+cond+'),"")');
  sh.getRange("D2").setFormula('=IFERROR(FILTER(INVENTORY!D2:D,'+cond+'),"")');
  sh.getRange("E2").setFormula('=IFERROR(FILTER(INVENTORY!E2:E,'+cond+'),"")');
  sh.getRange("F2").setFormula('=IFERROR(FILTER(INVENTORY!F2:F,'+cond+'),"")');
  sh.getRange("G2").setFormula('=IFERROR(FILTER(INVENTORY!G2:G,'+cond+'),"")');
  sh.getRange("H2").setFormula('=IFERROR(FILTER(INVENTORY!H2:H,'+cond+'),"")');
  sh.getRange("I2").setFormula('=IFERROR(FILTER(INVENTORY!I2:I,'+cond+'),"")');
  sh.getRange("J2").setFormula('=IFERROR(FILTER(INVENTORY!J2:J,'+cond+'),"")');
  sh.getRange("K2").setFormula('=IFERROR(FILTER(INVENTORY!K2:K,'+cond+'),"")');
  sh.getRange("L2").setFormula('=IFERROR(FILTER(INVENTORY!M2:M,'+cond+'),"")');
  sh.getRange("M2").setFormula('=IFERROR(FILTER(INVENTORY!N2:N,'+cond+'),"")');
  sh.getRange("N2").setFormula('=IFERROR(FILTER(INVENTORY!O2:O,'+cond+'),"")');
  sh.getRange("O2").setFormula('=IFERROR(FILTER(INVENTORY!P2:P,'+cond+'),"")');
  sh.getRange("P2").setFormula('=IFERROR(FILTER(INVENTORY!Q2:Q,'+cond+'),"")');
  sh.getRange("Q2").setFormula('=IFERROR(FILTER(INVENTORY!R2:R,'+cond+'),"")');
  // M/L/XL/XXL Left = Stock - Sold
  sh.getRange("R2").setFormula('=IFERROR(FILTER(INVENTORY!S2:S-INVENTORY!W2:W,'+cond+'),"")');
  sh.getRange("S2").setFormula('=IFERROR(FILTER(INVENTORY!T2:T-INVENTORY!X2:X,'+cond+'),"")');
  sh.getRange("T2").setFormula('=IFERROR(FILTER(INVENTORY!U2:U-INVENTORY!Y2:Y,'+cond+'),"")');
  sh.getRange("U2").setFormula('=IFERROR(FILTER(INVENTORY!V2:V-INVENTORY!Z2:Z,'+cond+'),"")');
  sh.getRange("V2").setFormula('=IFERROR(FILTER(INVENTORY!AM2:AM,'+cond+'),"")');
  // Image 4/5/6 ← INVENTORY columns AN(40), AO(41), AP(42)
  sh.getRange("W2").setFormula('=IFERROR(FILTER(INVENTORY!AN2:AN,'+cond+'),"")');
  sh.getRange("X2").setFormula('=IFERROR(FILTER(INVENTORY!AO2:AO,'+cond+'),"")');
  sh.getRange("Y2").setFormula('=IFERROR(FILTER(INVENTORY!AP2:AP,'+cond+'),"")');
  // Coupon ← INVENTORY columns AQ(43), AR(44), AS(45)
  sh.getRange("Z2").setFormula('=IFERROR(FILTER(INVENTORY!AQ2:AQ,'+cond+'),"")');
  sh.getRange("AA2").setFormula('=IFERROR(FILTER(INVENTORY!AR2:AR,'+cond+'),"")');
  sh.getRange("AB2").setFormula('=IFERROR(FILTER(INVENTORY!AS2:AS,'+cond+'),"")');
  _safeRowHeights(sh,2,499,32);
}

function _setupOrders(){
  var sh=_ss().getSheetByName("ORDERS");sh.clear();_ensureRows(sh,2000);
  _hdr(sh,["📅 Date","🆔 Order ID","👤 Customer","📞 Phone","📍 Address","🏘️ Location","📦 Product","📏 Size","🔢 Qty","💵 Price","🚚 Delivery","💰 Total","💳 Payment","📊 Status","🚛 Courier","📝 Notes"],C.BLUE);
  sh.getRange("N2:N2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled","Returned"],true).build());
  sh.setColumnWidths(1,16,100);
  _safeRowHeights(sh,2,1999,30);
}

function _setupWebsiteOrders(){
  var sh=_ss().getSheetByName("Website_Orders");sh.clear();_ensureRows(sh,2000);
  _hdr(sh,["🆔 Order ID","📅 Date","👤 Customer","📞 Phone","📍 Address","🏘️ Location","📦 Product","📏 Size","🔢 Qty","💵 Price","🚚 Delivery","💰 Total","💳 Payment","📝 Notes","🎟️ Coupon","🚦 Status","🚛 Courier","📅 Updated","📝 Activity"],C.PURPLE);
  sh.getRange("P2:P2000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Pending","Confirmed","Processing","Shipped","Delivered","Cancelled","Returned"],true).build());
  sh.setColumnWidths(1,19,100);
  _safeRowHeights(sh,2,1999,30);
}

function _setupTransactions(){
  var sh=_ss().getSheetByName("TRANSACTIONS");sh.clear();_ensureRows(sh,5000);
  _hdr(sh,["📅 Date","📦 Product","🔄 Type","📏 Size","🔢 Qty","💵 Revenue","💸 Cost","💰 Profit"],C.GREEN);
  sh.getRange("C2:C5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Sale","Return","Adjustment"],true).build());
  sh.setColumnWidths(1,8,110);
}

function _setupAdTracker(){
  var sh=_ss().getSheetByName("AD_TRACKER");sh.clear();_ensureRows(sh,2000);
  _hdr(sh,["📅 Date","📦 Product","💰 Spend","📊 Reach","👁️ Impressions","🖱️ Clicks","📝 Notes"],C.BLUE);
  sh.setColumnWidths(1,7,110);
}

function _setupExpenses(){
  var sh=_ss().getSheetByName("EXPENSES");sh.clear();_ensureRows(sh,2000);
  _hdr(sh,["📅 Date","🏷️ Category","📝 Description","💰 Amount","📝 Notes"],C.RED);
  sh.setColumnWidths(1,5,140);
}

function _setupMonthlyReport(){
  var sh=_ss().getSheetByName("MONTHLY_REPORT");sh.clear();_ensureRows(sh,200);
  _hdr(sh,["📅 Month","💵 Revenue","💸 Cost","📢 Ad Spend","💰 Net Profit","📊 Orders"],C.INDIGO);
  sh.setColumnWidths(1,6,140);
}

function _setupYearlyReport(){
  var sh=_ss().getSheetByName("YEARLY_REPORT");sh.clear();_ensureRows(sh,50);
  _hdr(sh,["📅 Year","💵 Revenue","💸 Cost","📢 Ad Spend","💰 Net Profit","📊 Orders"],C.PURPLE);
  sh.setColumnWidths(1,6,140);
}

function _setupSettings(){
  var sh=_ss().getSheetByName("SETTINGS");sh.clear();_ensureRows(sh,100);
  _hdr(sh,["🔑 Key","💾 Value","📝 Description"],C.DARK);
  var defaults=[
    ["Store Name","YARZ","স্টোরের নাম"],
    ["Store Phone","","ফোন নাম্বার"],
    ["Store Email","","ইমেল"],
    ["Store Address","","ঠিকানা"],
    ["Currency Symbol","৳","কারেন্সি"],
    ["Link Facebook","https://www.facebook.com/Yarzbd","Footer/contact social link"],
    ["Link Instagram","https://www.instagram.com/yarz_bd","Footer/contact social link"],
    ["Link WhatsApp","https://wa.me/8801601743670","Footer/contact social link"],
    ["Link Messenger","https://m.me/Yarzbd","Footer/contact social link + floating chat"],
    ["Link TikTok","https://tiktok.com/@yarzbd","Footer/contact social link"],
    ["Link YouTube","","Optional footer/contact social link"],
    ["Custom Categories","","কমা দিয়ে আলাদা করে category"],
    ["Custom Fabrics","","কমা দিয়ে আলাদা করে fabric"],
    ["Custom Badges","","কমা দিয়ে আলাদা করে badge"],
    ["GitHub Token","",""],
    ["GitHub Repo","",""],
    ["GitHub Branch","main",""],
    ["GitHub Path","data.json",""]
  ];
  sh.getRange(2,1,defaults.length,3).setValues(defaults);
  sh.setColumnWidths(1,3,200);
}

function _setupDeliveryCharges(){
  var sh=_ss().getSheetByName("DELIVERY_CHARGES");
  if(!sh) sh=_ss().insertSheet("DELIVERY_CHARGES");
  sh.clear(); _ensureRows(sh,100);
  _hdr(sh,["ID","Location Name","Charge","Active"],C.BLUE);
  sh.getRange(2,1,2,4).setValues([
    ["inside_narayanganj","Inside Narayanganj",70,true],
    ["outside_narayanganj","Outside Narayanganj",140,true]
    
  ]);
  sh.setColumnWidths(1,4,200);
  sh.getRange("C2:C100").setNumberFormat('৳#,##0');
}

function _getDeliveryCharges(){
  var ss=_ss();
  var sh=ss.getSheetByName("DELIVERY_CHARGES");
  if(!sh){
    _setupDeliveryCharges();
    sh=ss.getSheetByName("DELIVERY_CHARGES");
  }
  var lr=_getActualLastRow(sh,1);
  if(lr<2) return [];
  var rows=sh.getRange(2,1,lr-1,4).getValues();
  return rows.filter(function(r){return r[0] || r[1];}).map(function(r,idx){
    return {
      id:_str(r[0] || ("zone_"+(idx+1))),
      name:_str(r[1]),
      charge:_num(r[2]),
      active:String(r[3]).toLowerCase() !== "false"
    };
  }).filter(function(x){return x.name && x.active;});
}

function _webUpdateDeliveryCharges(body){
  try{
    var sh=_ss().getSheetByName("DELIVERY_CHARGES");
    if(!sh){ _setupDeliveryCharges(); sh=_ss().getSheetByName("DELIVERY_CHARGES"); }
    var locations = body.locations || [];
    if(typeof locations === "string") locations = JSON.parse(locations || "[]");
    if(!Array.isArray(locations)) locations = [];
    var clean = locations.map(function(loc,idx){
      return [
        _str(loc.id || ("zone_"+(idx+1))).replace(/\s+/g,"_"),
        _str(loc.name || loc.location || ""),
        _num(loc.charge || loc.fee || 0),
        loc.active === undefined ? true : !(String(loc.active).toLowerCase()==="false" || String(loc.active)==="0")
      ];
    }).filter(function(r){return r[1];});
    // ✅ v9.3: Narayanganj defaults if admin sends empty list
    if(!clean.length) clean = [["inside_narayanganj","Inside Narayanganj",70,true],["outside_narayanganj","Outside Narayanganj",140,true]];
    var lr=_getActualLastRow(sh,1);
    if(lr>=2) sh.getRange(2,1,lr-1,4).clearContent();
    _ensureRows(sh, clean.length+1);
    sh.getRange(2,1,clean.length,4).setValues(clean);
    return {ok:true,success:true,locations:clean.length};
  }catch(e){return {ok:false,success:false,msg:e.message};}
}

function _setupActivity(){
  var sh=_ss().getSheetByName("_ACTIVITY");sh.clear();_ensureRows(sh,5000);
  _hdr(sh,["Date","Product","Old Status","New Status"],C.GRAY);
}

function _setupDraftData(){
  var sh=_ss().getSheetByName("_DRAFT_DATA");sh.clear();
  _hdr(sh,["Name","Note"],C.GRAY);
  sh.getRange("A2").setValue("Legacy - data in INVENTORY");
}

function _setupArchiveData(){
  var sh=_ss().getSheetByName("_ARCHIVE_DATA");sh.clear();
  _hdr(sh,["Name","Note"],C.GRAY);
  sh.getRange("A2").setValue("Legacy - data in INVENTORY");
}

// ════════════════════════════════════════════════════════
// ===== MIGRATION HELPER (run once if you have old sheet) =====
// ════════════════════════════════════════════════════════
function migrateAddNewColumns(){
  var inv=_ss().getSheetByName("INVENTORY");
  if(!inv){ _ui().alert("INVENTORY tab নেই"); return; }
  _ensureColumns(inv, 45);
  // Set headers for new columns
  var newHeaders = [
    [40, "🖼️ Image 4"],
    [41, "🖼️ Image 5"],
    [42, "🖼️ Image 6"],
    [43, "🎟️ Coupon Active"],
    [44, "🎟️ Coupon Code"],
    [45, "💰 Coupon Disc %"]
  ];
  newHeaders.forEach(function(p){
    var cell = inv.getRange(1, p[0]);
    if(!cell.getValue() || String(cell.getValue()).trim()===""){
      cell.setValue(p[1])
        .setBackground(C.INDIGO).setFontColor(C.WHITE)
        .setFontWeight("bold").setFontFamily(C.FONT)
        .setFontSize(10).setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
    }
  });
  // Data validation for Coupon Active column (AQ = 43)
  inv.getRange("AQ2:AQ1000").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["Yes","No"],true).build()
  );
  inv.getRange("AS2:AS1000").setNumberFormat('0"%"');
  // Default "No" for empty Coupon Active cells of existing rows
  var lr = _getActualLastRow(inv,1);
  if(lr >= 2){
    var range = inv.getRange(2, 43, lr-1, 1);
    var vals = range.getValues();
    var changed = false;
    for(var i=0;i<vals.length;i++){
      if(vals[i][0]==="" || vals[i][0]===null){ vals[i][0]="No"; changed=true; }
    }
    if(changed) range.setValues(vals);
  }
  // Now rebuild WEBSITE_SYNC to include new columns
  try { _setupWebsiteSync(); } catch(e){}
  _ui().alert("✅ Migration Done","Image 4/5/6 + Coupon columns added to INVENTORY.\nWEBSITE_SYNC tab also rebuilt.",_ui().ButtonSet.OK);
}

// ════════════════════════════════════════════════════════
// ===== onEdit Trigger =====
// ════════════════════════════════════════════════════════
function onEdit(e){
  if(!e||!e.range)return;
  var ss=e.source;
  var sh=ss.getActiveSheet();
  var name=sh.getName();
  var row=e.range.getRow();
  var col=e.range.getColumn();
  if(row<2)return;
  if(name==="INVENTORY"){
    if(col===COL.NAME&&e.value&&!e.oldValue){
      if(!sh.getRange(row,COL.STATUS).getValue())sh.getRange(row,COL.STATUS).setValue("Draft");
      return;
    }
    if(SOLD_COLS.indexOf(col)!==-1){
      sh.getRange(row,COL.UPDATED).setValue(new Date());
      var diff=_int(e.value)-_int(e.oldValue);
      if(diff<=0)return;
      var product=sh.getRange(row,COL.NAME).getValue();
      if(!product)return;
      var sale=_num(sh.getRange(row,COL.SALE).getValue());
      var cost=_num(sh.getRange(row,COL.COST).getValue());
      var sizeMap={};sizeMap[COL.SOLD_M]="M";sizeMap[COL.SOLD_L]="L";sizeMap[COL.SOLD_XL]="XL";sizeMap[COL.SOLD_XXL]="XXL";
      _logTransaction([new Date(),product,"Sale",sizeMap[col],diff,diff*sale,diff*cost,diff*(sale-cost)]);
      return;
    }
    if(col===COL.STATUS&&e.value&&e.oldValue&&e.oldValue!==e.value){
      var p2=sh.getRange(row,COL.NAME).getValue();
      _logActivity(p2,e.oldValue,e.value);
    }
  }
  if(name==="DRAFT_VIEW"&&col===13&&row>=2){
    var action=e.value;
    var product=sh.getRange(row,2).getValue();
    if(!product||!action)return;
    var inv=ss.getSheetByName("INVENTORY");
    var lr=_getActualLastRow(inv,1);
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(product);
    if(idx===-1)return;
    var r=idx+2;
    if(action==="→ Activate"){
      inv.getRange(r,COL.STATUS).setValue("Active");
      inv.getRange(r,COL.UPDATED).setValue(new Date());
      _logActivity(product,"Draft","Active");
    } else if(action==="→ Archive"){
      inv.getRange(r,COL.STATUS).setValue("Archived");
      inv.getRange(r,COL.UPDATED).setValue(new Date());
      _logActivity(product,"Draft","Archived");
    }
    e.range.clearContent();
  }
  if(name==="ARCHIVE_VIEW"&&col===13&&row>=2){
    var action2=e.value;
    var product2=sh.getRange(row,2).getValue();
    if(!product2||!action2)return;
    var inv2=ss.getSheetByName("INVENTORY");
    var lr2=_getActualLastRow(inv2,1);
    var names2=inv2.getRange(2,1,lr2-1,1).getValues().flat();
    var idx2=names2.indexOf(product2);
    if(idx2===-1)return;
    var r2=idx2+2;
    var newSt=(action2==="→ Activate")?"Active":"Draft";
    inv2.getRange(r2,COL.STATUS).setValue(newSt);
    inv2.getRange(r2,COL.UPDATED).setValue(new Date());
    _logActivity(product2,"Archived",newSt);
    e.range.clearContent();
  }
}

// ════════════════════════════════════════════════════════
// ===== MENU =====
// ════════════════════════════════════════════════════════
function onOpen(){
  _ui().createMenu("🔧 YARZ PRO")
    .addItem("🚀 Create Full System","createFullSystem")
    .addItem("🔁 Migrate (Add Img4/5/6 + Coupon)","migrateAddNewColumns")
    .addSeparator()
    .addItem("🎛️ Inventory Studio","openInventoryStudio")
    .addItem("📦 Quick Add Product","openProductForm")
    .addItem("✏️ Edit Product","openProductEditSearch")
    .addItem("⚡ Quick Status Update","openQuickStatusUpdate")
    .addSeparator()
    .addItem("🛒 New Order","openOrderForm")
    .addItem("📢 Add Ad Spend","openAdForm")
    .addItem("💸 Add Expense","openExpenseForm")
    .addItem("🔄 Record Return","openReturnForm")
    .addSeparator()
    .addItem("📊 Generate Monthly Report","generateMonthlyReport")
    .addItem("📈 Generate Yearly Report","generateYearlyReport")
    .addItem("☁️ GitHub Sync Now","githubSyncNow")
    .addToUi();
}

function openInventoryStudio(){
  var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🎛️</span><h1>Inventory Studio</h1></div><div class="card"><div class="section-title">Quick Actions</div><div class="actions" style="flex-wrap:wrap"><button class="btn btn-primary" onclick="google.script.run.openProductForm();google.script.host.close();">📦 Add Product</button><button class="btn btn-secondary" onclick="google.script.run.openProductEditSearch();google.script.host.close();">✏️ Edit</button><button class="btn btn-secondary" onclick="google.script.run.openQuickStatusUpdate();google.script.host.close();">⚡ Status</button></div></div></div>';
  var out=HtmlService.createHtmlOutput(html).setWidth(420).setHeight(360);
  _ui().showModalDialog(out,"🎛️ Inventory Studio");
}

// ════════════════════════════════════════════════════════
// ===== PRODUCT FORM (Add) =====
// ════════════════════════════════════════════════════════
function openProductForm(){
  var catOpts=_buildOptions(getCategoryList());
  var fabOpts=_buildOptions(getFabricList());
  var badOpts=_buildOptions(getBadgeList());
  var discOpts=_buildOptions(DISC_TYPE_LIST,"Normal");
  var html=_sharedCSS()+_sharedJS()+
    '<div class="app"><div class="appbar"><span style="font-size:22px">📦</span><h1>Quick Add Product</h1></div>'+
    '<div class="field"><label>প্রোডাক্ট নাম<span class="req">*</span></label><input id="name" class="input" autofocus></div>'+
    '<div class="row"><div class="field"><label>Category</label><select id="cat" class="select">'+catOpts+'</select></div><div class="field"><label>Fabric</label><select id="fab" class="select">'+fabOpts+'</select></div></div>'+
    '<div class="row"><div class="field"><label>Badge</label><select id="bad" class="select">'+badOpts+'</select></div><div class="field"><label>Status<span class="req">*</span></label><select id="status" class="select"><option value="Draft">Draft</option><option value="Active">Active</option><option value="Archived">Archived</option></select></div></div>'+
    '<div class="row"><div class="field"><label>Disc Type</label><select id="dt" class="select">'+discOpts+'</select></div><div class="field"><label>Delivery Days</label><input id="ddays" class="input" value="2-3 days"></div></div>'+
    '<div class="section-title">🎁 Coupon Code</div>'+
    '<div class="row"><div class="field"><label>Coupon Active</label><select id="cAct" class="select"><option value="No">No</option><option value="Yes">Yes</option></select></div><div class="field"><label>Coupon Code</label><input id="cCode" class="input" placeholder="e.g. SAVE10"></div><div class="field"><label>Disc %</label><input id="cDisc" type="number" class="input" value="0"></div></div>'+
    '<div class="section-title">🖼️ মিডিয়া</div>'+
    '<div class="field"><label>Image 1 URL</label><input id="img1" class="input"></div>'+
    '<div class="row"><div class="field"><label>Image 2</label><input id="img2" class="input"></div><div class="field"><label>Image 3</label><input id="img3" class="input"></div></div>'+
    '<div class="row"><div class="field"><label>Image 4</label><input id="img4" class="input"></div><div class="field"><label>Image 5</label><input id="img5" class="input"></div><div class="field"><label>Image 6</label><input id="img6" class="input"></div></div>'+
    '<div class="field"><label>Video URL</label><input id="vid" class="input"></div>'+
    '<div class="section-title">📝 বিবরণ</div>'+
    '<div class="field"><label>Description</label><textarea id="desc" class="textarea"></textarea></div>'+
    '<div class="field"><label>Size Chart</label><textarea id="sc" class="textarea" style="min-height:50px"></textarea></div>'+
    '<div class="section-title">💰 মূল্য</div>'+
    '<div class="row"><div class="field"><label>Cost ৳<span class="req">*</span></label><input id="cost" type="number" class="input"></div><div class="field"><label>Regular ৳<span class="req">*</span></label><input id="reg" type="number" class="input"></div><div class="field"><label>Sale ৳<span class="req">*</span></label><input id="sale" type="number" class="input"></div></div>'+
    '<div class="section-title">🚚 ডেলিভারি</div>'+
    '<div class="row"><div class="field"><label>Dhaka ৳</label><input id="din" type="number" class="input" value="60"></div><div class="field"><label>Outside ৳</label><input id="dout" type="number" class="input" value="120"></div></div>'+
    '<div class="section-title">📊 স্টক</div>'+
    '<div class="row"><div class="field"><label>M</label><input id="sM" type="number" class="input" value="0"></div><div class="field"><label>L</label><input id="sL" type="number" class="input" value="0"></div><div class="field"><label>XL</label><input id="sXL" type="number" class="input" value="0"></div><div class="field"><label>XXL</label><input id="sXXL" type="number" class="input" value="0"></div></div>'+
    '<div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖ বাতিল</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 সেভ করো</button></div></div>'+
    '<script>function save(){if(!validateRequired(["name","cost","reg","sale"]))return;setLoading("saveBtn",true);var d={name:$("name").value.trim(),cat:$("cat").value,fab:$("fab").value,bad:$("bad").value,status:$("status").value,dt:$("dt").value,img1:$("img1").value.trim(),img2:$("img2").value.trim(),img3:$("img3").value.trim(),img4:$("img4").value.trim(),img5:$("img5").value.trim(),img6:$("img6").value.trim(),vid:$("vid").value.trim(),desc:$("desc").value,sc:$("sc").value,cost:parseFloat($("cost").value)||0,reg:parseFloat($("reg").value)||0,sale:parseFloat($("sale").value)||0,din:parseFloat($("din").value)||60,dout:parseFloat($("dout").value)||120,ddays:$("ddays").value,sM:parseInt($("sM").value)||0,sL:parseInt($("sL").value)||0,sXL:parseInt($("sXL").value)||0,sXXL:parseInt($("sXXL").value)||0,cAct:$("cAct").value,cCode:$("cCode").value.trim(),cDisc:parseFloat($("cDisc").value)||0};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("প্রোডাক্ট সেভ হয়েছে!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).withFailureHandler(function(e){setLoading("saveBtn",false);showError(e.message);}).saveProductFromForm(d);}</script>';
  var out=HtmlService.createHtmlOutput(html).setWidth(520).setHeight(840);
  _ui().showModalDialog(out,"📦 Quick Add");
}

// ════════════════════════════════════════════════════════
// ✅ saveProductFromForm — writes ALL columns including Img4/5/6 + Coupon
// ════════════════════════════════════════════════════════
function saveProductFromForm(d){
  try{
    var ss=_ss();
    var inv=ss.getSheetByName("INVENTORY");
    if(!inv)return{ok:false,msg:"INVENTORY নেই"};
    if(!d || !d.name)return{ok:false,msg:"নাম দরকার"};
    _ensureColumns(inv, 45);
    var lr=_getActualLastRow(inv,1);
    if(lr>=2){
      var names=inv.getRange(2,1,lr-1,1).getValues().flat();
      if(names.indexOf(d.name)!==-1)return{ok:false,msg:"এই নামে already আছে"};
    }
    var row=lr+1;
    _ensureRows(inv,row);

    // BUILD row array (1..45) for batch write
    var rowVals = new Array(45).fill("");
    rowVals[COL.NAME-1]          = d.name;
    rowVals[COL.IMG-1]           = _str(d.img1);
    rowVals[COL.IMG2-1]          = _str(d.img2);
    rowVals[COL.IMG3-1]          = _str(d.img3);
    rowVals[COL.VIDEO-1]         = _str(d.vid);
    rowVals[COL.DESC-1]          = _str(d.desc);
    rowVals[COL.CATEGORY-1]      = _str(d.cat);
    rowVals[COL.FABRIC-1]        = _str(d.fab);
    rowVals[COL.BADGE-1]         = _str(d.bad);
    rowVals[COL.SIZE_CHART-1]    = _str(d.sc);
    rowVals[COL.DELIVERY_DAYS-1] = _str(d.ddays || "2-3 days");
    rowVals[COL.COST-1]          = _num(d.cost);
    rowVals[COL.REG-1]           = _num(d.reg);
    rowVals[COL.SALE-1]          = _num(d.sale);
    // DISC_PCT (col 15) is formula — skip
    rowVals[COL.DISC_TYPE-1]     = _str(d.dt || "Normal");
    rowVals[COL.DELIVERY_IN-1]   = _num(d.din)||60;
    rowVals[COL.DELIVERY_OUT-1]  = _num(d.dout)||120;
    rowVals[COL.STK_M-1]         = _int(d.sM);
    rowVals[COL.STK_L-1]         = _int(d.sL);
    rowVals[COL.STK_XL-1]        = _int(d.sXL);
    rowVals[COL.STK_XXL-1]       = _int(d.sXXL);
    rowVals[COL.SOLD_M-1]        = 0;
    rowVals[COL.SOLD_L-1]        = 0;
    rowVals[COL.SOLD_XL-1]       = 0;
    rowVals[COL.SOLD_XXL-1]      = 0;
    // 27..37 (TOT_SOLD..DISC_IMPACT) are formulas — skip
    rowVals[COL.UPDATED-1]       = new Date();
    rowVals[COL.STATUS-1]        = _str(d.status || "Draft");
    rowVals[COL.IMG4-1]          = _str(d.img4);
    rowVals[COL.IMG5-1]          = _str(d.img5);
    rowVals[COL.IMG6-1]          = _str(d.img6);
    rowVals[COL.C_ACT-1]         = _str(d.cAct || "No");
    rowVals[COL.C_CODE-1]        = _str(d.cCode);
    rowVals[COL.C_DISC-1]        = _num(d.cDisc);

    // Write columns individually (skip formula cols)
    var skip = {15:1, 27:1,28:1,29:1,30:1,31:1,32:1,33:1,34:1,35:1,36:1,37:1};
    for(var c=1; c<=45; c++){
      if(skip[c]) continue;
      inv.getRange(row, c).setValue(rowVals[c-1]);
    }

    _restoreInventoryFormulas(inv);
    _logActivity(d.name, "", _str(d.status || "Draft"));
    return {ok:true, success:true};
  }catch(err){
    return {ok:false, msg:err.message};
  }
}

// ════════════════════════════════════════════════════════
// ===== PRODUCT EDIT — Search + Form =====
// ════════════════════════════════════════════════════════
function openProductEditSearch(){
  var ss=_ss();
  var inv=ss.getSheetByName("INVENTORY");
  var lr=inv?_getActualLastRow(inv,1):1;
  if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}
  var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();
  var items=data.filter(function(r){return r[0];}).map(function(r){
    return{name:r[COL.NAME-1],img:r[COL.IMG-1]||"",cat:r[COL.CATEGORY-1]||"",sale:_num(r[COL.SALE-1]),status:r[COL.STATUS-1]||""};
  });
  var json=JSON.stringify(items).replace(/</g,"\\u003c");
  var html=_sharedCSS()+_sharedJS()+
    '<div class="app"><div class="appbar"><span style="font-size:22px">✏️</span><h1>Product Edit</h1><span class="badge">'+items.length+'</span></div>'+
    '<div class="field"><input id="q" class="input" placeholder="🔍 খুঁজুন..." oninput="render()" autofocus></div>'+
    '<div id="list"></div></div>'+
    '<script>var LIST='+json+';function render(){var q=($("q").value||"").toLowerCase().trim();var h="";LIST.forEach(function(x){if(q&&x.name.toLowerCase().indexOf(q)===-1)return;h+=\'<div class="card" style="display:flex;gap:10px;align-items:center"><div style="flex:1"><div style="font-weight:700">\'+x.name+\'</div><div style="font-size:11px;color:#6B7280">\'+x.cat+\' • ৳\'+x.sale+\' • \'+x.status+\'</div></div><button class="btn btn-primary" style="width:auto;padding:8px 12px" onclick="edit(\\\''+'\'+x.name.replace(/\'/g,"&apos;").replace(/\\\\/g,"\\\\\\\\")+\'\\\')">✏ Edit</button></div>\';});$("list").innerHTML=h||\'<p style="text-align:center;color:#6B7280">কিছু পাওয়া যায়নি</p>\';}function edit(name){google.script.run.openProductEditForm(name);google.script.host.close();}render();</script>';
  var out=HtmlService.createHtmlOutput(html).setWidth(480).setHeight(640);
  _ui().showModalDialog(out,"✏️ Product Edit");
}

function openProductEditForm(productName){
  var ss=_ss();
  var inv=ss.getSheetByName("INVENTORY");
  var lr=_getActualLastRow(inv,1);
  if(lr<2){_ui().alert("Not found");return;}
  var names=inv.getRange(2,1,lr-1,1).getValues().flat();
  var idx=names.indexOf(productName);
  if(idx===-1){_ui().alert("পাওয়া যায়নি!");return;}
  var row=idx+2;
  _ensureColumns(inv, 45);
  var r=inv.getRange(row,1,1,45).getValues()[0];
  var p={
    name:r[COL.NAME-1],
    img1:r[COL.IMG-1]||"",img2:r[COL.IMG2-1]||"",img3:r[COL.IMG3-1]||"",
    img4:r[COL.IMG4-1]||"",img5:r[COL.IMG5-1]||"",img6:r[COL.IMG6-1]||"",
    vid:r[COL.VIDEO-1]||"",desc:r[COL.DESC-1]||"",
    cat:r[COL.CATEGORY-1]||"",fab:r[COL.FABRIC-1]||"",bad:r[COL.BADGE-1]||"",
    sc:r[COL.SIZE_CHART-1]||"",ddays:r[COL.DELIVERY_DAYS-1]||"2-3 days",
    cost:_num(r[COL.COST-1]),reg:_num(r[COL.REG-1]),sale:_num(r[COL.SALE-1]),
    dt:r[COL.DISC_TYPE-1]||"Normal",
    din:_num(r[COL.DELIVERY_IN-1])||60,dout:_num(r[COL.DELIVERY_OUT-1])||120,
    sM:_int(r[COL.STK_M-1]),sL:_int(r[COL.STK_L-1]),sXL:_int(r[COL.STK_XL-1]),sXXL:_int(r[COL.STK_XXL-1]),
    status:r[COL.STATUS-1]||"Draft",
    cAct:r[COL.C_ACT-1]||"No",
    cCode:r[COL.C_CODE-1]||"",
    cDisc:_num(r[COL.C_DISC-1])
  };
  var catOpts=_buildOptions(getCategoryList(),p.cat);
  var fabOpts=_buildOptions(getFabricList(),p.fab);
  var badOpts=_buildOptions(getBadgeList(),p.bad);
  var discOpts=_buildOptions(DISC_TYPE_LIST,p.dt);
  var esc=function(s){return String(_safe(s)).replace(/"/g,'&quot;');};
  var html=_sharedCSS()+_sharedJS()+
    '<div class="app"><div class="appbar"><span style="font-size:22px">✏️</span><h1>Edit: '+esc(p.name).substring(0,20)+'</h1></div>'+
    '<div class="field"><label>নাম<span class="req">*</span></label><input id="name" class="input" value="'+esc(p.name)+'"></div>'+
    '<div class="row"><div class="field"><label>Category</label><select id="cat" class="select">'+catOpts+'</select></div><div class="field"><label>Fabric</label><select id="fab" class="select">'+fabOpts+'</select></div></div>'+
    '<div class="row"><div class="field"><label>Badge</label><select id="bad" class="select">'+badOpts+'</select></div><div class="field"><label>Status</label><select id="status" class="select"><option value="Active"'+(p.status==="Active"?" selected":"")+'>Active</option><option value="Draft"'+(p.status==="Draft"?" selected":"")+'>Draft</option><option value="Archived"'+(p.status==="Archived"?" selected":"")+'>Archived</option></select></div></div>'+
    '<div class="row"><div class="field"><label>Disc Type</label><select id="dt" class="select">'+discOpts+'</select></div><div class="field"><label>Days</label><input id="ddays" class="input" value="'+esc(p.ddays)+'"></div></div>'+
    '<div class="section-title">🎁 Coupon</div>'+
    '<div class="row"><div class="field"><label>Coupon Active</label><select id="cAct" class="select"><option value="No"'+(p.cAct!=="Yes"?" selected":"")+'>No</option><option value="Yes"'+(p.cAct==="Yes"?" selected":"")+'>Yes</option></select></div><div class="field"><label>Coupon Code</label><input id="cCode" class="input" value="'+esc(p.cCode)+'"></div><div class="field"><label>Disc %</label><input id="cDisc" type="number" class="input" value="'+p.cDisc+'"></div></div>'+
    '<div class="section-title">🖼️ মিডিয়া</div>'+
    '<div class="field"><label>Image 1</label><input id="img1" class="input" value="'+esc(p.img1)+'"></div>'+
    '<div class="row"><div class="field"><label>Image 2</label><input id="img2" class="input" value="'+esc(p.img2)+'"></div><div class="field"><label>Image 3</label><input id="img3" class="input" value="'+esc(p.img3)+'"></div></div>'+
    '<div class="row"><div class="field"><label>Image 4</label><input id="img4" class="input" value="'+esc(p.img4)+'"></div><div class="field"><label>Image 5</label><input id="img5" class="input" value="'+esc(p.img5)+'"></div><div class="field"><label>Image 6</label><input id="img6" class="input" value="'+esc(p.img6)+'"></div></div>'+
    '<div class="field"><label>Video</label><input id="vid" class="input" value="'+esc(p.vid)+'"></div>'+
    '<div class="section-title">📝 বিবরণ</div>'+
    '<div class="field"><label>Description</label><textarea id="desc" class="textarea">'+String(p.desc).replace(/</g,'&lt;')+'</textarea></div>'+
    '<div class="field"><label>Size Chart</label><textarea id="sc" class="textarea" style="min-height:50px">'+String(p.sc).replace(/</g,'&lt;')+'</textarea></div>'+
    '<div class="section-title">💰 মূল্য</div>'+
    '<div class="row"><div class="field"><label>Cost ৳</label><input id="cost" type="number" class="input" value="'+p.cost+'"></div><div class="field"><label>Regular ৳</label><input id="reg" type="number" class="input" value="'+p.reg+'"></div><div class="field"><label>Sale ৳</label><input id="sale" type="number" class="input" value="'+p.sale+'"></div></div>'+
    '<div class="section-title">🚚 ডেলিভারি</div>'+
    '<div class="row"><div class="field"><label>Dhaka ৳</label><input id="din" type="number" class="input" value="'+p.din+'"></div><div class="field"><label>Outside ৳</label><input id="dout" type="number" class="input" value="'+p.dout+'"></div></div>'+
    '<div class="section-title">📊 স্টক</div>'+
    '<div class="row"><div class="field"><label>M</label><input id="sM" type="number" class="input" value="'+p.sM+'"></div><div class="field"><label>L</label><input id="sL" type="number" class="input" value="'+p.sL+'"></div><div class="field"><label>XL</label><input id="sXL" type="number" class="input" value="'+p.sXL+'"></div><div class="field"><label>XXL</label><input id="sXXL" type="number" class="input" value="'+p.sXXL+'"></div></div>'+
    '<div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">← Back</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Update</button></div></div>'+
    '<script>var ORIG_NAME="'+productName.replace(/"/g,'\\"')+'";function save(){if(!validateRequired(["name"]))return;setLoading("saveBtn",true);var d={origName:ORIG_NAME,name:$("name").value.trim(),cat:$("cat").value,fab:$("fab").value,bad:$("bad").value,status:$("status").value,dt:$("dt").value,img1:$("img1").value.trim(),img2:$("img2").value.trim(),img3:$("img3").value.trim(),img4:$("img4").value.trim(),img5:$("img5").value.trim(),img6:$("img6").value.trim(),vid:$("vid").value.trim(),desc:$("desc").value,sc:$("sc").value,cost:parseFloat($("cost").value)||0,reg:parseFloat($("reg").value)||0,sale:parseFloat($("sale").value)||0,din:parseFloat($("din").value)||60,dout:parseFloat($("dout").value)||120,ddays:$("ddays").value,sM:parseInt($("sM").value)||0,sL:parseInt($("sL").value)||0,sXL:parseInt($("sXL").value)||0,sXXL:parseInt($("sXXL").value)||0,cAct:$("cAct").value,cCode:$("cCode").value.trim(),cDisc:parseFloat($("cDisc").value)||0};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Updated!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).withFailureHandler(function(e){setLoading("saveBtn",false);showError(e.message);}).saveProductEditFromForm(d);}</script>';
  var out=HtmlService.createHtmlOutput(html).setWidth(520).setHeight(840);
  _ui().showModalDialog(out,"✏️ Edit: "+productName);
}

// ════════════════════════════════════════════════════════
// ✅ saveProductEditFromForm — updates ALL fields incl. Img4/5/6 + Coupon
// ════════════════════════════════════════════════════════
function saveProductEditFromForm(d){
  try{
    var ss=_ss();
    var inv=ss.getSheetByName("INVENTORY");
    if(!inv)return{ok:false,msg:"INVENTORY নেই"};
    if(!d || !d.origName)return{ok:false,msg:"origName দরকার"};
    _ensureColumns(inv, 45);
    var lr=_getActualLastRow(inv,1);
    if(lr<2)return{ok:false,msg:"নেই"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(d.origName);
    if(idx===-1)return{ok:false,msg:"পাওয়া যায়নি"};
    var row=idx+2;
    var oldStatus=inv.getRange(row,COL.STATUS).getValue();

    // Set fields one-by-one (cleaner & safer for formula-cells)
    inv.getRange(row,COL.NAME).setValue(d.name);
    inv.getRange(row,COL.IMG).setValue(_str(d.img1));
    inv.getRange(row,COL.IMG2).setValue(_str(d.img2));
    inv.getRange(row,COL.IMG3).setValue(_str(d.img3));
    inv.getRange(row,COL.VIDEO).setValue(_str(d.vid));
    inv.getRange(row,COL.DESC).setValue(_str(d.desc));
    inv.getRange(row,COL.CATEGORY).setValue(_str(d.cat));
    inv.getRange(row,COL.FABRIC).setValue(_str(d.fab));
    inv.getRange(row,COL.BADGE).setValue(_str(d.bad));
    inv.getRange(row,COL.SIZE_CHART).setValue(_str(d.sc));
    inv.getRange(row,COL.DELIVERY_DAYS).setValue(_str(d.ddays || "2-3 days"));
    inv.getRange(row,COL.COST).setValue(_num(d.cost));
    inv.getRange(row,COL.REG).setValue(_num(d.reg));
    inv.getRange(row,COL.SALE).setValue(_num(d.sale));
    inv.getRange(row,COL.DISC_TYPE).setValue(_str(d.dt || "Normal"));
    inv.getRange(row,COL.DELIVERY_IN).setValue(_num(d.din)||60);
    inv.getRange(row,COL.DELIVERY_OUT).setValue(_num(d.dout)||120);
    inv.getRange(row,COL.STK_M).setValue(_int(d.sM));
    inv.getRange(row,COL.STK_L).setValue(_int(d.sL));
    inv.getRange(row,COL.STK_XL).setValue(_int(d.sXL));
    inv.getRange(row,COL.STK_XXL).setValue(_int(d.sXXL));
    inv.getRange(row,COL.STATUS).setValue(_str(d.status || oldStatus || "Draft"));
    inv.getRange(row,COL.UPDATED).setValue(new Date());

    // ✅ FIX: Image 4/5/6 + Coupon — these were previously broken
    inv.getRange(row,COL.IMG4).setValue(_str(d.img4));
    inv.getRange(row,COL.IMG5).setValue(_str(d.img5));
    inv.getRange(row,COL.IMG6).setValue(_str(d.img6));
    inv.getRange(row,COL.C_ACT).setValue(_str(d.cAct || "No"));
    inv.getRange(row,COL.C_CODE).setValue(_str(d.cCode));
    inv.getRange(row,COL.C_DISC).setValue(_num(d.cDisc));

    _restoreInventoryFormulas(inv);
    if(oldStatus!==(d.status||oldStatus)) _logActivity(d.name,oldStatus,d.status);
    return {ok:true, success:true};
  }catch(err){
    return {ok:false, msg:err.message};
  }
}

// ════════════════════════════════════════════════════════
// ===== Product Status Update / Stock Change / Bulk Edit =====
// ════════════════════════════════════════════════════════
function updateProductStatus(d){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    if(!inv)return{ok:false,msg:"INVENTORY নেই"};
    var lr=_getActualLastRow(inv,1);
    if(lr<2)return{ok:false,msg:"empty"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(d.name);
    if(idx===-1)return{ok:false,msg:"না পাওয়া"};
    var row=idx+2;
    var old=inv.getRange(row,COL.STATUS).getValue();
    inv.getRange(row,COL.STATUS).setValue(d.status);
    inv.getRange(row,COL.UPDATED).setValue(new Date());
    _logActivity(d.name,old,d.status);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

function applyStockChange(d){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    var lr=_getActualLastRow(inv,1);
    if(lr<2)return{ok:false,msg:"empty"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(d.name);
    if(idx===-1)return{ok:false,msg:"not found"};
    var row=idx+2;
    var sizeMap={M:COL.STK_M,L:COL.STK_L,XL:COL.STK_XL,XXL:COL.STK_XXL};
    var col=sizeMap[d.size];
    if(!col)return{ok:false,msg:"size"};
    var cur=_int(inv.getRange(row,col).getValue());
    inv.getRange(row,col).setValue(cur + _int(d.delta));
    inv.getRange(row,COL.UPDATED).setValue(new Date());
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

function applyBulkEdit(d){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    var lr=_getActualLastRow(inv,1);
    if(lr<2)return{ok:false,msg:"empty"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    (d.products||[]).forEach(function(name){
      var idx=names.indexOf(name);
      if(idx===-1)return;
      var row=idx+2;
      if(d.status) inv.getRange(row,COL.STATUS).setValue(d.status);
      if(d.category) inv.getRange(row,COL.CATEGORY).setValue(d.category);
      if(d.badge!==undefined) inv.getRange(row,COL.BADGE).setValue(d.badge);
      inv.getRange(row,COL.UPDATED).setValue(new Date());
    });
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

// ════════════════════════════════════════════════════════
// ===== Quick Status Update Dialog =====
// ════════════════════════════════════════════════════════
function openQuickStatusUpdate(){
  var inv=_ss().getSheetByName("INVENTORY");
  var lr=inv?_getActualLastRow(inv,1):1;
  if(lr<2){_ui().alert("কোনো প্রোডাক্ট নেই!");return;}
  var data=inv.getRange(2,1,lr-1,COL.TOTAL).getValues();
  var items=data.filter(function(r){return r[0];}).map(function(r){return{name:r[COL.NAME-1],status:r[COL.STATUS-1]||""};});
  var json=JSON.stringify(items).replace(/</g,"\\u003c");
  var html=_sharedCSS()+_sharedJS()+
    '<div class="app"><div class="appbar"><span style="font-size:22px">⚡</span><h1>Quick Status</h1></div>'+
    '<input id="q" class="input" placeholder="🔍 খুঁজুন..." oninput="render()" autofocus>'+
    '<div id="list"></div></div>'+
    '<script>var LIST='+json+';function render(){var q=($("q").value||"").toLowerCase().trim();var h="";LIST.forEach(function(x,i){if(q&&x.name.toLowerCase().indexOf(q)===-1)return;h+=\'<div class="card"><div style="font-weight:700">\'+x.name+\'</div><div style="font-size:11px;color:#6B7280;margin-bottom:6px">\'+x.status+\'</div><select class="select" onchange="upd(\'+i+\',this.value)"><option value="">- Change -</option><option value="Active">Active</option><option value="Draft">Draft</option><option value="Archived">Archived</option></select></div>\';});$("list").innerHTML=h;}function upd(i,s){if(!s)return;google.script.run.withSuccessHandler(function(r){if(r&&r.ok){LIST[i].status=s;toast(LIST[i].name+" → "+s);render();}}).updateProductStatus({name:LIST[i].name,status:s});}render();</script>';
  var out=HtmlService.createHtmlOutput(html).setWidth(460).setHeight(640);
  _ui().showModalDialog(out,"⚡ Quick Status");
}

// ════════════════════════════════════════════════════════
// ===== ORDER FORM / MANUAL ORDERS =====
// ════════════════════════════════════════════════════════
function openOrderForm(){
  var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🛒</span><h1>New Order</h1></div><div class="field"><label>Customer*</label><input id="cust" class="input" autofocus></div><div class="field"><label>Phone*</label><input id="ph" class="input"></div><div class="field"><label>Address</label><textarea id="addr" class="textarea"></textarea></div><div class="row"><div class="field"><label>Location</label><select id="loc" class="select"><option>Dhaka</option><option>Outside</option></select></div><div class="field"><label>Payment</label><select id="pay" class="select"><option>COD</option><option>bKash</option><option>Nagad</option><option>Bank</option></select></div></div><div class="field"><label>Product*</label><input id="prod" class="input"></div><div class="row"><div class="field"><label>Size</label><select id="sz" class="select"><option>M</option><option>L</option><option>XL</option><option>XXL</option></select></div><div class="field"><label>Qty</label><input id="qty" type="number" class="input" value="1"></div><div class="field"><label>Price</label><input id="price" type="number" class="input"></div></div><div class="field"><label>Delivery</label><input id="dlv" type="number" class="input" value="60"></div><div class="field"><label>Notes</label><textarea id="notes" class="textarea"></textarea></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Save</button></div></div><script>function save(){if(!validateRequired(["cust","ph","prod","price"]))return;setLoading("saveBtn",true);var d={cust:$("cust").value,ph:$("ph").value,addr:$("addr").value,loc:$("loc").value,pay:$("pay").value,prod:$("prod").value,sz:$("sz").value,qty:parseInt($("qty").value)||1,price:parseFloat($("price").value)||0,dlv:parseFloat($("dlv").value)||0,notes:$("notes").value};google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Order saved!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).saveOrderFromForm(d);}</script>';
  var out=HtmlService.createHtmlOutput(html).setWidth(460).setHeight(720);
  _ui().showModalDialog(out,"🛒 New Order");
}

function saveOrderFromForm(d){
  try{
    var sh=_ss().getSheetByName("ORDERS");
    if(!sh)return{ok:false,msg:"ORDERS নেই"};
    var next=_getActualLastRow(sh,1)+1;
    _ensureRows(sh,next);
    var orderId="ORD-"+Date.now();
    var total=(_num(d.price)*_int(d.qty))+_num(d.dlv);
    sh.getRange(next,1,1,16).setValues([[
      new Date(),orderId,d.cust,d.ph,d.addr,d.loc,d.prod,d.sz,d.qty,d.price,d.dlv,total,d.pay,"Pending","",d.notes
    ]]);
    return{ok:true,success:true,orderId:orderId};
  }catch(e){return{ok:false,msg:e.message};}
}

function _webSaveOrderWithStatus(body){return saveOrderFromForm(body);}

function _webUpdateManualOrderStatus(body){
  try{
    var sh=_ss().getSheetByName("ORDERS");
    if(!sh)return{ok:false,msg:"ORDERS নেই"};
    var lr=_getActualLastRow(sh,1);
    if(lr<2)return{ok:false,msg:"empty"};
    var ids=sh.getRange(2,2,lr-1,1).getValues().flat();
    var idx=ids.indexOf(body.orderId);
    if(idx===-1)return{ok:false,msg:"not found"};
    sh.getRange(idx+2,14).setValue(body.status);
    if(body.courier)sh.getRange(idx+2,15).setValue(body.courier);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

function _webDeleteManualOrder(body){
  try{
    var sh=_ss().getSheetByName("ORDERS");
    if(!sh)return{ok:false,msg:"ORDERS নেই"};
    var lr=_getActualLastRow(sh,1);
    if(lr<2)return{ok:false,msg:"empty"};
    var ids=sh.getRange(2,2,lr-1,1).getValues().flat();
    var idx=ids.indexOf(body.orderId);
    if(idx===-1)return{ok:false,msg:"not found"};
    sh.deleteRow(idx+2);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

// ════════════════════════════════════════════════════════
// ===== AD / EXPENSE / RETURN FORMS =====
// ════════════════════════════════════════════════════════
function openAdForm(){
  var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">📢</span><h1>Add Ad Spend</h1></div><div class="field"><label>Product*</label><input id="prod" class="input" autofocus></div><div class="field"><label>Spend ৳*</label><input id="spend" type="number" class="input"></div><div class="row"><div class="field"><label>Reach</label><input id="reach" type="number" class="input"></div><div class="field"><label>Impressions</label><input id="imp" type="number" class="input"></div><div class="field"><label>Clicks</label><input id="cl" type="number" class="input"></div></div><div class="field"><label>Notes</label><textarea id="nt" class="textarea"></textarea></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Save</button></div></div><script>function save(){if(!validateRequired(["prod","spend"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Ad saved!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).saveAdFromForm({prod:$("prod").value,spend:parseFloat($("spend").value)||0,reach:parseInt($("reach").value)||0,imp:parseInt($("imp").value)||0,cl:parseInt($("cl").value)||0,nt:$("nt").value});}</script>';
  _ui().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(540),"📢 Ad Spend");
}

function saveAdFromForm(d){
  try{
    var sh=_ss().getSheetByName("AD_TRACKER");
    var next=_getActualLastRow(sh,1)+1;
    _ensureRows(sh,next);
    sh.getRange(next,1,1,7).setValues([[new Date(),d.prod,_num(d.spend),_int(d.reach),_int(d.imp),_int(d.cl),_str(d.nt)]]);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

function openExpenseForm(){
  var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">💸</span><h1>Add Expense</h1></div><div class="field"><label>Category*</label><input id="cat" class="input" autofocus></div><div class="field"><label>Description</label><input id="desc" class="input"></div><div class="field"><label>Amount ৳*</label><input id="amt" type="number" class="input"></div><div class="field"><label>Notes</label><textarea id="nt" class="textarea"></textarea></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Save</button></div></div><script>function save(){if(!validateRequired(["cat","amt"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Saved!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).saveExpenseFromForm({cat:$("cat").value,desc:$("desc").value,amt:parseFloat($("amt").value)||0,nt:$("nt").value});}</script>';
  _ui().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(480),"💸 Expense");
}

function saveExpenseFromForm(d){
  try{
    var sh=_ss().getSheetByName("EXPENSES");
    var next=_getActualLastRow(sh,1)+1;
    _ensureRows(sh,next);
    sh.getRange(next,1,1,5).setValues([[new Date(),_str(d.cat),_str(d.desc),_num(d.amt),_str(d.nt)]]);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

function openReturnForm(){
  var html=_sharedCSS()+_sharedJS()+'<div class="app"><div class="appbar"><span style="font-size:22px">🔄</span><h1>Record Return</h1></div><div class="field"><label>Product*</label><input id="prod" class="input" autofocus></div><div class="row"><div class="field"><label>Size</label><select id="sz" class="select"><option>M</option><option>L</option><option>XL</option><option>XXL</option></select></div><div class="field"><label>Qty*</label><input id="qty" type="number" class="input" value="1"></div></div><div class="field"><label>Notes</label><textarea id="nt" class="textarea"></textarea></div><div class="actions"><button class="btn btn-secondary" onclick="google.script.host.close()">✖</button><button id="saveBtn" class="btn btn-primary" onclick="save()">💾 Save</button></div></div><script>function save(){if(!validateRequired(["prod","qty"]))return;setLoading("saveBtn",true);google.script.run.withSuccessHandler(function(r){if(r&&r.ok)showSuccess("Saved!");else{setLoading("saveBtn",false);showError(r&&r.msg);}}).saveReturnFromForm({prod:$("prod").value,sz:$("sz").value,qty:parseInt($("qty").value)||1,nt:$("nt").value});}</script>';
  _ui().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(460).setHeight(440),"🔄 Return");
}

function saveReturnFromForm(d){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    var lr=_getActualLastRow(inv,1);
    var sale=0,cost=0;
    if(lr>=2){
      var names=inv.getRange(2,1,lr-1,1).getValues().flat();
      var idx=names.indexOf(d.prod);
      if(idx>-1){
        sale=_num(inv.getRange(idx+2,COL.SALE).getValue());
        cost=_num(inv.getRange(idx+2,COL.COST).getValue());
      }
    }
    var qty=_int(d.qty)||1;
    _logTransaction([new Date(),d.prod,"Return",d.sz,qty,qty*sale,qty*cost,qty*(sale-cost)]);
    return{ok:true,success:true};
  }catch(e){return{ok:false,msg:e.message};}
}

// ════════════════════════════════════════════════════════
// ===== REPORTS =====
// ════════════════════════════════════════════════════════
function generateMonthlyReport(){
  try{
    var ss=_ss();
    var tx=ss.getSheetByName("TRANSACTIONS");
    var ad=ss.getSheetByName("AD_TRACKER");
    var ord=ss.getSheetByName("ORDERS");
    var rep=ss.getSheetByName("MONTHLY_REPORT");
    if(!rep)return;
    rep.getRange(2,1,200,6).clearContent();
    var months={};
    if(tx){
      var lr=_getActualLastRow(tx,1);
      if(lr>=2){
        var rows=tx.getRange(2,1,lr-1,8).getValues();
        rows.forEach(function(r){
          if(!r[0])return;
          var d=new Date(r[0]);
          var key=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2);
          if(!months[key])months[key]={rev:0,cost:0,ad:0,ord:0};
          if(r[2]==="Sale"){months[key].rev+=_num(r[5]);months[key].cost+=_num(r[6]);}
          else if(r[2]==="Return"){months[key].rev-=_num(r[5]);months[key].cost-=_num(r[6]);}
        });
      }
    }
    if(ad){
      var alr=_getActualLastRow(ad,1);
      if(alr>=2){
        var arows=ad.getRange(2,1,alr-1,7).getValues();
        arows.forEach(function(r){
          if(!r[0])return;
          var d=new Date(r[0]);
          var key=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2);
          if(!months[key])months[key]={rev:0,cost:0,ad:0,ord:0};
          months[key].ad+=_num(r[2]);
        });
      }
    }
    if(ord){
      var olr=_getActualLastRow(ord,1);
      if(olr>=2){
        var orows=ord.getRange(2,1,olr-1,1).getValues();
        orows.forEach(function(r){
          if(!r[0])return;
          var d=new Date(r[0]);
          var key=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2);
          if(!months[key])months[key]={rev:0,cost:0,ad:0,ord:0};
          months[key].ord+=1;
        });
      }
    }
    var keys=Object.keys(months).sort();
    var out=keys.map(function(k){var m=months[k];return [k,m.rev,m.cost,m.ad,m.rev-m.cost-m.ad,m.ord];});
    if(out.length)rep.getRange(2,1,out.length,6).setValues(out);
  }catch(e){}
}

function generateYearlyReport(){
  try{
    var ss=_ss();
    var tx=ss.getSheetByName("TRANSACTIONS");
    var ad=ss.getSheetByName("AD_TRACKER");
    var ord=ss.getSheetByName("ORDERS");
    var rep=ss.getSheetByName("YEARLY_REPORT");
    if(!rep)return;
    rep.getRange(2,1,50,6).clearContent();
    var years={};
    if(tx){
      var lr=_getActualLastRow(tx,1);
      if(lr>=2){
        var rows=tx.getRange(2,1,lr-1,8).getValues();
        rows.forEach(function(r){
          if(!r[0])return;
          var y=new Date(r[0]).getFullYear();
          if(!years[y])years[y]={rev:0,cost:0,ad:0,ord:0};
          if(r[2]==="Sale"){years[y].rev+=_num(r[5]);years[y].cost+=_num(r[6]);}
          else if(r[2]==="Return"){years[y].rev-=_num(r[5]);years[y].cost-=_num(r[6]);}
        });
      }
    }
    if(ad){
      var alr=_getActualLastRow(ad,1);
      if(alr>=2){
        var arows=ad.getRange(2,1,alr-1,7).getValues();
        arows.forEach(function(r){
          if(!r[0])return;
          var y=new Date(r[0]).getFullYear();
          if(!years[y])years[y]={rev:0,cost:0,ad:0,ord:0};
          years[y].ad+=_num(r[2]);
        });
      }
    }
    if(ord){
      var olr=_getActualLastRow(ord,1);
      if(olr>=2){
        var orows=ord.getRange(2,1,olr-1,1).getValues();
        orows.forEach(function(r){
          if(!r[0])return;
          var y=new Date(r[0]).getFullYear();
          if(!years[y])years[y]={rev:0,cost:0,ad:0,ord:0};
          years[y].ord+=1;
        });
      }
    }
    var keys=Object.keys(years).sort();
    var out=keys.map(function(k){var m=years[k];return [k,m.rev,m.cost,m.ad,m.rev-m.cost-m.ad,m.ord];});
    if(out.length)rep.getRange(2,1,out.length,6).setValues(out);
  }catch(e){}
}

// ════════════════════════════════════════════════════════
// ===== GITHUB SYNC (publishes WEBSITE_SYNC + Settings as JSON) =====
// ════════════════════════════════════════════════════════
function saveGitHubSettings(body){
  try{
    var sh=_ss().getSheetByName("SETTINGS");
    var s={"GitHub Token":body.token,"GitHub Repo":body.repo,"GitHub Branch":body.branch||"main","GitHub Path":body.path||"data.json"};
    return _webUpdateSettings({settings:s});
  }catch(e){return{ok:false,msg:e.message};}
}

function githubSyncNow(){
  var s=_getSettingsMap();
  var token=String(_safe(s["GitHub Token"]||"")).trim();
  var repo=String(_safe(s["GitHub Repo"]||"")).trim();
  var branch=String(_safe(s["GitHub Branch"]||"main")).trim();
  var path=String(_safe(s["GitHub Path"]||"data.json")).trim();
  if(!token || !repo) throw new Error("GitHub Token / Repo missing in SETTINGS");
  // Build payload
  var data=_buildPublicData();
  var content=Utilities.base64Encode(Utilities.newBlob(JSON.stringify(data,null,2),"application/json").getBytes());
  var url="https://api.github.com/repos/"+repo+"/contents/"+encodeURI(path)+"?ref="+encodeURIComponent(branch);
  var headers={"Authorization":"Bearer "+token,"Accept":"application/vnd.github+json"};
  var sha="";
  try{
    var resp=UrlFetchApp.fetch(url,{method:"get",headers:headers,muteHttpExceptions:true});
    if(resp.getResponseCode()===200){var j=JSON.parse(resp.getContentText());sha=j.sha||"";}
  }catch(e){}
  var body={message:"YARZ sync "+new Date().toISOString(),content:content,branch:branch};
  if(sha)body.sha=sha;
  var put=UrlFetchApp.fetch("https://api.github.com/repos/"+repo+"/contents/"+encodeURI(path),{
    method:"put",headers:headers,contentType:"application/json",
    payload:JSON.stringify(body),muteHttpExceptions:true
  });
  if(put.getResponseCode()>=300) throw new Error("GitHub: "+put.getContentText());
  return true;
}

// Build public data (used for both GitHub sync and doGet "products")
function _buildPublicData(){
  var inv=_ss().getSheetByName("INVENTORY");
  var products=[];
  if(inv){
    var lr=_getActualLastRow(inv,1);
    if(lr>=2){
      _ensureColumns(inv, 45);
      var data=inv.getRange(2,1,lr-1,45).getValues();
      data.forEach(function(r){
        if(!r[COL.NAME-1])return;
        if(_str(r[COL.STATUS-1])!=="Active") return;
        products.push({
          name:_str(r[COL.NAME-1]),
          image1:_str(r[COL.IMG-1]),
          image2:_str(r[COL.IMG2-1]),
          image3:_str(r[COL.IMG3-1]),
          image4:_str(r[COL.IMG4-1]),
          image5:_str(r[COL.IMG5-1]),
          image6:_str(r[COL.IMG6-1]),
          video:_str(r[COL.VIDEO-1]),
          description:_str(r[COL.DESC-1]),
          category:_str(r[COL.CATEGORY-1]),
          fabric:_str(r[COL.FABRIC-1]),
          badge:_str(r[COL.BADGE-1]),
          sizeChart:_str(r[COL.SIZE_CHART-1]),
          deliveryDays:_str(r[COL.DELIVERY_DAYS-1]),
          regular:_num(r[COL.REG-1]),
          sale:_num(r[COL.SALE-1]),
          discPct:_num(r[COL.DISC_PCT-1]),
          discType:_str(r[COL.DISC_TYPE-1]),
          deliveryDhaka:_num(r[COL.DELIVERY_IN-1]),
          deliveryOutside:_num(r[COL.DELIVERY_OUT-1]),
          stockM:Math.max(0,_int(r[COL.STK_M-1])-_int(r[COL.SOLD_M-1])),
          stockL:Math.max(0,_int(r[COL.STK_L-1])-_int(r[COL.SOLD_L-1])),
          stockXL:Math.max(0,_int(r[COL.STK_XL-1])-_int(r[COL.SOLD_XL-1])),
          stockXXL:Math.max(0,_int(r[COL.STK_XXL-1])-_int(r[COL.SOLD_XXL-1])),
          status:_str(r[COL.STATUS-1]),
          couponActive:_str(r[COL.C_ACT-1]||"No"),
          couponCode:_str(r[COL.C_CODE-1]),
          couponDisc:_num(r[COL.C_DISC-1])
        });
      });
    }
  }
  return {
    storeInfo:_getFullStoreInfoObj(),
    categories:getCategoryList(),
    products:products,
    timestamp:new Date().toISOString()
  };
}

function _getStoreInfoObj(){
  var s=_getSettingsMap();
  return {
    name:_str(s["Store Name"]||"YARZ"),
    phone:_str(s["Store Phone"]),
    email:_str(s["Store Email"]),
    address:_str(s["Store Address"]),
    currency:_str(s["Currency Symbol"]||"৳")
  };
}

// ════════════════════════════════════════════════════════
// ===== WEB API (doGet / doPost) =====
// ════════════════════════════════════════════════════════
function _webJson_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _webErr_(msg, code){
  return _webJson_({ success:false, ok:false, error:msg, msg:msg, code:code||400 });
}

function doGet(e){
  try{
    var key=(e && e.parameter && e.parameter.key)?e.parameter.key:"";
    if(key!==API_KEY) return _webErr_("Invalid API Key", 401);
    var action=(e.parameter.action || "products").toLowerCase();
    switch(action){
      case "products":        return _webJson_({success:true, ok:true, data:_buildPublicData()});
      case "product":         return _getSingleProduct(e);
      case "categories":      return _webJson_({success:true, ok:true, data:getCategoryList()});
      case "store_info":      return _webJson_({success:true, ok:true, data:_getFullStoreInfoObj()});
      case "delivery_charges":return _webJson_({success:true, ok:true, data:_getDeliveryCharges(), locations:_getDeliveryCharges()});
      case "orders_by_phone": return _getOrdersByPhone(e);
      case "health":          return _webJson_({success:true, status:"online", version:"YARZ v9.3", timestamp:new Date().toISOString()});
      // ✅ v9.2 — GET fallbacks for write actions (CORS-friendly + customer cancel order)
      // These let the website call delete/update via GET when POST is blocked
      case "deletewebsiteorder":
        return _webJson_(_webDeleteWebsiteOrder({orderId:(e.parameter.orderId||"")}));
      case "updatewebsiteorderstatus":
        return _webJson_(_webUpdateWebsiteOrderStatus({
          orderId:(e.parameter.orderId||""),
          status:(e.parameter.status||""),
          courier:(e.parameter.courier||"")
        }));
      case "place_order_get":
        try {
          var oRaw = e.parameter.order || "{}";
          var o = (typeof oRaw === "string") ? JSON.parse(oRaw) : oRaw;
          return _placeWebsiteOrder(o);
        } catch(x) { return _webErr_("Invalid order payload: "+x.message); }
      case "sheet_read":      return _doSheetRead(e);
      default:                return _webErr_("Unknown action: "+action);
    }
  }catch(err){
    return _webErr_("Server error: "+err.message, 500);
  }
}

function doPost(e){
  try{
    var contents=e.postData.contents;
    var body=JSON.parse(contents);
    if(body.key!==API_KEY) return _webErr_("Invalid API Key", 401);
    var action=String(body.action||"").trim();
    var lo=action.toLowerCase();
    switch(lo){
      // Public order placement
      case "place_order":              return _placeWebsiteOrder(body.order || body);
      case "update_order_status":      return _webUpdateWebsiteOrderStatus(body);

      // Products
      case "saveproductfromform":      return _webJson_(saveProductFromForm(body));
      case "saveproducteditfromform":  return _webJson_(saveProductEditFromForm(body));
      case "updateproductstatus":      return _webJson_(updateProductStatus(body));
      case "applystockchange":         return _webJson_(applyStockChange(body));
      case "applybulkedit":            return _webJson_(applyBulkEdit(body));
      case "recordsale":               return _webJson_(_webRecordSale(body));
      case "deleteproduct":            return _webJson_(_webDeleteProduct(body));

      // Orders
      case "saveorderfromform":        return _webJson_(saveOrderFromForm(body));
      case "updatewebsiteorderstatus": return _webJson_(_webUpdateWebsiteOrderStatus(body));
      case "updatemanualorderstatus":  return _webJson_(_webUpdateManualOrderStatus(body));
      case "deletewebsiteorder":       return _webJson_(_webDeleteWebsiteOrder(body));
      case "deletemanualorder":        return _webJson_(_webDeleteManualOrder(body));

      // Cleanup
      case "fullfactoryreset":         return _webJson_(_webFullFactoryReset());
      case "clearfinancialsonly":      return _webJson_(_webClearFinancialsOnly());
      case "clearinventoryonly":       return _webJson_(_webClearInventoryOnly());

      // Finance
      case "saveadfromform":           return _webJson_(saveAdFromForm(body));
      case "saveexpensefromform":      return _webJson_(saveExpenseFromForm(body));
      case "savereturnfromform":       return _webJson_(saveReturnFromForm(body));

      // Settings
      case "updatesettings":           return _webJson_(_webUpdateSettings(body));
      case "updatedeliverycharges":    return _webJson_(_webUpdateDeliveryCharges(body));
      case "savegithubsettings":       return _webJson_(saveGitHubSettings(body));
      case "githubsyncnow":            try{ githubSyncNow(); return _webJson_({ok:true,success:true}); }catch(x){return _webErr_(x.message);}

      // Reports
      case "generatemonthlyreport":    try{ generateMonthlyReport(); return _webJson_({ok:true,success:true}); }catch(x){return _webErr_(x.message);}
      case "generateyearlyreport":     try{ generateYearlyReport(); return _webJson_({ok:true,success:true}); }catch(x){return _webErr_(x.message);}

      // Migration
      case "migrate":                  try{ migrateAddNewColumns(); return _webJson_({ok:true,success:true}); }catch(x){return _webErr_(x.message);}

      // Sheet read passthrough (for admin panel)
      case "sheet_read":               return _doSheetRead(body);

      default: return _webErr_("Unknown action: "+action);
    }
  }catch(err){
    return _webErr_("Server error: "+err.message, 500);
  }
}

// Generic sheet_read  (admin panel uses this to load INVENTORY!A2:AS1000)
function _doSheetRead(p){
  try{
    var rng=String(p.range || p.parameter && p.parameter.range || "");
    if(!rng) return _webErr_("range required");
    var ss=_ss();
    var r=ss.getRange(rng);
    var vals=r.getValues();
    return _webJson_({success:true, ok:true, data:vals, values:vals});
  }catch(e){return _webErr_(e.message);}
}

function _getSingleProduct(e){
  var name=(e.parameter && e.parameter.name)||"";
  var data=_buildPublicData();
  var p=data.products.filter(function(x){return x.name===name;})[0];
  if(!p) return _webErr_("Product not found", 404);
  return _webJson_({success:true,ok:true,data:p});
}

function _getOrdersByPhone(e){
  var phone=(e.parameter && e.parameter.phone)||"";
  if(!phone) return _webErr_("phone required");
  var sh=_ss().getSheetByName("Website_Orders");
  if(!sh) return _webJson_({success:true,ok:true,data:[]});
  var lr=_getActualLastRow(sh,1);
  if(lr<2) return _webJson_({success:true,ok:true,data:[]});
  var rows=sh.getRange(2,1,lr-1,19).getValues();
  var out=rows.filter(function(r){return String(r[3])===String(phone);}).map(function(r){
    return {orderId:r[0],date:r[1],customer:r[2],phone:r[3],address:r[4],location:r[5],product:r[6],size:r[7],qty:r[8],price:r[9],delivery:r[10],total:r[11],payment:r[12],notes:r[13],coupon:r[14],status:r[15],courier:r[16]};
  });
  return _webJson_({success:true,ok:true,data:out});
}

// ===== Place / Update Website Orders =====
function _placeWebsiteOrder(o){
  try{
    var sh=_ss().getSheetByName("Website_Orders");
    if(!sh) sh=_ss().insertSheet("Website_Orders");
    // ✅ v9.3 FIX: accept customerName (website) AND legacy "customer"
    var custName  = _str(o.customerName || o.customer || o.name || "");
    var custEmail = _str(o.email || "");
    var custCity  = _str(o.city || "");
    var fullAddr  = _str(o.address || "");
    if(custCity  && fullAddr.indexOf(custCity)  === -1) fullAddr += " | City: "  + custCity;
    if(custEmail && fullAddr.indexOf(custEmail) === -1) fullAddr += " | Email: " + custEmail;
    var orderId=_str(o.orderId || ("WEB-"+Date.now()));
    var next=_getActualLastRow(sh,1)+1;
    _ensureRows(sh,next);
    var qty=_int(o.qty)||1;
    var price=_num(o.price);
    var dlv=_num(o.delivery);
    var total=qty*price+dlv;
    sh.getRange(next,1,1,19).setValues([[
      orderId, new Date(), custName, _str(o.phone), fullAddr, _str(o.location),
      _str(o.product), _str(o.size), qty, price, dlv, total, _str(o.payment||"COD"),
      _str(o.notes), _str(o.coupon), "Pending", "", new Date(), "Order placed"
    ]]);
    return _webJson_({success:true,ok:true,orderId:orderId});
  }catch(e){return _webErr_(e.message);}
}

function _webUpdateWebsiteOrderStatus(body){
  try{
    var sh=_ss().getSheetByName("Website_Orders");
    if(!sh) return {ok:false,msg:"Website_Orders not found"};
    var lr=_getActualLastRow(sh,1);
    if(lr<2) return {ok:false,msg:"empty"};
    var ids=sh.getRange(2,1,lr-1,1).getValues().flat();
    var idx=ids.indexOf(body.orderId);
    if(idx===-1) return {ok:false,msg:"not found"};
    var row=idx+2;
    sh.getRange(row,16).setValue(body.status);
    if(body.courier) sh.getRange(row,17).setValue(body.courier);
    sh.getRange(row,18).setValue(new Date());
    sh.getRange(row,19).setValue("Status → "+body.status);
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webDeleteWebsiteOrder(body){
  try{
    var sh=_ss().getSheetByName("Website_Orders");
    if(!sh) return {ok:false,msg:"Website_Orders not found"};
    var lr=_getActualLastRow(sh,1);
    if(lr<2) return {ok:false,msg:"empty"};
    var ids=sh.getRange(2,1,lr-1,1).getValues().flat();
    var idx=ids.indexOf(body.orderId);
    if(idx===-1) return {ok:false,msg:"not found"};
    sh.deleteRow(idx+2);
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webDeleteProduct(body){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    if(!inv) return {ok:false,msg:"INVENTORY not found"};
    var lr=_getActualLastRow(inv,1);
    if(lr<2) return {ok:false,msg:"empty"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(body.name);
    if(idx===-1) return {ok:false,msg:"not found"};
    inv.deleteRow(idx+2);
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webRecordSale(d){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    if(!inv) return {ok:false,msg:"INVENTORY not found"};
    var lr=_getActualLastRow(inv,1);
    if(lr<2) return {ok:false,msg:"empty"};
    var names=inv.getRange(2,1,lr-1,1).getValues().flat();
    var idx=names.indexOf(d.product);
    if(idx===-1) return {ok:false,msg:"not found"};
    var row=idx+2;
    var sizeCol={M:COL.SOLD_M,L:COL.SOLD_L,XL:COL.SOLD_XL,XXL:COL.SOLD_XXL}[d.size];
    if(!sizeCol) return {ok:false,msg:"invalid size"};
    var qty=_int(d.qty)||1;
    var cur=_int(inv.getRange(row,sizeCol).getValue());
    inv.getRange(row,sizeCol).setValue(cur+qty);
    inv.getRange(row,COL.UPDATED).setValue(new Date());
    var sale=_num(inv.getRange(row,COL.SALE).getValue());
    var cost=_num(inv.getRange(row,COL.COST).getValue());
    _logTransaction([new Date(), d.product, "Sale", d.size, qty, qty*sale, qty*cost, qty*(sale-cost)]);
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webUpdateSettings(body){
  try{
    var sh=_ss().getSheetByName("SETTINGS");
    if(!sh) return {ok:false,msg:"SETTINGS not found"};
    var updates=body.settings || {};
    var lr=_getActualLastRow(sh,1);
    if(lr<2){
      _ensureRows(sh,2);
      sh.getRange(2,1,1,3).setValues([["Store Name","YARZ",""]]);
      lr=2;
    }
    var data=sh.getRange(2,1,lr-1,2).getValues();
    Object.keys(updates).forEach(function(k){
      var found=false;
      for(var i=0;i<data.length;i++){
        if(String(data[i][0]).trim()===k){
          sh.getRange(i+2,2).setValue(updates[k]);
          found=true;
          break;
        }
      }
      if(!found){
        var next=_getActualLastRow(sh,1)+1;
        _ensureRows(sh,next);
        sh.getRange(next,1,1,3).setValues([[k,updates[k],""]]);
      }
    });
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

// ===== CLEANUP ACTIONS =====
function _webFullFactoryReset(){
  try{
    var ss=_ss();
    ["INVENTORY","ORDERS","Website_Orders","TRANSACTIONS","AD_TRACKER","EXPENSES","_ACTIVITY"].forEach(function(n){
      var sh=ss.getSheetByName(n);
      if(!sh) return;
      var lr=_getActualLastRow(sh,1);
      if(lr>=2){
        var lc=sh.getLastColumn();
        sh.getRange(2,1,lr-1,lc).clearContent();
      }
    });
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webClearFinancialsOnly(){
  try{
    var ss=_ss();
    ["TRANSACTIONS","AD_TRACKER","EXPENSES"].forEach(function(n){
      var sh=ss.getSheetByName(n);
      if(!sh) return;
      var lr=_getActualLastRow(sh,1);
      if(lr>=2){
        var lc=sh.getLastColumn();
        sh.getRange(2,1,lr-1,lc).clearContent();
      }
    });
    // Reset SOLD_* in INVENTORY
    var inv=ss.getSheetByName("INVENTORY");
    if(inv){
      var lr=_getActualLastRow(inv,1);
      if(lr>=2){
        inv.getRange(2,COL.SOLD_M,lr-1,4).setValue(0);
      }
    }
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

function _webClearInventoryOnly(){
  try{
    var inv=_ss().getSheetByName("INVENTORY");
    if(!inv) return {ok:false,msg:"INVENTORY not found"};
    var lr=_getActualLastRow(inv,1);
    if(lr>=2){
      var lc=inv.getLastColumn();
      inv.getRange(2,1,lr-1,lc).clearContent();
    }
    return {ok:true,success:true};
  }catch(e){return {ok:false,msg:e.message};}
}

// ════════════════════════════════════════════════════════
// ✅ FIX v9.1: Full store info — passes ALL settings (Enable COD, zones,
// hero banners, sections, payment methods, etc.) to the website with
// normalized keys (lowercase + underscore). Used by api.js getGlobalControls().
// e.g. "Enable COD" → "enable_cod"   "Hero Banner 1" → "hero_banner_1"
function _getFullStoreInfoObj(){
  var s = _getSettingsMap();
  var out = {
    name:_str(s["Store Name"]||"YARZ"),
    phone:_str(s["Store Phone"]),
    email:_str(s["Store Email"]),
    address:_str(s["Store Address"]),
    currency:_str(s["Currency Symbol"]||"\u09f3"),
    // ✅ v3.5: Explicit social-link fields (used by website + admin panel)
    link_facebook : _str(s["Link Facebook"] || "https://www.facebook.com/Yarzbd"),
    link_instagram: _str(s["Link Instagram"] || "https://www.instagram.com/yarz_bd"),
    link_whatsapp : _str(s["Link WhatsApp"] || "https://wa.me/8801601743670"),
    link_messenger: _str(s["Link Messenger"] || "https://m.me/Yarzbd"),
    link_tiktok   : _str(s["Link TikTok"] || "https://tiktok.com/@yarzbd"),
    link_youtube  : _str(s["Link YouTube"]),
    link_twitter  : _str(s["Link Twitter"]),
    delivery_locations: JSON.stringify(_getDeliveryCharges())
  };
  Object.keys(s).forEach(function(k){
    var nk = String(k).toLowerCase().replace(/[\s\(\)\[\]]+/g, '_').replace(/_+/g,'_').replace(/^_|_$/g,'');
    if(nk && out[nk] === undefined) out[nk] = _str(s[k]);
  });
  return out;
}

// ════════════════════════════════════════════════════════
// END OF YARZ PRO v9.3
// ════════════════════════════════════════════════════════
