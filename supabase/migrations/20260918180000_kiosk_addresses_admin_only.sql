-- =============================================================================
-- The kiosk's source address becomes admin-only
-- =============================================================================
--
-- 20260918140000 added time_logs.kiosk_ip. The admin UI shows it only to admins,
-- but that is presentation: row level security filters rows, never columns, so a
-- viewer (rektor, samordnare) could read the address two ways -
--
--   * straight off the Data API: /rest/v1/time_logs?select=id,kiosk_ip
--   * through the realtime channel the presence view subscribes to, which
--     publishes every column of time_logs and delivered kiosk_ip in the payload
--
-- Same reasoning as 20260918090100, which moved QR tokens into worker_badges:
-- when a column must be narrower than the row, it belongs in its own table.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The address moves to a table only admins can read
-- -----------------------------------------------------------------------------

create table public.kiosk_scan_sources (
  time_log_id uuid primary key references public.time_logs (id) on delete cascade,
  kiosk_ip inet not null
);

comment on table public.kiosk_scan_sources is
  'Source address of the kiosk that registered each scan, for audit. A row exists only when the address was known. Admin-readable; written by public.kiosk_register_scan.';

alter table public.kiosk_scan_sources enable row level security;

revoke all on public.kiosk_scan_sources from anon, authenticated;
grant select on public.kiosk_scan_sources to authenticated;
grant select, insert, delete on public.kiosk_scan_sources to service_role;

create policy "Admins read scan sources"
  on public.kiosk_scan_sources for select to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 2. Carry the addresses over, then take the column away
-- -----------------------------------------------------------------------------

insert into public.kiosk_scan_sources (time_log_id, kiosk_ip)
select t.id, t.kiosk_ip
from public.time_logs t
where t.kiosk_ip is not null
on conflict (time_log_id) do nothing;

alter table public.time_logs drop column kiosk_ip;


-- -----------------------------------------------------------------------------
-- 3. kiosk_register_scan writes the address beside the log instead of in it
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
    client_captured_at, snapshot_path, created_by
  )
  values (
    v_log_id, v_worker.id, v_event, v_now, 'kiosk', v_uid,
    p_client_captured_at, v_path, v_uid
  );

  -- Same transaction as the log: a scan and where it came from cannot drift apart.
  if v_ip is not null then
    insert into public.kiosk_scan_sources (time_log_id, kiosk_ip) values (v_log_id, v_ip);
  end if;

  return query select 'ok'::text, v_log_id, v_event, v_now,
    v_worker.full_name, v_worker.company, v_path;
end;
$$;
