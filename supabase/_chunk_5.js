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