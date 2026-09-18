-- =============================================================================
-- The allowed networks become admin-only, and the purge stops lying
-- =============================================================================
--
-- Two findings from the review of 20260918180000/190000.
--
--   1. 20260918180000 moved the kiosk's source address into its own table
--      because row level security filters rows and not columns - and then left
--      app_settings.kiosk_ip_allowlist where it was. Viewers read app_settings,
--      so the school's own network ranges were still one query away. Same rule,
--      same answer: the allowlist gets its own admin-only table.
--
--   2. snapshots_due_for_purge() picked up rows whose photo was never uploaded.
--      The job then marked them "snapshot purged", and the admin UI told anyone
--      asking that the photo had been deleted under the retention policy - about
--      a photo that never existed. Wrong answer to a question about personal
--      data, and it hid a kiosk that was failing to upload.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Allowed networks, admin-readable only
-- -----------------------------------------------------------------------------

create table public.kiosk_network_allowlist (
  net cidr primary key,
  note text,
  added_at timestamptz not null default now()
);

comment on table public.kiosk_network_allowlist is
  'Networks a kiosk may register scans from. Empty table = scans accepted from anywhere (the address is still recorded). Admin-readable; written from the SQL editor.';

alter table public.kiosk_network_allowlist enable row level security;

revoke all on public.kiosk_network_allowlist from anon, authenticated;
grant select on public.kiosk_network_allowlist to authenticated;
grant select, insert, delete on public.kiosk_network_allowlist to service_role;

create policy "Admins read the network allowlist"
  on public.kiosk_network_allowlist for select to authenticated
  using ((select private.is_admin()));

insert into public.kiosk_network_allowlist (net)
select distinct unnest(array_remove(s.kiosk_ip_allowlist, null))
from public.app_settings s
on conflict (net) do nothing;

alter table public.app_settings drop column kiosk_ip_allowlist;


-- -----------------------------------------------------------------------------
-- 2. The scan RPC reads the table
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
  v_allowlist cidr[];
begin
  if not private.has_role('kiosk') then
    raise exception 'Only kiosk accounts can register scans.' using errcode = '42501';
  end if;

  select s.* into v_settings from public.app_settings s where s.id;

  -- Network binding. An empty allowlist means "record only, accept anywhere":
  -- array_agg over no rows is NULL, which private.ip_allowed reads as "allowed".
  select array_agg(a.net) into v_allowlist from public.kiosk_network_allowlist a;

  if not private.ip_allowed(v_ip, v_allowlist) then
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
-- 3. Only a photo that exists can be purged
-- -----------------------------------------------------------------------------

create or replace function public.snapshots_due_for_purge(p_limit integer default 500)
returns table (time_log_id uuid, snapshot_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.snapshot_path
  from public.time_logs t
  cross join public.app_settings s
  where t.snapshot_path is not null
    -- A reserved path whose upload never happened has nothing to delete, and
    -- marking it purged would claim a photo was deleted that never existed.
    and t.snapshot_uploaded_at is not null
    and t.snapshot_purged_at is null
    and t.occurred_at < now() - make_interval(days => s.snapshot_retention_days)
  order by t.occurred_at
  limit least(greatest(p_limit, 1), 1000);
$$;
