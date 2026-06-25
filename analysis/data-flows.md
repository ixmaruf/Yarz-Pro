# YARZ Data-Flow Map (5 User Journeys)
**Date:** 2026-06-20
**Phase:** 1.3

---

## Journey 1: Browse → Cart → Checkout (Anonymous, public)

### Old path (GAS + Sheets)
```
┌─────────┐    GET /exec?action=products&key=API_KEY     ┌──────────────┐
│ Browser ├─────────────────────────────────────────────►│ Cloudflare   │
│ (user)  │◄────────────── {products[], categories}  ────│ Worker (CF)  │
└─────────┘                                              └──────┬───────┘
   │ browse                                                       │ proxy
   │ add to cart                                                  ▼
   │ checkout                                              ┌──────────────┐
   │ POST {action:"place_order", cartItems, ...}          │ GAS doPost   │
   │ (key=API_KEY)                                         │ (Apps Script)│
   ▼                                                       └──────┬───────┘
   ┌─────────┐  return {success, orderId, total, ...}           │
   │ Browser │◄──────────────────────────────────────────────────┘
   └─────────┘                                              writes to
   │                                                       ┌──────────────────┐
   │                                                       │Website_Orders   │
   │                                                       │  multi-row cart  │
   │                                                       └──────────────────┘
   │                                                       decrements
   │                                                       ┌──────────────────┐
   │                                                       │ INVENTORY.SOLD_* │
   │                                                       └──────────────────┘
   │                                                       logs
   │                                                       ┌──────────────────┐
   │                                                       │ TRANSACTIONS     │
   │                                                       │   type=Sale      │
   │                                                       └──────────────────┘
   │                                                       updates
   │                                                       ┌──────────────────┐
   │                                                       │ CUSTOMER_LTV     │
   │                                                       └──────────────────┘
   │                                                       calls
   │                                                       ┌──────────────────┐
   │                                                       │ _sendTelegram-   │
   │                                                       │  OrderNotification│
   │                                                       └──────────────────┘
   │                                                       calls
   │                                                       ┌──────────────────┐
   │                                                       │ _fbCapiPurchase  │
   │                                                       │ → graph.facebook │
   │                                                       └──────────────────┘
   │                                                       calls (async)
   │                                                       ┌──────────────────┐
   │                                                       │ _executeCF Purge │
   │                                                       │ (products slot)  │
   │                                                       └──────────────────┘
```

**Failure modes in legacy:**
- GAS cold-start: 3-15s if idle > 6 min (mitigated by `healthPing` every 5 min)
- Sheet row-level lock per row, but LockService per-script
- CAPI calls are fire-and-forget; failure logged but doesn't fail order
- Telegram failure doesn't fail order (try/catch)

### New path (Supabase + Worker + Edge Functions)
```
┌─────────┐    GET /products (Worker, cached 30 min)     ┌──────────────┐
│ Browser ├─────────────────────────────────────────────►│ Cloudflare   │
│ (user)  │◄────────────── {products[], categories}  ────│ Worker (CF)  │
└─────────┘                                              └──────┬───────┘
   │                                                            │ REST query
   │                                                            ▼
   │                                                    ┌──────────────┐
   │                                                    │ Supabase     │
   │                                                    │ PostgREST    │
   │                                                    │ (Postgres)   │
   │                                                    └──────────────┘
   │ browse
   │ add to cart
   │ checkout
   │ POST /checkout (Worker, API_KEY)
   ▼
   ┌─────────┐  return {success, orderId, total, ...}     Worker:
   │ Browser │◄──────────────────────────────────────────┤
   └─────────┘                                           1. atomic_adjust_stock RPC (Postgres function)
                                                          2. INSERT website_orders (multi-row)
                                                          3. INSERT transactions
                                                          4. UPSERT customers (LTV)
                                                          5. Edge Function: send_telegram
                                                          6. Edge Function: fb_capi_purchase
                                                          7. Webhook → cache purge
```

**Supabase advantages:**
- Atomic stock decrement via `FOR UPDATE` row lock (no race condition on last item)
- Sub-100ms p50 response time (no GAS cold-start)
- Stock race condition: eliminated (DB-enforced)
- Idempotency: same orderId = single row (UNIQUE constraint, not loop)
- Multi-row cart: 1 RPC, 1 transaction, all-or-nothing
- Audit log: every destructive op triggers audit_log entry

---

## Journey 2: Admin: Add Product (Authenticated)

### Old path
```
┌──────────────┐  POST {action:"saveProductFromForm", ...}     ┌──────────────┐
│ Admin Panel  ├───────────────────────────────────────────────►│ Cloudflare   │
│ (browser)    │  key=API_KEY, sessionToken                    │ Worker (CF)  │
└──────┬───────┘                                                └──────┬───────┘
       │                                                             │ proxy
       │                                                             ▼
       │                                                     ┌──────────────┐
       │                                                     │ GAS doPost   │
       │                                                     │ _requireAdmin_│ (check session)
       │                                                     └──────┬───────┘
       │                                                  invalid? │
       │◄──── 401 ─────────────────────────────────────────┘        ▼
       │                                                  ok?     saveProductFromForm(d)
       │                                                          INVENTORY.insertRow
       │                                                          52-col row
       │                                                          _restoreInventoryFormulas
       │                                                          _logActivity
       │                                                          notifyCloudflare (DISABLED no-op)
       │ return {ok, success, verify}                                │
       │◄──────────────────────────────────────────────────────────┘
       │
       │ manual "Publish to Website" click
       │ POST publish_to_cloudflare
       │ → _executeCloudflarePurge (4 actions)
       │ → Worker /__purge → invalidates 4 cache slots
```

**Legacy bug:** `notifyCloudflare` is disabled (line 4934). Each `saveProductFromForm` does NOT purge the cache. Admin must click "Publish to Website" manually or wait 30 min for SWR expiry. **Critical UX issue** — explains why store owners see stale data after edits.

### New path
```
┌──────────────┐  POST {action:"saveProductFromForm", ...}     ┌──────────────┐
│ Admin Panel  ├───────────────────────────────────────────────►│ Cloudflare   │
│ (browser)    │  key=API_KEY, sessionToken                    │ Worker (CF)  │
└──────────────┘                                                └──────┬───────┘
                                                                      │ verify_session RPC
                                                                      │ (Supabase admin_sessions)
                                                                      ▼
                                                              ┌──────────────┐
                                                              │ Supabase     │
                                                              │ adapter      │
                                                              └──────┬───────┘
                                                                     │ INSERT inventory (1 RPC)
                                                                     │ (RETURNING *)
                                                                     ▼
                                                              ┌──────────────┐
                                                              │ INSERT _activity│
                                                              └──────┬───────┘
                                                                     │
                                                                     ▼ Webhook
                                                              ┌──────────────┐
                                                              │ Worker auto- │
                                                              │ purge:       │
                                                              │ products,    │
                                                              │ product,     │
                                                              │ store_info   │
                                                              └──────────────┘
```

**Supabase advantages:**
- Auto-purge on every write (no manual "Publish" needed)
- Real-time store cache invalidation
- Bcrypt-hashed admin password (vs plaintext "Hassan__00")
- bcrypt comparison is constant-time (no timing attack)
- Session token stored in DB + cache (can revoke from admin panel)

---

## Journey 3: Admin: Update Order Status (Authenticated)

### Old path
```
Admin clicks "Mark Shipped" in admin panel
   │
   │ POST {action:"updateWebsiteOrderStatus", orderId, status, courier, sessionToken}
   ▼
Worker (GAS passthrough)
   │
   │ doPost → _requireAdmin_ → _webUpdateWebsiteOrderStatus(body)
   │ → _webJson_
   │
   ├─► Update Website_Orders row(s) (multi-row cart):
   │   - Col P (16) = new status
   │   - Col Q (17) = courier (if any)
   │   - Col R (18) = BD time
   │   - Col S (19) = append Activity marker
   │
   ├─► _fbCapiOrderStatusEvent (try/catch — fire-and-forget)
   │   if Delivered/Cancelled/Returned + admin toggle ON:
   │   - Check Activity for "<event>_capi_fired" marker (idempotency)
   │   - Hash user data (phone/email/name)
   │   - POST graph.facebook.com/v22.0/<pixel>/events
   │   - On 2xx: append "<event>_capi_fired @ HH:mm:ss" to Activity
   │
   └─► notifyCloudflare() (DISABLED no-op)
```

**Legacy bug:** CAPI idempotency check uses Activity string match — if Activity is empty/corrupt, fires every time.

### New path
```
Admin clicks "Mark Shipped" in admin panel
   │
   │ POST {action:"updateWebsiteOrderStatus", orderId, status, courier, sessionToken}
   ▼
Worker (Supabase)
   │
   │ verify_session RPC → ok
   │
   ├─► UPDATE website_orders
   │   SET status=$2, courier=$3, updated_at=now(), activity = activity || ...
   │   WHERE order_id=$1
   │   RETURNING *
   │   (single SQL — atomic, all rows for orderId)
   │
   ├─► INSERT audit_log (admin_user, action, order_id, old, new)
   │
   ├─► Edge Function: fb_capi_status_event
   │   - Idempotency: CHECK audit_log for existing event_id (DB-enforced)
   │   - SHA-256 hashing in Edge Function (no duplication of client logic)
   │   - On 2xx: INSERT audit_log row with marker
   │
   └─► Webhook: cache purge "products" (stock may have changed)
```

---

## Journey 4: Steadfast Courier: Create Consignment (Server-side, 3rd-party HTTP)

### Old path
```
Admin clicks "Send to Steadfast" in admin panel
   │
   │ POST {action:"steadfastCreate", orderId, sessionToken}
   ▼
Worker (GAS passthrough)
   │
   │ doPost → _requireAdmin_ → steadfastCreateOrder(body)
   │
   ├─► _steadfastKeys() → SETTINGS["Steadfast API Key" + "Steadfast Secret Key"]
   │
   ├─► Read Website_Orders, find orderId rows (multi-row cart)
   │   Aggregate to single consignment:
   │   - recipient_name (from row 0, max 100 chars)
   │   - recipient_phone (BD-normalized)
   │   - recipient_address (sanitized, max 250 chars)
   │   - cod_amount (0 if prepaid, else total)
   │   - note (sanitized, max 380 chars)
   │   - item_description (product + size + qty, max 380 chars)
   │   - total_lot
   │   - delivery_type (0 = home, 1 = hub)
   │
   ├─► POST https://portal.packzy.com/api/v1/create_order
   │   Headers: Api-Key, Secret-Key, Accept: application/json
   │   Body: {invoice, recipient_*, cod_amount, ...}
   │   → {consignment_id, tracking_code, status}
   │
   ├─► On 2xx: Update ALL matching rows in Website_Orders:
   │   - P (16) = "Picked Up"
   │   - Q (17) = "Steadfast | {tracking_code}"
   │   - R (18) = BD time
   │   - S (19) = append "Steadfast pickup created ({code}) @ {ts}"
   │
   └─► notifyCloudflare (DISABLED no-op)
       Return {ok, success, orderId, trackingCode, consignmentId, ...}
```

**Steadfast 11 actions** (create / bulk / status / balance / returns / payments / policestations / savekeys) — all in lines 839-1214.

### New path
```
Admin clicks "Send to Steadfast" in admin panel
   │
   │ POST {action:"steadfastCreate", orderId, sessionToken}
   ▼
Worker (Supabase)
   │
   │ verify_session RPC
   │
   ├─► Edge Function: steadfast_create_consignment
   │   - Read order rows from Supabase (no Sheet read)
   │   - Aggregate to single consignment payload
   │   - Read Steadfast creds from `steadfast_keys` table (encrypted at rest)
   │   - POST to packzy.com
   │   - On 2xx: UPDATE website_orders (1 SQL)
   │   - INSERT steadfast_consignments (audit log)
   │   - Webhook: cache purge
   │   - Return {trackingCode, consignmentId}
   │
   └─► All 11 Steadfast endpoints → Edge Function (or Worker passthrough for simple GETs)
```

**Supabase advantages:**
- Steadfast creds stored in `steadfast_keys` table (encrypted), not in plain text SETTINGS
- All consignment history in `steadfast_consignments` table (no audit log loss)
- Rate limiting via `steadfast_balance_cache` (no API quota burn)

---

## Journey 5: Telegram Bot: Status Update (Webhook)

### Old path
```
Customer's order arrives → _placeWebsiteOrder() → _sendTelegramOrderNotification()
   → POST https://api.telegram.org/bot<token>/sendMessage
   → Inline keyboard: [✅ Confirm] [❌ Cancel]
   │
   ▼
Owner (in Telegram) clicks "✅ Confirm"
   │
   │ Telegram API sends webhook to GAS Web App URL
   │ POST {update_id, callback_query: {from, message, data:"confirm:WEB-123"}}
   ▼
GAS doPost() — line 2489
   │
   ├─► body.update_id !== undefined → _handleTelegramWebhook(body)
   │
   ├─► Verify cb.from.id === TG_OWNER_ID (security)
   │   else: _tgAnswer("⛔ অনুমতি নেই!")
   │
   ├─► Parse data:
   │   "confirm:WEB-123" → orderId="WEB-123", newStatus="Processing"
   │   "shipped:WEB-123" → newStatus="Shipped"
   │   "delivered:WEB-123" → newStatus="Delivered"
   │   "cancel:WEB-123" → newStatus="Cancelled"
   │
   ├─► _tgOrderAction(token, chatId, msgId, cbId, orderId, newStatus, label, origText)
   │   - Find all rows for orderId in Website_Orders
   │   - Update P (status), R (updated), S (activity) for each row
   │   - _fbCapiOrderStatusEvent(orderId, newStatus, row)
   │   - _tgAnswer(token, cbId, label) → popup
   │   - Build next-step buttons (Processing → Shipped → Delivered)
   │   - _tgEdit(token, chatId, msgId, updatedText, nextBtns) → edit original message
   │
   └─► Self-heal check: _tgEnsureWebhookCurrent (1h throttle)
       - GET getWebhookInfo
       - If URL mismatch: POST setWebhook
       - If getMe fails: _tgRecordDiag('error', ...)
```

**Telegram features:**
- /start → welcome message
- /orders → list pending with quick-confirm buttons
- /confirmed → list processing
- /today → today's orders + total revenue
- /stats → today's summary
- 9 status transitions: Pending → Processing → Shipped/Delivered + cancel

### New path
```
Customer's order arrives → Worker → Edge Function: send_telegram_order_notification
   → POST api.telegram.org/bot<token>/sendMessage
   → Inline keyboard (same as before)
   │
   ▼
Owner clicks "✅ Confirm" in Telegram
   │
   │ Telegram API sends webhook to Worker route /tg-webhook (or Edge Function URL)
   │ POST {update_id, callback_query: ...}
   ▼
Edge Function: handle_telegram_webhook
   │
   ├─► Verify cb.from.id === owner_chat_id (from env var)
   │
   ├─► Parse data → orderId, newStatus
   │
   ├─► UPDATE website_orders (1 SQL, all rows for orderId)
   │   SET status=$1, updated_at=now(), activity=activity||...
   │
   ├─► INSERT audit_log
   │
   ├─► Edge Function: fb_capi_status_event
   │
   ├─► Telegram API: answerCallbackQuery + editMessageText (same as before)
   │
   └─► Webhook: cache purge
```

**Supabase advantages:**
- No GAS-specific URL routing (just a Worker route)
- Owner chat ID stored as env var, not hardcoded
- Token stored as env var (not in ScriptProperties)
- 9 status transitions still work, just routed through Edge Function

---

## Cross-cutting: rate limiting

### Old path
- Per-API-key: 100 req/min via `CacheService.getScriptCache()` (line 2424-2441)
- Per-phone (place_order only): 5 req/min
- _rateLimit(key, phone) called in doGet AND doPost

### New path
- Per-API-key: Cloudflare Worker rate limit rule (5 req/s, 100 req/min)
- Per-IP: same Worker rule
- Per-phone (place_order only): Edge Function → Supabase `check_login_rate_limit` RPC
- All limits logged to `rate_limit_log` table for analytics

---

## Cross-cutting: cache invalidation

### Old path
- `notifyCloudflare()` is DISABLED (line 4934) — returns `{ok,note:...}`
- Only fires on manual "Publish to Website" click (menu) or `publish_to_cloudflare` action
- Worker /__purge route accepts `{actions: [...]}` and purges edge cache for those slots

### New path
- Every write RPC triggers a database webhook → Worker → cache purge
- Worker auto-purges based on table name: inventory → [products, product, store_info]
- No manual "Publish" needed (one less UX step)
- Admin can still force-purge all via Worker `/__purge?all=true`

---

## Cross-cutting: Telegram order notification timing

### Old path
- _sendTelegramOrderNotification() called inline from _placeWebsiteOrder
- Blocks order response for up to 5 sec if Telegram is slow
- Failure: try/catch, doesn't fail order

### New path
- Edge Function: send_telegram_order_notification (async, fire-and-forget)
- Order returns immediately, Telegram fires in background
- Failure: retry queue in `notification_queue` table, retry up to 3x
- If all 3 fail: log to `notification_failures` for manual review

---

## Summary: flow improvements

| Concern | Old (GAS) | New (Supabase) |
|---|---|---|
| Cold-start latency | 3-15s if idle | <100ms |
| Stock race condition | Possible (Sheet lock per-script) | Impossible (FOR UPDATE) |
| Cache invalidation | Manual ("Publish" button) | Automatic (webhook per write) |
| Session storage | ScriptProperties + CacheService + Sheet | `admin_sessions` table + Redis-equivalent (Supabase Realtime) |
| Telegram routing | GAS Web App URL | Edge Function URL |
| CAPI idempotency | String match in Activity col | UNIQUE constraint on event_id in audit_log |
| Rate limiting | CacheService (volatile) | Supabase table (durable, queryable) |
| Multi-row cart | N Sheet writes, manual aggregation | 1 SQL with array param |
| Manual order stock sync | Manual (applyStockChange) | Trigger: any insert into orders/website_orders auto-decrements stock |
| Return → Sale cancel | Loop through TRANSACTIONS, recalc totals | RPC: transactionally update both tables |
| Analytics | Read full Sheet, compute in GAS JS | SQL view, indexed, instant |
| Customer LTV | Full Sheet scan, append/update | UPSERT with ON CONFLICT |
| Cleanup (old orders) | GAS time-based trigger | pg_cron |
| Health check | GAS `healthPing` every 5min | Cloudflare auto-warm + `/__health` |
| Schema migration | Manual `migrateAddNewColumns` | `apply_migration` (idempotent) |
