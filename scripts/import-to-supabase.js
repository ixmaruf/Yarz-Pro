/**
 * YARZ — Import exported JSON into Supabase.
 * Usage:  node scripts/import-to-supabase.js
 * Requires: .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * Prereq:  supabase/*.sql already executed in Supabase
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[import] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const HEADER_MAP = {
  INVENTORY: { table: "inventory", map: {
    "Product":"product","Image 1":"image_1","Image 2":"image_2","Image 3":"image_3",
    "Video URL":"video_url","Description":"description","Category":"category",
    "Fabric":"fabric","Badge":"badge","Size Chart":"size_chart",
    "Delivery Days":"delivery_days","Cost":"cost","Regular":"regular","Sale":"sale",
    "Disc%":"disc_percent","Disc Type":"disc_type","Dhaka":"dhaka_delivery",
    "Outside":"outside_delivery","S":"stk_s","M":"stk_m","L":"stk_l","XL":"stk_xl",
    "XXL":"stk_xxl","3XL":"stk_3xl","Sold S":"sold_s","Sold M":"sold_m","Sold L":"sold_l",
    "Sold XL":"sold_xl","Sold XXL":"sold_xxl","Sold 3XL":"sold_3xl",
    "Returns":"returns","Invest":"invest","Revenue":"revenue","Recover":"to_recover",
    "Profit":"gross","FB Ad":"fb_ad","Net":"net","Disc P/L":"disc_impact",
    "Updated":"updated_at","Status":"status","Image 4":"image_4","Image 5":"image_5",
    "Image 6":"image_6","Coupon Active":"coupon_active","Coupon Code":"coupon_code",
    "Coupon Disc %":"coupon_disc_percent","Hidden Sizes":"hidden_sizes",
    "Size Type":"size_type","Accessory":"accessory"
  }},
  ORDERS: { table: "orders", map: {
    "Date":"date","Order ID":"order_id","Customer":"cust_name","Phone":"cust_phone",
    "Address":"cust_addr","Location":"deliv_dist","Product":"product","Size":"size",
    "Qty":"qty","Price":"price","Delivery":"delivery_charge","Total":"total",
    "Payment":"payment","Status":"status","Courier":"courier","Notes":"notes"
  }},
  Website_Orders: { table: "website_orders", map: {
    "Order ID":"order_id","Date":"date","Customer":"cust_name","Phone":"cust_phone",
    "Address":"cust_addr","Location":"deliv_zone","Product":"product","Size":"size",
    "Qty":"qty","Price":"price","Delivery":"delivery_charge","Total":"total",
    "Payment":"payment","Notes":"notes","Coupon":"coupon_code","Status":"status",
    "Courier":"courier","Updated":"updated_at","Activity":"activity",
    "Device ID":"device_id","IP":"ip","Country":"country","ASN":"asn",
    "Risk Score":"risk_score"
  }},
  TRANSACTIONS: { table: "transactions", map: {
    "Date":"date","Product":"product","Type":"type","Size":"size",
    "Qty":"qty","Revenue":"revenue","Cost":"cost"
  }},
  SETTINGS: { table: "settings", map: {
    "Key":"key","Value":"value","Description":"description"
  }},
  DELIVERY_CHARGES: { table: "delivery_charges", map: {
    "ID":"id","Location Name":"name","Charge":"charge","Active":"active"
  }},
  AD_TRACKER: { table: "ad_tracker", map: {
    "Date":"date","Product":"product","Spend":"spend","Reach":"reach",
    "Impressions":"impressions","Clicks":"clicks","Notes":"notes"
  }},
  EXPENSES: { table: "expenses", map: {
    "Date":"date","Category":"category","Description":"description",
    "Amount":"amount","Notes":"notes"
  }},
  MONTHLY_REPORT: { table: "monthly_reports", map: {
    "Month":"month","Revenue":"revenue","Cost":"cost","Ad Spend":"ad_spend",
    "Orders":"orders"
  }},
  YEARLY_REPORT: { table: "yearly_reports", map: {
    "Year":"year","Revenue":"revenue","Cost":"cost","Ad Spend":"ad_spend",
    "Orders":"orders"
  }},
  _ACTIVITY: { table: "_activity", map: {
    "Date":"ts","Product":"product","Old Status":"old_status","New Status":"new_status"
  }},
  _DRAFT_DATA:   { table: "_draft_data", map: { "Name":"name","Note":"note" } },
  _ARCHIVE_DATA: { table: "_archive_data", map: { "Name":"name","Note":"note" } }
};

const NUMERIC_COLS = {
  inventory: new Set(["cost","regular","sale","disc_percent","dhaka_delivery","outside_delivery",
    "stk_s","stk_m","stk_l","stk_xl","stk_xxl","stk_3xl",
    "sold_s","sold_m","sold_l","sold_xl","sold_xxl","sold_3xl",
    "returns","invest","revenue","to_recover","gross","fb_ad","net",
    "disc_impact","coupon_disc_percent"]),
  orders: new Set(["qty","price","delivery_charge","total"]),
  website_orders: new Set(["qty","price","delivery_charge","total","risk_score"]),
  transactions: new Set(["qty","revenue","cost"]),
  ad_tracker: new Set(["spend","reach","impressions","clicks"]),
  expenses: new Set(["amount"]),
  monthly_reports: new Set(["revenue","cost","ad_spend","orders"]),
  yearly_reports: new Set(["year","revenue","cost","ad_spend","orders"]),
  delivery_charges: new Set(["charge"])
};
const DATE_COLS = {
  inventory: new Set(["updated_at"]),
  orders: new Set(["date"]),
  website_orders: new Set(["date","updated_at"]),
  transactions: new Set(["date"]),
  ad_tracker: new Set(["date"]),
  expenses: new Set(["date"]),
  _activity: new Set(["ts"])
};
const BOOL_COLS = { delivery_charges: new Set(["active"]) };

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (v === null || v === undefined || v === "") return false;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "yes" || s === "1";
}
function toDate(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
function mapValue(col, val, table) {
  if (NUMERIC_COLS[table] && NUMERIC_COLS[table].has(col)) return toNum(val);
  if (BOOL_COLS[table] && BOOL_COLS[table].has(col))    return toBool(val);
  if (DATE_COLS[table] && DATE_COLS[table].has(col))    return toDate(val);
  return val === null || val === undefined ? "" : String(val);
}

async function supabaseInsert(table, rows, batchSize) {
  let inserted = 0, failed = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": "Bearer " + SERVICE_KEY,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(batch)
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("[import] " + table + " batch " + i + " FAILED: " + res.status + " " + err.substring(0, 300));
      failed += batch.length;
    } else {
      inserted += batch.length;
    }
  }
  return { inserted: inserted, failed: failed };
}

(async function main() {
  const expDir = path.join(__dirname, "..", "exports");
  const files = fs.readdirSync(expDir).filter(f => f.startsWith("gas-export-") && f.endsWith(".json"));
  if (!files.length) {
    console.error("[import] No exports/gas-export-*.json. Run export-pull.js first.");
    process.exit(1);
  }
  files.sort();
  const data = JSON.parse(fs.readFileSync(path.join(expDir, files[files.length - 1]), "utf8"));

  let grandInserted = 0, grandFailed = 0;
  for (const tabName of Object.keys(HEADER_MAP)) {
    const tabDef = HEADER_MAP[tabName];
    const tab = data.tabs && data.tabs[tabName];
    if (!tab || !tab.rows || tab.rows.length === 0) {
      console.log("[import] " + tabName + ": skipped (no data)");
      continue;
    }
    const headers = tab.headers;
    const rows = tab.rows.map(function(r) {
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const supCol = tabDef.map[headers[i]];
        if (supCol === undefined || supCol === null) continue;
        obj[supCol] = mapValue(supCol, r[i], tabDef.table);
      }
      return obj;
    });
    console.log("[import] " + tabName + " -> " + tabDef.table + ": " + rows.length + " rows");
    const r = await supabaseInsert(tabDef.table, rows, 500);
    console.log("  -> inserted: " + r.inserted + ", failed: " + r.failed);
    grandInserted += r.inserted;
    grandFailed += r.failed;
  }

  console.log("\n========================================");
  console.log("TOTAL inserted: " + grandInserted);
  console.log("TOTAL failed:   " + grandFailed);
  console.log("========================================");
  if (grandFailed > 0) process.exit(2);
})().catch(function(e){
  console.error("[import] FAIL:", e);
  process.exit(1);
});
