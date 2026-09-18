-- =============================================================================
-- Security hardening: snapshot access and kiosk network binding
-- =============================================================================
--
-- Two findings from the security audit:
--
--   1. Any signed-in reader could mint a signed URL for a snapshot with an
--      arbitrary expiry (verified: a viewer produced a one-year public link and
--      fetched it anonymously). Photos of staff could therefore leave the system
--      permanently, outside the retention policy and with no trace.
--      Fix: no role may read storage objects any more. The application streams
--      images through a server route using the secret key, after checking the
--      caller's role and that the row is visible under their own RLS policies.
--
--   2. A kiosk session lifted off the entrance tablet works from anywhere, so a
--      stolen token plus a photographed QR code can register attendance remotely
--      with any uploaded image.
--      Fix: every kiosk scan records the caller's source IP, and an optional
--      allowlist restricts scans to the school's own network.
--
-- The allowlist is deliberately EMPTY by default: recording comes first, so an
-- administrator can see the real addresses before switching enforcement on. A
-- wrong guess must never lock the entrance.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Snapshots: readable only by the server
-- -----------------------------------------------------------------------------

drop policy if exists "Admins and viewers read snapshots" on storage.objects;

-- After this there is no SELECT policy on storage.objects for authenticated
-- roles at all: snapshots are served by the app through /admin/snapshots using
-- the secret key, so a signed URL never reaches a browser.
--
-- The kiosk upload policy stays as it is: a kiosk may still create (never read,
-- overwrite or delete) the one file belonging to its own fresh scan.
-- (storage.objects is owned by supabase_storage_admin, so it takes no COMMENT
-- from a migration.)


-- -----------------------------------------------------------------------------
-- 2. Kiosk network binding
-- -----------------------------------------------------------------------------

alter table public.time_logs
  add column if not exists kiosk_ip inet;

comment on column public.time_logs.kiosk_ip is
  'Source address of the kiosk that registered the scan, for audit. Personal data: retained with the time log.';

alter table public.app_settings
  add column if not exists kiosk_ip_allowlist cidr[] not null default '{}';

comment on column public.app_settings.kiosk_ip_allowlist is
  'Empty = scans accepted from anywhere (addresses are still recorded). Non-empty = only these networks may register scans. Set from the SQL editor, e.g. ''{203.0.113.4/32,192.0.2.0/24}''.';


/**
 * Best-effort source address of the current request.
 *
 * A client can set its own X-Forwarded-For, and the proxy appends the real
 * address, so the LAST entry is the trustworthy one — never the first.
 * Returns null when the address cannot be determined; callers must decide what
 * that means rather than assuming it is safe.
 */
create function private.request_ip()
returns inet
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_candidate text;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  if v_headers is null then
    return null;
  end if;

  -- Last hop of x-forwarded-for, falling back to x-real-ip.
  v_candidate := btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',',
    array_length(string_to_array(coalesce(v_headers ->> 'x-forwarded-for', ''), ','), 1)));

  if v_candidate is null or v_candidate = '' then
    v_candidate := btrim(coalesce(v_headers ->> 'x-real-ip', ''));
  end if;

  if v_candidate = '' then
    return null;
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
-- 3. kiosk_register_scan: record the address, honour the allowlist
-- -----------------------------------------------------------------------------
-- New status value: 'blocked_network' — the kiosk is outside the allowed
-- networks. Nothing is recorded, and the kiosk shows a clear message.

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
  if array_length(v_settings.kiosk_ip_allowlist, 1) is not null
     and (v_ip is null or not (v_ip <<= any (v_settings.kiosk_ip_allowlist))) then
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

comment on function public.kiosk_register_scan(text, timestamptz) is
  'Kiosk only. Resolves a QR token, decides check-in/out, records the event and the kiosk source address. Refuses scans from outside app_settings.kiosk_ip_allowlist when that list is non-empty.';
