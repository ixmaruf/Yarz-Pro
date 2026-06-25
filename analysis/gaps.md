# YARZ Migration Gap Analysis
**Date:** 2026-06-20
**Phase:** 1.5 — Cross-reference GAS actions vs existing code
**Source files:**
- `legacy/google-apps-script-v11.7.txt` (5,713 lines, all functions mapped in `gas-functions.md`)
- `worker-supabase.js` (388 lines, Cloudflare Worker)
- `supabase-adapter-v2.js` (741 lines, Admin Panel adapter)
- `Yarz-admin panal/supabase_adapter.js` (319 lines, OLD v1 partial adapter)

---

## A. Public GET actions (doGet, 8 actions)

| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `products` | `_buildPublicData()` | ✅ `view: "website_sync_view"` | n/a (read by Worker, not Adapter) | ✅ COVERED |
| `product` | `_getSingleProduct(e)` | ✅ `table: "inventory", filter: "?product=eq.{name}"` | n/a | ✅ COVERED |
| `categories` | `getCategoryList()` | ⚠️ `passthrough` (uses SETTINGS in GAS) | n/a | ⚠️ PARTIAL — could be moved to `SELECT value FROM settings` |
| `store_info` | `_getFullStoreInfoObj()` | ⚠️ `passthrough` (aggregate over settings+delivery) | n/a | ⚠️ PARTIAL — could be moved to RPC |
| `delivery_charges` | `_getDeliveryCharges()` | ✅ `table: "delivery_charges", filter: "?active=eq.true&order=sort_order"` | n/a | ✅ COVERED |
| `orders_by_phone` | `_getOrdersByPhone(e)` | ❌ NOT in ACTIONS_SUPABASE — will go to GAS | n/a | ⚠️ GAP — should be `view: "customer_orders_view"` |
| `health` | static | ⚠️ `passthrough` | n/a | ⚠️ TRIVIAL — could be static JSON |
| `fb_feed` | `_fbProductFeed(e)` | ⚠️ `passthrough` (CSV generation needs GAS logic) | n/a | ⚠️ COMPLEX — keep GAS, or build CSV in Worker |

---

## B. Public POST actions (doPost, 4 actions + Telegram webhook)

| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `place_order` | `_placeWebsiteOrder()` (the big one, 262 lines) | ⚠️ `passthrough` (complex, keep GAS for now) | n/a (called from website, not admin) | ⚠️ PARTIAL — `passthrough` is correct for now, but the 5-sec Telegram block + CAPI fire-and-forget should be Edge Function eventually |
| `subscribe_newsletter` | `_webSubscribeNewsletter()` | ✅ `table: "newsletter_subscribers", op: "insert"` | n/a | ✅ COVERED |
| `capi` / `fbcapi` | `_fbCapiFromBrowser()` | ⚠️ `passthrough` | n/a | ⚠️ PARTIAL — Edge Function preferred (don't want server key in browser) |
| `ttapi` / `ttevents` | `_ttEventsApi()` | ⚠️ `passthrough` | n/a | ⚠️ PARTIAL — same as above |
| Telegram webhook | `_handleTelegramWebhook()` | ❌ NOT in any map | n/a | ⚠️ GAP — needs dedicated route, see open issue #1 below |

---

## C. Admin POST actions (doPost, ~50 actions)

### Auth
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `adminlogin` | `_webAdminLogin_()` | ✅ in ADMIN_ACTIONS set | ✅ `adminLogin()` via `admin_login` RPC | ✅ COVERED (real bcrypt) |
| `adminlogout` | `_webAdminLogout_()` | ✅ in ADMIN_ACTIONS set | ✅ `adminLogout()` via RPC | ✅ COVERED |
| `verify_auth` | inline check | ✅ in ADMIN_ACTIONS set | ✅ `verifyAuth()` via `verify_session` RPC | ✅ COVERED |

### Products
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `saveproductfromform` | `saveProductFromForm()` (94 lines) | ✅ `table: "inventory", op: "insert"` | ✅ `saveProductFromForm()` direct insert | ✅ COVERED |
| `saveproducteditfromform` | `saveProductEditFromForm()` (81 lines) | ✅ `table: "inventory", op: "update", key: "product"` | ✅ `saveProductEditFromForm()` | ✅ COVERED |
| `updateproductstatus` | `updateProductStatus()` | ✅ `table: "inventory", op: "update"` | ✅ `updateProductStatus()` | ✅ COVERED |
| `applystockchange` | `applyStockChange()` (multi-size deltas) | ⚠️ direct UPDATE | ✅ `applyStockChange()` (per-size loop) | ⚠️ WORKER direct update may bypass atomicity — should use `atomic_adjust_stock` RPC. **Adapter v2 is correct (RPC) but Worker isn't.** |
| `applybulkedit` | `applyBulkEdit()` (112 lines) | ⚠️ `passthrough` | ✅ `applyBulkEdit()` direct update | ✅ ADAPTER covers. Worker passthrough means it goes to GAS. |
| `recordsale` | `_webRecordSale()` | ⚠️ `passthrough` | ✅ `recordSale()` direct update | ✅ ADAPTER covers. |
| `deleteproduct` | `_webDeleteProduct()` | ✅ `table: "inventory", op: "delete"` | ✅ `deleteProduct()` | ✅ COVERED |

### Orders
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `saveorderfromform` | `saveOrderFromForm()` (LockService) | ✅ `table: "orders", op: "insert"` | ✅ `saveOrderFromForm()` | ⚠️ Worker direct insert doesn't decrement stock atomically. **Should use RPC.** |
| `updatewebsiteorderstatus` | `_webUpdateWebsiteOrderStatus()` (updates all rows for orderId) | ✅ `table: "website_orders", op: "update", key: "order_id"` | ✅ `updateWebsiteOrderStatus()` | ✅ COVERED — but only 1 row updated per order. Legacy updates all rows. **Worker needs `?order_id=eq.X` which DOES update all rows in PostgREST (no `single` flag set). Verified correct.** |
| `updatemanualorderstatus` | `_webUpdateManualOrderStatus()` | ✅ `table: "orders", op: "update"` | ✅ `updateManualOrderStatus()` | ✅ COVERED |
| `deletewebsiteorder` | `_webDeleteWebsiteOrder()` (123 lines, full reversal) | ✅ `table: "website_orders", op: "delete"` | ✅ `deleteWebsiteOrder()` | ⚠️ Worker direct delete doesn't reverse TRANSACTIONS or restore INVENTORY stock. **Should use RPC `delete_website_order`.** Adapter may have same gap — needs review. |
| `deletemanualorder` | `_webDeleteManualOrder()` | ✅ `table: "orders", op: "delete"` | ✅ `deleteManualOrder()` | ✅ COVERED (manual orders don't touch inventory) |
| `archivecompletedorders` | `_webArchiveCompletedOrders()` (54 lines) | ⚠️ `passthrough` | ✅ `archiveCompletedOrders()` | ⚠️ PARTIAL — Worker passthrough means it goes to GAS for now. |

### Cleanup
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `fullfactoryreset` | `_webFullFactoryReset()` | ⚠️ `passthrough` | ✅ `fullFactoryReset()` | ⚠️ PARTIAL — but DESTRUCTIVE, keep some auth/audit in RPC |
| `clearfinancialsonly` | `_webClearFinancialsOnly()` | ⚠️ `passthrough` | ✅ `clearFinancialsOnly()` | ⚠️ PARTIAL |
| `clearinventoryonly` | `_webClearInventoryOnly()` | ⚠️ `passthrough` | ✅ `clearInventoryOnly()` | ⚠️ PARTIAL |

### Finance
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `saveadfromform` | `saveAdFromForm()` | ✅ `table: "ad_tracker", op: "insert"` | ✅ `saveAdFromForm()` | ✅ COVERED |
| `saveexpensefromform` | `saveExpenseFromForm()` | ✅ `table: "expenses", op: "insert"` | ✅ `saveExpenseFromForm()` | ✅ COVERED |
| `savereturnfromform` | `saveReturnFromForm()` (108 lines, complex) | ⚠️ `passthrough` | ✅ `saveReturnFromForm()` | ⚠️ COMPLEX — should be RPC `record_return` (atomic TRANSACTIONS update + SOLD_* decrement). Adapter needs review. |

### Settings
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `updatesettings` | `_webUpdateSettings()` (alias sync) | ✅ `table: "settings", op: "upsert"` | ✅ `updateSettings()` | ✅ COVERED. **Note: alias sync (Currency ↔ Currency Symbol) is in GAS code line 3362-3374. May not be in Supabase `settings` table constraint.** |
| `updatedeliverycharges` | `_webUpdateDeliveryCharges()` | ✅ `table: "delivery_charges", op: "upsert"` | ✅ `updateDeliveryCharges()` | ✅ COVERED |
| `savegithubsettings` | `saveGitHubSettings()` | ✅ `table: "settings", op: "upsert"` | ✅ `saveGitHubSettings()` | ✅ COVERED |
| `githubsyncnow` | `githubSyncNow()` | ⚠️ `passthrough` | ❌ NOT in adapter | ⚠️ GAP — should be Edge Function (cron-triggered) |

### Reports
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `generatemonthlyreport` | `generateMonthlyReport()` | ❌ NOT in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ GAP — should be RPC that uses SQL view + `INSERT INTO monthly_reports ON CONFLICT DO UPDATE` |
| `generateyearlyreport` | `generateYearlyReport()` | ❌ NOT in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ GAP — same |
| `getcurrentmonthsnapshot` | `_readCurrentMonthSnapshot()` | ⚠️ `passthrough` | ❌ NOT in adapter | ⚠️ GAP — should be SQL view `current_month_snapshot` |
| `getproductanalytics6m` | `getProductAnalytics6m()` | ⚠️ `passthrough` | ❌ NOT in adapter | ⚠️ GAP — should be SQL view (legacy returns empty since aggregator not implemented) |
| `getcustomerltv` | `getCustomerLTV()` | ✅ `view: "customer_ltv_view"` | ❌ NOT in adapter | ✅ Worker. Adapter doesn't expose it. |
| `snapshotmonth` | `snapshotMonth()` | ⚠️ `passthrough` | ❌ NOT in adapter | ⚠️ GAP — should be pg_cron |

### Migration helpers (one-time)
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `migrate` | `migrateAddNewColumns()` | ✅ in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ ONE-TIME — no need to port |
| `diagnoses3xl` | `diagnoseS3XL()` | ✅ in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ ONE-TIME — no need to port |
| `repairwebsiteordersstatus` | `repairWebsiteOrdersStatus()` | ✅ in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ ONE-TIME — no need to port |
| `repaircouponactivevalidation` | `repairCouponActiveValidation()` | ✅ in ADMIN_ACTIONS | ❌ NOT in adapter | ⚠️ ONE-TIME — no need to port |

### Steadfast Courier (10 actions)
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `steadfastcreate` | `steadfastCreateOrder()` (123 lines) | ⚠️ `passthrough` | ⚠️ `steadfastPassthrough()` returns null | ⚠️ GAP — should be Edge Function (security: API keys never in browser) |
| `steadfastbulk` | `steadfastBulkCreate()` (125 lines) | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfaststatus` | `steadfastCheckStatus()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastbalance` | `steadfastBalance()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastsavekeys` | `steadfastSaveKeys()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — should be Edge Function (encrypts at rest) |
| `steadfastgetreturn` | `steadfastGetReturn()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastlistreturns` | `steadfastListReturns()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastlistpayments` | `steadfastListPayments()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastgetpayment` | `steadfastGetPayment()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |
| `steadfastlistpolicestations` | `steadfastListPolicestations()` | ⚠️ `passthrough` | ⚠️ null | ⚠️ GAP — Edge Function |

### Sheet Read
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `sheet_read` | `_doSheetRead()` (admin-only since v9.6) | ⚠️ `table_or_view` (not yet implemented) | ✅ `sheetRead()` covers all 11+ range prefixes | ✅ ADAPTER is the canonical implementation. Worker `table_or_view` not implemented. |
| `sheet_read_formatted` | n/a | ⚠️ `passthrough` | ✅ handled by sheetRead | ✅ |

### Fortress (anti-fraud, 5 actions)
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `__fortress_lookup` | `_fortressLookup()` | ⚠️ `passthrough` | ✅ `fortressLookup()` via passthroughOrRpc | ⚠️ PARTIAL — depends on `fortress_lookup` RPC being in schema |
| `__fortress_block` | `_fortressBlock()` | ⚠️ `passthrough` | ✅ `fortressBlock()` | ⚠️ PARTIAL — same |
| `__fortress_unblock` | `_fortressUnblock()` | ⚠️ `passthrough` | ✅ `fortressUnblock()` | ⚠️ PARTIAL |
| `__fortress_clear_all` | `_fortressClearAll()` | ⚠️ `passthrough` | ✅ `fortressClearAll()` | ⚠️ PARTIAL |
| `__fortress_log_event` | `_fortressLogEvent()` | ⚠️ `passthrough` | ✅ `fortressLogEvent()` | ⚠️ PARTIAL |

### Cache publish
| Action | GAS | Worker (v2) | Adapter v2 | Status |
|---|---|---|---|---|
| `publish_to_cloudflare` | `_executeCloudflarePurge()` (calls `/__purge` route) | ✅ in ADMIN_ACTIONS + has its own `/purge` route | ❌ NOT in adapter | ✅ COVERED (the Worker has its own `/purge` webhook) |

---

## D. Telegram webhook (NOT in any action map!)

The Telegram bot sends webhooks to the GAS Web App URL. When GAS `doPost` receives a request with `body.update_id`, it routes to `_handleTelegramWebhook()` BEFORE the API key check (line 2505).

**Gaps:**
1. **Worker** does NOT have a route for Telegram webhooks. The current `worker-supabase.js` only has `/purge` as a special route. The Telegram webhook would fall through to `handle()` which expects `action` in body — it would fail.
2. **Adapter v2** does NOT handle Telegram webhooks (admin doesn't initiate TG messages, only the server does).

**Required fix:**
- Add route to worker: `if (url.pathname === "/tg-webhook") return handleTelegramWebhook(req)`
- OR: deploy a separate Worker / Edge Function for Telegram at a dedicated URL
- Register the new URL in Telegram via `setWebhook` (currently GAS does this via `_tgEnsureWebhookCurrent` line 4033)

**Migration plan:** Move Telegram webhook to a **Supabase Edge Function** at `/functions/v1/tg-webhook`. Then update bot webhook URL via Telegram API.

---

## E. Summary of gaps (priority order)

### Critical (must fix before PHASE 4 deploy)
1. **Telegram webhook route** — Worker has no route. Migration: Edge Function at `/functions/v1/tg-webhook`.
2. **`applyStockChange` atomicity** — Worker uses direct UPDATE, doesn't use `atomic_adjust_stock` RPC. Race condition possible.
3. **`saveOrderFromForm` doesn't decrement stock** — Worker direct insert into `orders` skips the stock decrement that GAS does.
4. **`deleteWebsiteOrder` doesn't reverse transactions** — Worker direct delete skips the TRANSACTIONS cancellation + SOLD_* restoration. Adapter may have the same issue.

### High (functional gaps)
5. **`orders_by_phone` public endpoint** — Not in Worker map. Add `view: "customer_orders_by_phone"`.
6. **Reports (`generatemonthlyreport`, `generateyearlyreport`, `getcurrentmonthsnapshot`)** — Not in Worker map, not in Adapter. Use SQL views + RPC.
7. **`saveReturnFromForm` atomicity** — Complex multi-table update. Should be RPC `record_return`.
8. **`githubsyncnow`** — Not in Adapter. Should be Edge Function (cron).

### Medium (Steadfast, can ship with passthrough)
9. **All 10 Steadfast actions** — `passthrough` to GAS. Should be Edge Functions (security: API keys).
10. **5 Fortress actions** — `passthrough` to GAS. Depends on `fortress_*` RPCs being in `rpc.sql`.
11. **`applybulkedit`** — Worker passthrough (GAS handles). Adapter has direct UPDATE. Should use RPC for atomicity.

### Low (nice-to-have)
12. **`categories` / `store_info` / `health`** — Currently passthrough. Trivial to move to Supabase (SQL view for store_info, simple SELECT for categories).
13. **`fb_feed` CSV** — Passthrough. Could move to Worker.
14. **Settings alias sync** — `Currency ↔ Currency Symbol` etc. — verify `settings` table in schema.sql supports this.
15. **`getCustomerLTV` exposed in Adapter** — Worker handles, but Admin Panel adapter doesn't. Admin can call it via `app.supabaseClient.from('customers').select('*')` directly.

---

## F. Schema coverage check

Cross-referencing `analysis/tab-schemas.md` against `supabase/schema.sql`:

| Table | Needed (per tab-schemas) | In schema.sql | Status |
|---|---|---|---|
| inventory | 52-col INVENTORY | yes | ✅ |
| orders | 16-col ORDERS | yes | ✅ |
| website_orders | 29-col Website_Orders | yes | ✅ |
| transactions | 8-col TRANSACTIONS | yes | ✅ |
| settings | 3-col SETTINGS (key/value) | yes | ✅ |
| delivery_charges | 4-col DELIVERY_CHARGES | yes | ✅ |
| ad_tracker | 7-col AD_TRACKER | yes | ✅ |
| expenses | 5-col EXPENSES | yes | ✅ |
| monthly_reports | 6-col MONTHLY_REPORT | yes | ✅ |
| yearly_reports | 6-col YEARLY_REPORT | yes | ✅ |
| _activity | 4-col _ACTIVITY | yes | ✅ |
| customers | 6-col CUSTOMER_LTV | yes | ✅ |
| admin_sessions | 7-col ADMIN_SESSIONS | yes | ✅ |
| admin_login_attempts | 4-col ADMIN_LOGIN_ATTEMPTS | yes | ✅ |
| newsletter_subscribers | 4-col NEWSLETTER_SUBSCRIBERS | yes | ✅ |
| blocked_devices | 13-col Blocked_Devices | needs check | ⚠️ |
| fortress_log | 12-col Fortress_Log | needs check | ⚠️ |
| steadfast_keys | new (encrypted creds) | needs check | ⚠️ |
| steadfast_consignments | new (audit log) | needs check | ⚠️ |
| rate_limit_log | new | needs check | ⚠️ |
| audit_log | new | needs check | ⚠️ |
| admin_users | new (bcrypt creds) | needs check | ⚠️ |
| _draft_data | 2-col placeholder | maybe skipped | ⚠️ |
| _archive_data | 2-col placeholder | maybe skipped | ⚠️ |
| monthly_snapshots | 5-col Monthly_Snapshots | needs check | ⚠️ |

**Action items for PHASE 2.1:** re-verify schema.sql has tables for Fortress (blocked_devices, fortress_log), Steadfast (steadfast_keys, steadfast_consignments), rate_limit_log, audit_log, admin_users.

---

## G. RPC coverage check

Cross-referencing `supabase/rpc.sql` against needed operations:

| RPC | Needed for | In rpc.sql | Status |
|---|---|---|---|
| `admin_login(username, password, user_agent)` | Admin login | needs check | ⚠️ |
| `admin_logout(token)` | Admin logout | needs check | ⚠️ |
| `verify_session(token)` | Session check | needs check | ⚠️ |
| `atomic_adjust_stock(product, size, qty)` | applyStockChange, saveOrder, place_order | needs check | ⚠️ |
| `check_login_rate_limit(ip, window_sec)` | login rate limit | needs check | ⚠️ |
| `get_customer_ltv(phone)` | LTV query | needs check | ⚠️ |
| `generate_monthly_report(year, month)` | report generation | needs check | ⚠️ |
| `record_return(product, size, qty)` | saveReturnFromForm | needs check | ⚠️ |
| `delete_website_order(order_id)` | full reversal | needs check | ⚠️ |
| `full_factory_reset()` | cleanup | needs check | ⚠️ |
| `steadfast_create_consignment(...)` | courier integration | needs check | ⚠️ |
| `fortress_block(device_id, ...)` | anti-fraud | needs check | ⚠️ |
| `fortress_unblock(device_id)` | anti-fraud | needs check | ⚠️ |
| `fortress_log_event(...)` | anti-fraud | needs check | ⚠️ |
| `fortress_lookup()` | anti-fraud | needs check | ⚠️ |

**Action items for PHASE 2.2:** re-verify rpc.sql has all needed functions.

---

## H. Sign-off criteria for PHASE 2

Before user can approve PHASE 2 (apply SQL to Supabase), we need to:
1. ✅ Re-verify `supabase/schema.sql` has all 22 tables (GAPS F) — pending
2. ✅ Re-verify `supabase/rpc.sql` has all needed functions (GAPS G) — pending
3. ✅ Re-verify `supabase/views.sql` has 5 views (DRAFT/ARCHIVE/WEBSITE_SYNC/customer_ltv) — pending
4. ✅ Re-verify `supabase/rls.sql` has policies for all tables — pending
5. ✅ User provisions Supabase project + provides `SUPABASE_ACCESS_TOKEN`
6. ✅ User provides answers to 6 open questions in plan §9

If any of (1)-(4) find missing items, write the missing SQL FIRST, then proceed with deployment.
