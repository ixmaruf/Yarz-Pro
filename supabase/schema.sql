-- =====================================================================
-- YARZ Supabase Schema (PostgreSQL)
-- Date: 2026-06-20
-- Migrates 16 Google Sheets tabs into proper relational tables.
-- Money columns are NUMERIC(12,2) -- NOT FLOAT -- to avoid rounding bugs.
-- Stock counts are INTEGER; formulas become GENERATED columns.
-- All tables have id BIGSERIAL PK + created_at/updated_at TIMESTAMPTZ.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. INVENTORY (52 columns from Google Sheets INVENTORY tab)
-- ---------------------------------------------------------------------
create table if not exists inventory (
  id                  bigserial primary key,
  product             text not null unique,
  image_1             text default '''',
  image_2             text default '''',
  image_3             text default '''',
  video_url           text default '''',
  description         text default '''',
  category            text default '''',
  fabric              text default '''',
  badge               text default '''',
  size_chart          text default '''',
  delivery_days       text default '''',
  cost                numeric(12,2) default 0,
  regular             numeric(12,2) default 0,
  sale                numeric(12,2) default 0,
  disc_percent        numeric(5,2) default 0,
  disc_type           text default ''Normal'',
  dhaka_delivery      numeric(12,2) default 60,
  outside_delivery    numeric(12,2) default 120,
  stk_s               integer default 0,
  stk_m               integer default 0,
  stk_l               integer default 0,
  stk_xl              integer default 0,
  stk_xxl             integer default 0,
  stk_3xl             integer default 0,
  sold_s              integer default 0,
  sold_m              integer default 0,
  sold_l              integer default 0,
  sold_xl             integer default 0,
  sold_xxl            integer default 0,
  sold_3xl            integer default 0,
  -- GENERATED computed columns (was Sheet formulas col 27,29,30)
  tot_sold            integer generated always as
                       (coalesce(sold_s,0)+coalesce(sold_m,0)+coalesce(sold_l,0)
                        +coalesce(sold_xl,0)+coalesce(sold_xxl,0)+coalesce(sold_3xl,0)) stored,
  tot_stock           integer generated always as
                       (coalesce(stk_s,0)+coalesce(stk_m,0)+coalesce(stk_l,0)
                        +coalesce(stk_xl,0)+coalesce(stk_xxl,0)+coalesce(stk_3xl,0)) stored,
  remaining           integer generated always as
                       (tot_stock - tot_sold) stored,
  returns             integer default 0,
  invest              numeric(12,2) default 0,
  revenue             numeric(12,2) default 0,
  to_recover          numeric(12,2) default 0,
  gross               numeric(12,2) default 0,
  fb_ad               numeric(12,2) default 0,
  net                 numeric(12,2) default 0,
  disc_impact         numeric(12,2) default 0,
  updated_at          timestamptz default now(),
  status              text default ''Active'' check (status in (''Active'',''Draft'',''Archived'')),
  image_4             text default '''',
  image_5             text default '''',
  image_6             text default '''',
  coupon_active       text default ''No'' check (coupon_active in (''Yes'',''No'',''Hidden'')),
  coupon_code         text default '''',
  coupon_disc_percent numeric(5,2) default 0,
  hidden_sizes        text default '''',
  size_type           text default '''',
  accessory           text default ''No'' check (accessory in (''Yes'',''No'')),
  created_at          timestamptz default now()
);
create index if not exists idx_inventory_status on inventory(status);
create index if not exists idx_inventory_category on inventory(category);
create index if not exists idx_inventory_updated on inventory(updated_at desc);

-- ---------------------------------------------------------------------
-- 2. ORDERS (16 columns, manual / phone orders)
-- ---------------------------------------------------------------------
create table if not exists orders (
  id              bigserial primary key,
  order_id        text unique,
  date            timestamptz default now(),
  cust_name       text default '''',
  cust_phone      text default '''',
  cust_addr       text default '''',
  deliv_dist      text default '''',
  deliv_zone      text default '''',
  product         text default '''',
  size            text default '''',
  qty             integer default 1,
  price           numeric(12,2) default 0,
  delivery_charge numeric(12,2) default 0,
  total           numeric(12,2) default 0,
  payment         text default ''Cash on Delivery'',
  status          text default ''Pending'' check (status in
                    (''Pending'',''Confirmed'',''Processing'',''Shipped'',
                     ''Delivered'',''Cancelled'',''Returned'')),
  courier         text default '''',
  notes           text default '''',
  created_at      timestamptz default now()
);
create index if not exists idx_orders_phone on orders(cust_phone);
create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_date on orders(date desc);

-- ---------------------------------------------------------------------
-- 3. WEBSITE_ORDERS (29 columns from Website_Orders tab)
--    Includes fraud signals (device_id, ip, country, asn, risk_score...)
-- ---------------------------------------------------------------------
create table if not exists website_orders (
  id              bigserial primary key,
  order_id        text unique,
  date            timestamptz default now(),
  cust_name       text default '''',
  cust_phone      text default '''',
  cust_addr       text default '''',
  deliv_zone      text default '''',
  product         text default '''',
  size            text default '''',
  qty             integer default 1,
  price           numeric(12,2) default 0,
  delivery_charge numeric(12,2) default 0,
  total           numeric(12,2) default 0,
  payment         text default ''Cash on Delivery'',
  notes           text default '''',
  coupon_code     text default '''',
  status          text default ''Pending'' check (status in
                    (''Pending'',''Confirmed'',''Processing'',''Picked Up'',
                     ''Ready for Delivery'',''Handed to Courier'',''In Transit'',
                     ''Shipped'',''Delivered'',''Cancelled'',''Returned'')),
  courier         text default '''',
  updated_at      timestamptz default now(),
  activity        text default '''',
  device_id       text default '''',
  ip              text default '''',
  country         text default '''',
  asn             text default '''',
  risk_score      numeric(5,2) default 0,
  risk_signals    text default '''',
  flagged         boolean default false,
  flag_reason     text default '''',
  flagged_at      timestamptz,
  flagged_by      text default '''',
  created_at      timestamptz default now()
);
create index if not exists idx_wo_phone on website_orders(cust_phone);
create index if not exists idx_wo_status on website_orders(status);
create index if not exists idx_wo_date on website_orders(date desc);
create index if not exists idx_wo_flagged on website_orders(flagged) where flagged = true;
create index if not exists idx_wo_device on website_orders(device_id);

-- ---------------------------------------------------------------------
-- 4. TRANSACTIONS (8 columns)
-- ---------------------------------------------------------------------
create table if not exists transactions (
  id             bigserial primary key,
  date           timestamptz default now(),
  product        text default '''',
  type           text default ''Sale'' check (type in (''Sale'',''Return'',''Adjustment'')),
  size           text default '''',
  qty            integer default 0,
  revenue        numeric(12,2) default 0,
  cost           numeric(12,2) default 0,
  profit         numeric(12,2) generated always as (revenue - cost) stored,
  created_at     timestamptz default now()
);
create index if not exists idx_tx_date on transactions(date desc);
create index if not exists idx_tx_product on transactions(product);

-- ---------------------------------------------------------------------
-- 5. AD_TRACKER (7 columns)
-- ---------------------------------------------------------------------
create table if not exists ad_tracker (
  id          bigserial primary key,
  date        timestamptz default now(),
  product     text default '''',
  spend       numeric(12,2) default 0,
  reach       integer default 0,
  impressions integer default 0,
  clicks      integer default 0,
  notes       text default '''',
  created_at  timestamptz default now()
);
create index if not exists idx_ad_date on ad_tracker(date desc);

-- ---------------------------------------------------------------------
-- 6. EXPENSES (5 columns)
-- ---------------------------------------------------------------------
create table if not exists expenses (
  id          bigserial primary key,
  date        timestamptz default now(),
  category    text default '''',
  description text default '''',
  amount      numeric(12,2) default 0,
  notes       text default '''',
  created_at  timestamptz default now()
);
create index if not exists idx_exp_date on expenses(date desc);
create index if not exists idx_exp_category on expenses(category);

-- ---------------------------------------------------------------------
-- 7. MONTHLY_REPORT (6 columns)
-- ---------------------------------------------------------------------
create table if not exists monthly_reports (
  id          bigserial primary key,
  month       text unique, -- format YYYY-MM
  revenue     numeric(12,2) default 0,
  cost        numeric(12,2) default 0,
  ad_spend    numeric(12,2) default 0,
  net_profit  numeric(12,2) generated always as (revenue - cost - ad_spend) stored,
  orders      integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 8. YEARLY_REPORT (6 columns)
-- ---------------------------------------------------------------------
create table if not exists yearly_reports (
  id          bigserial primary key,
  year        integer unique,
  revenue     numeric(12,2) default 0,
  cost        numeric(12,2) default 0,
  ad_spend    numeric(12,2) default 0,
  net_profit  numeric(12,2) generated always as (revenue - cost - ad_spend) stored,
  orders      integer default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 9. SETTINGS (key-value store)
-- ---------------------------------------------------------------------
create table if not exists settings (
  id          bigserial primary key,
  key         text unique not null,
  value       text default '''',
  description text default '''',
  is_secret   boolean default false,
  updated_at  timestamptz default now()
);
create index if not exists idx_settings_key on settings(key);

-- ---------------------------------------------------------------------
-- 10. DELIVERY_CHARGES (4 columns)
-- ---------------------------------------------------------------------
create table if not exists delivery_charges (
  id        text primary key,    -- e.g. inside_narayanganj
  name      text not null,
  charge    numeric(12,2) default 0,
  active    boolean default true,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 11. CUSTOMERS (LTV aggregation; derived from website_orders + orders)
-- ---------------------------------------------------------------------
create table if not exists customers (
  id              bigserial primary key,
  phone           text unique not null,
  name            text default '''',
  total_orders    integer default 0,
  total_spent     numeric(12,2) default 0,
  first_order_at  timestamptz,
  last_order_at   timestamptz,
  risk_score      numeric(5,2) default 0,
  is_blocked      boolean default false,
  block_reason    text default '''',
  notes           text default '''',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_customers_blocked on customers(is_blocked) where is_blocked = true;

-- ---------------------------------------------------------------------
-- 12. _ACTIVITY (4 columns)
-- ---------------------------------------------------------------------
create table if not exists _activity (
  id          bigserial primary key,
  ts          timestamptz default now(),
  product     text default '''',
  old_status  text default '''',
  new_status  text default '''',
  actor       text default ''system''
);
create index if not exists idx_activity_ts on _activity(ts desc);
create index if not exists idx_activity_product on _activity(product);

-- ---------------------------------------------------------------------
-- 13. _DRAFT_DATA / _ARCHIVE_DATA (2 cols each)
-- ---------------------------------------------------------------------
create table if not exists _draft_data (
  id    bigserial primary key,
  name  text unique,
  note  text default '''',
  created_at timestamptz default now()
);
create table if not exists _archive_data (
  id    bigserial primary key,
  name  text unique,
  note  text default '''',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 14. ADMIN_SESSIONS + ADMIN_LOGIN_ATTEMPTS (auth)
-- ---------------------------------------------------------------------
create table if not exists admin_sessions (
  id          bigserial primary key,
  token       text unique not null,
  username    text not null,
  user_agent  text default '''',
  ip          text default '''',
  expires_at  timestamptz not null,
  created_at  timestamptz default now(),
  last_used_at timestamptz default now()
);
create index if not exists idx_sessions_token on admin_sessions(token);
create index if not exists idx_sessions_expires on admin_sessions(expires_at);

create table if not exists admin_login_attempts (
  id          bigserial primary key,
  username    text default '''',
  ip          text default '''',
  success     boolean default false,
  user_agent  text default '''',
  ts          timestamptz default now()
);
create index if not exists idx_login_ip_ts on admin_login_attempts(ip, ts desc);
create index if not exists idx_login_success on admin_login_attempts(success, ts desc);

-- ---------------------------------------------------------------------
-- 15. STEADFAST_CACHE (avoid hitting Steadfast every load)
-- ---------------------------------------------------------------------
create table if not exists steadfast_keys (
  id          integer primary key default 1,
  api_key     text default '''',
  secret_key  text default '''',
  updated_at  timestamptz default now(),
  check constraint only_one_row check (id = 1)
);

create table if not exists steadfast_balance_cache (
  id          integer primary key default 1,
  balance     numeric(12,2) default 0,
  raw_json    jsonb,
  fetched_at  timestamptz default now(),
  check constraint only_one_row_sb check (id = 1)
);

-- ---------------------------------------------------------------------
-- 16. NEWSLETTER subscribers (from _webSubscribeNewsletter)
-- ---------------------------------------------------------------------
create table if not exists newsletter_subscribers (
  id          bigserial primary key,
  email       text unique,
  phone       text,
  source      text default ''website'',
  subscribed_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- 17. RATE_LIMIT_LOG (replaces GAS PropertiesService sliding window)
-- ---------------------------------------------------------------------
create table if not exists rate_limit_log (
  id          bigserial primary key,
  scope       text not null,   -- e.g. ''api'', ''place_order''
  identifier  text not null,   -- ip or phone
  ts          timestamptz default now()
);
create index if not exists idx_rl_scope_id_ts on rate_limit_log(scope, identifier, ts desc);

-- ---------------------------------------------------------------------
-- 18. AUDIT_LOG (track every admin destructive action)
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id          bigserial primary key,
  action      text not null,
  actor       text default ''admin'',
  details     jsonb,
  ts          timestamptz default now()
);
create index if not exists idx_audit_action_ts on audit_log(action, ts desc);

-- =====================================================================
-- END schema.sql
-- =====================================================================
