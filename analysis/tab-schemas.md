# YARZ 19-Tab Schema Map
**Source:** `legacy/google-apps-script-v11.7.txt` COL constants + `_setup*` functions
**Date:** 2026-06-20
**Phase:** 1.2

---

## Tab 1: INVENTORY (52 cols) → `inventory` table
**Source lines:** 79-110 (COL map), 330-380 (`_setupInventory`), 1417-1758 (writers)
**Estimated rows:** up to 1,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Product | TEXT | NOT NULL UNIQUE | business key |
| B | 2 | Image1 | TEXT | yes | URL |
| C | 3 | Image2 | TEXT | yes | URL |
| D | 4 | Image3 | TEXT | yes | URL |
| E | 5 | VideoURL | TEXT | yes | URL |
| F | 6 | Description | TEXT | yes | HTML allowed |
| G | 7 | Category | TEXT | yes | dropdown |
| H | 8 | Fabric | TEXT | yes | dropdown |
| I | 9 | Badge | TEXT | yes | dropdown |
| J | 10 | SizeChart | TEXT | yes | |
| K | 11 | DeliveryDays | TEXT | yes | "2-3 days" |
| L | 12 | Cost | NUMERIC(12,2) | yes | BDT |
| M | 13 | Regular | NUMERIC(12,2) | yes | BDT |
| N | 14 | Sale | NUMERIC(12,2) | yes | BDT |
| O | 15 | Disc% | NUMERIC(5,2) | yes | **FORMULA** = (M-N)/M*100 |
| P | 16 | DiscType | TEXT | yes | enum: Normal/Serious/Special/Clearance/Seasonal |
| Q | 17 | DeliveryDhaka | NUMERIC(12,2) | yes | default 60 |
| R | 18 | DeliveryOutside | NUMERIC(12,2) | yes | default 120 |
| S | 19 | Stk_M | INT | yes | |
| T | 20 | Stk_L | INT | yes | |
| U | 21 | Stk_XL | INT | yes | |
| V | 22 | Stk_XXL | INT | yes | |
| W | 23 | Sold_M | INT | yes | |
| X | 24 | Sold_L | INT | yes | |
| Y | 25 | Sold_XL | INT | yes | |
| Z | 26 | Sold_XXL | INT | yes | |
| AA | 27 | TotSold | INT | yes | **FORMULA** = W+X+Y+Z+AV+AW |
| AB | 28 | Returns | INT | yes | **FORMULA** = 0 (always, v15.35 fix) |
| AC | 29 | Remaining | INT | yes | **FORMULA** = (W+X+Y+Z+AV+AW) - (AA-AB) |
| AD | 30 | TotStock | INT | yes | **FORMULA** = W+X+Y+Z+AT+AU |
| AE | 31 | Invest | NUMERIC(12,2) | yes | **FORMULA** = L × (W+X+Y+Z+AT+AU) |
| AF | 32 | Revenue | NUMERIC(12,2) | yes | **FORMULA** = N × (AA-AB) |
| AG | 33 | ToRecover | NUMERIC(12,2) | yes | **FORMULA** = max(0, AE-AF) |
| AH | 34 | Gross | NUMERIC(12,2) | yes | **FORMULA** = (N-L) × (AA-AB) |
| AI | 35 | FB_Ad | NUMERIC(12,2) | yes | **FORMULA** = SUMPRODUCT(AD_TRACKER!B:n × AD_TRACKER!C:C) |
| AJ | 36 | Net | NUMERIC(12,2) | yes | **FORMULA** = AH - AI |
| AK | 37 | DiscImpact | NUMERIC(12,2) | yes | **FORMULA** = (M-N) × (AA-AB) if P≠"Normal" |
| AL | 38 | Updated | TIMESTAMPTZ | yes | |
| AM | 39 | Status | TEXT | NOT NULL | enum: Active/Draft/Archived |
| AN | 40 | Image4 | TEXT | yes | URL |
| AO | 41 | Image5 | TEXT | yes | URL |
| AP | 42 | Image6 | TEXT | yes | URL |
| AQ | 43 | CouponActive | TEXT | yes | enum: Yes/No/Hidden (v15.92) |
| AR | 44 | CouponCode | TEXT | yes | |
| AS | 45 | CouponDisc% | NUMERIC(5,2) | yes | 0-100 |
| AT | 46 | Stk_S | INT | yes | |
| AU | 47 | Stk_3XL | INT | yes | |
| AV | 48 | Sold_S | INT | yes | |
| AW | 49 | Sold_3XL | INT | yes | |
| AX | 50 | HiddenSizes | TEXT | yes | "S,XXL" or "__ONESIZE__" sentinel |
| AY | 51 | SizeType | TEXT | yes | "" / "shirt" / "pant" |
| AZ | 52 | Accessory | TEXT | yes | "Yes" / "No" |

**PK:** surrogate `id` BIGSERIAL + UNIQUE on `product`
**FKs:** none (denormalized — size cols embedded for speed)
**Formulas (12):** Disc%, TotSold, Returns=0, Remaining, TotStock, Invest, Revenue, ToRecover, Gross, FB_Ad, Net, DiscImpact — all in `supabase/schema.sql` as `GENERATED ALWAYS AS (STORED)`
**Special:**
- __ONESIZE__ sentinel (v16.1) for sizeless products (caps/watches)
- ONE token maps to STK_M / SOLD_M in code (line 1737, 1927, 2111, 2919, 3150, 3340)

---

## Tab 2: ORDERS (16 cols) → `orders` table
**Source lines:** 483-489, 1901-1986
**Estimated rows:** up to 2,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ | NOT NULL | default now() |
| B | 2 | OrderID | TEXT | NOT NULL UNIQUE | "ORD-{ts}" |
| C | 3 | Customer | TEXT | NOT NULL | |
| D | 4 | Phone | TEXT | NOT NULL | 11 digits BD |
| E | 5 | Address | TEXT | yes | |
| F | 6 | Location | TEXT | yes | Dhaka/Outside |
| G | 7 | Product | TEXT | NOT NULL | INVENTORY ref (text) |
| H | 8 | Size | TEXT | yes | S/M/L/XL/XXL/3XL/ONE |
| I | 9 | Qty | INT | NOT NULL | default 1 |
| J | 10 | Price | NUMERIC(12,2) | NOT NULL | unit price |
| K | 11 | Delivery | NUMERIC(12,2) | yes | |
| L | 12 | Total | NUMERIC(12,2) | NOT NULL | (Qty*Price)+Delivery |
| M | 13 | Payment | TEXT | yes | COD/bKash/Nagad/Bank |
| N | 14 | Status | TEXT | NOT NULL | Pending/Confirmed/Processing/Shipped/Delivered/Cancelled/Returned |
| O | 15 | Courier | TEXT | yes | |
| P | 16 | Notes | TEXT | yes | |

**PK:** surrogate `id` + UNIQUE on `order_id`
**FKs:** product → inventory.product (soft, no constraint for legacy rows)

---

## Tab 3: Website_Orders (19 cols) → `website_orders` table
**Source lines:** 491-507, 2707-2969, 2971-3226
**Estimated rows:** up to 2,000 (90-day auto-prune)

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | OrderID | TEXT | NOT NULL UNIQUE | "WEB-{ts}" or client-provided |
| B | 2 | Date | TIMESTAMPTZ | NOT NULL | |
| C | 3 | Customer | TEXT | NOT NULL | |
| D | 4 | Phone | TEXT | NOT NULL | 11 digits, normalized |
| E | 5 | Address | TEXT | yes | |
| F | 6 | Location | TEXT | yes | |
| G | 7 | Product | TEXT | NOT NULL | per row (multi-item cart = N rows) |
| H | 8 | Size | TEXT | yes | |
| I | 9 | Qty | INT | NOT NULL | |
| J | 10 | Price | NUMERIC(12,2) | NOT NULL | |
| K | 11 | Delivery | NUMERIC(12,2) | yes | charged once on first row only |
| L | 12 | Total | NUMERIC(12,2) | NOT NULL | |
| M | 13 | Payment | TEXT | yes | |
| N | 14 | Notes | TEXT | yes | may contain "FREE Delivery (৳X+ order)" marker |
| O | 15 | Coupon | TEXT | yes | |
| P | 16 | Status | TEXT | NOT NULL | 11 enum values (v16.4) |
| Q | 17 | Courier | TEXT | yes | "Steadfast \| TRACKING_CODE" |
| R | 18 | Updated | TEXT | yes | "yyyy-MM-dd HH:mm:ss" BD |
| S | 19 | Activity | TEXT | yes | pipe-separated event log |
| T | 20 | DeviceID | TEXT | yes | v1.0 Fortress |
| U | 21 | IP | TEXT | yes | client-provided |
| V | 22 | Country | TEXT | yes | |
| W | 23 | DeviceInfo | TEXT | yes | browser + OS + screen |
| X | 24 | RiskScore | INT | yes | 0-100 |
| Y | 25 | RiskSignals | TEXT | yes | pipe-separated |
| Z | 26 | Flagged | BOOL | yes | |
| AA | 27 | FlagReason | TEXT | yes | |
| AB | 28 | FlaggedAt | TIMESTAMPTZ | yes | |
| AC | 29 | FlaggedBy | TEXT | yes | |

**Status enum (11):** Pending, Confirmed, Processing, Picked Up, Ready for Delivery, Handed to Courier, In Transit, Shipped, Delivered, Cancelled, Returned

**PK:** surrogate `id` + UNIQUE on `order_id`
**FKs:** product → inventory.product (soft)
**Index:** (phone), (status), (date DESC), (courier) WHERE courier IS NOT NULL

---

## Tab 4: TRANSACTIONS (8 cols) → `transactions` table
**Source lines:** 554-559
**Estimated rows:** up to 5,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ | NOT NULL | |
| B | 2 | Product | TEXT | NOT NULL | |
| C | 3 | Type | TEXT | NOT NULL | enum: Sale/Return/Adjustment |
| D | 4 | Size | TEXT | yes | |
| E | 5 | Qty | INT | NOT NULL | **v15.32: Returns log qty=0** |
| F | 6 | Revenue | NUMERIC(12,2) | yes | |
| G | 7 | Cost | NUMERIC(12,2) | yes | |
| H | 8 | Profit | NUMERIC(12,2) | yes | F - G |

**PK:** surrogate `id` BIGSERIAL
**Special:** Returns always log qty=0 to keep INVENTORY.AB (Returns) = 0 source-of-truth
**Index:** (product, type, date DESC), (date)

---

## Tab 5: SETTINGS (3 cols) → `settings` table
**Source lines:** 585-610, 3354-3416
**Estimated rows:** up to 100

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Key | TEXT | NOT NULL UNIQUE | |
| B | 2 | Value | TEXT | yes | |
| C | 3 | Description | TEXT | yes | |

**Default keys (line 588-606):** Store Name, Store Phone, Store Email, Store Address, Currency Symbol, Link Facebook, Link Instagram, Link WhatsApp, Link Messenger, Link TikTok, Link YouTube, Custom Categories, Custom Fabrics, Custom Badges, GitHub Token, GitHub Repo, GitHub Branch, GitHub Path

**Plus runtime-added keys:** Steadfast API Key, Steadfast Secret Key, Telegram Bot Token, Telegram Chat ID, FB Pixel, FB CAPI Token, FB CAPI Test Code, FB CAPI Test Mode, TT Pixel, TT Access Token, TT Advertiser ID, Website Host, Store URL, Enable COD, Store Status, B2B Mode, Announcement Active/Text/BG/Text Color, Checkout Mode, Custom Field, Free Ship Amt, FreeShip Advance, pixel_net_fb_capi, pixel_evt_order_delivered, pixel_evt_order_cancelled, pixel_evt_order_returned

**PK:** `key` TEXT PRIMARY KEY (no surrogate)
**Special:** Key alias sync — saving "Currency" also updates "Currency Symbol" (line 3362-3374)

---

## Tab 6: DELIVERY_CHARGES (4 cols) → `delivery_charges` table
**Source lines:** 612-644, 646-670
**Estimated rows:** up to 10 (zones)

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | ID | TEXT | NOT NULL UNIQUE | "inside_narayanganj" |
| B | 2 | LocationName | TEXT | NOT NULL | |
| C | 3 | Charge | NUMERIC(12,2) | NOT NULL | BDT |
| D | 4 | Active | BOOL | NOT NULL | default true |

**Defaults:** inside_narayanganj=70, outside_narayanganj=140

---

## Tab 7: AD_TRACKER (7 cols) → `ad_tracker` table
**Source lines:** 561-565
**Estimated rows:** up to 2,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ | NOT NULL | |
| B | 2 | Product | TEXT | NOT NULL | |
| C | 3 | Spend | NUMERIC(12,2) | NOT NULL | BDT |
| D | 4 | Reach | INT | yes | |
| E | 5 | Impressions | INT | yes | |
| F | 6 | Clicks | INT | yes | |
| G | 7 | Notes | TEXT | yes | |

**PK:** surrogate `id` BIGSERIAL
**Index:** (product, date DESC), (date)

---

## Tab 8: EXPENSES (5 cols) → `expenses` table
**Source lines:** 567-571
**Estimated rows:** up to 2,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ | NOT NULL | |
| B | 2 | Category | TEXT | NOT NULL | "Delivery Loss" auto-added for returns |
| C | 3 | Description | TEXT | yes | |
| D | 4 | Amount | NUMERIC(12,2) | NOT NULL | BDT |
| E | 5 | Notes | TEXT | yes | |

---

## Tab 9: MONTHLY_REPORT (6 cols) → `monthly_reports` table + view
**Source lines:** 573-577, 2147-2201
**Estimated rows:** up to 200

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Month | TEXT | NOT NULL UNIQUE | "YYYY-MM" |
| B | 2 | Revenue | NUMERIC(12,2) | yes | sum of Sale txns in month |
| C | 3 | Cost | NUMERIC(12,2) | yes | sum of Cost in Sale txns |
| D | 4 | AdSpend | NUMERIC(12,2) | yes | sum from AD_TRACKER |
| E | 5 | NetProfit | NUMERIC(12,2) | yes | B - C - D |
| F | 6 | Orders | INT | yes | count from ORDERS sheet |

**PK:** `month` TEXT PRIMARY KEY
**Note:** The current GAS code only counts ORDERS sheet (manual orders), not Website_Orders. **Bug in legacy code** — should also count Website_Orders. Fix in Supabase view.

---

## Tab 10: YEARLY_REPORT (6 cols) → `yearly_reports` table + view
**Source lines:** 579-583, 2203-2254
**Estimated rows:** up to 50

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Year | INT | NOT NULL UNIQUE | 2026 |
| B | 2 | Revenue | NUMERIC(12,2) | yes | |
| C | 3 | Cost | NUMERIC(12,2) | yes | |
| D | 4 | AdSpend | NUMERIC(12,2) | yes | |
| E | 5 | NetProfit | NUMERIC(12,2) | yes | |
| F | 6 | Orders | INT | yes | |

**PK:** `year` INT PRIMARY KEY
**Same bug as MONTHLY_REPORT** — only counts ORDERS sheet.

---

## Tab 11: _ACTIVITY (4 cols) → `_activity` table (hidden in GAS)
**Source lines:** 672-675, 262-268, 1296-1298, 1314-1318, 1335
**Estimated rows:** up to 5,000

| Col | # | Name | Type | Nullable | Notes |
|---|---|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ | NOT NULL | |
| B | 2 | Product | TEXT | yes | |
| C | 3 | OldStatus | TEXT | yes | |
| D | 4 | NewStatus | TEXT | yes | |

---

## Tab 12: _DRAFT_DATA (2 cols) → `_draft_data` table (hidden)
**Source lines:** 677-681
**Estimated rows:** 1 (placeholder)

| Col | # | Name | Type |
|---|---|---|---|
| A | 1 | Name | TEXT |
| B | 2 | Note | TEXT |

**Note:** Just a placeholder ("Legacy - data in INVENTORY"). Could be removed in Supabase.

---

## Tab 13: _ARCHIVE_DATA (2 cols) → `_archive_data` table (hidden)
**Source lines:** 683-687
**Estimated rows:** 1 (placeholder)

Same structure as _DRAFT_DATA. Could be removed.

---

## Tab 14: DRAFT_VIEW (13 cols) → `inventory_draft_view` VIEW
**Source lines:** 382-400
**Computed:** `FILTER(INVENTORY!A:A, INVENTORY!AM2:AM="Draft", INVENTORY!A2:A<>"")`

| Col | # | Name | Source |
|---|---|---|---|
| A | 1 | # (row index) | ROW(B:B)-1 |
| B | 2 | Product | INVENTORY.A |
| C | 3 | Image | INVENTORY.B |
| D | 4 | Category | INVENTORY.G |
| E | 5 | Fabric | INVENTORY.H |
| F | 6 | Badge | INVENTORY.I |
| G | 7 | Cost | INVENTORY.L |
| H | 8 | Regular | INVENTORY.M |
| I | 9 | Sale | INVENTORY.N |
| J | 10 | Stock | INVENTORY.AD |
| K | 11 | Sold | INVENTORY.AA |
| L | 12 | Left | INVENTORY.AC |
| M | 13 | Action | "→ Activate" / "→ Archive" |

**Supabase:** `CREATE VIEW inventory_draft_view AS SELECT ... FROM inventory WHERE status='Draft'`

---

## Tab 15: ARCHIVE_VIEW (13 cols) → `inventory_archive_view` VIEW
**Source lines:** 402-420
**Computed:** `FILTER(INVENTORY!A:A, INVENTORY!AM2:AM="Archived", INVENTORY!A2:A<>"")`

Same structure as DRAFT_VIEW but filtered on status='Archived' and action "→ Restore".

---

## Tab 16: WEBSITE_SYNC (30 cols) → `website_sync_view` VIEW
**Source lines:** 422-481
**Computed:** `FILTER(INVENTORY!A:A, INVENTORY!AM2:AM="Active", INVENTORY!A2:A<>"")`

This is the public-facing product data. Used by:
- `doGet action=products` (line 2450)
- `githubSyncNow` (line 2289)
- `_buildPublicData()` (line 2309)

| Col | # | Name | Source | Supabase |
|---|---|---|---|---|
| A | 1 | Product | INVENTORY.A | inventory.product |
| B | 2 | Image1 | INVENTORY.B | inventory.image_1 |
| C-D | 3-4 | Image2, Image3 | INVENTORY.C, D | inventory.image_2, image_3 |
| E | 5 | Video | INVENTORY.E | inventory.video_url |
| F | 6 | Description | INVENTORY.F | inventory.desc |
| G-I | 7-9 | Category, Fabric, Badge | INVENTORY.G, H, I | inventory.* |
| J | 10 | SizeChart | INVENTORY.J | inventory.size_chart |
| K | 11 | DeliveryDays | INVENTORY.K | inventory.delivery_days |
| L | 12 | Regular | INVENTORY.M | inventory.reg |
| M | 13 | Sale | INVENTORY.N | inventory.sale |
| N | 14 | Disc% | INVENTORY.O | inventory.disc_pct |
| O | 15 | DiscType | INVENTORY.P | inventory.disc_type |
| P | 16 | Delivery(Dhaka) | INVENTORY.Q | inventory.dhaka_delivery |
| Q | 17 | Delivery(Outside) | INVENTORY.R | inventory.outside_delivery |
| R | 18 | S_Left | INVENTORY.AT - AV | stk_s - sold_s |
| S | 19 | M_Left | INVENTORY.S - W | stk_m - sold_m |
| T | 20 | L_Left | INVENTORY.T - X | stk_l - sold_l |
| U | 21 | XL_Left | INVENTORY.U - Y | stk_xl - sold_xl |
| V | 22 | XXL_Left | INVENTORY.V - Z | stk_xxl - sold_xxl |
| W | 23 | 3XL_Left | INVENTORY.AU - AW | stk_3xl - sold_3xl |
| X | 24 | Status | INVENTORY.AM | inventory.status |
| Y-AA | 25-27 | Image4-6 | INVENTORY.AN-AP | inventory.image_4-6 |
| AB | 28 | CouponActive | INVENTORY.AQ | inventory.coupon_active |
| AC | 29 | CouponCode | INVENTORY.AR | inventory.coupon_code |
| AD | 30 | CouponDisc | INVENTORY.AS | inventory.coupon_disc_percent |

---

## Tab 17: PRODUCT_ANALYTICS (6 cols) → `product_analytics` view
**Source lines:** 5406-5426

| Col | # | Name |
|---|---|---|
| A | 1 | month_id |
| B | 2 | product |
| C | 3 | units_sold |
| D | 4 | revenue |
| E | 5 | returns |
| F | 6 | net_profit |

**Note:** The tab is created by `_ensureProductAnalyticsTab` (line 5406) but the actual writer `aggregateProductMonth` is "Not implemented yet" (line 5428). Tab is always empty in production.

**Supabase:** can skip — not implemented.

---

## Tab 18: CUSTOMER_LTV (6 cols) → `customers` table + view
**Source lines:** 5439-5467, 5500-5509

| Col | # | Name | Type | Source |
|---|---|---|---|---|
| A | 1 | phone | TEXT PK | normalized to 11 digits |
| B | 2 | name | TEXT | last seen |
| C | 3 | orders | INT | count |
| D | 4 | ltv | NUMERIC(12,2) | lifetime value |
| E | 5 | last_order_date | TIMESTAMPTZ | |
| F | 6 | last_location | TEXT | |

**Supabase:** `customers` table with UNIQUE on `phone` (last 11 digits). `customer_ltv_view` aggregates from orders.

---

## Tab 19: NEWSLETTER_SUBSCRIBERS (4 cols) → `newsletter_subscribers` table
**Source lines:** 2394-2420

| Col | # | Name | Type |
|---|---|---|---|
| A | 1 | Date | TIMESTAMPTZ |
| B | 2 | Email | TEXT (UNIQUE, lowercase) |
| C | 3 | Source | TEXT |
| D | 4 | UserAgent | TEXT |

**PK:** `email` TEXT PRIMARY KEY (de-dup by case-insensitive match)

---

## Additional runtime tables (not in setup list)

### ADMIN_SESSIONS (7 cols) → `admin_sessions` table (hidden)
**Source lines:** 5516-5526, 5600-5663, 5665-5712

| Col | # | Name |
|---|---|---|
| A | 1 | SessionID (64-char hex token) PK |
| B | 2 | Username |
| C | 3 | CreatedAt |
| D | 4 | LastSeenAt |
| E | 5 | ExpiresAt |
| F | 6 | Revoked (bool) |
| G | 7 | UserAgent |

---

### ADMIN_LOGIN_ATTEMPTS (4 cols) → `admin_login_attempts` table (hidden)
**Source lines:** 5528-5578

| Col | # | Name |
|---|---|---|
| A | 1 | Identifier (username) |
| B | 2 | Timestamp |
| C | 3 | Success (bool) |
| D | 4 | IP |

---

### Blocked_Devices (13 cols) → `blocked_devices` table (Fortress)
**Source lines:** 5038-5049, 5063-5082, 5170-5229

| Col | # | Name |
|---|---|---|
| A | 1 | DeviceID PK |
| B | 2 | BlockedAt |
| C | 3 | BlockedBy |
| D | 4 | BlockReason |
| E | 5 | BlockType |
| F | 6 | ExpiresAt |
| G | 7 | AdminNotes |
| H | 8 | Status (active/archived) |
| I | 9 | LastSeen |
| J | 10 | OrderAttempts |
| K | 11 | RiskScore |
| L | 12 | PhonesSeen |
| M | 13 | IPsSeen |

---

### Fortress_Log (12 cols) → `fortress_log` table
**Source lines:** 5051-5061, 5291-5318

| Col | # | Name |
|---|---|---|
| A | 1 | LogID PK |
| B | 2 | Timestamp |
| C | 3 | EventType |
| D | 4 | DeviceID |
| E | 5 | PhoneHash (FNV-1a + salt) |
| F | 6 | IP |
| G | 7 | Country |
| H | 8 | RiskScore |
| I | 9 | Reason |
| J | 10 | Actor |
| K | 11 | OrderID |
| L | 12 | Notes |

---

### Monthly_Snapshots (5 cols) → `monthly_snapshots` table
**Source lines:** 5352-5366

| Col | # | Name |
|---|---|---|
| A | 1 | month_id (YYYY-MM) PK |
| B | 2 | revenue |
| C | 3 | cost |
| D | 4 | ad_spend |
| E | 5 | net_profit |

---

## Summary: total Supabase tables needed
**Direct tabs:** 16 (INVENTORY, ORDERS, Website_Orders, TRANSACTIONS, SETTINGS, DELIVERY_CHARGES, AD_TRACKER, EXPENSES, MONTHLY_REPORT, YEARLY_REPORT, _ACTIVITY, _DRAFT_DATA, _ARCHIVE_DATA, DRAFT_VIEW, ARCHIVE_VIEW, WEBSITE_SYNC, NEWSLETTER_SUBSCRIBERS, ADMIN_SESSIONS, ADMIN_LOGIN_ATTEMPTS, Blocked_Devices, Fortress_Log, Monthly_Snapshots, CUSTOMER_LTV, PRODUCT_ANALYTICS)

**Supabase count: 22 tables + 5 views** (DRAFT/ARCHIVE/WEBSITE_SYNC/customer_ltv) — matches `supabase/schema.sql` already written.

## Special notes
1. **Multi-row carts:** Website_Orders can have N rows per orderId (line 912, 1046). Aggregations must use `SUM(L)` grouped by orderId.
2. **Bangladesh timezone:** All Date columns are stored as TIMESTAMPTZ with content formatted via `Utilities.formatDate(..., 'Asia/Dhaka', ...)`. Migration must use `Asia/Dhaka` for BD-time display.
3. **Size column letters:** S=46, M=19, L=20, XL=21, XXL=22, 3XL=47 (non-sequential because of v15.94 addition). Schema must reflect actual column positions.
4. **Returns always qty=0:** TRANSACTIONS.Type='Return' always has E=0 (v15.32 fix). Don't store qty in Returns.
5. **__ONESIZE__ sentinel:** HIDDEN_SIZES column may contain literal string "__ONESIZE__" — code uses this to skip size picker on storefront.
