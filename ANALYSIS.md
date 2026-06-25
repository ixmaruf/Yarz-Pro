# YARZ — PHASE 1 Analysis (GAS to Supabase)
# Date: 2026-06-20  |  Analyst: Kilo

## 1. FILE INVENTORY

| Purpose | File | Lines | Notes |
|---|---|---|---|
| GAS Backend | `Google Sheet app scrept.txt` | 5,360 | YARZ PRO v11.7 |
| Cloudflare Worker | `cloudflare workers.txt` | 1,541 | Edge cache + GAS proxy |
| Admin Panel | `Yarz-admin panal/index.html` | 12,007 | Single-file SPA |
| Existing Adapter | `Yarz-admin panal/supabase_adapter.js` | ~370 | Partial Supabase impl |
| Frontend API | `js/api.js` + `js/app.js` | ~580 + 1,500+ | SPA controller |
| Tracker | `js/pixel.js` + `js/fortress.js` | 60 + 22 | FB/TT/GA4 + fraud block |

## 2. TAB MAP (19 Google Sheets Tabs)

### Core (migrate directly)
| Tab | Cols | Supabase Table | Primary Key |
|---|---|---|---|
| INVENTORY | 52 | `inventory` | `product` (UNIQUE) |
| ORDERS | 16 | `orders` | `order_id` |
| Website_Orders | 29 | `website_orders` | `order_id` |
| TRANSACTIONS | 8 | `transactions` | auto-id |
| SETTINGS | 3 | `settings` | `key` |
| DELIVERY_CHARGES | 4 | `delivery_charges` | `id` |
| AD_TRACKER | 7 | `ad_tracker` | auto-id |
| EXPENSES | 5 | `expenses` | auto-id |
| MONTHLY_REPORT | 6 | `monthly_reports` | `month` |
| YEARLY_REPORT | 6 | `yearly_reports` | `year` |
| CUSTOMER_LTV | runtime | `customers` | `phone` |
| _ACTIVITY | 4 | `_activity` | auto-id |
| _DRAFT_DATA | 2 | `_draft_data` | `name` |
| _ARCHIVE_DATA | 2 | `_archive_data` | `name` |
| ADMIN_SESSIONS | runtime | `admin_sessions` | `token` |
| ADMIN_LOGIN_ATTEMPTS | runtime | `admin_login_attempts` | auto-id |

### View tabs (FILTER formula over INVENTORY)
| Tab | Supabase |
|---|---|
| DRAFT_VIEW (status=Draft) | `inventory_draft_view` VIEW |
| ARCHIVE_VIEW (status=Archived) | `inventory_archive_view` VIEW |
| WEBSITE_SYNC (status=Active, customer-facing subset) | `website_sync_view` VIEW |

### INVENTORY 52-Column Schema
1=Product, 2=Image1, 3=Image2, 4=Image3, 5=VideoURL,
6=Description, 7=Category, 8=Fabric, 9=Badge, 10=SizeChart,
11=DeliveryDays, 12=Cost, 13=Regular, 14=Sale, 15=Disc%, 16=DiscType,
17=DhakaDelivery, 18=OutsideDelivery,
19=M(stock), 20=L(stock), 21=XL(stock), 22=XXL(stock),
23=M(sold), 24=L(sold), 25=XL(sold), 26=XXL(sold),
27=TotSold, 28=Returns, 29=Remaining, 30=TotStock,
31=Invest, 32=Revenue, 33=ToRecover, 34=Gross, 35=FB_Ad, 36=Net, 37=DiscImpact,
38=Updated, 39=Status,
40=Image4, 41=Image5, 42=Image6,
43=CouponActive, 44=CouponCode, 45=CouponDisc%,
46=S(stock), 47=3XL(stock), 48=S(sold), 49=3XL(sold),
50=HiddenSizes, 51=SizeType, 52=Accessory

## 3. ACTION MAP (50+ endpoints)

### Public GET (API_KEY only, no admin)
products             -> _buildPublicData()   [INVENTORY filtered Active]
product              -> _getSingleProduct()  [by name]
categories           -> getCategoryList()
store_info           -> _getFullStoreInfoObj()
delivery_charges     -> _getDeliveryCharges()
orders_by_phone      -> _getOrdersByPhone()
health               -> static
fb_feed              -> CSV for FB catalog

### Public POST (API_KEY only)
place_order          -> _placeWebsiteOrder()  [Website_Orders insert]
subscribe_newsletter -> _webSubscribeNewsletter()
capi / fbcapi        -> _fbCapiFromBrowser()
ttapi / ttevents     -> _ttEventsApi()

### Admin POST (session token required)
adminLogin / adminLogout / verify_auth

# Products
saveProductFromForm, saveProductEditFromForm, updateProductStatus,
applyStockChange, applyBulkEdit, recordSale, deleteProduct

# Orders
saveOrderFromForm, updateWebsiteOrderStatus, updateManualOrderStatus,
deleteWebsiteOrder, deleteManualOrder, archiveCompletedOrders

# Finance
saveAdFromForm, saveExpenseFromForm, saveReturnFromForm,
generateMonthlyReport, generateYearlyReport

# Settings
updateSettings, updateDeliveryCharges, saveGitHubSettings, githubSyncNow

# Analytics
getcurrentmonthsnapshot, getproductanalytics6m, getcustomerltv, snapshotmonth

# Cleanup (DANGER)
fullFactoryReset, clearFinancialsOnly, clearInventoryOnly

# Courier (Steadfast)
steadfastCreate, steadfastBulk, steadfastStatus, steadfastBalance,
steadfastSaveKeys, steadfastGetReturn, steadfastListReturns,
steadfastListPayments, steadfastGetPayment, steadfastListPolicestations

# Fortress (anti-fraud)
__fortress_lookup, __fortress_block, __fortress_unblock,
__fortress_clear_all, __fortress_log_event

# Sheet read (admin-only since v9.6)
sheet_read, sheet_read_formatted

# Migration helpers
migrate, diagnoseS3XL, repairWebsiteOrdersStatus, repairCouponActiveValidation

# Cache publish
publish_to_cloudflare

## 4. EXISTING SUPABASE WORK (already done)

`Yarz-admin panal/supabase_adapter.js`:
| Action | Status | Notes |
|---|---|---|
| sheet_read (INVENTORY/ORDERS/TRANSACTIONS/SETTINGS) | DONE | Returns GAS-compatible array shape |
| applyStockChange | DONE | Direct update |
| saveProductFromForm | DONE | Direct insert |
| saveProductEditFromForm | DONE | Direct update |
| deleteProduct | DONE | Direct delete |
| adminLogin | PARTIAL | Hardcoded credentials — NOT real Supabase session |
| adminLogout | STUB | Returns success only |

## 5. RISKS / EDGE CASES

1. **Rate limiting**: GAS uses PropertiesService sliding window. Replicate
   with `rate_limit_log` table OR keep simple in-memory in Worker.
2. **Inventory formulas** (TotSold, Remaining): GAS uses formulas.
   In Supabase, use GENERATED ALWAYS AS (STORED) columns.
3. **WEBSITE_SYNC filter**: Supabase VIEW (same shape, customer subset).
4. **Stock race condition**: 2 customers buy last item. Solution:
   `UPDATE inventory SET stk_m = stk_m - $qty WHERE product=$p AND stk_m>=$qty RETURNING ...`.
5. **Steadfast external HTTP**: keep in Supabase Edge Function (or Worker).
6. **Telegram webhook**: doPost catches `update_id`. Will become Supabase
   Edge Function or Worker route.
7. **FB/TikTok CAPI**: Pure HTTP — easy migration.
8. **GitHub sync**: write data.json. Cron Edge Function in Supabase.
9. **Mass resets**: fullFactoryReset — must require explicit confirm + audit log.

## 6. MIGRATION ORDER (least-risk first)

1. settings, delivery_charges, customers (read-only data)
2. inventory (highest impact, complex)
3. orders + website_orders (transaction core)
4. transactions, ad_tracker, expenses (financial)
5. monthly/yearly_reports (depend on 3+4)
6. _activity, _draft_data, _archive_data (admin-only)
7. admin_sessions + admin_login_attempts (auth last)

## 7. CUTOVER DECISIONS

| Question | Decision |
|---|---|
| Adapter strategy | Continue + Audit (do not break working code) |
| Worker kill-switch | `SUPABASE_ENABLED` env var (simple, effective) |
| Session/login | Custom `admin_sessions` + token (current direction) |
| Cutover | Side-by-side, gradual switch via per-action flag |
| Frontend | Transparent via Worker (no frontend changes) |

## 8. FILES TO CREATE

```
supabase/
  schema.sql           # All CREATE TABLE
  indexes.sql          # All CREATE INDEX
  views.sql            # DRAFT_VIEW / ARCHIVE_VIEW / WEBSITE_SYNC
  rls.sql              # Row Level Security policies
  seed_defaults.sql    # categories, fabrics, badges, delivery zones
scripts/
  export-from-gas.gs   # Apps Script snippet (paste into GAS, run once)
  export-pull.js       # Node: call GAS and save JSON
  import-to-supabase.js # Node: JSON -> Supabase bulk insert
  verify-counts.js     # Cross-check Sheets vs Supabase
supabase-adapter-v2.js # Complete adapter (backwards-compatible)
worker-supabase.js     # Cloudflare Worker with Supabase routing
.env.example           # Credential template
README.md              # Migration guide
MIGRATION_REPORT.md    # Final report
```

## 9. CREDENTIALS NEEDED (from user later)

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STEADFAST_API_KEY=
STEADFAST_SECRET_KEY=
FB_CAPI_ACCESS_TOKEN=
TELEGRAM_BOT_TOKEN=
GITHUB_TOKEN=
```

User plugs these in when running the scripts. No code requires them at write time.
