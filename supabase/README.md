# Supabase setup

Everything VisiTrack needs in Supabase is in a single migration:
[`migrations/20260917120000_initial_schema.sql`](migrations/20260917120000_initial_schema.sql).
It is commented section by section; this page covers installation and the model at a glance.

## 1. Create the project

1. Create a new project at [supabase.com/dashboard](https://supabase.com/dashboard).
   **Region: an EU region**, e.g. *North EU (Stockholm)* `eu-north-1` or *Central EU (Frankfurt)* `eu-central-1`.
   The region cannot be changed later.
2. **Authentication → Sign In / Providers**
   - Turn **off** *Allow new users to sign up*. Accounts are only created by an admin.
   - Keep the *Email* provider enabled.

## 2. Run the migration

Either paste the migration file into **SQL Editor → New query** and run it, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Run it once, on a fresh project.

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

For the daily snapshot purge job (`/api/cron/purge-snapshots`, scheduled in `vercel.json`) also add the
server-only `SUPABASE_SECRET_KEY` (Secret keys) and a random `CRON_SECRET` (`openssl rand -hex 32`).

---

## Data model

| Object                    | Kind     | Purpose                                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------------ |
| `app_users`               | table    | Role (`admin` / `kiosk`) for each Supabase Auth user                     |
| `workers`                 | table    | External staff: name, company, job role, active flag                     |
| `worker_badges`           | table    | QR token per worker. Admin-only, so viewers never see badge secrets      |
| `time_logs`               | table    | Append-only check-in/check-out events with snapshot reference and audit  |
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
        │  status: ok | duplicate | inactive_worker | invalid_token
        │  DB decides check_in / check_out and stamps server time
        ▼
show ✓ + name  ──►  upload snapshot to snapshots/<yyyy>/<mm>/<time_log_id>.jpg
                          │
                          ▼
                   rpc kiosk_confirm_snapshot(time_log_id)
```

### Rules enforced by the database

| Rule                                                                                  | How                                             |
| ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Only admins read or manage workers, logs, settings and snapshots                      | RLS + `private.is_admin()`                      |
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

### Settings

Adjust under **Inställningar** in the admin UI, or directly:

```sql
update public.app_settings
set presence_window_hours = 16,
    duplicate_scan_seconds = 60,
    snapshot_retention_days = 90;
```

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

## GDPR notes

- **Hosting:** keep Supabase in an EU region and set Vercel's Function Region to the EU (`arn1` Stockholm or `fra1` Frankfurt).
- **Snapshots:** private bucket, viewed via short-lived signed URLs, purged after `snapshot_retention_days` (default 90).
  Storage objects must be removed through the Storage API, so the purge runs as a daily Vercel Cron job
  (`/api/cron/purge-snapshots`) calling `snapshots_due_for_purge()` → Storage `remove()` → `mark_snapshots_purged()`.
  Time records are kept and marked "snapshot purged".
- **Time logs** are kept indefinitely as billing/attendance records. Decide on a retention period with your data protection officer.
- **Right to erasure:** not automated yet. A worker with logs can be deactivated; full erasure is a manual SQL operation for now.
- Sign Supabase's and Vercel's Data Processing Addendums (DPA) and inform staff about the camera snapshots.

## Tests

```bash
npm run test:db
```

Runs the migrations against an in-memory Postgres (PGlite) with stand-ins for Supabase's `auth` and
`storage` schemas and checks RLS, grants, the scan state machine, upload rules, audit trail and
retention (79 assertions). It does not cover Supabase-specific runtime behaviour (Storage API,
Realtime) or true concurrency; those are verified against a live project.
