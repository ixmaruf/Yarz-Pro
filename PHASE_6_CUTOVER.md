# YARZ — PHASE 6: Cutover Runbook
Date: 2026-06-20
Status: ✅ CUTOVER COMPLETE (2026-06-20 09:40 +06:00)
Result: Production `https://yarzclothing.xyz/` now serves Supabase data with GAS passthrough fallback

## What actually happened

### Step 1: Cloudflare auth (via Playwright)
1. Ran `npx wrangler login` (background)
2. Opened OAuth URL in Playwright browser
3. Clicked "Authorize" on the consent form
4. ✅ Account: `Marufhasan80009@gmail.com` (ID: `f923bbbc8babcb3e52d2edc47c5b6c7e`)

### Step 2: Set 4 Cloudflare secrets for `yarz` worker
```bash
echo "https://xdzduowhwubogaavraap.supabase.co" | npx wrangler secret put SUPABASE_URL
echo "<jwt>" | npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
echo "yarz-purge-secret-2026" | npx wrangler secret put PURGE_SECRET
echo "yarz-tg-webhook-2026" | npx wrangler secret put TG_WEBHOOK_SECRET
```

### Step 3: Update wrangler.toml
```toml
name = "yarz"             # was "yarz-api"; replaced old worker
main = "worker-supabase.js"
compatibility_date = "2024-11-01"
workers_dev = true        # was false; fixed
SUPABASE_ENABLED = "true" # was false; flipped after verifying legacy mode works
```

### Step 4: Deploy (zero-risk → flipped to Supabase)
1. Deploy with `SUPABASE_ENABLED = "false"` — customer site still works (routes to GAS)
2. Verify with curl: identical response (383 bytes via GAS)
3. Flip `SUPABASE_ENABLED = "true"` and redeploy
4. Verify: 420 bytes from Supabase (different response — confirmed Supabase routing)

### Bugs found and fixed
1. **wrangler 4.x doesn't expose env vars as globals**
   - Refactored to `export default { fetch(request, env, ctx) }` pattern
   - `supabaseRequest`, `handleSupabase` now accept env as param
2. **`workers_dev = false`** — workers.dev URL inaccessible
   - Set to `true` in wrangler.toml
3. **`caches.default.keys()` not implemented in Workers**
   - Replaced with explicit `cache.delete(new Request(...))` for known endpoints
4. **Public POSTs (subscribe_newsletter) not routed to Supabase**
   - Worker only routed ADMIN_ACTIONS POSTs to Supabase
   - Added separate handler for PUBLIC_POST set (no cache purge)
5. **Worker sent meta fields (action, key) in payload**
   - Supabase rejected with `PGRST204: column 'action' not found`
   - Added `delete cleanPayload.action; delete cleanPayload.key; delete cleanPayload._t;` in insert/update paths

### Final verification (PRODUCTION yarzclothing.xyz)

| Endpoint | Result | Source |
|---|---|---|
| `?action=products` | 681 bytes | Supabase (Aza product) |
| `?action=product&name=Aza` | 722 bytes | Supabase |
| `?action=delivery_charges` | 420 bytes | Supabase (2 zones) |
| `?action=store_info` | 4804 bytes | GAS passthrough |
| `?action=categories` | 350 bytes | GAS passthrough |
| `?action=health` | 143 bytes | GAS passthrough |
| `POST action=subscribe_newsletter` | 200, row inserted | Supabase |
| `POST /purge` (with secret) | 200, purged=0 | Worker |
| `POST /__env` (debug) | env state | Worker |

### Frontend updates
- `js/api.js` default URL changed to `https://yarz-api.marufhasan80009.workers.dev/` (defensive; in case same-origin isn't used)
- `Yarz-admin panal/index.html` `WORKER` constant updated to new URL (for cache purge)
- `Yarz-admin panal/index.html` purge URLs updated
- `index.html` line 138 fallback URL updated

### Cutover method used
**Direct deployment to old worker name (`yarz`)** — simplest path:
- Old worker `yarz.marufhasan80009.workers.dev` got new code (overwrites old)
- Custom domain `yarzclothing.xyz` already bound to `yarz` → automatically serves new code
- Zero frontend change for production
- localStorage override still works as backup

### Rollback (if needed)
**30-second SLA via env var:**
```bash
echo "false" | npx wrangler secret put SUPABASE_ENABLED
```
This reverts all traffic to GAS within 30 seconds (Cloudflare edge propagation).

To completely revert to old worker code:
1. `wrangler deploy cloudflare-worker-pre-supabase.txt --name yarz` (in `legacy/`)
2. Restore `wrangler.toml` with `SUPABASE_ENABLED = "false"`
3. Wait for cache to expire (30 min) or call `/purge`

### Known limitations
- **place_order still uses GAS** (passthrough) — full Supabase order flow not implemented
- **store_info, categories, health use GAS** (passthrough) — these work fine via GAS
- **Admin actions** are routed to Supabase but not fully tested (no admin login test)
- **Telegram bot not configured** (TG_BOT_TOKEN not set) — webhook returns 500
- **debug `/__env` endpoint still exists** — useful for diagnostics, no secrets exposed

### Future enhancements (post-7-day stable)
- Move `place_order` to use `create_manual_order` RPC
- Move `store_info` to use settings+delivery aggregate RPC
- Add Telegram bot + webhook
- Delete `legacy/cloudflare-worker-pre-supabase.txt` after 7 days stable
- Delete `legacy/google-apps-script-v11.7.txt` if GAS no longer needed
- Permanent cleanup of `legacy/debug-scripts/`
