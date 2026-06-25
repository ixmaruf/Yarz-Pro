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
-- pg_cron jobs (optional Ã¢â‚¬â€ set up after first deploy if available)
-- =====================================================================
-- Run at 1 AM Bangladesh time every day: cleanupOldOrders equivalent
-- (Remove comments + install via Supabase dashboard or psql if pg_cron enabled)
-- select cron.schedule('cleanup-old-orders', '0 1 * * *',
--   $$delete from website_orders where date < now() - interval '90 days'$$);
-- select cron.schedule('cleanup-expired-sessions', '0 2 * * *',
--   $$delete from admin_sessions where expires_at < now()$$);
-- select cron.schedule('refresh-customer-ltv', '0 3 * * *',
--   $$select update_customer_ltv()$$);

-- =====================================================================
-- END supplement.sql
-- =====================================================================
