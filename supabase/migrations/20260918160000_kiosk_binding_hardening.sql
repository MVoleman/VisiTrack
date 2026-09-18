-- =============================================================================
-- Hardening of the kiosk network binding
-- =============================================================================
--
-- An adversarial review of 20260918140000 found four defects, each reproduced
-- against a live database:
--
--   1. request_ip() cast the last forwarded hop straight to inet, so a value
--      with a port ("10.0.0.1:53422"), a bracketed IPv6 ("[2001:db8::2]:443")
--      or any junk became NULL. With enforcement on, NULL means refused - so a
--      proxy that appends a port would have blocked every scan at the entrance.
--
--   2. The x-real-ip fallback was trusted. X-Forwarded-For is only trustworthy
--      because the proxy appends the real address after whatever the client
--      sent; X-Real-IP carries no such guarantee, so a client that omits
--      X-Forwarded-For entirely could have named its own address.
--
--   3. An IPv4-mapped IPv6 address (::ffff:192.0.2.5) never matched an IPv4
--      network, and a NULL element anywhere in the allowlist made the whole
--      comparison NULL - which reads as "allowed" while the UI shows the list
--      as active.
--
--   4. A refused scan wrote nothing anywhere, so the one attack this feature
--      exists to detect left no trace at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A refused scan is now recorded
-- -----------------------------------------------------------------------------

create table public.kiosk_scan_denials (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  kiosk_user_id uuid references public.app_users (user_id) on delete set null,
  kiosk_ip inet,
  reason text not null
);

comment on table public.kiosk_scan_denials is
  'Scans refused because the kiosk was outside app_settings.kiosk_ip_allowlist. Evidence that a kiosk session is being used from somewhere it should not be.';

create index kiosk_scan_denials_time_idx on public.kiosk_scan_denials (occurred_at desc);

alter table public.kiosk_scan_denials enable row level security;

revoke all on public.kiosk_scan_denials from anon, authenticated;
grant select on public.kiosk_scan_denials to authenticated;
grant select, insert, delete on public.kiosk_scan_denials to service_role;

-- Written only by the security-definer RPC; readable by admins.
create policy "Admins read denied scans"
  on public.kiosk_scan_denials for select to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 2. A source address that survives real proxies
-- -----------------------------------------------------------------------------

create or replace function private.request_ip()
returns inet
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_forwarded text;
  v_candidate text;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if v_headers is null then
    return null;
  end if;

  -- Only X-Forwarded-For is trusted, and only its LAST entry: a client can put
  -- anything in the header, but the proxy appends the address it actually saw.
  -- X-Real-IP is deliberately NOT used as a fallback - it is a single value
  -- with no appending guarantee, so a client that omits X-Forwarded-For could
  -- otherwise name its own address.
  v_forwarded := coalesce(v_headers ->> 'x-forwarded-for', '');
  if btrim(v_forwarded) = '' then
    return null;
  end if;

  v_candidate := btrim(split_part(v_forwarded, ',', array_length(string_to_array(v_forwarded, ','), 1)));

  -- Strip a port, keeping bracketed IPv6 intact: "[2001:db8::2]:443", "10.0.0.1:53422".
  if v_candidate like '[%' then
    v_candidate := split_part(substring(v_candidate from 2), ']', 1);
  elsif v_candidate ~ '^[0-9.]+:[0-9]+$' then
    v_candidate := split_part(v_candidate, ':', 1);
  end if;

  -- An IPv4-mapped IPv6 address must compare as the IPv4 address it represents.
  if v_candidate ~* '^::ffff:[0-9.]+$' then
    v_candidate := substring(v_candidate from 8);
  end if;

  begin
    return v_candidate::inet;
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function private.request_ip() from public, anon, authenticated;
grant execute on function private.request_ip() to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Allowlist comparison that cannot silently pass
-- -----------------------------------------------------------------------------

/**
 * True when the address is inside one of the allowed networks.
 *
 * NULL-safe on purpose: a NULL element used to make `<<= any(...)` evaluate to
 * NULL, which reads as "not blocked" and quietly disabled enforcement while the
 * settings page still listed the networks as active.
 */
create function private.ip_allowed(p_ip inet, p_allowlist cidr[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  with normalised as (
    -- An IPv4-mapped IPv6 address compares as the IPv4 address it represents.
    select case
      when p_ip is not null and family(p_ip) = 6 and host(p_ip) like '::ffff:%'
        then (substring(host(p_ip) from 8))::inet
      else p_ip
    end as ip
  )
  select case
    when p_allowlist is null or array_length(array_remove(p_allowlist, null), 1) is null then true
    when (select ip from normalised) is null then false
    else coalesce(
      (select bool_or((select ip from normalised) <<= net) from unnest(array_remove(p_allowlist, null)) as net),
      false)
  end;
$$;

revoke all on function private.ip_allowed(inet, cidr[]) from public, anon, authenticated;
grant execute on function private.ip_allowed(inet, cidr[]) to authenticated;


-- -----------------------------------------------------------------------------
-- 4. kiosk_register_scan: use them, and leave a trace when refusing
-- -----------------------------------------------------------------------------

create or replace function public.kiosk_register_scan(
  p_token text,
  p_client_captured_at timestamptz default null
)
returns table (
  status text,
  time_log_id uuid,
  event_type public.time_log_event,
  occurred_at timestamptz,
  worker_name text,
  worker_company text,
  snapshot_path text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_settings public.app_settings;
  v_worker public.workers;
  v_last public.time_logs;
  v_event public.time_log_event;
  v_log_id uuid := gen_random_uuid();
  v_path text;
  v_ip inet := private.request_ip();
begin
  if not private.has_role('kiosk') then
    raise exception 'Only kiosk accounts can register scans.' using errcode = '42501';
  end if;

  select s.* into v_settings from public.app_settings s where s.id;

  -- Network binding. An empty allowlist means "record only, accept anywhere".
  if not private.ip_allowed(v_ip, v_settings.kiosk_ip_allowlist) then
    insert into public.kiosk_scan_denials (kiosk_user_id, kiosk_ip, reason)
    values (v_uid, v_ip, case when v_ip is null then 'unknown_source_address' else 'outside_allowlist' end);

    return query select 'blocked_network'::text, null::uuid, null::public.time_log_event,
      null::timestamptz, null::text, null::text, null::text;
    return;
  end if;

  select w.* into v_worker
  from public.workers w
  join public.worker_badges b on b.worker_id = w.id
  where b.token = p_token;

  if not found then
    return query select 'invalid_token'::text, null::uuid, null::public.time_log_event,
      null::timestamptz, null::text, null::text, null::text;
    return;
  end if;

  if not v_worker.is_active then
    return query select 'inactive_worker'::text, null::uuid, null::public.time_log_event,
      null::timestamptz, v_worker.full_name, v_worker.company, null::text;
    return;
  end if;

  -- Serialise scans per worker so two kiosks can't create conflicting events.
  perform pg_advisory_xact_lock(hashtextextended(v_worker.id::text, 0));

  select t.* into v_last
  from public.time_logs t
  where t.worker_id = v_worker.id
    and t.voided_at is null
  order by t.occurred_at desc
  limit 1;

  if found and v_last.occurred_at > v_now - make_interval(secs => v_settings.duplicate_scan_seconds) then
    return query select 'duplicate'::text, v_last.id, v_last.event_type, v_last.occurred_at,
      v_worker.full_name, v_worker.company, null::text;
    return;
  end if;

  if found
     and v_last.event_type = 'check_in'
     and v_last.occurred_at > v_now - make_interval(hours => v_settings.presence_window_hours) then
    v_event := 'check_out';
  else
    v_event := 'check_in';
  end if;

  v_path := to_char(v_now at time zone 'UTC', 'YYYY/MM/') || v_log_id::text || '.jpg';

  insert into public.time_logs (
    id, worker_id, event_type, occurred_at, source, kiosk_user_id,
    client_captured_at, snapshot_path, created_by, kiosk_ip
  )
  values (
    v_log_id, v_worker.id, v_event, v_now, 'kiosk', v_uid,
    p_client_captured_at, v_path, v_uid, v_ip
  );

  return query select 'ok'::text, v_log_id, v_event, v_now,
    v_worker.full_name, v_worker.company, v_path;
end;
$$;
