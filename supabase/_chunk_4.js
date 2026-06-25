declare
  v_ok boolean;
begin
  update admin_sessions set last_used_at = now()
    where token = p_token and expires_at > now();
  v_ok := found;
  if not v_ok then
    -- Clean up expired sessions occasionally
    delete from admin_sessions where expires_at < now() - interval ''1 day'';
  end if;
  return v_ok;
end $$;

-- ---------------------------------------------------------------------
-- check_login_rate_limit: returns false if too many failed attempts
-- ---------------------------------------------------------------------
create or replace function check_login_rate_limit(p_ip text, p_window_sec integer)
returns boolean language plpgsql security definer as $$
declare
  v_count int;
begin
  select count(*) into v_count from admin_login_attempts
    where ts > now() - (p_window_sec || '' seconds'')::interval and success = false;
  return v_count < 20;
end $$;

-- ---------------------------------------------------------------------
-- full_factory_reset: deletes ALL business data (preserves auth + logs)
-- ---------------------------------------------------------------------
create or replace function full_factory_reset()
returns void language plpgsql security definer as $$
begin
  truncate table website_orders, orders, transactions, ad_tracker, expenses,
    monthly_reports, yearly_reports, customers, _activity, _draft_data, _archive_data
    restart identity cascade;
  delete from inventory;
  insert into audit_log(action, details) values (''full_factory_reset'', jsonb_build_object(''ts'', now()));
end $$;

-- ---------------------------------------------------------------------
-- clear_financials_only
-- ---------------------------------------------------------------------
create or replace function clear_financials_only()
returns void language plpgsql security definer as $$
begin
  truncate table website_orders, orders, transactions, ad_tracker, expenses,
    monthly_reports, yearly_reports
    restart identity cascade;
  insert into audit_log(action, details) values (''clear_financials_only'', jsonb_build_object(''ts'', now()));
end $$;

-- ---------------------------------------------------------------------
-- clear_inventory_only
-- ---------------------------------------------------------------------
create or replace function clear_inventory_only()
returns void language plpgsql security definer as $$
begin
  truncate table inventory restart identity cascade;
  insert into audit_log(action, details) values (''clear_inventory_only'', jsonb_build_object(''ts'', now()));
end $$;

-- ---------------------------------------------------------------------
-- atomic_adjust_stock: race-condition-safe stock update
-- Returns false if not enough stock for sale.
-- ---------------------------------------------------------------------
create or replace function atomic_adjust_stock(
  p_product text, p_size text, p_delta integer, p_kind text
)
returns boolean language plpgsql security definer as $$
declare
  v_stk_col text; v_sold_col text;
  v_cur integer;
begin
  v_stk_col  := case p_size when ''S'' then ''stk_s'' when ''M'' then ''stk_m''
                              when ''L'' then ''stk_l'' when ''XL'' then ''stk_xl''
                              when ''XXL'' then ''stk_xxl'' when ''3XL'' then ''stk_3xl'' end;
  v_sold_col := replace(v_stk_col, ''stk_'', ''sold_'');
  if v_stk_col is null then raise exception ''Unknown size: %'', p_size; end if;

  execute format(''select %I from inventory where product = $1 for update'', v_stk_col)
    into v_cur using p_product;

  if p_kind = ''sale'' and v_cur < p_delta then return false; end if;

  execute format(''update inventory set %I = %I - $1, %I = %I + $1, updated_at = now() where product = $2'',
    v_stk_col, v_stk_col, v_sold_col, v_sold_col)
    using p_delta, p_product;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- update_customer_ltv: refresh customer aggregates from orders
-- ---------------------------------------------------------------------
create or replace function update_customer_ltv()
returns void language sql security definer as $$
  insert into customers (phone, name, total_orders, total_spent, first_order_at, last_order_at)
  select phone, max(name), count(*), coalesce(sum(total),0), min(first_order_at), max(last_order_at)
  from customer_ltv_view
  group by phone
  on conflict (phone) do update set
    name = excluded.name,
    total_orders = excluded.total_orders,
    total_spent = excluded.total_spent,
    first_order_at = excluded.first_order_at,
    last_order_at = excluded.last_order_at,
    updated_at = now();
$$;

-- =====================================================================
-- admin_users seed (create your admin here)
-- =====================================================================
create table if not exists admin_users (
  id              bigserial primary key,
  username        text unique not null,
  password_hash   text not null,    -- bcrypt-style; use crypt() to set
  is_active       boolean default true,
  created_at      timestamptz default now(),
  last_login_at   timestamptz
);

-- Seed: username=maruf_ix, password=Hassan__00
-- (Default password; CHANGE IMMEDIATELY after first login)
insert into admin_users (username, password_hash)
values (''maruf_ix'', crypt(''Hassan__00'', gen_salt(''bf'', 10)))
on conflict (username) do update set password_hash = excluded.password_hash;

-- =====================================================================
-- END rpc.sql
-- =====================================================================


-- =====================================================================
-- >>> seed_defaults.sql
-- =====================================================================

-- =====================================================================
-- YARZ Supabase Seed Defaults
-- Date: 2026-06-20
-- Populates: settings (defaults from _setupSettings), delivery_charges
-- =====================================================================

insert into settings (key, value, description) values
  (''Store Name'',          ''YARZ'',                                 ''sotorer nam''),
  (''Store Phone'',         '''',                                     ''phone number''),
  (''Store Email'',         '''',                                     ''email''),
  (''Store Address'',       '''',                                     ''thikana''),
  (''Currency Symbol'',     ''?'',                                    ''currency''),
  (''Link Facebook'',       ''https://www.facebook.com/Yarzbd'',      ''Footer/contact social link''),
  (''Link Instagram'',      ''https://www.instagram.com/yarz_bd'',    ''Footer/contact social link''),
  (''Link WhatsApp'',       ''https://wa.me/8801601743670'',          ''Footer/contact social link''),
  (''Link Messenger'',      ''https://m.me/Yarzbd'',                  ''Footer/contact social link + floating chat''),
  (''Link TikTok'',         ''https://tiktok.com/@yarzbd'',           ''Footer/contact social link''),
  (''Link YouTube'',        '''',                                     ''Optional footer/contact social link''),
  (''Custom Categories'',   ''Shirt,T-Shirt,Polo,Formal,Casual,Panjabi,Kurta,Pant,Formal Pant,Jeans,Chinos,Cargo Pant,Trouser,Hoodie,Sweater,Jacket,Blazer,Coat,Waistcoat,Tracksuit,Shorts,Three Quarter,Shoes,Sneakers,Sandals,Belt,Cap,Hat,Watch,Wallet,Sunglasses,Accessories,Other'', ''comma-separated''),
  (''Custom Fabrics'',      ''Oxford Cotton,Poplin Cotton,Premium Cotton,Cotton,China Fabric,Twill Cotton,Linen,Silk,Denim,Polyester,Rayon,Viscose,Chiffon,Georgette,Khadi,Jersey,Fleece,Wool,Corduroy,Satin,Velvet,Nylon,Spandex,Mixed,Other'', ''comma-separated''),
  (''Custom Badges'',       '',New Arrival,Hot Sale,Best Seller,Limited Edition,Trending,Premium,Sold Out Soon'', ''comma-separated''),
  (''GitHub Token'',        '''',                                     ''GitHub sync''),
  (''GitHub Repo'',         '''',                                     ''GitHub sync''),
  (''GitHub Branch'',       ''main'',                                 ''GitHub sync''),
  (''GitHub Path'',         ''data.json'',                            ''GitHub sync'')
on conflict (key) do nothing;

insert into delivery_charges (id, name, charge, active, sort_order) values
  (''inside_narayanganj'',  ''Inside Narayanganj'',  70,  true, 1),
  (''outside_narayanganj'', ''Outside Narayanganj'', 140, true, 2)
on conflict (id) do nothing;

-- Mark the secret keys as secret so they do NOT leak via anon reads
update settings set is_secret = true where key in (''GitHub Token'',''Steadfast API Key'',''Steadfast Secret Key'');


-- =====================================================================
-- >>> fortress_steadfast_supplement.sql
-- =====================================================================

-- =====================================================================
-- YARZ Supabase Supplement Ã¢â‚¬â€ Fortress + Steadfast + Reports
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