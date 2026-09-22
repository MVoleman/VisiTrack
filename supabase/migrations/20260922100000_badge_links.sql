-- =============================================================================
-- Sending a worker their QR code by email
-- =============================================================================
--
-- A badge has only ever left VisiTrack on paper. This lets an admin email the
-- person a link to their own code instead - and the link, not the code, is what
-- travels by mail.
--
-- WHY A LINK AND NOT THE IMAGE
--   The QR token is a door key with no expiry. Attaching it would park a
--   permanent key in the recipient's mailbox and in the mail provider's
--   storage, which for Resend sits in the United States. A link keeps the key
--   on our own domain, in the EU, and stops working after a week.
--
-- WHY ONLY A HASH IS STORED
--   The row holds sha-256 of the link token, never the token. A database dump
--   therefore yields nothing usable: redeeming takes the original, which exists
--   only in that one email. This is the same reasoning that moved QR tokens out
--   of public.workers in 20260918090100 - a secret belongs where the people who
--   may read the surrounding data cannot reach it.
--
-- The link is also a credential, just a short-lived one: whoever holds it
-- within the week holds the badge. What the expiry buys is that the key is not
-- parked forever; it does not stop someone forwarding the mail. The snapshot
-- taken at every scan remains the control against using someone else's code.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. One row per link, readable by admins only
-- -----------------------------------------------------------------------------

create table public.badge_links (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers (id) on delete cascade,
  -- sha-256 of the link token. The token itself is never stored, here or anywhere.
  token_hash text not null unique,
  -- The address as it was when we sent. workers.email can be edited afterwards,
  -- and this has to answer where the key actually went, not where it would go today.
  sent_to text not null,
  sent_by uuid references public.app_users (user_id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  expires_at timestamptz not null,
  opened_at timestamptz,
  open_count integer not null default 0,
  revoked_at timestamptz,
  provider_id text,
  -- 'accepted' means the provider queued the mail, never that it arrived.
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'delivered', 'bounced', 'failed'))
);

comment on table public.badge_links is
  'Emailed links that let a worker view their own QR code for a limited time. Holds a hash of the link, never the link. Admin-readable; written by public.create_badge_link and public.redeem_badge_link.';

create index badge_links_worker_idx on public.badge_links (worker_id, created_at desc);

alter table public.badge_links enable row level security;

revoke all on public.badge_links from anon, authenticated;
grant select on public.badge_links to authenticated;
grant select, insert, delete on public.badge_links to service_role;

create policy "Admins read badge links"
  on public.badge_links for select to authenticated
  using ((select private.is_admin()));


-- -----------------------------------------------------------------------------
-- 2. Creating one
-- -----------------------------------------------------------------------------

/**
 * Reserves a link for a worker and returns its id.
 *
 * Called before the mail is sent, because the address goes in the mail. The row
 * starts as 'pending' and only becomes redeemable once the provider has
 * accepted it, so a link whose mail never went out is dead on arrival.
 *
 * The send limits live here rather than in the server action: this runs in the
 * same transaction as the insert, so they cannot be raced by a double click or
 * bypassed by posting the action directly.
 */
create function public.create_badge_link(
  p_worker_id uuid,
  p_sent_to text,
  p_token text,
  p_valid_days integer default 7
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_worker public.workers;
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'Only admins can send QR codes.' using errcode = '42501';
  end if;

  if p_token is null or length(p_token) < 32 then
    raise exception 'The link token is too short to be random.' using errcode = '22023';
  end if;

  select w.* into v_worker from public.workers w where w.id = p_worker_id;
  if not found then
    raise exception 'Worker not found.' using errcode = 'P0002';
  end if;
  if not v_worker.is_active then
    -- A code that opens nothing today, but works again the moment someone is
    -- reactivated. Refuse rather than send a key into that gap.
    raise exception 'The worker is not active.' using errcode = '22023';
  end if;

  if (select count(*) from public.badge_links l
      where l.worker_id = p_worker_id and l.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'Too many links for this worker in the last hour.' using errcode = '22023';
  end if;

  if (select count(*) from public.badge_links l
      where l.sent_by = v_uid and l.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many links sent in the last hour.' using errcode = '22023';
  end if;

  insert into public.badge_links (worker_id, token_hash, sent_to, sent_by, expires_at)
  values (
    p_worker_id,
    encode(extensions.digest(p_token, 'sha256'), 'hex'),
    p_sent_to,
    v_uid,
    now() + make_interval(days => greatest(least(p_valid_days, 30), 1))
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_badge_link(uuid, text, text, integer) is
  'Admin only. Reserves an emailed badge link. The link only becomes usable once record_badge_link_result marks it accepted.';

revoke all on function public.create_badge_link(uuid, text, text, integer) from public, anon;
grant execute on function public.create_badge_link(uuid, text, text, integer) to authenticated;


/**
 * Records what the mail provider said, once. A link that was never accepted
 * stays unusable, so a failed send cannot leave a working key behind.
 */
create function public.record_badge_link_result(
  p_id uuid,
  p_status text,
  p_provider_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admins can send QR codes.' using errcode = '42501';
  end if;

  if p_status not in ('accepted', 'failed') then
    raise exception 'Unknown delivery result.' using errcode = '22023';
  end if;

  update public.badge_links
  set status = p_status,
      provider_id = p_provider_id,
      accepted_at = case when p_status = 'accepted' then now() end,
      revoked_at = case when p_status = 'failed' then now() else revoked_at end
  where id = p_id
    and status = 'pending';

  if not found then
    raise exception 'No pending link with that id.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.record_badge_link_result(uuid, text, text) from public, anon;
grant execute on function public.record_badge_link_result(uuid, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Redeeming one
-- -----------------------------------------------------------------------------

/**
 * Exchanges a link token for the worker's badge, for the page at /kod/<token>.
 *
 * Callable without a session - the token is the credential, like a password
 * reset link. Unknown, expired, revoked and never-sent all return no rows, so
 * the page cannot be used to find out whether a token ever existed.
 */
create function public.redeem_badge_link(p_token text)
returns table (
  full_name text,
  company text,
  role text,
  qr_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.badge_links;
begin
  if p_token is null or length(p_token) < 32 then
    return;
  end if;

  update public.badge_links l
  set opened_at = coalesce(l.opened_at, now()),
      open_count = l.open_count + 1
  where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and l.revoked_at is null
    and l.expires_at > now()
    and l.status in ('accepted', 'delivered')
  returning l.* into v_link;

  if not found then
    return;
  end if;

  return query
    select w.full_name, w.company, w.role, b.token, v_link.expires_at
    from public.workers w
    join public.worker_badges b on b.worker_id = w.id
    where w.id = v_link.worker_id
      and w.is_active;
end;
$$;

comment on function public.redeem_badge_link(text) is
  'Exchanges an emailed link token for the worker''s QR code. Anonymous by design: the token is the credential. Counts the open.';

revoke all on function public.redeem_badge_link(text) from public;
grant execute on function public.redeem_badge_link(text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. Rotating a code kills the links that pointed at it
-- -----------------------------------------------------------------------------

/**
 * Unchanged except for the revoke: losing a phone should take one action, not
 * two. Whoever still holds an emailed link gets nothing after a rotation.
 */
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

  update public.badge_links l
  set revoked_at = now()
  where l.worker_id = p_worker_id
    and l.revoked_at is null;

  return v_token;
end;
$$;
