# YARZ GAS Function Map (YARZ PRO v11.7)
**Source:** `legacy/google-apps-script-v11.7.txt` (5,713 lines, all read)
**Date:** 2026-06-20
**Phase:** 1.1 — GAS function inventory

---

## A. TOP-LEVEL CONSTANTS & HELPERS

| Line | Name | Kind | Purpose | Supabase equivalent |
|---|---|---|---|---|
| 56 | `API_KEY` | const | hardcoded `AIzaSy...` — fallback only | `admin_users.api_key` (hashed) |
| 58 | `SPREADSHEET_ID` | const | Google Sheet ID | n/a (DB replaces Sheets) |
| 60-68 | `C` | const | color palette | n/a |
| 70-73 | `DEFAULT_*_LIST` | const | categories / fabrics / badges / disc types | `seed_defaults.sql` |
| 75 | `ALL_TABS` | const | 16 tab names | n/a |
| 79-110 | `COL` | const | 52-column index map for INVENTORY | `inventory` table columns |
| 116 | `_ss()` | helper | get active spreadsheet or open by ID | n/a |
| 125 | `_getActualLastRow()` | helper | last non-empty row in col 1 | SQL `count` + filter |
| 136-141 | `_num / _int / _safe / _str / _flat` | helpers | null-safe coercion | SQL NULLIF, COALESCE |
| 143 | `_safeRowHeights` | helper | safe setRowHeights | n/a |
| 154-168 | `_ensureRows / _ensureColumns` | helpers | grow sheet to size | n/a |
| 170 | `_getSettingsMap()` | helper | SETTINGS → key/value object | `SELECT key, value FROM settings` |
| 184-194 | `_getListFromSettings / getCategoryList / getFabricList / getBadgeList` | helpers | comma-separated list with fallback | JSONB column + default |
| 196 | `_getInventoryFormulas()` | helper | 12 ARRAYFORMULA expressions (TotSold, Revenue, Net, etc.) | SQL `GENERATED ALWAYS AS (STORED)` |
| 230 | `_restoreInventoryFormulas()` | helper | re-write formulas after clear | n/a (DB enforces) |
| 247 | `_hdr()` | helper | styled header row | schema definition |
| 262 | `_logActivity()` | helper | write to `_ACTIVITY` | `INSERT INTO _activity` |
| 270 | `_logTransaction()` | helper | write to `TRANSACTIONS` | `INSERT INTO transactions` |
| 278 | `_buildOptions()` | helper | `<option>` HTML for Apps Script dialogs | n/a (admin panel uses native form) |
| 287 | `_sharedCSS()` | helper | CSS for Apps Script modals | n/a |
| 291 | `_sharedJS()` | helper | JS for Apps Script modals | n/a |
| 839 | `STEADFAST_BASE_URL` | const | `https://portal.packzy.com/api/v1` | Edge Function env var |
| 841 | `_steadfastKeys()` | helper | read Steadfast API keys from SETTINGS | `steadfast_keys` table |
| 1219 | `_sanitizeAddressForCourier()` | helper | strip noise tokens from address | Edge Function helper |
| 1233 | `_sanitizeNoteForCourier()` | helper | strip internal markers from notes | Edge Function helper |
| 1247 | `_normalizeBdPhoneServer()` | helper | normalize BD phone → `01XXXXXXXXX` | SQL function or Worker helper |
| 2687 | `_v96Addr / _v96Notes / _v96Total()` | helpers | v9.6 backward-compat wrappers | n/a |
| 3548 | `_sha256Lower()` | helper | SHA-256 + lowercase (CAPI hashing) | Edge Function or RPC |
| 3562 | `_normalizePhoneForCapi()` | helper | BD phone → 880XXXXXXXXX for FB CAPI | Edge Function helper |
| 3572 | `_splitNameForCapi()` | helper | split full name → first/last | Edge Function helper |
| 4083 | `_tgApi / _tgSend / _tgEdit / _tgAnswer / _tgEscape` | helpers | Telegram API wrappers | Edge Function helpers |
| 5347 | `_readSheet()` | helper | read entire sheet as 2D array | n/a |
| 4015 | `_tgRecordDiag()` | helper | log Telegram health to ScriptProperties | Edge Function log |
| 4033 | `_tgEnsureWebhookCurrent()` | helper | self-heal TG webhook mismatch (1h throttle) | n/a |
| 4865+ | `healthPing / setupKeepAlivePing` | scheduled | GAS pings Worker every 5 min to avoid cold-start | n/a (Cloudflare auto-warms) |
| 4915-4923 | `_getPurgeSecret / _getCloudflareWorkerUrl / CLOUDFLARE_WORKER_URL / PURGE_SECRET` | const | purge webhook config | Worker env var |
| 5347 | `_readSheet()` | helper | read all data | n/a |
| 5406 | `_ensureProductAnalyticsTab()` | helper | create PRODUCT_ANALYTICS sheet | n/a (use view) |
| 5439 | `_ensureCustomerLTVTab()` | helper | create CUSTOMER_LTV sheet | `customers` table |
| 5516-5538 | `_sessionsSheet_() / _attemptsSheet_()` | helpers | create session/attempts sheets | `admin_sessions / admin_login_attempts` |
| 5540 | `_newToken_()` | helper | 64-char hex session token | SQL `gen_random_uuid()` |
| 5545 | `_loginRateCheck_()` | helper | 5 fails / 15 min lock | SQL `check_login_rate_limit` RPC |
| 5572 | `_logLoginAttempt_()` | helper | write to ADMIN_LOGIN_ATTEMPTS | `INSERT INTO admin_login_attempts` |
| 5581 | `_secureCompare()` | helper | constant-time string compare | SQL `crypt()` |
| 4788 | `cleanupOldOrders()` | scheduled | 90-day / 180-day retention | pg_cron + SQL delete |
| 4818 | `_pruneOrdersByDate()` | helper | batch delete by date | SQL DELETE |
| 4850 | `_setupAutoCleanup()` | setup | install daily trigger | `pg_cron` schedule |
| 4890 | `setupKeepAlivePing()` | setup | 5-min health trigger | n/a (Cloudflare auto) |

---

## B. SETUP / MIGRATION (run once from GAS editor)

| Line | Function | Purpose | Supabase equivalent |
|---|---|---|---|
| 298 | `createFullSystem()` | creates all 16 tabs | run schema.sql once |
| 330 | `_setupInventory()` | 52-col INVENTORY + formulas | n/a |
| 382 | `_setupDraftView()` | FILTER formula view | `inventory_draft_view` |
| 402 | `_setupArchiveView()` | FILTER formula view | `inventory_archive_view` |
| 423 | `_setupWebsiteSync()` | 30-col FILTER view for public | `website_sync_view` |
| 483 | `_setupOrders()` | 16-col ORDERS tab | `orders` table |
| 491 | `_setupWebsiteOrders()` | 19-col Website_Orders tab | `website_orders` table |
| 518 | `repairWebsiteOrdersStatus()` | fix data-validation rule (Picked Up etc.) | n/a |
| 540 | `repairCouponActiveValidation()` | fix data-validation (Yes/No/Hidden) | n/a |
| 554 | `_setupTransactions()` | 8-col TRANSACTIONS tab | `transactions` table |
| 561 | `_setupAdTracker()` | 7-col AD_TRACKER | `ad_tracker` table |
| 567 | `_setupExpenses()` | 5-col EXPENSES | `expenses` table |
| 573 | `_setupMonthlyReport()` | 6-col MONTHLY_REPORT | `monthly_reports` table + view |
| 579 | `_setupYearlyReport()` | 6-col YEARLY_REPORT | `yearly_reports` table + view |
| 585 | `_setupSettings()` | 3-col SETTINGS with defaults | `settings` table |
| 612 | `_setupDeliveryCharges()` | 4-col DELIVERY_CHARGES | `delivery_charges` table |
| 626 | `_getDeliveryCharges()` | read active delivery zones | `SELECT * FROM delivery_charges WHERE active` |
| 646 | `_webUpdateDeliveryCharges(body)` | upsert delivery zones | `UPSERT` |
| 672-687 | `_setupActivity / _setupDraftData / _setupArchiveData` | internal hidden sheets | `_activity / _draft_data / _archive_data` |
| 692 | `migrateAddNewColumns()` | add Img4-6 + Coupon + S/3XL + Hidden/SizeType/Accessory | n/a (in schema.sql) |
| 5038 | `_setupBlockedDevices()` | 13-col Blocked_Devices (Fortress) | `blocked_devices` table |
| 5051 | `_setupFortressLog()` | 12-col Fortress_Log | `fortress_log` table |

---

## C. PUBLIC GET (doGet) — API_KEY only, no admin

| Action | Line | Reads | Output | Cache TTL | Supabase equivalent |
|---|---|---|---|---|---|
| `products` | 2450 | INVENTORY (Active only) | `{storeInfo, categories, products[], timestamp}` | 30 min | `SELECT * FROM website_sync_view` |
| `product` | 2645 | single product by name | `{data: product}` | 30 min | `SELECT * FROM inventory WHERE name=$1` |
| `categories` | 2452 | SETTINGS | `{data: [...]}` | 30 min | `SELECT value FROM settings WHERE key='Custom Categories'` |
| `store_info` | 2453 | SETTINGS (full normalized) | `{data: {...all keys lowercase_underscore}}` | 30 min | `SELECT * FROM settings` → jsonb_agg |
| `delivery_charges` | 2454 | DELIVERY_CHARGES | `{data: [...], locations: [...]}` | 30 min | `SELECT * FROM delivery_charges WHERE active` |
| `orders_by_phone` | 2653 | Website_Orders | `{data: [...]}` | n/a (PII) | `SELECT * FROM website_orders WHERE phone=$1` |
| `health` | 2456 | static | `{success, status, version, timestamp, colCheck}` | n/a | static JSON |
| `fb_feed` | 3893 | INVENTORY (Active) | CSV (15 cols) | 30 min | `SELECT ... FROM website_sync_view` → CSV |

**Returns 403:** `deletewebsiteorder`, `updatewebsiteorderstatus`, `place_order_get`, `sheet_read` (all moved to admin POST)

---

## D. PUBLIC POST (doPost) — API_KEY only, no admin

| Action | Line | Writes | Output | Supabase equivalent |
|---|---|---|---|---|
| `place_order` | 2707-2969 | Website_Orders (multi-row), INVENTORY.SOLD_*, TRANSACTIONS, Telegram notify, CAPI Purchase, customer LTV | `{success, orderId, timestamp, total, qty, status:"Pending"}` | `INSERT INTO website_orders` + RPC `atomic_adjust_stock` + Edge Function `send_telegram` |
| `subscribenewsletter` | 2394 | NEWSLETTER_SUBSCRIBERS | `{success, duplicate?}` | `INSERT INTO newsletter_subscribers` (UNIQUE email) |
| `capi` / `fbcapi` | 3820 | FB Conversions API event | `{ok, success}` | Edge Function → FB Graph |
| `ttapi` / `ttevents` | 3834 | TikTok Events API | `{ok, success}` | Edge Function → TikTok |
| (Telegram webhook) | 4256 | update Website_Orders status, fire CAPI | n/a | Edge Function route `/tg-webhook` |

**Telegram webhook is routed FIRST** (before API key check) — line 2505.

---

## E. ADMIN POST (doPost) — session token required

| Action | Line | Writes | Lock | Supabase equivalent |
|---|---|---|---|---|
| `adminlogin` | 5600 | ADMIN_SESSIONS, CacheService | n/a | RPC `admin_login` (bcrypt + rate-limit) |
| `adminlogout` | 5641 | ADMIN_SESSIONS.Revoked=true | n/a | RPC `admin_logout` |
| `verify_auth` | 2606-2611 | n/a (read-only) | n/a | RPC `verify_session` |
| **PRODUCTS** | | | | |
| `saveproductfromform` | 1417 | INVENTORY (insert) | n/a | `INSERT INTO inventory` |
| `saveproducteditfromform` | 1597 | INVENTORY (update by name) | n/a | `UPDATE inventory WHERE product=$1` |
| `updateproductstatus` | 1683 | INVENTORY.STATUS | n/a | `UPDATE inventory SET status=$2 WHERE product=$1` |
| `applystockchange` | 1702 | INVENTORY.STK_* (deltas) | n/a | RPC `atomic_adjust_stock` |
| `applybulkedit` | 1760 | INVENTORY (status/badge/discount/delivery/coupon/hidden/sizeType/accessory for N products) | n/a | bulk `UPDATE inventory` |
| `recordsale` | 3325 | INVENTORY.SOLD_*, TRANSACTIONS | n/a | RPC `atomic_adjust_stock` + `INSERT INTO transactions` |
| `deleteproduct` | 3288 | INVENTORY delete + TRANSACTIONS/AD_TRACKER cleanup | n/a | `DELETE FROM inventory` (CASCADE) |
| **ORDERS** | | | | |
| `saveorderfromform` | 1901 | ORDERS + INVENTORY.SOLD_* + TRANSACTIONS + LTV | LockService | `INSERT INTO orders` + RPC + `INSERT INTO transactions` + RPC `update_customer_ltv` |
| `updatewebsiteorderstatus` | 2971 | Website_Orders (all rows of orderId) + CAPI event | n/a | `UPDATE website_orders` + Edge Function CAPI |
| `updatemanualorderstatus` | 1957 | ORDERS | n/a | `UPDATE orders` |
| `deletewebsiteorder` | 3099 | Website_Orders (with full reversal: TRANSACTIONS cancel, INVENTORY.SOLD_* restore) | LockService | RPC `delete_website_order` (transactional) |
| `archivecompletedorders` | 3228 | Website_Orders → Website_Orders_Archive | n/a | `INSERT INTO archive_view; DELETE FROM website_orders` |
| `deletemanualorder` | 1973 | ORDERS | n/a | `DELETE FROM orders` |
| **FINANCE** | | | | |
| `saveadfromform` | 1996 | AD_TRACKER | n/a | `INSERT INTO ad_tracker` |
| `saveexpensefromform` | 2011 | EXPENSES | n/a | `INSERT INTO expenses` |
| `savereturnfromform` | 2026 | TRANSACTIONS (Return marker), INVENTORY.SOLD_* (decrement) | n/a | RPC `record_return` |
| **SETTINGS** | | | | |
| `updatesettings` | 3354 | SETTINGS (upsert + alias sync) | n/a | `INSERT INTO settings ON CONFLICT DO UPDATE` |
| `updatedeliverycharges` | 646 | DELIVERY_CHARGES | n/a | bulk `UPSERT delivery_charges` |
| `savegithubsettings` | 2259 | SETTINGS (GitHub creds) | n/a | `UPDATE settings WHERE key LIKE 'GitHub%'` |
| `githubsyncnow` | 2281 | GitHub API PUT (data.json) | n/a | Edge Function (cron) |
| **REPORTS** | | | | |
| `generatemonthlyreport` | 2147 | MONTHLY_REPORT (overwrite) | n/a | RPC `generate_monthly_report` |
| `generateyearlyreport` | 2203 | YEARLY_REPORT (overwrite) | n/a | RPC `generate_yearly_report` |
| **MIGRATION HELPERS** | | | | |
| `migrate` | 692 | adds new INVENTORY columns | n/a | n/a (one-time, already in schema) |
| `diagnoses3xl` | 747 | n/a (read-only self-test) | n/a | n/a (sanity check) |
| `repairwebsiteordersstatus` | 518 | n/a (data-validation) | n/a | n/a (one-time) |
| `repaircouponactivevalidation` | 540 | n/a (data-validation) | n/a | n/a (one-time) |
| **STEADFAST (3rd-party HTTP)** | | | | |
| `steadfastcreate` | 897 | Website_Orders.Status="Picked Up" + Steadfast API call | n/a | Edge Function `steadfast_create` (fraud-safe) |
| `steadfastbulk` | 1026 | Steadfast bulk + sheet update | n/a | Edge Function `steadfast_bulk` |
| `steadfaststatus` | 1154 | Steadfast API (read) | n/a | Edge Function passthrough |
| `steadfastbalance` | 1171 | Steadfast API (read) | n/a | Edge Function passthrough |
| `steadfastsavekeys` | 850 | SETTINGS (Steadfast creds) | n/a | `UPDATE settings` |
| `steadfastgetreturn / listreturns / listpayments / getpayment / listpolicestations` | 1181-1214 | Steadfast API (read) | n/a | Edge Function passthrough |
| **SHEET READ** | | | | |
| `sheet_read` | 2634 | generic A1:Notation read | n/a | `SELECT * FROM <table>` via RPC |
| **CACHE PUBLISH** | | | | |
| `publish_to_cloudflare` | 2604 | Worker webhook (purge cache) | n/a | Worker route `/__purge` |
| **ANALYTICS** | | | | |
| `getcurrentmonthsnapshot` | 5368 | reads ORDERS+Website_Orders+TRANSACTIONS+AD_TRACKER | n/a | RPC `current_month_snapshot` (SQL view) |
| `getproductanalytics6m` | 5417 | PRODUCT_ANALYTICS | n/a | `SELECT * FROM product_analytics_6m_view` |
| `getcustomerltv` | 5500 | CUSTOMER_LTV | n/a | `SELECT * FROM customers` |
| `snapshotmonth` | 5352 | Monthly_Snapshots (last full month) | n/a | `INSERT INTO monthly_snapshots` (pg_cron) |
| **FORTRESS (anti-fraud)** | | | | |
| `__fortress_lookup` | 5105 | reads Blocked_Devices + Fortress_Log | n/a | `SELECT * FROM blocked_devices; SELECT * FROM fortress_log ORDER BY ts DESC LIMIT 100` |
| `__fortress_block` | 5170 | Blocked_Devices insert/update | LockService | `INSERT INTO blocked_devices ON CONFLICT DO UPDATE` |
| `__fortress_unblock` | 5231 | Blocked_Devices delete | LockService | `DELETE FROM blocked_devices WHERE device_id=$1` |
| `__fortress_clear_all` | 5263 | Blocked_Devices status='archived' | LockService | `UPDATE blocked_devices SET status='archived'` |
| `__fortress_log_event` | 5291 | Fortress_Log insert | n/a | `INSERT INTO fortress_log` |

---

## F. FORMS (Apps Script modal dialogs — only callable from GAS editor menu)

These are server-side HTML renderers for native Apps Script dialogs. **Not used by the admin panel HTML** (which has its own forms). They are only invoked from the GAS menu (line 1343-1364 `onOpen`).

| Line | Function | Purpose |
|---|---|---|
| 1366 | `openInventoryStudio()` | dashboard modal |
| 1381 | `openProductForm()` | add product modal |
| 1515 | `openProductEditSearch()` | product search modal |
| 1534 | `openProductEditForm(name)` | edit product modal |
| 1876 | `openQuickStatusUpdate()` | bulk status change modal |
| 1895 | `openOrderForm()` | manual order modal |
| 1991 | `openAdForm()` | ad spend modal |
| 2006 | `openExpenseForm()` | expense modal |
| 2021 | `openReturnForm()` | return record modal |
| 4530 | `setupTelegramWebhook()` | one-time TG setup |
| 4564 | `removeTelegramWebhook()` | disconnect TG |
| 4580 | `checkTelegramWebhook()` | status check |
| 4610 | `diagnoseTelegramBot()` | full health report |
| 5428 | `aggregateProductMonth()` | not implemented |
| 5432 | `archiveOldProductAnalytics()` | not implemented |
| 5469 | `_webDeleteCustomers(body)` | bulk delete LTV rows |

**For Supabase migration:** all these can be deleted — the admin panel HTML has its own forms calling the action endpoints.

---

## G. CACHE / NOTIFY HOOKS

| Line | Function | Purpose | Supabase equivalent |
|---|---|---|---|
| 4934 | `notifyCloudflare(actions, opts)` | disabled no-op (returns `{ok:true, note:...}`) | n/a |
| 4938 | `publishToCloudflareAction()` | menu item: manual purge | Worker `/__purge` route |
| 4948 | `_executeCloudflarePurge(actions, opts)` | async / sync POST to Worker `/__purge` | Worker route itself |
| 4983 | `_scheduleAsyncPurge(payload)` | stash purge in ScriptProperties, 1-min trigger | n/a |
| 4998 | `_runPendingPurge()` | one-shot trigger to fire pending purge | n/a |
| 5320 | `_sendFraudAlert(event)` | Telegram notification for fraud | Edge Function |

---

## H. TRIGGERS (Apps Script `onEdit` / `onOpen`)

| Line | Function | Fires when | Purpose |
|---|---|---|---|
| 1263 | `onEdit(e)` | any sheet edit | auto-status=Draft on new row, log Sale transactions when SOLD_* changes, log status change to _ACTIVITY, handle DRAFT_VIEW/ARCHIVE_VIEW action dropdown |
| 1343 | `onOpen()` | spreadsheet opened | create custom menu "🔧 YARZ PRO" |

---

## I. SUMMARY (PHASE 1.1)

- **Total functions in GAS:** ~140
- **Public GET actions:** 8
- **Public POST actions:** 4 (+ Telegram webhook)
- **Admin POST actions:** ~40
- **Steadfast actions:** 10
- **Fortress actions:** 5
- **Setup / one-time functions:** ~17
- **Apps Script menu forms:** 14 (admin panel doesn't use these)
- **Hardcoded secrets in code:** `API_KEY` (line 56), `SPREADSHEET_ID` (line 58), `STEADFAST_BASE_URL` (line 839, public endpoint OK), `TG_OWNER_ID` (line 4000, just chat ID), fallback `FORTRESS_SALT` (line 5093), fallback `ADMIN_SECRET` (line 2475/2482), fallback `ADMIN_USERNAME` (line 2476/2486), fallback `PURGE_SECRET` (line 4916), fallback `CLOUDFLARE_WORKER_URL` (line 4919)

**Most secrets are read from ScriptProperties at runtime** — fallbacks are just for first-deploy convenience. ✅

**Notable features:**
- LockService used for concurrent order writes (avoid race conditions)
- CacheService used for rate limiting (100/min per key, 5/min per phone for orders)
- CacheService used for session token storage (fast path before Sheet lookup)
- PropertiesService used for purge secret, admin creds, telegram tokens, deploy marker
- All times in Bangladesh timezone (UTC+6) via `Utilities.formatDate(..., 'Asia/Dhaka', ...)`
- All customer-facing totals are computed server-side (no client trust for revenue)
- Telegram self-heal: webhook URL auto-corrects if redeploy changed it (1h throttle)
- Idempotency check on `place_order` (return existing order if same `orderId` already in sheet)
- Free-ship marker re-validated server-side from cart subtotal (client can't lie)
- CAPI event_idempotency: Activity column marker so we don't double-fire status events
