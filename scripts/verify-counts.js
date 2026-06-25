/**
 * YARZ — Cross-check row counts between exported GAS JSON and Supabase.
 *
 * Usage:  node scripts/verify-counts.js exports/gas-export-*.json
 * Requires: .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * For each tab, prints:
 *   Sheet count, Supabase count, delta
 *   If delta != 0 -> mark as MISMATCH.
 */
require("dotenv").config();
const fs = require("fs");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[verify] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const TAB_TO_TABLE = {
  INVENTORY: "inventory",
  ORDERS: "orders",
  Website_Orders: "website_orders",
  TRANSACTIONS: "transactions",
  SETTINGS: "settings",
  DELIVERY_CHARGES: "delivery_charges",
  AD_TRACKER: "ad_tracker",
  EXPENSES: "expenses",
  MONTHLY_REPORT: "monthly_reports",
  YEARLY_REPORT: "yearly_reports",
  _ACTIVITY: "_activity",
  _DRAFT_DATA: "_draft_data",
  _ARCHIVE_DATA: "_archive_data"
};

async function countTable(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=id&limit=0`, {
    method: "HEAD",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": "Bearer " + SERVICE_KEY,
      "Prefer": "count=exact"
    }
  });
  if (!res.ok) return null;
  const cr = res.headers.get("content-range"); // e.g. "0-0/123"
  if (!cr) return null;
  const m = cr.match(/\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

(async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/verify-counts.js exports/gas-export-XXX.json");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log("\n=== YARZ MIGRATION VERIFICATION ===");
  console.log("Exported at:", data.exported_at, "\n");
  console.log("Tab".padEnd(20), "Sheet".padStart(8), "Supabase".padStart(10), "Delta".padStart(8), "  Status");
  console.log("-".repeat(60));

  let mismatches = 0;
  for (const tabName of Object.keys(TAB_TO_TABLE)) {
    const tab = data.tabs && data.tabs[tabName];
    const sheetCount = tab && tab.rows ? tab.rows.length : 0;
    const supaCount = await countTable(TAB_TO_TABLE[tabName]);
    const delta = sheetCount - (supaCount || 0);
    const status = delta === 0 ? "OK" : "MISMATCH";
    if (delta !== 0) mismatches++;
    console.log(
      tabName.padEnd(20),
      String(sheetCount).padStart(8),
      String(supaCount !== null ? supaCount : "ERR").padStart(10),
      String(delta).padStart(8),
      "  " + status
    );
  }

  console.log("\nMismatches: " + mismatches);
  process.exit(mismatches > 0 ? 2 : 0);
})().catch(function(e){
  console.error("[verify] FAIL:", e);
  process.exit(1);
});
