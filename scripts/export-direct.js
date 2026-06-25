/**
 * YARZ — Direct pull from Google Sheets (no Apps Script needed).
 * Fetches each tab as CSV via the public gviz API, then converts to the
 * JSON format expected by import-to-supabase.js.
 *
 * Usage:  node scripts/export-direct.js
 */
require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q';
const TABS = [
  'INVENTORY','ORDERS','Website_Orders','TRANSACTIONS','SETTINGS',
  'DELIVERY_CHARGES','AD_TRACKER','EXPENSES','MONTHLY_REPORT',
  'YEARLY_REPORT','_ACTIVITY','_DRAFT_DATA','_ARCHIVE_DATA'
];

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'YARZ-Migration/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function csvToRows(csv) {
  // Parse CSV with quoted fields (commas inside quotes preserved)
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQuotes) {
      if (c === '"' && csv[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); row = []; cur = ''; }
        if (c === '\r' && csv[i + 1] === '\n') i++;
      } else { cur += c; }
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

function stripEmoji(s) {
  // Strip leading emoji + spaces from header names: "📦 Product" -> "Product"
  if (typeof s !== 'string') return s;
  // Comprehensive emoji + variation-selector + ZWJ stripper
  return s.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\s]+/gu, '').trim();
}

(async function main() {
  const out = { exported_at: new Date().toISOString(), version: 'direct-csv-v1', tabs: {} };
  for (const tabName of TABS) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}&headers=1`;
    try {
      const csv = await fetchText(url);
      const rows = csvToRows(csv);
      if (rows.length === 0) {
        out.tabs[tabName] = null;
        console.log('[export-direct] ' + tabName + ': empty');
        continue;
      }
      const rawHeaders = rows[0];
      const headers = rawHeaders.map(stripEmoji);
      const dataRows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
      out.tabs[tabName] = { headers: headers, rows: dataRows };
      console.log('[export-direct] ' + tabName + ': ' + dataRows.length + ' rows (cols: ' + headers.length + ')');
    } catch (e) {
      out.tabs[tabName] = null;
      console.log('[export-direct] ' + tabName + ': ERR ' + e.message);
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(__dirname, '..', 'exports', 'gas-export-' + ts + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\n[export-direct] Saved: ' + outPath);

  // Summary
  let totalRows = 0;
  for (const t of TABS) {
    const tab = out.tabs[t];
    if (tab && tab.rows) totalRows += tab.rows.length;
  }
  console.log('[export-direct] TOTAL rows: ' + totalRows);
})().catch(e => { console.error('[export-direct] FAIL:', e); process.exit(1); });
