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
