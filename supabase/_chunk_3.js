  description     as "Description",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  size_chart      as "SizeChart",
  delivery_days   as "DeliveryDays",
  regular         as "Regular",
  sale            as "Sale",
  disc_percent    as "Disc%",
  disc_type       as "DiscType",
  dhaka_delivery  as "Delivery(Dhaka)",
  outside_delivery as "Delivery(Outside)",
  greatest(stk_s - sold_s, 0) as "S_Left",
  greatest(stk_m - sold_m, 0) as "M_Left",
  greatest(stk_l - sold_l, 0) as "L_Left",
  greatest(stk_xl - sold_xl, 0) as "XL_Left",
  greatest(stk_xxl - sold_xxl, 0) as "XXL_Left",
  greatest(stk_3xl - sold_3xl, 0) as "3XL_Left",
  status          as "Status",
  image_4         as "Image4",
  image_5         as "Image5",
  image_6         as "Image6",
  coupon_active   as "CouponActive",
  coupon_code     as "CouponCode",
  coupon_disc_percent as "CouponDisc"
from inventory
where status = ''Active'' and product <> '''';

-- DRAFT_VIEW (Draft products only, admin sees)
create or replace view inventory_draft_view as
select
  row_number() over (order by product) as "#",
  product         as "Product",
  image_1         as "Image",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  cost            as "Cost",
  regular         as "Regular",
  sale            as "Sale",
  tot_stock       as "Stock",
  tot_sold        as "Sold",
  remaining       as "Left",
  ''--''          as "Action"
from inventory
where status = ''Draft'' and product <> '''';

-- ARCHIVE_VIEW (Archived products only)
create or replace view inventory_archive_view as
select
  row_number() over (order by product) as "#",
  product         as "Product",
  image_1         as "Image",
  category        as "Category",
  fabric          as "Fabric",
  badge           as "Badge",
  cost            as "Cost",
  regular         as "Regular",
  sale            as "Sale",
  tot_stock       as "Stock",
  tot_sold        as "Sold",
  remaining       as "Left",
  ''--''          as "Action"
from inventory
where status = ''Archived'' and product <> '''';

-- PUBLIC_PRODUCTS view (used by frontend; subset of WEBSITE_SYNC + computed flags)
create or replace view public_products as
select *
from website_sync_view;

-- CUSTOMER_LTV view (aggregates orders + website_orders)
create or replace view customer_ltv_view as
select
  cust_phone as phone,
  max(cust_name) as name,
  count(*) as total_orders,
  coalesce(sum(total), 0) as total_spent,
  min(date) as first_order_at,
  max(date) as last_order_at
from (
  select cust_name, cust_phone, total, date from orders where cust_phone <> ''''
  union all
  select cust_name, cust_phone, total, date from website_orders where cust_phone <> ''''
) combined
group by cust_phone;

-- =====================================================================
-- END views.sql
-- =====================================================================


-- =====================================================================
-- >>> rls.sql
-- =====================================================================

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


-- =====================================================================
-- >>> rpc.sql
-- =====================================================================

-- =====================================================================
-- YARZ Supabase RPC functions (Postgres-side business logic)
-- Date: 2026-06-20
-- These are called by supabase-adapter-v2.js.
-- Security: ALL functions check admin session EXCEPT admin_login.
-- =====================================================================

-- ---------------------------------------------------------------------
-- admin_login: verify username/password, create session, return token
-- ---------------------------------------------------------------------
create or replace function admin_login(
  p_username text, p_password text, p_user_agent text default ''''
)
returns table (token text, username text, expires_at timestamptz)
language plpgsql security definer as $$
declare
  v_user_id bigint;
  v_hash text;
  v_token text;
  v_expires timestamptz;
begin
  -- Find user (simple lookup; production should use admin_users table)
  select u.id, u.password_hash into v_user_id, v_hash
  from admin_users u where u.username = p_username and u.is_active = true;
  if v_user_id is null then
    insert into admin_login_attempts(username, success, user_agent) values (p_username, false, p_user_agent);
    return;
  end if;
  -- Verify hash (uses pgcrypto crypt())
  if v_hash != crypt(p_password, v_hash) then
    insert into admin_login_attempts(username, success, user_agent) values (p_username, false, p_user_agent);
    return;
  end if;
  -- Issue token
  v_token := encode(gen_random_bytes(32), ''hex'');
  v_expires := now() + interval ''7 days'';
  insert into admin_sessions(token, username, user_agent, expires_at)
    values (v_token, p_username, p_user_agent, v_expires);
  insert into admin_login_attempts(username, success, user_agent) values (p_username, true, p_user_agent);
  return query select v_token, p_username, v_expires;
end $$;

-- ---------------------------------------------------------------------
-- admin_logout: invalidate session
-- ---------------------------------------------------------------------
create or replace function admin_logout(p_token text)
returns boolean language plpgsql security definer as $$
begin
  delete from admin_sessions where token = p_token;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- verify_session: returns true if session is valid (not expired)
-- ---------------------------------------------------------------------
create or replace function verify_session(p_token text)
returns boolean language plpgsql security definer as $$