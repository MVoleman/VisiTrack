-- =============================================================================
-- Snapshot paths that cannot be guessed, and a way to retire a leaked one
-- =============================================================================
--
-- 20260918140000 stopped anyone from minting a Supabase signed URL for a photo.
-- It could not do anything about links minted BEFORE it ran, and measurement
-- shows why: a storage signed URL is a JWT whose whole payload is
--
--   {"url":"snapshots/<path>","scope":"download","iat":...,"exp":...}
--
-- It names no user, and the download route resolves it as superuser, so no
-- policy, grant or account is consulted when it is redeemed. Nothing revokes it.
-- Two things follow, and this migration does both.
--
--   1. The path was derivable: YYYY/MM/<time_log_id>.jpg, and the id is printed
--      in the CSV export. Anyone who could sign a token could sign it for a
--      specific person's photo without ever seeing the storage listing. New
--      paths carry 128 bits of randomness, so the path is now a secret too.
--
--   2. Moving an object does invalidate an outstanding link (verified: the old
--      link then answers NoSuchKey) - but only while nothing occupies the old
--      path again. With a random component nothing legitimately can, so the
--      move becomes a real retirement. public.rekey_snapshot below is what
--      scripts/rekey-snapshots.mjs calls once the object has been moved.
--
-- Complete revocation of every outstanding link at once is still only possible
-- by rotating the project's JWT secret in the Supabase dashboard; see
-- supabase/README.md. This makes that a choice rather than the only option.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Where a new snapshot goes
-- -----------------------------------------------------------------------------

create function private.new_snapshot_path(p_time_log_id uuid, p_at timestamptz)
returns text
language sql
volatile
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY/MM/')
      || p_time_log_id::text || '-'
      || encode(extensions.gen_random_bytes(16), 'hex') || '.jpg';
$$;

comment on function private.new_snapshot_path(uuid, timestamptz) is
  'Storage path for a kiosk snapshot. The random half makes the path unguessable and means a retired path can never be reoccupied.';

revoke all on function private.new_snapshot_path(uuid, timestamptz) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 2. The scan RPC uses it
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

  v_path := private.new_snapshot_path(v_log_id, v_now);

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


-- -----------------------------------------------------------------------------
-- 3. Retiring a path
-- -----------------------------------------------------------------------------

/**
 * snapshot_path is immutable: the guard refuses to let a time log point at a
 * different photo, which is what makes the picture evidence. Retiring a leaked
 * path is the one legitimate exception, so it is allowed only while
 * public.rekey_snapshot holds the flag below - a flag nothing else sets, and
 * that no browser session could use anyway, since `authenticated` has no UPDATE
 * grant on the column.
 */
create or replace function private.time_logs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.occurred_at > now() + interval '5 minutes' then
      raise exception 'A time log cannot be in the future.' using errcode = '22023';
    end if;
    if new.voided_at is not null then
      raise exception 'A time log cannot be created already voided.' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.worker_id is distinct from old.worker_id
     or new.source is distinct from old.source
     or new.kiosk_user_id is distinct from old.kiosk_user_id
     or (new.snapshot_path is distinct from old.snapshot_path
         and coalesce(current_setting('visitrack.rekey_snapshot', true), '') <> 'on') then
    raise exception 'These time log fields cannot be changed.' using errcode = '42501';
  end if;

  if old.source = 'kiosk'
     and (new.event_type is distinct from old.event_type
          or new.occurred_at is distinct from old.occurred_at) then
    raise exception 'Kiosk records are immutable. Void the record and add a manual entry instead.'
      using errcode = '42501';
  end if;

  if new.occurred_at is distinct from old.occurred_at and new.occurred_at > now() + interval '5 minutes' then
    raise exception 'A time log cannot be in the future.' using errcode = '22023';
  end if;

  if new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason then
    if old.voided_at is not null then
      raise exception 'A voided time log cannot be changed back.' using errcode = '42501';
    end if;
    -- The server decides who voided the record and when.
    new.voided_at := now();
    new.voided_by := auth.uid();
  end if;

  if (new.event_type, new.occurred_at, new.note, new.voided_at)
     is distinct from (old.event_type, old.occurred_at, old.note, old.voided_at) then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;


/**
 * Points a time log at the path its photo was just moved to.
 *
 * Called by scripts/rekey-snapshots.mjs with the secret key, after the storage
 * object has been moved, and only for a log whose photo is still there. The new
 * path must carry the random component - a caller cannot hand back a derivable
 * path and call it retired.
 */
create function public.rekey_snapshot(p_time_log_id uuid, p_new_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
begin
  if p_new_path !~ '^[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{32}\.jpg$' then
    raise exception 'A retired snapshot path must carry a random component.' using errcode = '22023';
  end if;

  select t.snapshot_path into v_old
  from public.time_logs t
  where t.id = p_time_log_id
    and t.snapshot_purged_at is null;

  if v_old is null then
    raise exception 'No snapshot to move for this time log.' using errcode = 'P0002';
  end if;

  perform set_config('visitrack.rekey_snapshot', 'on', true);
  update public.time_logs set snapshot_path = p_new_path where id = p_time_log_id;
  perform set_config('visitrack.rekey_snapshot', 'off', true);

  return v_old;
end;
$$;

comment on function public.rekey_snapshot(uuid, text) is
  'Service role only. Retires a snapshot path after the object has been moved, so an outstanding signed URL for the old path can never be redeemed again.';

revoke all on function public.rekey_snapshot(uuid, text) from public, anon, authenticated;
grant execute on function public.rekey_snapshot(uuid, text) to service_role;
