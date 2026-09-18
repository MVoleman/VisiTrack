# Supabase setup

Everything VisiTrack needs in Supabase is in [`migrations/`](migrations), applied in filename order.
The first file builds the schema; the ones after it are hardening steps, and a project missing any of
them is missing part of the security model. Each file is commented section by section; this page
covers installation and the model at a glance.

## 1. Create the project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
   **Region: an EU region**, e.g. *North EU (Stockholm)* `eu-north-1` or *Central EU (Frankfurt)* `eu-central-1`.
   The region cannot be changed later.
2. **Authentication → Sign In / Providers**
   - Turn **off** *Allow new users to sign up*. Accounts are only created by an admin.
   - Keep the *Email* provider enabled.

## 2. Apply the migrations

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Use the CLI, not the SQL Editor: the files must be applied in order and `db push` is what keeps track
of which ones a project already has. Running it again later applies only what is new.

## 3. Create accounts

In **Authentication → Users → Add user → Create new user**, create (with *Auto Confirm User* checked):

| Account              | Example email          | Used by                                       |
| -------------------- | ---------------------- | --------------------------------------------- |
| One per admin        | `anna@skola.se`        | Full access in `/admin`                       |
| One per viewer       | `rektor@skola.se`      | Read-only access in `/admin`                  |
| One per kiosk device | `kiosk-entre@skola.se` | The entrance tablet (signed in once at setup) |

Then assign roles in the **SQL Editor**:

```sql
select private.assign_role('anna@skola.se', 'admin', 'Anna Andersson');
select private.assign_role('rektor@skola.se', 'viewer', 'Rektor Andersson');
select private.assign_role('kiosk-entre@skola.se', 'kiosk', 'Entré, Hus A');
```

An account without a role can sign in but can read or change nothing.

### Roles

| Capability                                        | admin | viewer | kiosk |
| ------------------------------------------------- | :---: | :----: | :---: |
| See presence, staff and time logs                 |  ✅   |   ✅   |  ❌   |
| See webcam snapshots                              |  ✅   |   ✅   |  ❌   |
| Export CSV                                        |  ✅   |   ✅   |  ❌   |
| Add/edit staff, QR codes, printable badges        |  ✅   |   ❌   |  ❌   |
| Manual entries, notes, voiding                    |  ✅   |   ❌   |  ❌   |
| Change settings                                   |  ✅   |   ❌   |  ❌   |
| Register scans and upload snapshots               |  ❌   |   ❌   |  ✅   |

Viewers cannot read `worker_badges`, so QR tokens are never exposed to them.

## 4. Connect the app

From **Project Settings → API Keys**, add to `.env.local` and to Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Also add the server-only `SUPABASE_SECRET_KEY` (Secret keys) and a random `CRON_SECRET`
(`openssl rand -hex 32`). The secret key is **not optional**: no browser session may read the snapshot
bucket, so every photo in the admin UI is streamed by `/admin/snapshots` with that key. Without it no
photo can be shown at all (the route answers `503` and logs `snapshot-storage-unavailable`), and the
daily purge job cannot delete anything either.

---

## Data model

| Object                    | Kind     | Purpose                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------ |
| `app_users`               | table    | Role (`admin` / `viewer` / `kiosk`) for each Supabase Auth user          |
| `workers`                 | table    | External staff: name, company, job role, active flag                     |
| `worker_badges`           | table    | QR token per worker. Admin-only, so viewers never see badge secrets      |
| `time_logs`               | table    | Append-only check-in/check-out events with snapshot reference and audit  |
| `kiosk_scan_sources`      | table    | Address each scan came from. Admin-only: RLS filters rows, not columns   |
| `kiosk_scan_denials`      | table    | Scans refused by the network allowlist, as evidence. Admin-only          |
| `kiosk_network_allowlist` | table    | Networks a kiosk may scan from. Empty = anywhere. Admin-only            |
| `app_settings`            | table    | Single row: time zone, presence window, duplicate window, retention days |
| `current_presence`        | view     | Who is in the building right now                                         |
| `work_sessions`           | view     | Check-in → check-out pairs with duration (reports, CSV export)           |
| `snapshots`               | bucket   | Private, JPEG/WebP only, max 512 KB per file                             |

### Kiosk flow

```
QR decoded + frame captured (same instant, in the browser)
        │
        ▼
rpc kiosk_register_scan(token, client_captured_at)
        │  status: ok | duplicate | inactive_worker | invalid_token | blocked_network
        │  DB decides check_in / check_out and stamps server time
        ▼
show ✓ + name  ──►  upload snapshot to snapshots/<yyyy>/<mm>/<time_log_id>-<32 hex>.jpg
                          │
                          ▼
                   rpc kiosk_confirm_snapshot(time_log_id)
```

### Rules enforced by the database

| Rule                                                                                  | How                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Only admins manage workers, logs and settings; admins and viewers read them          | RLS + `private.is_admin()` / `private.can_read()` |
| Kiosks cannot read any table; they can only register scans                            | RPCs with `security definer`, no table policies |
| Check-in vs. check-out and the timestamp are decided server-side                      | `kiosk_register_scan`                           |
| Re-scanning the same badge within 60 s does nothing                                   | `duplicate_scan_seconds`                        |
| A check-in older than 16 h (forgotten check-out) no longer counts as present          | `presence_window_hours`                         |
| A kiosk can upload only its own scan's snapshot, once, within 10 minutes, never overwrite or read it | storage policy + `kiosk_can_upload_snapshot` |
| QR tokens are random (192 bits), server-generated, and revocable                      | `generate_qr_token`, `rotate_worker_qr_token`   |
| Kiosk records cannot be edited; mistakes are voided with a reason, never deleted      | trigger `time_logs_guard`, no DELETE grant      |
| Workers with time logs cannot be deleted (deactivate instead)                         | `on delete restrict`                            |
| Admin role changes happen only in the SQL editor                                      | no write grants on `app_users`                  |
| Viewers can read everything except QR tokens, and can change nothing                  | `private.can_read()` on select policies only    |
| Nobody reads snapshots directly: no SELECT policy on `storage.objects` at all         | served by `/admin/snapshots` with the secret key |
| Every kiosk scan records its source address, and may be limited to given networks     | `private.request_ip()`, `app_settings.kiosk_ip_allowlist` |
| The source address is readable by admins only, over the API and over realtime alike   | own table `kiosk_scan_sources`, admin-only policy |
| A refused scan is recorded with its address and reason                                | `kiosk_scan_denials`                            |
| A snapshot path cannot be guessed from a time log id, and can be retired if leaked    | `private.new_snapshot_path()`, `rekey_snapshot()` |

### Settings

Adjust under **Inställningar** in the admin UI, or directly:

```sql
update public.app_settings
set presence_window_hours = 16,
    duplicate_scan_seconds = 60,
    snapshot_retention_days = 90;
```

## Restricting the kiosk to the school network

Every scan records the address it came from (visible to admins under a time log, and in
`public.kiosk_scan_sources`). Once you can see the school's real address there, enforcement is one
statement — after which a stolen kiosk session is useless from anywhere else:

```sql
insert into public.kiosk_network_allowlist (net) values ('203.0.113.4/32');   -- your address
delete from public.kiosk_network_allowlist;                                   -- turn enforcement off
```

The table is empty by default, so a wrong guess can never lock the entrance. Like the recorded
addresses, it is readable by admins only - it names the school's own networks. Scans from outside
the list are refused with a clear message on the kiosk, and the attempt is recorded in
`public.kiosk_scan_denials` with its address and reason. The address is
read from the last hop of `X-Forwarded-For`, which a client cannot forge past the proxy.

Complementary settings in the dashboard, both worth turning on:
- **Database → Network Restrictions** — limit database access to your own networks.
- **Authentication → Sessions** — time-box sessions so a lifted kiosk token expires.

## Email (password reset and invitations)

The app has "forgot password" (`/login/glomt-losenord`) and "choose a new password"
(`/login/nytt-losenord`) screens. Links in Supabase emails land on `/auth/confirm`, which
exchanges the token and forwards the person.

1. **Authentication → URL Configuration**
   - *Site URL*: `https://www.visitrack.se` (the apex redirects there).
   - *Redirect URLs*: add `https://www.visitrack.se/auth/confirm` and `https://visitrack.se/auth/confirm` (plus `http://localhost:3000/auth/confirm` for local work).
2. **Custom SMTP** (Project Settings → Authentication → SMTP Settings). Supabase's built-in sender is
   rate-limited and explicitly not for production. [Resend](https://resend.com) has an EU region and a
   free tier that covers a school's volume; any SMTP provider works.
3. Invite a new person under **Authentication → Users → Invite user**, then assign their role with
   `private.assign_role(...)`. They set their own password from the email link — nobody has to share one.

Without SMTP configured, reset emails may silently not arrive. The app always shows the same
confirmation message (it never reveals whether an address exists).

## If a link to a photo may have leaked

A Supabase signed URL is a token over the literal string `snapshots/<path>`. It names no user, and
when it is redeemed the storage service resolves the path as superuser - no policy, grant or account
is consulted. Nothing revokes it. Two things follow:

- No session can create one any more: there is no SELECT policy on `storage.objects` for any
  browser-facing role.
- Links created **before** that change keep working until they expire. The admin pages minted a
  10-minute one per image, but anyone with admin or viewer access could mint one with any expiry.

To retire those links, move the photos they name:

```bash
npm run snapshots:rekey                 # dry run: lists what would move
npm run snapshots:rekey -- --apply      # move them
```

Every photo that is actually in the bucket moves to a path carrying 128 bits of randomness, and the
old link then answers `NoSuchKey` for good - nothing can legitimately reoccupy the old path. A log
whose upload never arrived has no photo to retire, and the run says how many of those it found.
Moving is opt-in (`--apply`) so a mistyped flag cannot start it, and an interrupted run is repaired
by the next one: the new path begins with the time log's id, so a photo left behind is found again. Run it if a link may have
been shared, if `SUPABASE_SECRET_KEY` may have leaked (rotate the key first), or when someone with
admin or viewer access leaves.

What kills **every** outstanding link at once, including any this project does not know about, is
rotating the project's JWT secret in the Supabase dashboard. Check what else presents a legacy JWT
before doing it: here, user sessions are signed with the asymmetric JWKS key and the API keys are the
opaque `sb_publishable_` / `sb_secret_` kind, so nothing in this repo depends on the legacy secret
except storage URL signing - but an old deployment, integration or webhook might.

## GDPR notes

- **Hosting:** keep Supabase in an EU region and set Vercel's Function Region to the EU (`arn1` Stockholm or `fra1` Frankfurt).
- **Snapshots:** private bucket with no read policy for any browser session. The app streams each image
  through `/admin/snapshots` after checking the caller's role, so no shareable link to a photo can be
  created. Purged after `snapshot_retention_days` (default 90).
  Storage objects must be removed through the Storage API, so the purge runs as a daily Vercel Cron job
  (`/api/cron/purge-snapshots`) calling `snapshots_due_for_purge()` → Storage `remove()` → `mark_snapshots_purged()`.
  Time records are kept and marked "snapshot purged".
- **Time logs** are kept indefinitely as billing/attendance records. Decide on a retention period with your data protection officer.
- **Right to erasure:** not automated yet. A worker with logs can be deactivated; full erasure is a manual SQL operation for now.
- **Kiosk addresses:** `kiosk_scan_sources.kiosk_ip` stores the IP a scan came from, which is personal data. It exists to detect scans made from outside the school and is kept for as long as the time log. Only admins can read it - it sits in its own table because row level security filters rows, never columns, so a column on `time_logs` would have been readable by viewers over the API and over the realtime channel.
- Sign Supabase's and Vercel's Data Processing Addendums (DPA) and inform staff about the camera snapshots.

## Tests

```bash
npm run test:db
```

Runs the migrations against an in-memory Postgres (PGlite) with stand-ins for Supabase's `auth` and
`storage` schemas and checks RLS, grants, the scan state machine, upload rules, audit trail and
retention. It does not cover Supabase-specific runtime behaviour (Storage API,
Realtime) or true concurrency; those are verified against a live project.
