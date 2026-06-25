# YARZ Clothing — Google Apps Script → Supabase Migration

This repository contains the complete migration plan + scripts to move the YARZ
backend from Google Apps Script (GAS) + Google Sheets to Supabase (PostgreSQL).

## 📁 Repository Structure

```
YARZ WEB SITE/
├── Google Sheet app scrept.txt          # LEGACY: GAS backend (5,360 lines)
├── cloudflare workers.txt               # LEGACY: Cloudflare Worker v17.5
├── Yarz-admin panal/
│   ├── index.html                       # Admin Panel SPA (12,007 lines)
│   └── supabase_adapter.js              # OLD: partial Supabase adapter (~370 lines)
│
├── supabase/                            # NEW: Supabase schema
│   ├── schema.sql                       # 22 tables (BIGSERIAL PK, NUMERIC money, GENERATED columns)
│   ├── views.sql                        # 5 views (DRAFT/ARCHIVE/WEBSITE_SYNC/customer_ltv)
│   ├── indexes.sql                      # (inlined into schema.sql)
│   ├── rls.sql                          # Row Level Security policies
│   ├── rpc.sql                          # 8 Postgres functions (admin_login, atomic stock, etc.)
│   └── seed_defaults.sql                # categories, fabrics, badges, delivery zones
│
├── scripts/                             # NEW: Migration scripts
│   ├── export-from-gas.gs               # Paste into GAS editor, run once
│   ├── export-pull.js                   # Node: pulls JSON from GAS
│   ├── import-to-supabase.js            # Node: bulk-insert into Supabase
│   └── verify-counts.js                 # Node: cross-check Sheets vs Supabase
│
├── supabase-adapter-v2.js               # NEW: complete Supabase adapter (all 40+ actions)
├── worker-supabase.js                   # NEW: Cloudflare Worker (dual GAS+Supabase routing)
├── .env.example                         # Template for credentials
├── ANALYSIS.md                          # PHASE 1 analysis output
└── README.md                            # This file
```

## 🚀 Migration Steps

### Step 1 — Create Supabase project
1. Go to https://supabase.com and create a new project
2. Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   from Settings -> API

### Step 2 — Run SQL files (in order)
In Supabase SQL Editor, run:
```
1. supabase/schema.sql         -- creates 22 tables
2. supabase/views.sql          -- creates 5 views
3. supabase/rls.sql            -- Row Level Security
4. supabase/rpc.sql            -- Postgres functions
5. supabase/seed_defaults.sql  -- defaults (categories, delivery, etc.)
```

### Step 3 — Fill `.env`
```
cp .env.example .env
# edit .env with real credentials
```

### Step 4 — Export from GAS
1. Open https://script.google.com -> your YARZ project
2. File -> New -> paste contents of `scripts/export-from-gas.gs`
3. Run `exportAllTabsToJson()` (authorize if asked)
4. View -> Logs -> copy the JSON
5. Save as `exports/manual-export.json`
6. (Alternative): Publish the EXPORT_JSON tab as CSV -> put URL in `.env`

### Step 5 — Import to Supabase
```bash
npm install node-fetch dotenv   # if needed
node scripts/export-pull.js --manual
node scripts/import-to-supabase.js
node scripts/verify-counts.js exports/gas-export-*.json
```

Expected: all rows should show OK; mismatches = data problem.

### Step 6 — Deploy Cloudflare Worker
```bash
# Install wrangler if needed: npm i -g wrangler
wrangler kv:namespace create "CACHE"
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put PURGE_SECRET
wrangler secret put SUPABASE_ENABLED   # true = opt-in to Supabase
wrangler deploy worker-supabase.js --name yarz-api
```

### Step 7 — Switch Admin Panel
1. In `Yarz-admin panal/index.html`, replace the `<script src="supabase_adapter.js">`
   tag with `<script src="../supabase-adapter-v2.js">`
2. Add Supabase URL + anon key initialization in `<head>`
3. Test all sections (Inventory, Orders, etc.)

### Step 8 — Test and Cutover
1. Keep `SUPABASE_ENABLED=false` in Worker; everything works as before
2. Set `SUPABASE_ENABLED=true` and watch Cloudflare Worker logs
3. Verify each action works end-to-end
4. Once stable, can leave GAS running read-only as backup, then retire

## 🔄 Rollback

If anything goes wrong:
```bash
wrangler secret put SUPABASE_ENABLED   # value: false
```
This routes ALL traffic back to legacy GAS — instant rollback, no DNS change.

## 📊 What Was Done (PHASES 1-5)

| Phase | Status | Output |
|---|---|---|
| 1. Analysis | ✅ | `ANALYSIS.md` + CHECKPOINT-1 |
| 2. Schema | ✅ | `supabase/*.sql` (5 files) |
| 3. Data Migration | ✅ | `scripts/*` (4 files) |
| 4. Worker | ✅ | `worker-supabase.js` (16 KB) |
| 5. Adapter | ✅ | `supabase-adapter-v2.js` (30 KB, 40+ actions) |
| 6. Docs | ✅ | This README + MIGRATION_REPORT.md |

## 🔐 Security Notes

- `SUPABASE_SERVICE_ROLE_KEY` MUST stay server-side. Never in browser.
- `SUPABASE_ANON_KEY` is browser-safe but RLS-restricted.
- Admin Panel uses `admin_sessions` table (custom JWT-like token), NOT Supabase Auth.
- Old hardcoded `maruf_ix` / `Hassan__00` is now bcrypt-hashed in `admin_users` table.
- `gitignore` MUST include `.env`.
