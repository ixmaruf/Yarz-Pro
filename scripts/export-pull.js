/**
 * YARZ — Pull exported JSON from Apps Script and save to disk.
 *
 * Usage:
 *   1. Run `exportAllTabsToJson()` in Apps Script editor first.
 *   2. The script writes JSON to a new sheet tab called EXPORT_JSON.
 *   3. Add this sheet as a published CSV: File -> Share -> Publish to web
 *      -> choose "EXPORT_JSON" tab -> CSV -> Publish
 *   4. Set the resulting URL in env GAS_PUBLISHED_EXPORT_URL
 *   5. Run: node scripts/export-pull.js
 *
 *   ALTERNATIVE: paste the JSON output from Apps Script Logs into
 *   exports/manual-export.json and run with --manual
 *
 * Output: exports/gas-export-<timestamp>.json
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function pullFromPublished() {
  const url = process.env.GAS_PUBLISHED_EXPORT_URL;
  if (!url) throw new Error("Set GAS_PUBLISHED_EXPORT_URL in .env");

  const res = await fetch(url);
  if (!res.ok) throw new Error("Fetch failed: " + res.status);
  const csv = await res.text();

  // EXPORT_JSON cells are split into multiple rows; each row is one chunk
  // of the original JSON. We need to reassemble.
  // When published as CSV, each row becomes a row; the JSON chunks are in column A.
  const lines = csv.split(/\r?\n/).filter(function(l){ return l.trim() && l !== ',,,,' && l.length > 1; });
  let json = "";
  for (const line of lines) {
    // CSV quoting: cells are wrapped in double-quotes; strip them.
    const m = line.match(/^"((?:[^"]|"")*)"/);
    const cell = m ? m[1].replace(/""/g, '"') : line;
    json += cell;
  }
  return JSON.parse(json);
}

async function pullManual() {
  const p = path.join(__dirname, "..", "exports", "manual-export.json");
  if (!fs.existsSync(p)) throw new Error("No manual-export.json found at " + p);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

(async function main() {
  const isManual = process.argv.includes("--manual");
  console.log("[export-pull] mode:", isManual ? "manual" : "published");
  const data = isManual ? await pullManual() : await pullFromPublished();

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(__dirname, "..", "exports", "gas-export-" + ts + ".json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  console.log("[export-pull] Saved:", outPath);
  console.log("[export-pull] Tabs exported:");
  for (const [name, t] of Object.entries(data.tabs || {})) {
    const rows = t && t.rows ? t.rows.length : 0;
    console.log("  - " + name + ": " + rows + " rows");
  }
})().catch(function(e){
  console.error("[export-pull] FAIL:", e.message);
  process.exit(1);
});
