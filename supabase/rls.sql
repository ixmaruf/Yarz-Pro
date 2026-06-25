-- =====================================================================
-- YARZ Supabase Row Level Security
-- Date: 2026-06-20
-- Strategy:
--   1. anon role  -> SELECT on read-only tables + INSERT on website_orders/newsletter
--   2. authenticated -> full CRUD (admin only)
-- We do NOT use Supabase Auth for admin (custom session table used instead).
--   The Worker will set service_role key for ALL writes.
-- =====================================================================

-- Enable RLS on every table
alter table inventory             enable row level security;
alter table orders                enable row level security;
alter table website_orders        enable row level security;
alter table transactions          enable row level security;
alter table ad_tracker            enable row level security;
alter table expenses              enable row level security;
alter table monthly_reports       enable row level security;
alter table yearly_reports        enable row level security;
alter table settings              enable row level security;
alter table delivery_charges      enable row level security;
alter table customers             enable row level security;
alter table _activity             enable row level security;
alter table _draft_data           enable row level security;
alter table _archive_data         enable row level security;
alter table admin_sessions        enable row level security;
alter table admin_login_attempts  enable row level security;
alter table steadfast_keys        enable row level security;
alter table steadfast_balance_cache enable row level security;
alter table newsletter_subscribers enable row level security;
alter table rate_limit_log        enable row level security;
alter table audit_log             enable row level security;

-- ---------------------------------------------------------------------
-- PUBLIC READS (anon role can SELECT the data website needs to render)
-- ---------------------------------------------------------------------
create policy "anon read active inventory" on inventory
  for select to anon using (status = ''Active'');

create policy "anon read delivery_charges" on delivery_charges
  for select to anon using (active = true);

create policy "anon read public settings" on settings
  for select to anon using (is_secret = false);

-- ---------------------------------------------------------------------
-- PUBLIC WRITES (place order, subscribe newsletter)
-- ---------------------------------------------------------------------
create policy "anon insert website_orders" on website_orders
  for insert to anon with check (true);

create policy "anon insert newsletter" on newsletter_subscribers
  for insert to anon with check (true);

-- ---------------------------------------------------------------------
-- ALL OTHER ACCESS -> requires service_role key (Worker uses this)
-- Admin Panel NEVER talks to Supabase directly; Worker proxies with
-- service_role after verifying session token from admin_sessions.
-- ---------------------------------------------------------------------
-- (No policies = no access for anon/authenticated = fail-closed default)
