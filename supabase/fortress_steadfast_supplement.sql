-- =====================================================================
-- YARZ Supabase Supplement — Fortress + Steadfast + Reports
-- Date: 2026-06-20
-- Run AFTER schema.sql + views.sql + rls.sql + rpc.sql + seed_defaults.sql
-- This adds the 3 missing tables and 8 missing RPCs identified in
-- analysis/gaps.md.
--
-- Tables added (3):
--   blocked_devices       -- Fortress device blocklist
--   fortress_log          -- Fortress event audit log
--   steadfast_consignments -- All Steadfast consignments created
--
-- RPCs added (8):
--   record_return             -- atomic SOLD_* decrement + Return marker
--   delete_website_order      -- full reversal (cancel tx + restore stock)
--   generate_monthly_report   -- aggregate orders/website_orders/tx/ads
--   steadfast_create_consignment -- call Steadfast API + log + update status
--   fortress_block            -- upsert into blocked_devices
--   fortress_unblock          -- delete from blocked_devices
--   fortress_log_event        -- insert into fortress_log
--   fortress_lookup           -- return all blocked + recent log
-- =====================================================================

-- ---------------------------------------------------------------------
-- blocked_devices
-- ---------------------------------------------------------------------
create table if not exists blocked_devices (
  id              bigserial primary key,
  device_id       text unique not null,
  blocked_at      timestamptz default now(),
  blocked_by      text default 'admin',
  block_reason    text default 'manual',
  block_type      text default 'hard',  -- 'hard' | 'soft' | 'shadow'
  expires_at      timestamptz,
  admin_notes     text,
  status          text default 'active', -- 'active' | 'archived'
  last_seen       timestamptz,
  order_attempts  int default 0,
  risk_score      int default 0,
  phones_seen     text,                  -- comma-separated
  ips_seen        text,                  -- comma-separated
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_blocked_devices_status on blocked_devices(status) where status = 'active';
create index if not exists idx_blocked_devices_expires on blocked_devices(expires_at) where expires_at is not null;

alter table blocked_devices enable row level security;

-- ---------------------------------------------------------------------
-- fortress_log
-- ---------------------------------------------------------------------
create table if not exists fortress_log (
  id              bigserial primary key,
  log_id          text unique not null,  -- "FL-YYYYMMDD-HHMMSS-XXXXXX"
  ts              timestamptz default now(),
  event_type      text not null,         -- 'block_added' | 'block_removed' | 'shadow_ban' | 'burst_attempt' etc.
  device_id       text,
  phone_hash      text,                  -- FNV-1a hash, not raw
  ip              text,
  country         text,
  risk_score      int default 0,
  reason          text,
  actor           text default 'auto',   -- 'admin' | 'auto'
  order_id        text,
  notes           text
);
create index if not exists idx_fortress_log_ts on fortress_log(ts desc);
create index if not exists idx_fortress_log_device on fortress_log(device_id);
create index if not exists idx_fortress_log_event on fortress_log(event_type, ts desc);

alter table fortress_log enable row level security;

-- ---------------------------------------------------------------------
-- steadfast_consignments (audit log of all Steadfast API calls)
-- ---------------------------------------------------------------------
create table if not exists steadfast_consignments (
  id                 bigserial primary key,
  consignment_id     text unique,                    -- Steadfast consignment_id
  tracking_code      text,
  invoice            text not null,                  -- YARZ order_id
  recipient_name     text,
  recipient_phone    text,
  recipient_address  text,
  cod_amount         numeric(12,2) default 0,
  total_lot          int default 0,
  item_description   text,
  note               text,
  delivery_type      int default 0,                  -- 0=home, 1=hub
  status             text default 'pending',         -- 'pending' | 'in_review' | 'delivered' | 'cancelled' | 'returned'
  stead_response     jsonb,                          -- raw response from Steadfast
  created_at         timestamptz default now(),
  last_checked_at    timestamptz,
  delivered_at       timestamptz,
  cancelled_at       timestamptz
);
create index if not exists idx_steadfast_inv on steadfast_consignments(invoice);
create index if not exists idx_steadfast_track on steadfast_consignments(tracking_code);
create index if not exists idx_steadfast_status on steadfast_consignments(status, created_at desc);

alter table steadfast_consignments enable row level security;

-- =====================================================================
-- RPCs
-- =====================================================================

-- ---------------------------------------------------------------------
-- record_return: atomic SOLD_* decrement + TRANSACTIONS Return marker
-- (Mirrors saveReturnFromForm in GAS line 2026-2142)
-- ---------------------------------------------------------------------
create or replace function record_return(
  p_product text, p_size text, p_qty int, p_user text default 'admin'
)
returns boolean language plpgsql security definer as $$
declare
  v_sold_col text;
  v_cur int;
  v_new int;
begin
  v_sold_col := case upper(p_size)
    when 'S'   then 'sold_s'   when 'M'   then 'sold_m'
    when 'L'   then 'sold_l'   when 'XL'  then 'sold_xl'
    when 'XXL' then 'sold_xxl' when '3XL' then 'sold_3xl'
    when 'ONE' then 'sold_m'   else null end;
  if v_sold_col is null then raise exception 'Unknown size: %', p_size; end if;

  -- Lock inventory row
  execute format('select %I from inventory where product = $1 for update', v_sold_col)
    into v_cur using p_product;

  v_new := greatest(0, coalesce(v_cur, 0) - p_qty);
  execute format('update inventory set %I = $1, updated_at = now() where product = $2',
    v_sold_col) using v_new, p_product;

  -- Log Return marker (qty=0 per v15.32 fix to keep AB=0 source-of-truth)
  insert into transactions (date, product, type, size, qty, revenue, cost, profit)
  values (now(), p_product, 'Return', p_size, 0, 0, 0, 0);

  insert into audit_log (action, actor, details)
  values ('record_return', p_user,
    jsonb_build_object('product', p_product, 'size', p_size, 'qty', p_qty, 'new_stock', v_new));
  return true;
end $$;

-- ---------------------------------------------------------------------
-- delete_website_order: full reversal (cancel TRANSACTIONS, restore SOLD_*, delete rows)
-- (Mirrors _webDeleteWebsiteOrder in GAS line 3099-3226)
-- ---------------------------------------------------------------------
create or replace function delete_website_order(
  p_order_id text, p_user text default 'admin'
)
returns table (rows_deleted int, stock_restored int) language plpgsql security definer as $$
declare
  v_item record;
  v_sold_col text;
  v_remaining int;
  v_rows int := 0;
  v_stock int := 0;
begin
  -- Snapshot order items before deleting
  for v_item in
    select cust_phone, product, size, qty, status
    from website_orders where order_id = p_order_id
  loop
    -- Skip already-reversed statuses
    if v_item.status in ('Returned', 'Cancelled') then continue; end if;

    -- Cancel matching TRANSACTIONS Sale rows (most-recent first)
    -- For simplicity, mark them qty=0 (like Return marker)
    update transactions
      set qty = 0, revenue = 0, cost = 0, profit = 0
      where product = v_item.product and size = v_item.size and type = 'Sale' and qty > 0
        and id in (
          select id from transactions
          where product = v_item.product and size = v_item.size and type = 'Sale' and qty > 0
          order by date desc limit greatest(1, v_item.qty)
        );

    -- Restore INVENTORY.SOLD_*
    v_sold_col := case upper(v_item.size)
      when 'S'   then 'sold_s'   when 'M'   then 'sold_m'
      when 'L'   then 'sold_l'   when 'XL'  then 'sold_xl'
      when 'XXL' then 'sold_xxl' when '3XL' then 'sold_3xl'
      when 'ONE' then 'sold_m'   else null end;
    if v_sold_col is not null then
      execute format(
        'update inventory set %I = greatest(0, %I - $1), updated_at = now() where product = $2',
        v_sold_col, v_sold_col)
        using v_item.qty, v_item.product;
      v_stock := v_stock + v_item.qty;
    end if;
  end loop;

  -- Delete the Website_Orders rows
  delete from website_orders where order_id = p_order_id;
  get diagnostics v_rows = row_count;

  insert into audit_log (action, actor, details)
  values ('delete_website_order', p_user,
    jsonb_build_object('order_id', p_order_id, 'rows_deleted', v_rows, 'stock_restored', v_stock));
  return query select v_rows, v_stock;
end $$;

-- ---------------------------------------------------------------------
-- generate_monthly_report: aggregate orders/website_orders + tx + ad_tracker
-- (Fixes legacy bug: legacy code only counted ORDERS sheet, not Website_Orders)
-- ---------------------------------------------------------------------
create or replace function generate_monthly_report(p_year int, p_month int)
returns void language plpgsql security definer as $$
declare
  v_month_id text;
  v_revenue numeric(12,2);
  v_cost    numeric(12,2);
  v_ad      numeric(12,2);
  v_orders  int;
  v_net     numeric(12,2);
  v_start   timestamptz;
  v_end     timestamptz;
begin
  v_month_id := p_year || '-' || lpad(p_month::text, 2, '0');
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Dhaka');
  v_end   := v_start + interval '1 month';

  -- Revenue from manual ORDERS (not Cancelled/Returned)
  select coalesce(sum(total), 0) into v_revenue
    from orders
    where date >= v_start and date < v_end
      and status not in ('Cancelled', 'Returned');
  -- Add Website_Orders revenue
  select v_revenue + coalesce(sum(total), 0) into v_revenue
    from website_orders
    where date >= v_start and date < v_end
      and status not in ('Cancelled', 'Returned');

  -- Cost from TRANSACTIONS (type=Sale)
  select coalesce(sum(cost), 0) into v_cost
    from transactions
    where date >= v_start and date < v_end and type = 'Sale';

  -- AdSpend from AD_TRACKER
  select coalesce(sum(spend), 0) into v_ad
    from ad_tracker
    where date >= v_start and date < v_end;

  -- Order count
  select (select count(*) from orders where date >= v_start and date < v_end)
       + (select count(*) from website_orders where date >= v_start and date < v_end)
    into v_orders;

  v_net := v_revenue - v_cost - v_ad;

  insert into monthly_reports (month, revenue, cost, ad_spend, net_profit, orders)
  values (v_month_id, v_revenue, v_cost, v_ad, v_net, v_orders)
  on conflict (month) do update set
    revenue = excluded.revenue,
    cost = excluded.cost,
    ad_spend = excluded.ad_spend,
    net_profit = excluded.net_profit,
    orders = excluded.orders,
    updated_at = now();

  insert into audit_log (action, details)
  values ('generate_monthly_report', jsonb_build_object('month', v_month_id));
end $$;

-- ---------------------------------------------------------------------
-- steadfast_create_consignment: HTTP call to Steadfast (via Worker / Edge Function)
-- The actual HTTP call lives in the Worker (server-side); this RPC just
-- logs the consignment into steadfast_consignments.
-- This RPC is called by the Worker after the HTTP call returns.
-- ---------------------------------------------------------------------
create or replace function steadfast_log_consignment(
  p_consignment_id text, p_tracking_code text, p_invoice text,
  p_recipient_name text, p_recipient_phone text, p_recipient_address text,
  p_cod_amount numeric, p_total_lot int, p_item_description text, p_note text,
  p_delivery_type int default 0, p_stead_response jsonb default '{}'::jsonb
)
returns bigint language plpgsql security definer as $$
declare
  v_id bigint;
begin
  insert into steadfast_consignments
    (consignment_id, tracking_code, invoice, recipient_name, recipient_phone,
     recipient_address, cod_amount, total_lot, item_description, note,
     delivery_type, status, stead_response, last_checked_at)
  values
    (p_consignment_id, p_tracking_code, p_invoice, p_recipient_name, p_recipient_phone,
     p_recipient_address, p_cod_amount, p_total_lot, p_item_description, p_note,
     p_delivery_type, 'pending', p_stead_response, now())
  returning id into v_id;

  -- Update Website_Orders status to "Picked Up" + courier field
  update website_orders
    set status = 'Picked Up',
        courier = 'Steadfast' || case when p_tracking_code is not null then ' | ' || p_tracking_code else '' end,
        updated_at = now(),
        activity = coalesce(activity, '') || ' | Steadfast pickup created (' || coalesce(p_tracking_code, p_consignment_id) || ') @ ' || to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD HH24:MI:SS')
    where order_id = p_invoice;

  insert into audit_log (action, details)
  values ('steadfast_create', jsonb_build_object('invoice', p_invoice, 'tracking_code', p_tracking_code));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- fortress_block: upsert into blocked_devices
-- (Mirrors _fortressBlock in GAS line 5170)
-- ---------------------------------------------------------------------
create or replace function fortress_block(
  p_device_id text, p_blocked_by text default 'admin',
  p_reason text default 'manual', p_block_type text default 'hard',
  p_expires_at timestamptz default null, p_admin_notes text default null,
  p_order_attempts int default 0, p_risk_score int default 0,
  p_phones_seen text default null, p_ips_seen text default null
)
returns void language plpgsql security definer as $$
begin
  insert into blocked_devices
    (device_id, blocked_by, block_reason, block_type, expires_at, admin_notes,
     status, last_seen, order_attempts, risk_score, phones_seen, ips_seen)
  values
    (p_device_id, p_blocked_by, p_reason, p_block_type, p_expires_at, p_admin_notes,
     'active', now(), p_order_attempts, p_risk_score, p_phones_seen, p_ips_seen)
  on conflict (device_id) do update set
    blocked_by = excluded.blocked_by,
    block_reason = excluded.block_reason,
    block_type = excluded.block_type,
    expires_at = excluded.expires_at,
    admin_notes = excluded.admin_notes,
    status = 'active',
    last_seen = now(),
    order_attempts = excluded.order_attempts,
    risk_score = excluded.risk_score,
    phones_seen = excluded.phones_seen,
    ips_seen = excluded.ips_seen,
    updated_at = now();

  insert into fortress_log (log_id, event_type, device_id, risk_score, reason, actor)
  values (
    'FL-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMMDD-HH24MISS') || '-' || upper(substring(md5(random()::text) for 6)),
    'block_added', p_device_id, p_risk_score, p_reason, p_blocked_by
  );

  insert into audit_log (action, details)
  values ('fortress_block', jsonb_build_object('device_id', p_device_id, 'reason', p_reason));
end $$;

-- ---------------------------------------------------------------------
-- fortress_unblock: delete from blocked_devices (soft delete: status='archived')
-- (Mirrors _fortressUnblock in GAS line 5231)
-- ---------------------------------------------------------------------
create or replace function fortress_unblock(p_device_id text, p_actor text default 'admin')
returns boolean language plpgsql security definer as $$
declare
  v_found boolean;
begin
  update blocked_devices
    set status = 'archived', updated_at = now()
    where device_id = p_device_id and status = 'active'
    returning true into v_found;

  if v_found then
    insert into fortress_log (log_id, event_type, device_id, reason, actor)
    values (
      'FL-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMMDD-HH24MISS') || '-' || upper(substring(md5(random()::text) for 6)),
      'block_removed', p_device_id, 'admin_unblock', p_actor
    );
    insert into audit_log (action, details)
    values ('fortress_unblock', jsonb_build_object('device_id', p_device_id));
  end if;
  return coalesce(v_found, false);
end $$;

-- ---------------------------------------------------------------------
-- fortress_log_event: insert into fortress_log
-- ---------------------------------------------------------------------
create or replace function fortress_log_event(
  p_event_type text, p_device_id text default null, p_phone_hash text default null,
  p_ip text default null, p_country text default null, p_risk_score int default 0,
  p_reason text default null, p_actor text default 'auto',
  p_order_id text default null, p_notes text default null
)
returns text language plpgsql security definer as $$
declare
  v_log_id text;
begin
  v_log_id := 'FL-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMMDD-HH24MISS')
              || '-' || upper(substring(md5(random()::text) for 6));
  insert into fortress_log
    (log_id, event_type, device_id, phone_hash, ip, country, risk_score, reason, actor, order_id, notes)
  values
    (v_log_id, p_event_type, p_device_id, p_phone_hash, p_ip, p_country, p_risk_score, p_reason, p_actor, p_order_id, p_notes);
  return v_log_id;
end $$;

-- ---------------------------------------------------------------------
-- fortress_lookup: return all active blocked + recent 100 log events
-- ---------------------------------------------------------------------
create or replace function fortress_lookup()
returns table (
  device_id text, blocked_at timestamptz, blocked_by text, block_reason text,
  block_type text, expires_at timestamptz, admin_notes text, status text,
  last_seen timestamptz, order_attempts int, risk_score int,
  phones_seen text, ips_seen text
) language plpgsql security definer as $$
begin
  return query
    select b.device_id, b.blocked_at, b.blocked_by, b.block_reason, b.block_type,
           b.expires_at, b.admin_notes, b.status, b.last_seen, b.order_attempts,
           b.risk_score, b.phones_seen, b.ips_seen
    from blocked_devices b
    where b.status = 'active'
    order by b.blocked_at desc;
end $$;

-- ---------------------------------------------------------------------
-- Helper: list recent fortress events (for admin UI)
-- ---------------------------------------------------------------------
create or replace function fortress_recent_events(p_limit int default 100)
returns table (
  log_id text, ts timestamptz, event_type text, device_id text, phone_hash text,
  ip text, country text, risk_score int, reason text, actor text,
  order_id text, notes text
) language plpgsql security definer as $$
begin
  return query
    select f.log_id, f.ts, f.event_type, f.device_id, f.phone_hash, f.ip, f.country,
           f.risk_score, f.reason, f.actor, f.order_id, f.notes
    from fortress_log f
    order by f.ts desc
    limit p_limit;
end $$;

-- ---------------------------------------------------------------------
-- Helper: get_steadfast_consignments (for admin UI)
-- ---------------------------------------------------------------------
create or replace function get_steadfast_consignments(p_invoice text default null)
returns table (
  id bigint, consignment_id text, tracking_code text, invoice text,
  recipient_name text, recipient_phone text, cod_amount numeric,
  total_lot int, status text, created_at timestamptz,
  last_checked_at timestamptz, delivered_at timestamptz
) language plpgsql security definer as $$
begin
  if p_invoice is not null then
    return query
      select s.id, s.consignment_id, s.tracking_code, s.invoice, s.recipient_name,
             s.recipient_phone, s.cod_amount, s.total_lot, s.status, s.created_at,
             s.last_checked_at, s.delivered_at
      from steadfast_consignments s
      where s.invoice = p_invoice
      order by s.created_at desc;
  else
    return query
      select s.id, s.consignment_id, s.tracking_code, s.invoice, s.recipient_name,
             s.recipient_phone, s.cod_amount, s.total_lot, s.status, s.created_at,
             s.last_checked_at, s.delivered_at
      from steadfast_consignments s
      order by s.created_at desc
      limit 200;
  end if;
end $$;

-- =====================================================================
-- pg_cron jobs (optional — set up after first deploy if available)
-- =====================================================================
-- Run at 1 AM Bangladesh time every day: cleanupOldOrders equivalent
-- (Remove comments + install via Supabase dashboard or psql if pg_cron enabled)
-- select cron.schedule('cleanup-old-orders', '0 1 * * *',
--   $$delete from website_orders where date < now() - interval '90 days'$$);
-- select cron.schedule('cleanup-expired-sessions', '0 2 * * *',
--   $$delete from admin_sessions where expires_at < now()$$);
-- select cron.schedule('refresh-customer-ltv', '0 3 * * *',
--   $$select update_customer_ltv()$$);

-- ---------------------------------------------------------------------
-- create_manual_order: atomic manual order creation
--   Inserts into orders, increments inventory.SOLD_*, inserts TRANSACTIONS row,
--   and updates customers (LTV) — all in one transaction.
-- Used by Admin Panel "saveOrderFromForm" and Worker ACTIONS_SUPABASE.
-- ---------------------------------------------------------------------
create or replace function create_manual_order(
  p_order_id text, p_cust_name text, p_cust_phone text, p_cust_addr text default '',
  p_deliv_dist text default '', p_deliv_zone text default '',
  p_product text, p_size text, p_qty int default 1, p_price numeric default 0,
  p_delivery_charge numeric default 0, p_total numeric default 0,
  p_payment text default 'Cash on Delivery', p_status text default 'Pending',
  p_courier text default '', p_notes text default '',
  p_user text default 'admin'
)
returns bigint language plpgsql security definer as $$
declare
  v_sold_col text;
  v_cur int;
  v_new int;
  v_id bigint;
begin
  -- 1. UPSERT into orders (admin can re-save an order)
  insert into orders (order_id, cust_name, cust_phone, cust_addr, deliv_dist, deliv_zone,
    product, size, qty, price, delivery_charge, total, payment, status, courier, notes)
  values (p_order_id, p_cust_name, p_cust_phone, p_cust_addr, p_deliv_dist, p_deliv_zone,
    p_product, p_size, p_qty, p_price, p_delivery_charge, p_total, p_payment, p_status,
    p_courier, p_notes)
  on conflict (order_id) do update set
    cust_name = excluded.cust_name,
    cust_phone = excluded.cust_phone,
    cust_addr = excluded.cust_addr,
    deliv_dist = excluded.deliv_dist,
    deliv_zone = excluded.deliv_zone,
    product = excluded.product,
    size = excluded.size,
    qty = excluded.qty,
    price = excluded.price,
    delivery_charge = excluded.delivery_charge,
    total = excluded.total,
    payment = excluded.payment,
    status = excluded.status,
    courier = excluded.courier,
    notes = excluded.notes
  returning id into v_id;

  -- 2. Increment SOLD_* on inventory (lock row)
  v_sold_col := case upper(p_size)
    when 'S'   then 'sold_s'   when 'M'   then 'sold_m'
    when 'L'   then 'sold_l'   when 'XL'  then 'sold_xl'
    when 'XXL' then 'sold_xxl' when '3XL' then 'sold_3xl'
    when 'ONE' then 'sold_m'   else null end;
  if v_sold_col is null then raise exception 'Unknown size: %', p_size; end if;

  execute format('select %I from inventory where product = $1 for update', v_sold_col)
    into v_cur using p_product;
  v_new := coalesce(v_cur, 0) + p_qty;
  execute format('update inventory set %I = $1, updated_at = now() where product = $2',
    v_sold_col) using v_new, p_product;

  -- 3. Insert into TRANSACTIONS (Sale)
  insert into transactions (date, product, type, size, qty, revenue, cost, profit)
  values (now(), p_product, 'Sale', p_size, p_qty, p_price, 0, 0);

  -- 4. Upsert customers (LTV)
  insert into customers (phone, name, total_orders, total_spent, first_order_at, last_order_at)
  values (p_cust_phone, p_cust_name, 1, p_total, now(), now())
  on conflict (phone) do update set
    name = excluded.name,
    total_orders = customers.total_orders + 1,
    total_spent = customers.total_spent + excluded.total_spent,
    last_order_at = now(),
    updated_at = now();

  -- 5. Audit log
  insert into audit_log (action, actor, details)
  values ('create_manual_order', p_user,
    jsonb_build_object('order_id', p_order_id, 'product', p_product,
                      'size', p_size, 'qty', p_qty, 'total', p_total));

  return v_id;
end $$;

-- =====================================================================
-- END supplement.sql
-- =====================================================================
