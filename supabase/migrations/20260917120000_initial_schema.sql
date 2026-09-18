-- =============================================================================
-- VisiTrack — initial database schema
-- =============================================================================
--
-- Run once on a fresh Supabase project (EU region), either with
-- `supabase db push` or by pasting this file into Dashboard → SQL Editor.
-- Post-install steps (admin + kiosk accounts, auth settings) are described in
-- supabase/README.md.
--
-- Security model
-- --------------
--   * Every authenticated account has exactly one role in public.app_users:
--       admin — manages workers, reads logs and snapshots.
--       kiosk — an unattended entrance device. It can NOT read any table. It
--               may only call kiosk_register_scan() / kiosk_confirm_snapshot()
--               and upload the one snapshot belonging to its own fresh scan.
--   * Accounts without a role (and anonymous visitors) can do nothing.
--   * Check-in vs. check-out is decided by the database, and the timestamp is
--     the database clock — a kiosk cannot backdate or pick the event type.
--   * Kiosk records are immutable. Admins correct mistakes by voiding a record
--     (with a reason) and adding a manual entry, so the audit trail is kept.
--   * Snapshots live in a private bucket, are viewed through short-lived signed
--     URLs, and are purged after app_settings.snapshot_retention_days (GDPR).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Extensions and schemas
-- -----------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

-- Helper functions live in a schema that is NOT exposed through the Data API,
-- so they can be used by RLS policies without being callable as RPCs.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 1. Types
-- -----------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'kiosk');
create type public.time_log_event as enum ('check_in', 'check_out');
create type public.time_log_source as enum ('kiosk', 'admin');


-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- Single-row settings table (the primary key can only ever be `true`).
create table public.app_settings (
  id boolean primary key default true check (id),
  time_zone text not null default 'Europe/Stockholm',
  -- A check-in older than this no longer counts as "in the building"
  -- (covers forgotten check-outs); the next scan starts a new check-in.
  presence_window_hours integer not null default 16
    check (presence_window_hours between 1 and 72),
  -- Repeat scans of the same badge within this window are ignored, so holding
  -- a badge in front of the camera never checks someone in and straight out.
  duplicate_scan_seconds integer not null default 60
    check (duplicate_scan_seconds between 0 and 600),
  snapshot_retention_days integer not null default 90
    check (snapshot_retention_days between 1 and 365),
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is 'Singleton row with tunable attendance and retention rules.';

insert into public.app_settings default values;


-- Role assignment for Supabase Auth users (credentials themselves are managed
-- by Supabase Auth). Rows are created with private.assign_role() from the SQL editor.
create table public.app_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now()
);

comment on table public.app_users is 'Maps each Supabase Auth user to an application role (admin or kiosk device).';


-- 192 bits of randomness, URL-safe, with a version prefix so the kiosk can
-- ignore unrelated QR codes without a database round trip.
create function private.generate_qr_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select 'vt1_' || translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
$$;


create table public.workers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  company text not null check (char_length(btrim(company)) between 1 and 120),
  role text not null check (char_length(btrim(role)) between 1 and 80),
  -- Optional; reserved for emailing QR codes in a later version.
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  is_active boolean not null default true,
  -- Opaque badge secret encoded in the QR code. Never the worker id, so a lost
  -- badge can be revoked with rotate_worker_qr_token().
  qr_token text not null unique default private.generate_qr_token(),
  qr_token_rotated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.workers is 'External staff who check in and out at the kiosk.';
comment on column public.workers.role is 'Job role, e.g. "Städ" or "Elektriker" (not an application role).';

create index workers_active_name_idx on public.workers (is_active, full_name);


create table public.time_logs (
  id uuid primary key default gen_random_uuid(),
  -- Restrict: time records are billing evidence and must not vanish with a worker.
  worker_id uuid not null references public.workers (id) on delete restrict,
  event_type public.time_log_event not null,
  occurred_at timestamptz not null default now(),
  source public.time_log_source not null default 'admin',
  kiosk_user_id uuid references public.app_users (user_id) on delete set null,
  -- Kiosk device clock at the moment of capture (diagnostics only; the
  -- authoritative time is occurred_at, set by the database).
  client_captured_at timestamptz,

  -- Snapshot lifecycle: path reserved at scan → uploaded → purged.
  snapshot_path text unique,
  snapshot_uploaded_at timestamptz,
  snapshot_purged_at timestamptz,

  note text check (note is null or char_length(note) <= 500),

  voided_at timestamptz,
  voided_by uuid references auth.users (id) on delete set null,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),

  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint time_logs_void_consistent check ((voided_at is null) = (void_reason is null)),
  constraint time_logs_snapshot_consistent check (
    (snapshot_uploaded_at is null or snapshot_path is not null)
    and (snapshot_purged_at is null or snapshot_path is not null)
  )
);

comment on table public.time_logs is 'Append-only check-in/check-out events. Void instead of delete.';

create index time_logs_worker_time_idx on public.time_logs (worker_id, occurred_at desc);
create index time_logs_time_idx on public.time_logs (occurred_at desc);
create index time_logs_snapshot_purge_idx on public.time_logs (occurred_at)
  where snapshot_path is not null and snapshot_purged_at is null;


-- -----------------------------------------------------------------------------
-- 3. Role helpers (used by RLS policies and RPCs)
-- -----------------------------------------------------------------------------

create function private.has_role(p_role public.app_role)
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
      and u.role = p_role
  );
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('admin');
$$;


-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workers_touch_updated_at
  before update on public.workers
  for each row execute function private.touch_updated_at();

create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function private.touch_updated_at();


-- Guards the audit trail of time_logs.
create function private.time_logs_guard()
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
     or new.snapshot_path is distinct from old.snapshot_path then
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

create trigger time_logs_guard
  before insert or update on public.time_logs
  for each row execute function private.time_logs_guard();


-- -----------------------------------------------------------------------------
-- 5. Views (security_invoker: the caller's RLS applies, i.e. admins only)
-- -----------------------------------------------------------------------------

-- Who is in the building right now: workers whose latest valid event is a
-- check-in inside the presence window.
create view public.current_presence
with (security_invoker = true)
as
select
  w.id as worker_id,
  w.full_name,
  w.company,
  w.role,
  l.id as time_log_id,
  l.occurred_at as checked_in_at,
  l.snapshot_path,
  l.snapshot_uploaded_at,
  l.snapshot_purged_at
from public.workers w
cross join public.app_settings s
cross join lateral (
  select t.*
  from public.time_logs t
  where t.worker_id = w.id
    and t.voided_at is null
  order by t.occurred_at desc
  limit 1
) l
where l.event_type = 'check_in'
  and l.occurred_at > now() - make_interval(hours => s.presence_window_hours);

comment on view public.current_presence is 'Workers currently checked in (latest non-voided event is a recent check-in).';


-- Check-ins paired with the check-out that directly follows them. A check-in
-- without a matching check-out (forgotten) has null check_out_* and duration.
create view public.work_sessions
with (security_invoker = true)
as
with events as (
  select
    t.id,
    t.worker_id,
    t.event_type,
    t.occurred_at,
    lead(t.id) over w as next_id,
    lead(t.event_type) over w as next_event,
    lead(t.occurred_at) over w as next_at
  from public.time_logs t
  where t.voided_at is null
  window w as (partition by t.worker_id order by t.occurred_at)
)
select
  e.id as check_in_log_id,
  e.worker_id,
  e.occurred_at as check_in_at,
  case when e.next_event = 'check_out' then e.next_id end as check_out_log_id,
  case when e.next_event = 'check_out' then e.next_at end as check_out_at,
  case when e.next_event = 'check_out' then e.next_at - e.occurred_at end as duration
from events e
where e.event_type = 'check_in';

comment on view public.work_sessions is 'Check-in/check-out pairs with duration, used for reports and CSV export.';


-- -----------------------------------------------------------------------------
-- 6. Row Level Security and privileges
-- -----------------------------------------------------------------------------

alter table public.app_settings enable row level security;
alter table public.app_users enable row level security;
alter table public.workers enable row level security;
alter table public.time_logs enable row level security;

-- Start from zero, then grant only what the app needs. Column-level grants
-- stop the API from touching server-managed columns (tokens, audit fields).
revoke all on public.app_settings, public.app_users, public.workers, public.time_logs
  from anon, authenticated;
revoke all on public.current_presence, public.work_sessions from anon, authenticated;

grant select on public.app_settings to authenticated;
grant update (time_zone, presence_window_hours, duplicate_scan_seconds, snapshot_retention_days)
  on public.app_settings to authenticated;

grant select on public.app_users to authenticated;

grant select, delete on public.workers to authenticated;
grant insert (full_name, company, role, email, is_active) on public.workers to authenticated;
grant update (full_name, company, role, email, is_active) on public.workers to authenticated;

grant select on public.time_logs to authenticated;
grant insert (worker_id, event_type, occurred_at, note) on public.time_logs to authenticated;
grant update (event_type, occurred_at, note, voided_at, void_reason) on public.time_logs to authenticated;

grant select on public.current_presence, public.work_sessions to authenticated;

-- Server-side tooling using the secret key (seed scripts, scheduled jobs).
-- Newer Supabase projects no longer grant this by default. service_role bypasses RLS.
grant select, insert, update, delete
  on public.app_settings, public.app_users, public.workers, public.time_logs
  to service_role;
grant select on public.current_presence, public.work_sessions to service_role;

-- app_settings
create policy "Admins read settings"
  on public.app_settings for select to authenticated
  using ((select private.is_admin()));

create policy "Admins update settings"
  on public.app_settings for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- app_users (managed from the SQL editor; read-only through the API)
create policy "Users read their own role, admins read all"
  on public.app_users for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- workers
create policy "Admins read workers"
  on public.workers for select to authenticated
  using ((select private.is_admin()));

create policy "Admins create workers"
  on public.workers for insert to authenticated
  with check ((select private.is_admin()));

create policy "Admins update workers"
  on public.workers for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Only succeeds for workers without time logs (foreign key is RESTRICT);
-- otherwise the app deactivates the worker instead.
create policy "Admins delete workers"
  on public.workers for delete to authenticated
  using ((select private.is_admin()));

-- time_logs (kiosks write only through the security-definer RPCs below)
create policy "Admins read time logs"
  on public.time_logs for select to authenticated
  using ((select private.is_admin()));

create policy "Admins add manual time logs"
  on public.time_logs for insert to authenticated
  with check ((select private.is_admin()) and source = 'admin');

create policy "Admins correct or void time logs"
  on public.time_logs for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 7. Kiosk RPCs
-- -----------------------------------------------------------------------------

-- Registers a badge scan. Returns exactly one row whose `status` is one of:
--   ok              — event recorded; upload the snapshot to `snapshot_path`
--   duplicate       — same badge scanned again within duplicate_scan_seconds;
--                     nothing recorded, show the previous event, skip upload
--   inactive_worker — badge belongs to a deactivated worker
--   invalid_token   — unknown or revoked badge
create function public.kiosk_register_scan(
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

  select w.* into v_worker from public.workers w where w.qr_token = p_token;

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

  -- Storage path: snapshots/<yyyy>/<mm>/<time_log_id>.jpg
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

comment on function public.kiosk_register_scan(text, timestamptz) is
  'Kiosk only. Resolves a QR token, decides check-in/out and records the event.';


-- Marks the snapshot of a scan as uploaded, after verifying the object exists.
create function public.kiosk_confirm_snapshot(p_time_log_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  if not private.has_role('kiosk') then
    raise exception 'Only kiosk accounts can confirm snapshots.' using errcode = '42501';
  end if;

  update public.time_logs t
  set snapshot_uploaded_at = now()
  where t.id = p_time_log_id
    and t.kiosk_user_id = auth.uid()
    and t.snapshot_uploaded_at is null
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'snapshots'
        and o.name = t.snapshot_path
    )
  returning t.snapshot_path into v_path;

  return v_path is not null;
end;
$$;

comment on function public.kiosk_confirm_snapshot(uuid) is
  'Kiosk only. Confirms that the snapshot for a scan was uploaded.';


-- Used by the storage upload policy: a kiosk may upload exactly the file that
-- was reserved for its own scan, within 10 minutes, and only once.
create function private.kiosk_can_upload_snapshot(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('kiosk')
    and exists (
      select 1
      from public.time_logs t
      where t.snapshot_path = p_object_name
        and t.kiosk_user_id = (select auth.uid())
        and t.snapshot_uploaded_at is null
        and t.created_at > now() - interval '10 minutes'
    );
$$;


-- -----------------------------------------------------------------------------
-- 8. Admin RPCs
-- -----------------------------------------------------------------------------

-- Issues a new QR token. The previous badge stops working immediately.
create function public.rotate_worker_qr_token(p_worker_id uuid)
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

  update public.workers w
  set qr_token = private.generate_qr_token(),
      qr_token_rotated_at = now()
  where w.id = p_worker_id
  returning w.qr_token into v_token;

  if v_token is null then
    raise exception 'Worker not found.' using errcode = 'P0002';
  end if;

  return v_token;
end;
$$;


-- -----------------------------------------------------------------------------
-- 9. Snapshot retention (called by the scheduled purge job with the secret key)
-- -----------------------------------------------------------------------------
-- Storage objects must be deleted through the Storage API, not SQL, so the
-- purge runs as a scheduled server job (Vercel Cron) that:
--   1. calls snapshots_due_for_purge() to get paths past the retention period,
--   2. removes those objects with the Storage API,
--   3. calls mark_snapshots_purged() with the processed ids.

create function public.snapshots_due_for_purge(p_limit integer default 500)
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
    and t.snapshot_purged_at is null
    and t.occurred_at < now() - make_interval(days => s.snapshot_retention_days)
  order by t.occurred_at
  limit least(greatest(p_limit, 1), 1000);
$$;

create function public.mark_snapshots_purged(p_time_log_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with updated as (
    update public.time_logs t
    set snapshot_purged_at = now()
    where t.id = any (p_time_log_ids)
      and t.snapshot_purged_at is null
    returning 1
  )
  select count(*)::integer from updated;
$$;


-- -----------------------------------------------------------------------------
-- 10. Bootstrap helper (SQL editor only — not callable through the API)
-- -----------------------------------------------------------------------------
-- Usage, after creating the user under Authentication → Users:
--   select private.assign_role('rektor@skola.se', 'admin', 'Anna Andersson');
--   select private.assign_role('kiosk-entre@skola.se', 'kiosk', 'Entré, Hus A');

create function private.assign_role(p_email text, p_role public.app_role, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(p_email);

  if v_user_id is null then
    raise exception 'No auth user with email %. Create the user first.', p_email;
  end if;

  insert into public.app_users (user_id, role, display_name)
  values (v_user_id, p_role, p_display_name)
  on conflict (user_id) do update
    set role = excluded.role,
        display_name = excluded.display_name;
end;
$$;


-- -----------------------------------------------------------------------------
-- 11. Function privileges
-- -----------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default (and Supabase adds anon and
-- authenticated), so revoke everything and grant explicitly.

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_role(public.app_role),
  private.is_admin(),
  private.kiosk_can_upload_snapshot(text),
  private.generate_qr_token()
to authenticated;

revoke all on function
  public.kiosk_register_scan(text, timestamptz),
  public.kiosk_confirm_snapshot(uuid),
  public.rotate_worker_qr_token(uuid),
  public.snapshots_due_for_purge(integer),
  public.mark_snapshots_purged(uuid[])
from public, anon, authenticated;

grant execute on function
  public.kiosk_register_scan(text, timestamptz),
  public.kiosk_confirm_snapshot(uuid),
  public.rotate_worker_qr_token(uuid)
to authenticated;

grant execute on function
  public.snapshots_due_for_purge(integer),
  public.mark_snapshots_purged(uuid[])
to service_role;

-- Column default on workers.qr_token, used when server-side tooling inserts workers.
grant execute on function private.generate_qr_token() to service_role;


-- -----------------------------------------------------------------------------
-- 12. Storage: private snapshot bucket
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('snapshots', 'snapshots', false, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Kiosks can create (never overwrite, read or delete) their own scan's snapshot.
create policy "Kiosks upload the snapshot for their own scan"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'snapshots'
    and private.kiosk_can_upload_snapshot(name)
  );

-- Admins can read snapshots (required to create signed URLs).
create policy "Admins read snapshots"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snapshots'
    and (select private.is_admin())
  );


-- -----------------------------------------------------------------------------
-- 13. Realtime
-- -----------------------------------------------------------------------------
-- The admin dashboard subscribes to time_logs changes to refresh presence.
-- Realtime applies the RLS policies above, so only admins receive events.

alter publication supabase_realtime add table public.time_logs;
