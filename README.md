# VisiTrack

Time & attendance for external school staff. Staff check in and out at an
entrance kiosk by showing a personal QR code; the kiosk captures a webcam
snapshot of the exact frame the code was read from, so admins can verify identity.

**Production:** https://visitrack.se · Supabase (Stockholm, `eu-north-1`) · Vercel functions in `arn1`

**Stack:** Next.js 16 (App Router, Turbopack) · Tailwind CSS v4 · shadcn/ui (Radix) ·
Supabase (Postgres, Auth, Storage, Realtime) · deployed on Vercel.

## Local development

Requires Node 20.9+, Docker and the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npm install
supabase start          # local Supabase in Docker; applies supabase/migrations
npm run db:seed         # demo accounts + workers (local only)
npm run dev
```

Create `.env.local` from `.env.example` with the values printed by `supabase status`.

| Account (local only)    | Password        | Use                         |
| ----------------------- | --------------- | --------------------------- |
| `admin@visitrack.local` | `visitrack-dev` | Sign in at `/login` (admin) |
| `rektor@visitrack.local` | `visitrack-dev` | Sign in at `/login` (read-only viewer) |
| `kiosk@visitrack.local` | `visitrack-dev` | Sign the device in at `/kiosk` |

## Routes

| Route                       | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| `/kiosk`                    | Full-screen check-in terminal for the entrance tablet or Chromebook  |
| `/admin`                    | Overview with real-time presence                                     |
| `/admin/konto`              | Own account: details and change password                             |
| `/admin/workers`            | Staff, QR codes, printable badges                                    |
| `/admin/logs`               | Time logs with snapshots, manual entries, voiding, CSV export        |
| `/admin/settings`           | Presence window, duplicate-scan window, snapshot retention           |
| `/admin/snapshots/*`        | Streams a snapshot after checking the caller's role (never a signed URL) |
| `/api/cron/purge-snapshots` | Daily GDPR purge of old snapshots (Vercel Cron)                      |
| `/login/glomt-losenord`     | Request a password reset link                                        |

## Roles

`admin` — full access · `viewer` — read-only (including snapshots and CSV export, but never QR codes)
· `kiosk` — the entrance device; registers scans and can read nothing. See [supabase/README.md](supabase/README.md).

## Setting up a kiosk

1. Create a kiosk account in Supabase and give it the `kiosk` role (see [supabase/README.md](supabase/README.md)).
2. On the tablet, open `https://visitrack.se/kiosk` in Chrome (or Edge/Safari) and sign in with the kiosk account.
3. Tap **Starta kiosken** and allow the camera. After that the kiosk resumes by itself after reloads or restarts.
4. Recommended: pin the page in kiosk/app mode and disable screen sleep in the device settings.

Hidden device menu: press and hold the VisiTrack logo for two seconds (restart camera, full screen, sign out).

## Deploying (Vercel + Supabase, EU)

1. Create the Supabase project in an **EU region** and follow [supabase/README.md](supabase/README.md).
2. Import the repository in Vercel. `vercel.json` pins functions to `arn1` (Stockholm) and schedules the purge job.
3. Add environment variables in Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY`, `CRON_SECRET` and `NEXT_PUBLIC_SITE_URL` (see `.env.example`).
   `SUPABASE_SECRET_KEY` is required for snapshots to display, and `NEXT_PUBLIC_SITE_URL` for password
   reset links — the app refuses to build those links from request headers.

No third-party requests at runtime: fonts are self-hosted by `next/font`, and the QR decoder's WebAssembly
file is served from `/zxing` (copied from `node_modules` by `scripts/copy-zxing-wasm.mjs`).

## Scripts

| Command            | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `npm run dev`      | Dev server                                                    |
| `npm run build`    | Production build                                              |
| `npm run lint`     | ESLint                                                        |
| `npm run test:db`  | Schema/RLS test suite against in-memory Postgres (PGlite)     |
| `npm run db:seed`  | Seed local Supabase with demo accounts and workers            |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` from local DB |
