/**
 * =====================================================================
 * YARZ — ONE-TIME EXPORT SCRIPT (paste into Apps Script editor)
 * Date: 2026-06-20
 *
 * INSTRUCTIONS:
 *   1. Open https://script.google.com  -> your YARZ project
 *   2. Create a new file -> paste this ENTIRE content -> Save
 *   3. Run the function `exportAllTabsToJson()` once (authorize if asked)
 *   4. Copy the LOG OUTPUT (View -> Logs) and save it as
 *      exports/gas-export-YYYY-MM-DD.json
 *
 *   OR (better): it auto-saves to a new "EXPORT_JSON" tab in your sheet.
 *   Read that tab with the Node script `export-pull.js`.
 * =====================================================================
 */

function exportAllTabsToJson() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var tabs = [
    "INVENTORY","ORDERS","Website_Orders","TRANSACTIONS","SETTINGS",
    "DELIVERY_CHARGES","AD_TRACKER","EXPENSES","MONTHLY_REPORT",
    "YEARLY_REPORT","_ACTIVITY","_DRAFT_DATA","_ARCHIVE_DATA"
  ];
  var out = { exported_at: new Date().toISOString(), version: "v11.7", tabs: {} };

  tabs.forEach(function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { out.tabs[name] = null; return; }
    var lastRow = sh.getLastRow();
    var lastCol = sh.getLastColumn();
    if (lastRow < 1 || lastCol < 1) { out.tabs[name] = []; return; }

    // First row is header; keep it so import can map columns by name
    var values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
    out.tabs[name] = {
      headers: values[0],
      rows: values.slice(1).filter(function(r){ return r.join("").trim() !== ""; })
    };
    Logger.log("Exported " + name + ": " + (out.tabs[name].rows.length) + " data rows");
  });

  // Also try to dump CUSTOMER_LTV (computed at runtime)
  try {
    var ltv = getCustomerLTV();
    out.tabs["CUSTOMER_LTV"] = ltv && ltv.customers ? { headers: ["phone","name","total_orders","total_spent","first_order_at","last_order_at"], rows: ltv.customers.map(function(c){ return [c.phone, c.name, c.total_orders, c.total_spent, c.first_order_at, c.last_order_at]; }) } : null;
  } catch(e) {
    Logger.log("CUSTOMER_LTV export skipped: " + e.message);
  }

  var json = JSON.stringify(out);

  // Save to a new sheet for easy download
  var dumpSh = ss.getSheetByName("EXPORT_JSON") || ss.insertSheet("EXPORT_JSON");
  dumpSh.clear();
  // Chunk into 50k-char cells because Sheets cell limit is 50,000 chars
  var chunkSize = 45000;
  var row = 1;
  for (var i = 0; i < json.length; i += chunkSize) {
    dumpSh.getRange(row, 1).setValue(json.substr(i, chunkSize));
    row++;
  }
  Logger.log("TOTAL JSON size: " + json.length + " chars, written in " + (row-1) + " cells");
  Logger.log("DONE. Open the EXPORT_JSON sheet, then run scripts/export-pull.js");
  return out;
}
