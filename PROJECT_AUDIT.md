# YARZ PRO — সম্পূর্ণ প্রজেক্ট অডিট
## তারিখ: 2026-06-24 | অডিটর: OpenCode AI

---

## টেবিল অফ কনটেন্ট
1. [প্রজেক্ট ওভারভিউ](#১-প্রজেক্ট-ওভারভিউ)
2. [ফোল্ডার স্ট্রাকচার](#২-ফোল্ডার-স্ট্রাকচার)
3. [ফাইল ইনভেন্টরি](#৩-ফাইল-ইনভেন্টরি)
4. [টেকনোলজি স্ট্যাক](#৪-টেকনোলজি-স্ট্যাক)
5. [ডাটাবেস স্কিমা (Supabase)](#৫-ডাটাবেস-স্কিমা)
6. [ব্যাকএন্ড আর্কিটেকচার](#৬-ব্যাকএন্ড-আর্কিটেকচার)
7. [ফ্রন্টএন্ড আর্কিটেকচার](#৭-ফ্রন্টএন্ড-আর্কিটেকচার)
8. [অ্যাডমিন প্যানেল](#৮-অ্যাডমিন-প্যানেল)
9. [API এন্ডপয়েন্ট](#৯-এপি-এন্ডপয়েন্ট)
10. [সিকিউরিটি](#১০-সিকিউরিটি)
11. [পারফরম্যান্স অপ্টিমাইজেশন](#১১-পারফরম্যান্স-অপ্টিমাইজেশন)
12. [ইন্টিগ্রেশন](#১২-ইন্টিগ্রেশন)
13. [বাগ ও সমস্যা](#১৩-বাগ-ও-সমস্যা)
14. [সুপারিশ](#১৪-সুপারিশ)

---

## ১. প্রজেক্ট ওভারভিউ

**নাম:** YARZ Clothing (yarzclothing.xyz)
**ধরন:** Premium Men's Fashion E-Commerce Website
**ডিজাইন:** Pinterest-style Clean Minimal Aesthetic UI
**ভাষা:** Bengali (বাংলা) + English
**মূল ফিচার:**
- কাস্টমার সাইট: প্রোডাক্ট ব্রাউজ, অর্ডার, পেমেন্ট (COD)
- অ্যাডমিন প্যানেল: ইনভেন্টরি, অর্ডার, ফিনান্স, সেটিংস ম্যানেজমেন্ট
- Cloudflare Worker: API রুটিং + Edge Caching
- Supabase: PostgreSQL ডাটাবেস
- Telegram Bot: অর্ডার নোটিফিকেশন
- Anti-Fraud: Shield + Fortress সিস্টেম
- Analytics: FB Pixel + GA4 + TikTok + CAPI

**স্ট্যাটাস:** প্রোডাকশনে লাইভ (yarzclothing.xyz)
**মাইগ্রেশন:** Google Apps Script → Supabase (সম্পন্ন)

---

## ২. ফোল্ডার স্ট্রাকচার

```
YARZ WEB SITE/
├── 📄 index.html                    # মূল ওয়েবসাইট (1,760 lines)
├── 📄 404.html                      # 404 পেজ
├── 📄 admin-from-gh.html            # GitHub থেকে অ্যাডমিন
├── 📄 admin-panel-snippet.html      # অ্যাডমিন স্নিপেট
├── 📄 manifest.webmanifest          # PWA Manifest
├── 📄 robots.txt                    # SEO Robots
├── 📄 sitemap.xml                   # SEO Sitemap
├── 📄 sw.js                         # Service Worker (304 lines)
├── 📄 package.json                  # npm কনফিগ
├── 📄 package-lock.json             # npm lock
├── 📄 wrangler.toml                 # Cloudflare Worker কনফিগ
├── 📄 wrangler-api.toml             # Worker API কনফিগ
├── 📄 .env                          # সিক্রেট কী
├── 📄 .env.example                  # টেমপ্লেট
├── 📄 .gitignore                    # Git ignore
├── 📄 README.md                     # প্রজেক্ট গাইড
├── 📄 PROJECT_CONTEXT.md            # AI কনটেক্সট
├── 📄 PROJECT_AUDIT.md              # এই ফাইল
├── 📄 CHECKPOINT.md                 # মাইগ্রেশন স্টেট
├── 📄 MIGRATION_REPORT.md           # মাইগ্রেশন রিপোর্ট
├── 📄 ANALYSIS.md                   # PHASE 1 অ্যানালাইসিস
├── 📄 PHASE_5_RUNBOOK.md            # ডাটা মাইগ্রেশন
├── 📄 PHASE_6_CUTOVER.md            # কাটওভার গাইড
├── 📄 supabase_live_tables.md       # লাইভ টেবিল
├── 📄 app_js_live.js                # লাইভ app.js
├── 📄 app_js_orig_v16.js            # অরিজিনাল app.js
├── 📄 supabase-adapter-v2.js        # Supabase অ্যাডাপ্টার
├── 📄 worker-supabase.js            # Cloudflare Worker
├── 📄 extract_tables_main.js        # টেবিল এক্সট্র্যাক্ট
├── 📄 fetch_supabase_schema.js      # স্কিমা ফেচ
├── 📄 test_query.js                 # টেস্ট কুয়েরি
│
├── 📁 css/
│   └── style.css                    # মূল CSS (12,351 lines, 353KB)
│
├── 📁 js/
│   ├── api.js                       # API ক্লায়েন্ট (1,587 lines)
│   ├── app.js                       # SPA কন্ট্রোলার (545KB)
│   ├── boot.js                      # বুট লোডার (191 lines)
│   ├── armor.js                     # সিকিউরিটি শিল্ড (219 lines)
│   ├── shield.js                    # অ্যান্টি-ফ্রড v1 (326 lines)
│   ├── fortress.js                  # অ্যান্টি-ফ্রড v2 (622 lines)
│   ├── pixel.js                     # অ্যানালিটিক্স (1,242 lines)
│   ├── turbo-core.js                # ক্যাশ ইঞ্জিন (211 lines)
│   ├── turbo.js                     # পারফরম্যান্স ইঞ্জিন (442 lines)
│   ├── api-turbo.js                 # API ব্রিজ (136 lines)
│   ├── image-turbo.js               # ইমেজ অপ্টিমাইজার (308 lines)
│   └── pages-common.js              # সাবপেজ এনহান্সমেন্ট (318 lines)
│
├── 📁 Yarz-admin panal/
│   ├── index.html                   # অ্যাডমিন প্যানেল SPA (12,783 lines)
│   ├── api.js                       # অ্যাডমিন API
│   ├── supabase-adapter-v2.js       # Supabase অ্যাডাপ্টার
│   └── danda_lines.txt              # নোটস
│
├── 📁 supabase/
│   ├── schema.sql                   # 22 টেবিল (395 lines)
│   ├── views.sql                    # 5 ভিউ (105 lines)
│   ├── rls.sql                      # Row Level Security (60 lines)
│   ├── rpc.sql                      # 9 RPC ফাংশন (186 lines)
│   ├── seed_defaults.sql            # ডিফল্ট ডাটা (34 lines)
│   ├── fortress_steadfast_supplement.sql # 3 টেবিল + 8 RPC (561 lines)
│   ├── combined.sql                 # সব একসাথে (1,311 lines)
│   └── _chunk_*.js                  # ডাটা চাংক
│
├── 📁 scripts/
│   ├── export-from-gas.gs           # GAS এক্সপোর্ট
│   ├── export-pull.js               # JSON পুল
│   ├── export-direct.js             # ডাইরেক্ট এক্সপোর্ট
│   ├── import-to-supabase.js        # ইম্পোর্ট
│   ├── verify-counts.js             # ভেরিফাই
│   ├── load-test.js                 # লোড টেস্ট
│   └── admin-server.js              # অ্যাডমিন সার্ভার
│
├── 📁 about/, contact/, privacy/, terms/, shipping/, return-policy/, community/
│   └── index.html                   # সাবপেজ (প্রতিটি ~20K lines)
│
├── 📁 images/, icons/               # ইমেজ ও আইকন
├── 📁 exports/                      # এক্সপোর্ট ফাইল
├── 📁 analysis/                     # অ্যানালাইসিস ডকুমেন্ট
│
├── 📁 Yarz_Live/                    # লাইভ ডিপ্লয়মেন্ট (কাস্টমার সাইট)
│   ├── index.html, 404.html, sw.js, wrangler.toml
│   ├── css/style.css                # লাইভ CSS (365KB)
│   ├── js/                          # লাইভ JS ফাইল
│   ├── about/, contact/, privacy/, terms/, shipping/, return-policy/, community/
│   └── dev-notes/
│
├── 📁 Yarz_Pro_Live/                # লাইভ অ্যাডমিন প্যানেল
│   ├── index.html                   # অ্যাডমিন (674KB)
│   ├── supabase-adapter-v2.js       # লাইভ অ্যাডাপ্টার
│   ├── audit_admin.js               # অডিট স্ক্রিপ্ট
│   ├── inject_*.js                  # UI ইনজেকশন স্ক্রিপ্ট
│   ├── fix_*.js                     # ফিক্স স্ক্রিপ্ট
│   ├── check_*.js                   # চেক স্ক্রিপ্ট
│   └── test_*.js                    # টেস্ট স্ক্রিপ্ট
│
├── 📁 BACKUP_PRISTINE_20260621_231842/ # প্রিস্টিন ব্যাকআপ
│
├── 📁 legacy/
│   ├── google-apps-script-v11.7.txt # GAS সোর্স (288KB)
│   ├── cloudflare-worker-pre-supabase.txt # পুরানো Worker
│   ├── V1-supabase_adapter-deprecated.js # পুরানো অ্যাডাপ্টার
│   └── debug-scripts-archive/       # 19+ ডিবাগ স্ক্রিপ্ট
│
├── 📁 .kilo/                        # Kilo AI প্ল্যান
├── 📁 .playwright-mcp/              # Playwright স্ক্রিনশট
└── 📁 .wrangler/                    # Wrangler ক্যাশ
```

---

## ৩. ফাইল ইনভেন্টরি

### মূল ফাইল (Production)
| ফাইল | সাইজ | লাইন | উদ্দেশ্য |
|------|-------|------|----------|
| `index.html` | 101KB | 1,760 | কাস্টমার সাইট |
| `css/style.css` | 353KB | 12,351 | মূল CSS |
| `js/api.js` | 73KB | 1,587 | API ক্লায়েন্ট |
| `js/app.js` | 545KB | ~15,000 | SPA কন্ট্রোলার |
| `js/boot.js` | 10KB | 191 | বুট লোডার |
| `js/armor.js` | 7KB | 219 | সিকিউরিটি |
| `js/shield.js` | 12KB | 326 | অ্যান্টি-ফ্রড v1 |
| `js/fortress.js` | 23KB | 622 | অ্যান্টি-ফ্রড v2 |
| `js/pixel.js` | 61KB | 1,242 | অ্যানালিটিক্স |
| `js/turbo-core.js` | 10KB | 211 | ক্যাশ ইঞ্জিন |
| `js/turbo.js` | 16KB | 442 | পারফরম্যান্স |
| `js/api-turbo.js` | 6KB | 136 | API ব্রিজ |
| `js/image-turbo.js` | 13KB | 308 | ইমেজ অপ্টিমাইজার |
| `js/pages-common.js` | 18KB | 318 | সাবপেজ |
| `sw.js` | 15KB | 304 | Service Worker |
| `worker-supabase.js` | 56KB | 1,249 | Cloudflare Worker |
| `supabase-adapter-v2.js` | 36KB | 860 | Supabase অ্যাডাপ্টার |

### অ্যাডমিন প্যানেল
| ফাইল | সাইজ | লাইন | উদ্দেশ্য |
|------|-------|------|----------|
| `Yarz-admin panal/index.html` | 640KB | 12,783 | অ্যাডমিন SPA |
| `Yarz-admin panal/api.js` | 73KB | 1,587 | অ্যাডমিন API |
| `Yarz-admin panal/supabase-adapter-v2.js` | 36KB | 823 | Supabase অ্যাডাপ্টার |

### Supabase ফাইল
| ফাইল | সাইজ | লাইন | উদ্দেশ্য |
|------|-------|------|----------|
| `supabase/schema.sql` | 17KB | 395 | 22 টেবিল |
| `supabase/views.sql` | 4KB | 105 | 5 ভিউ |
| `supabase/rls.sql` | 3KB | 60 | RLS পলিসি |
| `supabase/rpc.sql` | 8KB | 186 | 9 RPC ফাংশন |
| `supabase/seed_defaults.sql` | 3KB | 34 | ডিফল্ট ডাটা |
| `supabase/fortress_steadfast_supplement.sql` | 25KB | 561 | 3 টেবিল + 8 RPC |
| `supabase/combined.sql` | 58KB | 1,311 | সব একসাথে |

---

## ৪. টেকনোলজি স্ট্যাক

### ফ্রন্টএন্ড
- **HTML5** — সিম্পল, সিমান্টিক
- **CSS3** — কাস্টম ভ্যারিয়েবল, Grid, Flexbox, Glassmorphism
- **JavaScript (ES6+)** — ভ্যানিলা JS, কোন ফ্রেমওয়ার্ক নেই
- **Fonts:** Inter, Hind Siliguri, Noto Sans Bengali
- **Icons:** FontAwesome 6.4, RemixIcon 4.1
- **Charts:** Chart.js 4.4

### ব্যাকএন্ড
- **Cloudflare Worker** — API রুটিং + Edge Caching
- **Supabase** — PostgreSQL ডাটাবেস (ap-southeast-1)
- **Google Apps Script** — লিগেসি ব্যাকএন্ড (passthrough)
- **Telegram Bot** — অর্ডার নোটিফিকেশন

### ডাটাবেস
- **Supabase PostgreSQL** — 25 টেবিল, 5 ভিউ, 18 RPC
- **RLS** — 25 টেবিলে Row Level Security
- **SECURITY DEFINER** — 5 ভিউ (পাবলিক রিড)

### হোস্টিং
- **Cloudflare Pages** — স্ট্যাটিক সাইট
- **Cloudflare Workers** — API
- **Supabase** — ডাটাবেস
- **GitHub** — ভার্সন কন্ট্রোল

---

## ৫. ডাটাবেস স্কিমা

### ২৫টি টেবিল

#### কোর টেবিল (22)
| # | টেবিল | কলাম | উদ্দেশ্য |
|---|--------|-------|----------|
| 1 | `inventory` | 52 | প্রোডাক্ট (52 কলাম!) |
| 2 | `orders` | 16 | ম্যানুয়াল অর্ডার |
| 3 | `website_orders` | 29 | ওয়েবসাইট অর্ডার + ফ্রড সিগন্যাল |
| 4 | `transactions` | 8 | লেনদেন |
| 5 | `ad_tracker` | 7 | বিজ্ঞাপন ট্র্যাকিং |
| 6 | `expenses` | 5 | খরচ |
| 7 | `monthly_reports` | 6 | মাসিক রিপোর্ট |
| 8 | `yearly_reports` | 6 | বার্ষিক রিপোর্ট |
| 9 | `settings` | 3 | কী-ভ্যালু স্টোর |
| 10 | `delivery_charges` | 4 | ডেলিভারি চার্জ |
| 11 | `customers` | 12 | কাস্টমার LTV |
| 12 | `_activity` | 4 | অ্যাকটিভিটি লগ |
| 13 | `_draft_data` | 3 | ড্রাফট প্রোডাক্ট |
| 14 | `_archive_data` | 3 | আর্কাইভ প্রোডাক্ট |
| 15 | `admin_sessions` | 7 | অ্যাডমিন সেশন |
| 16 | `admin_login_attempts` | 6 | লগইন চেষ্টা |
| 17 | `admin_users` | 5 | অ্যাডমিন ইউজার |
| 18 | `newsletter_subscribers` | 5 | নিউজলেটার |
| 19 | `rate_limit_log` | 4 | রেট লিমিট |
| 20 | `audit_log` | 5 | অডিট লগ |
| 21 | `steadfast_keys` | 4 | Steadfast API কী |
| 22 | `steadfast_balance_cache` | 4 | Steadfast ব্যালেন্স |

#### সাপ্লিমেন্ট টেবিল (3)
| # | টেবিল | কলাম | উদ্দেশ্য |
|---|--------|-------|----------|
| 23 | `blocked_devices` | 15 | Fortress ডিভাইস ব্লক |
| 24 | `fortress_log` | 8 | Fortress ইভেন্ট লগ |
| 25 | `steadfast_consignments` | 15 | Steadfast কনসাইনমেন্ট |

### ৫টি ভিউ
| ভিউ | উদ্দেশ্য |
|------|----------|
| `website_sync_view` | পাবলিক প্রোডাক্ট (Active ফিল্টার) |
| `public_products` | অ্যানোন রিডেবল প্রোডাক্ট |
| `inventory_draft_view` | ড্রাফট প্রোডাক্ট |
| `inventory_archive_view` | আর্কাইভ প্রোডাক্ট |
| `customer_ltv_view` | কাস্টমার LTV অ্যাগ্রিগেশন |

### ১৮টি RPC ফাংশন
| ক্যাটাগরি | ফাংশন |
|-----------|--------|
| **Auth** | `admin_login`, `admin_logout`, `verify_session`, `check_login_rate_limit` |
| **Atomic Ops** | `atomic_adjust_stock`, `create_manual_order`, `delete_website_order`, `record_return`, `update_customer_ltv` |
| **Factory Reset** | `full_factory_reset`, `clear_financials_only`, `clear_inventory_only` |
| **Reports** | `generate_monthly_report` |
| **Fortress** | `fortress_block`, `fortress_unblock`, `fortress_lookup`, `fortress_log_event` |
| **Steadfast** | `steadfast_log_consignment` |

### INVENTORY টেবিলের 52টি কলাম
```
id, product (UNIQUE), image_1-6, video_url, description, category,
fabric, badge, size_chart, delivery_days, cost, regular, sale,
disc_percent, disc_type, dhaka_delivery, outside_delivery,
stk_s, stk_m, stk_l, stk_xl, stk_xxl, stk_3xl,
sold_s, sold_m, sold_l, sold_xl, sold_xxl, sold_3xl,
tot_sold (GENERATED), tot_stock (GENERATED), remaining (GENERATED),
returns, invest, revenue, to_recover, gross, fb_ad, net, disc_impact,
updated_at, status, coupon_active, coupon_code, coupon_disc_percent,
hidden_sizes, size_type, accessory, created_at
```

### GENERATED কলাম (ডাটাবেস-সাইড ক্যালকুলেশন)
- `tot_sold` = sold_s + sold_m + sold_l + sold_xl + sold_xxl + sold_3xl
- `tot_stock` = stk_s + stk_m + stk_l + stk_xl + stk_xxl + stk_3xl
- `remaining` = tot_stock - tot_sold

---

## ৬. ব্যাকএন্ড আর্কিটেকচার

### রিকোয়েস্ট ফ্লো
```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Customer Site  │───▶│  Cloudflare      │───▶│  Supabase        │
│  yarzclothing   │    │  Worker (yarz)   │    │  (primary DB)    │
│  .xyz           │    │                  │    │  - 25 tables     │
│                 │    │  - ACTIONS map   │    │  - 5 views       │
│  - HTML/JS      │    │  - /purge        │    │  - 18 RPCs       │
│  - CORS         │    │  - /tg-webhook   │    │  - 25 RLS        │
└─────────────────┘    │  - CACHE: 1min   └──────────────────┘
                       │  - FALLBACK: GAS │
                       └──────────┬───────┘
                                  │ (fallback only)
                                  ▼
                       ┌──────────────────┐
                       │  Google Apps     │
                       │  Script (GAS)    │
                       │  - legacy v11.7  │
                       │  - 30+ endpoints │
                       └──────────────────┘
```

### Cloudflare Worker কনফিগ (`wrangler.toml`)
- **নাম:** `yarz`
- **মেইন:** `worker-supabase.js`
- **SUPABASE_ENABLED:** `true`
- **TTL:** FRESH=60s, SWR=60s, HARD=86400s
- **সিক্রেট:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TG_BOT_TOKEN, TG_WEBHOOK_SECRET, PURGE_SECRET

### Worker Action Map (ACTIONS_SUPABASE)
| ক্যাটাগরি | Supabase রুটেড | Passthrough |
|-----------|---------------|-------------|
| **Public GET** | products, product, delivery_charges | categories, store_info, fb_feed, health |
| **Public POST** | subscribe_newsletter | place_order, capi, ttapi |
| **Admin Auth** | (all via RPC) | — |
| **Products** | save, edit, status, delete | applybulkedit, recordsale |
| **Orders** | save (RPC), update status, delete | archivecompleted |
| **Finance** | save ad, save expense | savereturn |
| **Settings** | update, delivery, github | githubsyncnow |
| **Analytics** | getcustomerltv | getcurrentmonth, getproductanalytics6m |
| **Cleanup** | — | fullfactoryreset, clearfinancials, clearinventory |
| **Courier** | — | all steadfast* (passthrough) |
| **Fortress** | — | all fortress* (passthrough) |

---

## ৭. ফ্রন্টএন্ড আর্কিটেকচার

### JS ফাইল লোড অর্ডার
```html
1. boot.js          — Service Worker + বুট
2. turbo-core.js    — ক্যাশ ইঞ্জিন
3. api.js           — API ক্লায়েন্ট
4. api-turbo.js     — API ব্রিজ
5. app.js           — SPA কন্ট্রোলার
6. image-turbo.js   — ইমেজ অপ্টিমাইজার
7. turbo.js         — পারফরম্যান্স
8. pixel.js         — অ্যানালিটিক্স (lazy)
9. armor.js         — সিকিউরিটি (lazy)
10. shield.js       — অ্যান্টি-ফ্রড (lazy)
11. fortress.js     — অ্যান্টি-ফ্রড v2 (lazy)
```

### Service Worker স্ট্র্যাটেজি
| রিসোর্স | স্ট্র্যাটেজি |
|----------|-------------|
| HTML পেজ | Network-first, fallback cache (10s timeout) |
| CSS/JS/Fonts | Stale-While-Revalidate |
| Images | Cache-First (1 year TTL) |
| API | Network-first with 6s timeout |
| Static assets | Cache-First |

### API ক্লায়েন্ট (`api.js`)
- **Worker URL Detection:** Same-origin > localStorage override > workers.dev
- **ZERO-CACHE MODE:** কোনো client-side persistence নেই
- **Turbo Load:** Google Sheets API v4 Direct Read (300-500ms)
- **Edge SSR:** `__YARZ_INITIAL_STATE` injection
- **Request Deduplication:** একই সাথে 500+ visitors → 1 API call

### অ্যানালিটিক্স (`pixel.js`)
- **Networks:** FB, GA4, TikTok, Snapchat, Pinterest, FB CAPI
- **Events:** ViewContent, AddToCart, InitiateCheckout, Purchase + 20+ custom
- **Advanced Matching:** SHA-256 hashed (em, ph, fn, ln, ge, db, ct, st, zp)
- **CAPI Mirror:** Server-side beacon for iOS/adblock recovery
- **Toggle System:** Per-event ON/OFF from admin panel

---

## ৮. অ্যাডমিন প্যানেল

### সেকশন (14টি মেনু)
| # | সেকশন | ফিচার |
|---|--------|--------|
| 1 | **Dashboard** | স্ট্যাটস কার্ড, গ্রাফ, সেলস |
| 2 | **Inventory** | Quick Add, Sales Entry, Stock Manager, Bulk Edit |
| 3 | **Archive** | আর্কাইভ প্রোডাক্ট |
| 4 | **Product Analytics** | প্রোডাক্ট বিশ্লেষণ |
| 5 | **Customers** | কাস্টমার লিস্ট, LTV |
| 6 | **Orders** | Manual + Website Orders + Customers (3 ট্যাব) |
| 7 | **Finance** | Ad Tracker, Expenses, Returns |
| 8 | **Reports** | Monthly/Yearly Reports |
| 9 | **Website** | Website Builder, Website Control, Settings |
| 10 | **Website Control** | Quick Actions, Design, SEO, Pages |
| 11 | **Settings** | Business, Contact, Theme, Homepage, Appearance, System, Data |
| 12 | **Protection** | Fortress + Steadfast |

### Supabase কানেকশন
- **URL:** `https://xdzduowhwubogaavraap.supabase.co`
- **Anon Key:** ব্রাউজারে (RLS-restricted)
- **Service Role Key:** শুধু `.env` + Worker (RLS bypass)
- **Auth:** Custom `admin_sessions` + bcrypt (Supabase Auth নয়)

### অ্যাডাপ্টার v2 (`supabase-adapter-v2.js`)
- **মেথড:** 30+ (সব GAS action cover করে)
- **RLS Bypass:** Service Role Key দিয়ে write DB client তৈরি
- **Session:** localStorage-এ `yarz_admin_session_v2`
- **Backwards-compat:** GAS response shape ধরে রাখে

---

## ৯. API এন্ডপয়েন্ট

### Public GET (API_KEY only)
| Action | Source | Status |
|--------|--------|--------|
| `products` | Supabase (website_sync_view) | ✅ |
| `product` | Supabase (inventory) | ✅ |
| `delivery_charges` | Supabase | ✅ |
| `categories` | GAS passthrough | ⚠️ |
| `store_info` | GAS passthrough | ⚠️ |
| `orders_by_phone` | ❌ GAP | ❌ |
| `health` | GAS passthrough | ⚠️ |
| `fb_feed` | GAS passthrough | ⚠️ |

### Public POST
| Action | Source | Status |
|--------|--------|--------|
| `place_order` | GAS → create_website_order RPC | ✅ |
| `subscribe_newsletter` | Supabase | ✅ |
| `capi`/`fbcapi` | GAS passthrough | ⚠️ |
| `ttapi`/`ttevents` | GAS passthrough | ⚠️ |
| Telegram webhook | Worker `/tg-webhook` | ✅ |

### Admin (50+ actions)
| ক্যাটাগরি | Actions |
|-----------|---------|
| **Auth** | adminlogin, adminlogout, verify_auth |
| **Products** | saveproductfromform, saveproducteditfromform, updateproductstatus, applystockchange, applybulkedit, recordsale, deleteproduct |
| **Orders** | saveorderfromform, updatewebsiteorderstatus, updatemanualorderstatus, deletewebsiteorder, deletemanualorder, archivecompletedorders |
| **Finance** | saveadfromform, saveexpensefromform, savereturnfromform |
| **Settings** | updatesettings, updatedeliverycharges, savegithubsettings, githubsyncnow |
| **Analytics** | getcurrentmonthsnapshot, getproductanalytics6m, getcustomerltv, snapshotmonth |
| **Reports** | generatemonthlyreport, generateyearlyreport |
| **Cleanup** | fullfactoryreset, clearfinancialsonly, clearinventoryonly |
| **Courier** | steadfastcreate, steadfastbulk, steadfaststatus, steadfastbalance, steadfastsavekeys |
| **Fortress** | __fortress_lookup, __fortress_block, __fortress_unblock, __fortress_clear_all, __fortress_log_event |

---

## ১০. সিকিউরিটি

### লেয়ার
1. **Cloudflare Worker** — CORS, Rate Limiting, API Key validation
2. **Supabase RLS** — টেবিল-লেভেল অ্যাক্সেস কন্ট্রোল
3. **Admin Auth** — Custom sessions + bcrypt (7-day expiry)
4. **Armor.js** — DevTools detection, Console neutralization, Right-click block
5. **Shield.js** — Behavior scoring, Device fingerprint, Form timing
6. **Fortress.js** — Device fingerprint, Risk scoring, Blocklist

### সিকিউরিটি ফিচার
- **Bcrypt:** `admin_users` টেবিলে পাসওয়ার্ড হ্যাশ
- **Rate Limiting:** `rate_limit_log` + `check_login_rate_limit` RPC
- **Audit Trail:** প্রতিটি destructive action `audit_log`-এ
- **RLS:** 25 টেবিলে enabled, 5 anon policies
- **SECURITY DEFINER:** 5 ভিউ (পাবলিক রিড)
- **No client-side secrets:** `.env` gitignored

### অ্যান্টি-ফ্রড (Shield + Fortress)
- **Shield:** Behavior scoring (touch, scroll, type), Device fingerprint, Phone intelligence, Address quality, Spam velocity
- **Fortress:** 13 risk signals → 0-100 score, Local-first blocklist, Server-side blocklist, Shadow ban

### ঝুঁকি
| সমস্যা | ঝুঁকি | স্ট্যাটাস |
|--------|--------|----------|
| Service Role Key ব্রাউজারে দেখায় | Medium | ⚠️ (সিকিংস পরে ফিক্স) |
| `.env` ফাইল কমিট হতে পারে | High | ✅ (.gitignore আছে) |
| RLS bypass হতে পারে | High | ✅ (RLS enabled) |
| Default password | High | ⚠️ (পরিবর্তন করা উচিত) |

---

## ১১. পারফরম্যান্স অপ্টিমাইজেশন

### স্পিড স্ট্র্যাটেজি
1. **Cloudflare Edge SSR:** `__YARZ_INITIAL_STATE` injection (0 round-trips)
2. **Service Worker:** Second visit < 500ms
3. **Image Turbo:** Google Drive → lh3 CDN, Lazy loading, LQIP blur
4. **Turbo Core:** SWR cache, In-memory cache
5. **Turbo Engine:** Request deduplication, Touch prefetch, Chunked rendering
6. **API Turbo:** Mutation hooks + Event bridge

### ক্যাশ লেয়ার
| লেয়ার | TTL | স্ট্র্যাটেজি |
|--------|-----|-------------|
| L1: In-memory | 60s (products) | SWR |
| L2: Removed | — | Owner preference |
| L3: localStorage | — | Tiny config only |
| L4: Service Worker | 1yr (images) | Cache-first |

### মোবাইল অপ্টিমাইজেশন
- **iPhone Notch/Dynamic Island:** `env(safe-area-inset-*)` support
- **In-app Browser Detection:** FB, Instagram, TikTok, WeChat, LINE
- **VisualViewport Sync:** `--vh`, `--vw`, `--kb` CSS variables
- **Memory Guardian:** Auto cleanup for low-RAM phones
- **Connection Monitor:** Offline fallback, speed-aware

---

## ১২. ইন্টিগ্রেশন

### Cloudflare
- **Worker:** `yarz-marufhasan80009.workers.dev`
- **Domain:** `yarzclothing.xyz`
- **Secrets:** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TG_BOT_TOKEN, TG_WEBHOOK_SECRET, PURGE_SECRET
- **Vars:** SUPABASE_ENABLED=true, TG_OWNER_ID, TTLs

### Supabase
- **Project:** `xdzduowhwubogaavraap`
- **Region:** ap-southeast-1 (Singapore)
- **URL:** `https://xdzduowhwubogaavraap.supabase.co`
- **Tables:** 25, Views: 5, RPCs: 18, RLS: 25

### Telegram
- **Bot:** @yarzclothing_v2_bot (ID: 8870829970)
- **Webhook:** `/tg-webhook`
- **Commands:** /start, /whoami, /orders, /stats
- **TG_OWNER_ID:** 8370659578

### Google Apps Script
- **URL:** `https://script.google.com/macros/s/AKfycbzLs9KDameNALSxN4ntZXHKs-st2V-4gN5ITFL38UnqKFw_s2yXFPcmLFB4KXzIVs7K/exec`
- **Sheet ID:** `1wQz5OQZAtISTD1FdSEs_j9-p0e-BHwYjmjN7PR9hA-Q`
- **স্ট্যাটাস:** Passthrough (fallback only)

### Facebook
- **Pixel:** অ্যাডমিন প্যানেল থেকে সেট হয়
- **CAPI:** Server-side beacon
- **Advanced Matching:** SHA-256 hashed

### Google Analytics
- **GA4:** অ্যাডমিন প্যানেল থেকে সেট হয়

### TikTok
- **Pixel:** অ্যাডমিন প্যানেল থেকে সেট হয়
- **Events API:** Server-side

### Steadfast (Courier)
- **API:** External HTTP calls (passthrough to GAS)
- **Tables:** steadfast_keys, steadfast_balance_cache, steadfast_consignments
- **RPCs:** steadfast_log_consignment

### GitHub
- **Sync:** data.json file
- **Settings:** settings টেবিলে সেভ হয়

---

## ১৩. বাগ ও সমস্যা

### Known Issues
| # | সমস্যা | সিভেরিটি | স্ট্যাটাস |
|---|--------|----------|----------|
| 1 | `orders_by_phone` Worker map-এ নেই | Medium | ❌ |
| 2 | `generatemonthlyreport` Worker + Adapter-এ নেই | Medium | ❌ |
| 3 | `generateyearlyreport` Worker + Adapter-এ নেই | Medium | ❌ |
| 4 | `getcurrentmonthsnapshot` Worker-এ passthrough | Low | ⚠️ |
| 5 | `getproductanalytics6m` Worker-এ passthrough | Low | ⚠️ |
| 6 | `snapshotmonth` Worker-এ passthrough | Low | ⚠️ |
| 7 | `archivecompletedorders` Worker-এ passthrough | Low | ⚠️ |
| 8 | `githubsyncnow` Adapter-এ নেই | Low | ❌ |
| 9 | Default password `Hassan__00` | High | ⚠️ |
| 10 | Service Role Key localStorage-এ সেভ হয় | Medium | ⚠️ |
| 11 | Product image loading হচ্ছে না | Low | ⚠️ |
| 12 | Analytics/Finance/Reports সেকশন খালি | Low | ⚠️ |

### GAP Analysis (Worker Map Coverage)
| ক্যাটাগরি | Covered | Total | % |
|-----------|---------|-------|---|
| Public GET | 5 | 8 | 63% |
| Public POST | 2 | 5 | 40% |
| Admin Auth | 3 | 3 | 100% |
| Products | 5 | 7 | 71% |
| Orders | 4 | 6 | 67% |
| Finance | 2 | 3 | 67% |
| Settings | 3 | 4 | 75% |
| Reports | 0 | 6 | 0% |
| Steadfast | 0 | 10 | 0% |
| Fortress | 0 | 5 | 0% |
| **মোট** | **24** | **57** | **42%** |

---

## ১৪. সুপারিশ

### অগ্রাধিকার ১ (High)
1. **Default password পরিবর্তন** — `Hassan__00` বদলান
2. **Service Role Key security** — localStorage থেকে সরান, শুধু Worker-এ রাখুন
3. **`orders_by_phone` Worker map-এ যোগ করুন**

### অগ্রাধিকার ২ (Medium)
4. **Reports Actions** — `generatemonthlyreport`, `generateyearlyreport` Worker map-এ যোগ করুন
5. **Analytics Actions** — `getcurrentmonthsnapshot`, `getproductanalytics6m` কে Supabase RPC তৈরি করুন
6. **`archivecompletedorders`** — Worker map-এ যোগ করুন

### অগ্রাধিকার ৩ (Low)
7. **Product image fix** — Supabase Storage থেকে ইমেজ URL চেক করুন
8. **Analytics/Finance/Reports sections** — Supabase এর সাথে কানেক্ট করুন
9. **`githubsyncnow`** — Edge Function তৈরি করুন
10. **Steadfast Integration** — Edge Function তৈরি করুন

### দীর্ঘমেয়াদী
11. **App.js সেপারেট করুন** — 545KB একটি ফাইলে আছে, ভাগ করুন
12. **TypeScript migration** — টাইপ সেফটির জন্য
13. **Testing** — Unit + Integration tests যোগ করুন
14. **CI/CD** — GitHub Actions সেটআপ করুন
15. **Monitoring** — Sentry/Datadog ইন্টিগ্রেশন

---

## মোট স্কোর

| ক্যাটাগরি | স্কোর |
|-----------|-------|
| **ডিজাইন** | ⭐⭐⭐⭐⭐ (5/5) |
| **ফিচার** | ⭐⭐⭐⭐ (4/5) |
| **সিকিউরিটি** | ⭐⭐⭐ (3/5) |
| **পারফরম্যান্স** | ⭐⭐⭐⭐⭐ (5/5) |
| **কোড কোয়ালিটি** | ⭐⭐⭐⭐ (4/5) |
| **ডকুমেন্টেশন** | ⭐⭐⭐⭐⭐ (5/5) |
| **মোট** | ⭐⭐⭐⭐ (26/30) |

---

**সূত্র:** সব ফাইল পড়ে, সব কোড বিশ্লেষণ করে তৈরি।
**তারিখ:** 2026-06-24
**অডিটর:** OpenCode AI (mimo-v2.5-free)
