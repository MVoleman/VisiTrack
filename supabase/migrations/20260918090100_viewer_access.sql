-- =============================================================================
-- Viewer access + QR tokens moved to their own table
-- =============================================================================
--
-- Roles after this migration:
--   admin  — everything (staff, QR codes, logs, snapshots, settings).
--   viewer — read-only: presence, staff, time logs, snapshots, CSV export.
--            Cannot see QR tokens, change anything, or void records.
--   kiosk  — unchanged: registers scans, reads nothing.
--
-- Why a separate badge table: a QR token is effectively a key that checks a
-- person in. Postgres grants and RLS work per row, not per column, so the only
-- way to let viewers read staff without reading tokens is to keep tokens in a
-- table of their own with admin-only policies.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Role helpers
-- -----------------------------------------------------------------------------

-- Admins and viewers may read; everyone else may not.
create function private.can_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_users u
    where u.user_id = (select auth.uid())
      and u.role in ('admin', 'viewer')
  );
$$;

revoke all on function private.can_read() from public, anon, authenticated;
grant execute on function private.can_read() to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Badge tokens move out of public.workers
-- -----------------------------------------------------------------------------

create table public.worker_badges (
  worker_id uuid primary key references public.workers (id) on delete cascade,
  token text not null unique default private.generate_qr_token(),
  rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.worker_badges is 'QR badge secrets. Admin-only; never exposed to viewers or kiosks.';

insert into public.worker_badges (worker_id, token, rotated_at, created_at)
select id, qr_token, qr_token_rotated_at, created_at
from public.workers;

alter table public.workers
  drop column qr_token,
  drop column qr_token_rotated_at;

-- Every worker gets a badge automatically, including ones created by the API.
create function private.workers_create_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.worker_badges (worker_id)
  values (new.id)
  on conflict (worker_id) do nothing;
  return new;
end;
$$;

create trigger workers_create_badge
  after insert on public.workers
  for each row execute function private.workers_create_badge();

alter table public.worker_badges enable row level security;

revoke all on public.worker_badges from anon, authenticated;
-- Read-only through the API: tokens are created by the trigger and replaced by
-- rotate_worker_qr_token(), never written directly.
grant select on public.worker_badges to authenticated;
grant select, insert, update, delete on public.worker_badges to service_role;

create policy "Admins read badges"
  on public.worker_badges for select to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 3. Read policies now accept viewers
-- -----------------------------------------------------------------------------

drop policy "Admins read workers" on public.workers;
create policy "Admins and viewers read workers"
  on public.workers for select to authenticated
  using ((select private.can_read()));

drop policy "Admins read time logs" on public.time_logs;
create policy "Admins and viewers read time logs"
  on public.time_logs for select to authenticated
  using ((select private.can_read()));

drop policy "Admins read settings" on public.app_settings;
create policy "Admins and viewers read settings"
  on public.app_settings for select to authenticated
  using ((select private.can_read()));

-- Snapshots: viewers may look at the photo evidence, but still cannot upload,
-- overwrite or delete anything.
drop policy "Admins read snapshots" on storage.objects;
create policy "Admins and viewers read snapshots"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snapshots'
    and (select private.can_read())
  );

-- Write policies are unchanged and remain admin-only:
--   workers insert/update/delete, time_logs insert/update, app_settings update.


-- -----------------------------------------------------------------------------
-- 4. Functions that used workers.qr_token
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
begin
  if not private.has_role('kiosk') then
    raise exception 'Only kiosk accounts can register scans.' using errcode = '42501';
  end if;

  select s.* into v_settings from public.app_settings s where s.id;

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

  return query select 'ok'::text, v_log_id, v_event, v_now,
    v_worker.full_name, v_worker.company, v_path;
end;
$$;


create or replace function public.rotate_worker_qr_token(p_worker_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not private.has_role('admin') then
    raise exception 'Only admins can rotate QR codes.' using errcode = '42501';
  end if;

  update public.worker_badges b
  set token = private.generate_qr_token(),
      rotated_at = now()
  where b.worker_id = p_worker_id
  returning b.token into v_token;

  if v_token is null then
    raise exception 'Worker not found.' using errcode = 'P0002';
  end if;

  return v_token;
end;
$$;
