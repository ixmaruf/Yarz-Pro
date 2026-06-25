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


-- =====================================================================
-- >>> views.sql
-- =====================================================================

-- =====================================================================
-- YARZ Supabase Views (replaces Google Sheets FILTER formulas)
-- Date: 2026-06-20
-- These views mirror the GAS DRAFT_VIEW, ARCHIVE_VIEW, WEBSITE_SYNC
-- so the existing _doSheetRead(range) API can be reproduced.
-- =====================================================================

-- WEBSITE_SYNC view (Active products, customer-facing subset of columns)
create or replace view website_sync_view as
select
  product         as "Product",
  image_1         as "Image1",
  image_2         as "Image2",
  image_3         as "Image3",
  video_url       as "Video",