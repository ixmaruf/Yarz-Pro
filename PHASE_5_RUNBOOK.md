# YARZ — PHASE 5: Data Migration Runbook
Date: 2026-06-20
Status: ✅ COMPLETE (45 rows migrated via direct public API pull)

## What actually happened

Instead of running Apps Script export, we pulled data directly from the
public Google Sheets `gviz/tq` API. All 13 tabs are publicly accessible.

### Steps used
1. Created `.env` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (extracted from Supabase dashboard)
2. Wrote `scripts/export-direct.js` — pulls all tabs via `gviz/tq?tqx=out:csv`, strips emoji headers, outputs `gas-export-<timestamp>.json`
3. Ran `node scripts/import-to-supabase.js` — imported 45 rows

### Final data in Supabase

| Table | Sheet | Supabase | Delta |
|---|---|---|---|
| inventory | 1 | 1 | 0 ✅ |
| orders | 0 | 0 | 0 ✅ |
| website_orders | 5 | 5 | 0 ✅ |
| transactions | 5 | 5 | 0 ✅ |
| settings | 530 | 48 | 482 (500 dedupes of 18 seed) |
| delivery_charges | 2 | 2 | 0 ✅ |
| ad_tracker | 0 | 0 | 0 ✅ |
| expenses | 0 | 0 | 0 ✅ |
| monthly_reports | 0 | 0 | 0 ✅ |
| yearly_reports | 0 | 0 | 0 ✅ |
| _activity | 2 | 2 | 0 ✅ |
| _draft_data | 1 | 1 | 0 ✅ |
| _archive_data | 1 | 1 | 0 ✅ |

**Net new: 1 inventory + 5 website_orders + 5 transactions + 30 settings + 2 _activity + 1 _draft + 1 _archive = 45 rows**

## Re-running (if needed)

To re-export and re-import:

```bash
cd "C:\Users\maruf\Downloads\YARZ WEB SITE"

# Pull current data from Google Sheets
node scripts/export-direct.js

# Import the latest export
node scripts/import-to-supabase.js

# Verify counts
node scripts/verify-counts.js exports/gas-export-*.json
```

## Alternative methods (if direct API fails)

### Option A: Apps Script export
1. Open Apps Script editor
2. Paste `scripts/export-from-gas.gs`
3. Run `exportAllTabsToJson()`
4. Save logs to `exports/manual-export.json`
5. `node scripts/export-pull.js --manual`

### Option B: Publish tab as CSV
1. After running export, publish `EXPORT_JSON` tab as CSV
2. Set `GAS_PUBLISHED_EXPORT_URL` in `.env`
3. `node scripts/export-pull.js`

## Known issues

- **Duplicate column names in INVENTORY**: M/L/XL/XXL used for both stock and sold
  columns. For Aza product (only data), all sold values are 0 so no data loss.
  For other products, the sold counts for M/L/XL/XXL may be lost.
  Workaround: edit the sheet to use unique headers (e.g., "M Stock", "M Sold").

- **Transaction dates in future**: 2026-10-05 dates suggest test entries.
  Not a data integrity issue, but worth flagging.

## What's NOT migrated (intentional)

- `customers` — computed from `orders` via `customer_ltv_view`
- `admin_sessions`, `admin_login_attempts` — runtime data
- `rate_limit_log`, `fortress_log` — runtime data
- `steadfast_balance_cache`, `steadfast_consignments` — runtime data
- `blocked_devices` — runtime data
- `newsletter_subscribers` — repopulated on first opt-in

## Rollback

```sql
TRUNCATE inventory, orders, website_orders, transactions,
         settings, delivery_charges, ad_tracker, expenses,
         monthly_reports, yearly_reports, _activity,
         _draft_data, _archive_data RESTART IDENTITY CASCADE;
```
