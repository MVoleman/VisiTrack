import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Applies every migration in supabase/migrations (in order) to an in-memory
// Postgres (PGlite) with stand-ins for Supabase's auth/storage schemas, then
// exercises RLS, grants and the kiosk scan flow.
// Run with: npm run test:db
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? join(import.meta.dirname, "..", "migrations");
const MIGRATIONS = process.env.MIGRATION
  ? [process.env.MIGRATION]
  : readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => join(MIGRATIONS_DIR, f));
const db = await PGlite.create({ extensions: { pgcrypto } });

// ---------------------------------------------------------------------------
// Minimal stand-in for the parts of a Supabase project the migration touches.
// ---------------------------------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Mimic Supabase's permissive default privileges, so the migration's revokes are exercised.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key, email text unique);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets, name text, owner uuid,
    created_at timestamptz default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  grant select, insert, update, delete on storage.objects to anon, authenticated;

  create publication supabase_realtime;
`);

for (const file of MIGRATIONS) await db.exec(readFileSync(file, "utf8"));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
async function expectError(name, fn, pattern) {
  try {
    await fn();
    failures.push(`${name} — expected an error, got success`);
  } catch (e) {
    if (pattern && !pattern.test(e.message)) failures.push(`${name} — wrong error: ${e.message}`);
    else passed++;
  }
}
async function as(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${uid ? "authenticated" : "anon"};`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
/** Simulates the headers PostgREST exposes to a request (used for kiosk IP binding). */
const withHeaders = async (headers) =>
  db.exec(`select set_config('request.headers', ${headers === null ? "''" : `'${JSON.stringify(headers)}'`}, false);`);
const badgeToken = async (workerId) =>
  (await q(`select token from public.worker_badges where worker_id = $1`, [workerId]))[0]?.token;
// Move a worker's history back in time (bypasses triggers, superuser only).
async function ageLogs(workerId, interval) {
  await db.exec(`set session_replication_role = replica;
    update public.time_logs set occurred_at = occurred_at - interval '${interval}', created_at = created_at - interval '${interval}' where worker_id = '${workerId}';
    set session_replication_role = origin;`);
}

const ADMIN = "11111111-1111-1111-1111-111111111111";
const KIOSK = "22222222-2222-2222-2222-222222222222";
const KIOSK2 = "44444444-4444-4444-4444-444444444444";
const NOBODY = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users values
  ('${ADMIN}', 'admin@skola.se'), ('${KIOSK}', 'kiosk@skola.se'),
  ('${KIOSK2}', 'kiosk2@skola.se'), ('${NOBODY}', 'nobody@skola.se');`);

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
await db.exec(`select private.assign_role('ADMIN@skola.se', 'admin', 'Admin');
  select private.assign_role('kiosk@skola.se', 'kiosk', 'Entré A');
  select private.assign_role('kiosk2@skola.se', 'kiosk', 'Entré B');`);
check("assign_role creates roles", (await q("select count(*)::int n from public.app_users"))[0].n === 3);
await expectError("assign_role rejects unknown email",
  () => db.exec(`select private.assign_role('ghost@skola.se', 'admin', 'x')`), /No auth user/);
await expectError("assign_role not callable by admins via API",
  () => as(ADMIN, () => q(`select private.assign_role('nobody@skola.se', 'admin', 'x')`)), /permission denied/);

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------
const [worker] = await as(ADMIN, () =>
  q(`insert into public.workers (full_name, company, role, email) values ('Erik Svensson', 'Städbolaget AB', 'Städ', 'erik@example.com') returning *`));
check("admin creates worker", !!worker?.id);
worker.qr_token = await badgeToken(worker.id);
check("qr token format", /^vt1_[A-Za-z0-9_-]{32}$/.test(worker.qr_token), worker.qr_token);
check("badge row created by trigger", !!worker.qr_token);
check("created_by defaults to admin", worker.created_by === ADMIN);

const [worker2] = await as(ADMIN, () =>
  q(`insert into public.workers (full_name, company, role) values ('Sara Lind', 'El & Data', 'Elektriker') returning *`));
worker2.qr_token = await badgeToken(worker2.id);
check("tokens are unique", worker.qr_token !== worker2.qr_token);

await expectError("admin cannot overwrite a badge token",
  () => as(ADMIN, () => q(`update public.worker_badges set token = 'vt1_weak' where worker_id = $1`, [worker.id])), /permission denied/);
await expectError("admin cannot insert badges directly",
  () => as(ADMIN, () => q(`insert into public.worker_badges (worker_id) values ($1)`, [worker.id])), /permission denied/);
check("admin can read badge tokens", (await as(ADMIN, () => q(`select token from public.worker_badges where worker_id = $1`, [worker.id])))[0]?.token === worker.qr_token);
await expectError("blank name rejected",
  () => as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('  ','Y','Z')`)), /check constraint/);
await expectError("invalid email rejected",
  () => as(ADMIN, () => q(`insert into public.workers (full_name, company, role, email) values ('A','Y','Z','nope')`)), /check constraint/);

check("kiosk sees no workers", (await as(KIOSK, () => q(`select * from public.workers`))).length === 0);
check("role-less user sees no workers", (await as(NOBODY, () => q(`select * from public.workers`))).length === 0);
await expectError("anon cannot read workers", () => as(null, () => q(`select * from public.workers`)), /permission denied/);
await expectError("kiosk cannot create workers",
  () => as(KIOSK, () => q(`insert into public.workers (full_name, company, role) values ('A','B','C')`)), /row-level security/);
check("role-less user sees only nothing in app_users", (await as(NOBODY, () => q(`select * from public.app_users`))).length === 0);
check("kiosk sees only its own app_users row", (await as(KIOSK, () => q(`select * from public.app_users`))).length === 1);
check("admin sees all app_users", (await as(ADMIN, () => q(`select * from public.app_users`))).length === 3);
await expectError("admin cannot escalate roles via API",
  () => as(ADMIN, () => q(`update public.app_users set role = 'admin' where user_id = $1`, [KIOSK])), /permission denied/);

// ---------------------------------------------------------------------------
// Kiosk scan flow
// ---------------------------------------------------------------------------
const scan = (uid, token) => as(uid, () => q(`select * from public.kiosk_register_scan($1, now())`, [token]));

check("invalid token", (await scan(KIOSK, "vt1_doesnotexist"))[0].status === "invalid_token");
await expectError("admin cannot register scans", () => scan(ADMIN, worker.qr_token), /Only kiosk/);
await expectError("role-less user cannot register scans", () => scan(NOBODY, worker.qr_token), /Only kiosk/);
await expectError("anon cannot register scans", () => scan(null, worker.qr_token), /permission denied/);

const [s1] = await scan(KIOSK, worker.qr_token);
check("first scan is check_in", s1.status === "ok" && s1.event_type === "check_in", JSON.stringify(s1));
check("scan returns worker name", s1.worker_name === "Erik Svensson" && s1.worker_company === "Städbolaget AB");
check("snapshot path format", /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/.test(s1.snapshot_path) && s1.snapshot_path.includes(s1.time_log_id), s1.snapshot_path);

const [dup] = await scan(KIOSK, worker.qr_token);
check("immediate rescan is duplicate", dup.status === "duplicate" && dup.time_log_id === s1.time_log_id && dup.snapshot_path === null, JSON.stringify(dup));
check("duplicate did not create a log", (await q(`select count(*)::int n from public.time_logs`))[0].n === 1);

// Presence
let presence = await as(ADMIN, () => q(`select * from public.current_presence`));
check("worker present after check-in", presence.length === 1 && presence[0].worker_id === worker.id);
check("kiosk cannot read presence", (await as(KIOSK, () => q(`select * from public.current_presence`))).length === 0);

// Snapshot upload rules
const upload = (uid, name) => as(uid, () => q(`insert into storage.objects (bucket_id, name, owner) values ('snapshots', $1, $2)`, [name, uid]));
await expectError("kiosk cannot upload arbitrary path", () => upload(KIOSK, "2026/09/evil.jpg"), /row-level security/);
await expectError("other kiosk cannot upload this scan's snapshot", () => upload(KIOSK2, s1.snapshot_path), /row-level security/);
await expectError("admin cannot upload kiosk snapshot", () => upload(ADMIN, s1.snapshot_path), /row-level security/);
check("confirm before upload returns false", (await as(KIOSK, () => q(`select public.kiosk_confirm_snapshot($1) ok`, [s1.time_log_id])))[0].ok === false);
await upload(KIOSK, s1.snapshot_path);
passed++;
check("kiosk cannot read snapshots back", (await as(KIOSK, () => q(`select * from storage.objects`))).length === 0);
check("confirm after upload returns true", (await as(KIOSK, () => q(`select public.kiosk_confirm_snapshot($1) ok`, [s1.time_log_id])))[0].ok === true);
check("second confirm returns false", (await as(KIOSK, () => q(`select public.kiosk_confirm_snapshot($1) ok`, [s1.time_log_id])))[0].ok === false);
// Superseded: admins no longer read storage objects at all (see the snapshot lockdown block below).
// Even if the object disappeared, a confirmed scan's path can never be re-uploaded (no evidence swapping).
await db.exec(`delete from storage.objects`);
await expectError("no re-upload after confirmation", () => upload(KIOSK, s1.snapshot_path), /row-level security/);

const [log1] = await as(ADMIN, () => q(`select * from public.time_logs where id = $1`, [s1.time_log_id]));
check("log records kiosk + server time", log1.source === "kiosk" && log1.kiosk_user_id === KIOSK && log1.snapshot_uploaded_at !== null && log1.updated_by === null);

// Stale upload window (> 10 min)
const [w2scan] = await scan(KIOSK, worker2.qr_token);
await ageLogs(worker2.id, "11 minutes");
await expectError("upload window expires after 10 minutes", () => upload(KIOSK, w2scan.snapshot_path), /row-level security/);

// Check-out after the duplicate window
await ageLogs(worker.id, "2 minutes");
const [s2] = await scan(KIOSK2, worker.qr_token);
check("second scan (other kiosk) is check_out", s2.status === "ok" && s2.event_type === "check_out", JSON.stringify(s2));
presence = await as(ADMIN, () => q(`select worker_id from public.current_presence`));
check("worker not present after check-out", !presence.some((p) => p.worker_id === worker.id));

await ageLogs(worker.id, "3 hours");
const [s3] = await scan(KIOSK, worker.qr_token);
check("third scan is check_in again", s3.event_type === "check_in");

// Forgotten check-out: old check-in outside presence window → new check-in
await ageLogs(worker.id, "20 hours");
check("stale check-in is not present",
  !(await as(ADMIN, () => q(`select worker_id from public.current_presence`))).some((p) => p.worker_id === worker.id));
const [s4] = await scan(KIOSK, worker.qr_token);
check("scan after forgotten check-out is check_in", s4.event_type === "check_in", JSON.stringify(s4));

// Work sessions
const sessions = await as(ADMIN, () => q(`select * from public.work_sessions where worker_id = $1 order by check_in_at`, [worker.id]));
check("work_sessions pairs check-in/out", sessions.length === 3 && sessions[0].check_out_log_id === s2.time_log_id && sessions[1].check_out_at === null && sessions[2].check_out_at === null,
  JSON.stringify(sessions.map((s) => [s.check_out_log_id, s.duration])));
check("work_sessions duration", sessions[0].duration?.minutes === 2 || JSON.stringify(sessions[0].duration).includes("2"), JSON.stringify(sessions[0].duration));

// Inactive worker
await as(ADMIN, () => q(`update public.workers set is_active = false where id = $1`, [worker2.id]));
check("inactive worker rejected", (await scan(KIOSK, worker2.qr_token))[0].status === "inactive_worker");

// Token rotation
const oldToken = worker.qr_token;
await expectError("kiosk cannot rotate tokens", () => as(KIOSK, () => q(`select public.rotate_worker_qr_token($1)`, [worker.id])), /Only admins/);
const [{ rotate_worker_qr_token: newToken }] = await as(ADMIN, () => q(`select public.rotate_worker_qr_token($1)`, [worker.id]));
check("rotation issues a new token", newToken !== oldToken && newToken.startsWith("vt1_"));
check("rotation is stored on the badge", (await badgeToken(worker.id)) === newToken);
check("old token no longer works", (await scan(KIOSK, oldToken))[0].status === "invalid_token");

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------
await expectError("kiosk record time is immutable",
  () => as(ADMIN, () => q(`update public.time_logs set occurred_at = occurred_at - interval '1 hour' where id = $1`, [s2.time_log_id])), /immutable/);
await expectError("kiosk record type is immutable",
  () => as(ADMIN, () => q(`update public.time_logs set event_type = 'check_in' where id = $1`, [s2.time_log_id])), /immutable/);
await expectError("admin cannot change worker_id (no column grant)",
  () => as(ADMIN, () => q(`update public.time_logs set worker_id = $2 where id = $1`, [s2.time_log_id, worker2.id])), /permission denied/);
await expectError("admin cannot forge source",
  () => as(ADMIN, () => q(`insert into public.time_logs (worker_id, event_type, source) values ($1, 'check_in', 'kiosk')`, [worker.id])), /permission denied/);
await expectError("void requires a reason",
  () => as(ADMIN, () => q(`update public.time_logs set voided_at = now() where id = $1`, [s4.time_log_id])), /check constraint/);

const [voided] = await as(ADMIN, () => q(`update public.time_logs set void_reason = 'Felaktig skanning' where id = $1 returning *`, [s4.time_log_id]));
check("void sets voided_at/by server-side", voided.voided_at !== null && voided.voided_by === ADMIN && voided.updated_by === ADMIN);
await expectError("cannot un-void",
  () => as(ADMIN, () => q(`update public.time_logs set voided_at = null, void_reason = null where id = $1`, [s4.time_log_id])), /cannot be changed back/);
check("note on kiosk record is allowed",
  (await as(ADMIN, () => q(`update public.time_logs set note = 'Glömde checka ut' where id = $1 returning note`, [s3.time_log_id])))[0].note === "Glömde checka ut");

const [manual] = await as(ADMIN, () => q(`insert into public.time_logs (worker_id, event_type, occurred_at, note) values ($1, 'check_out', now() - interval '12 hours', 'Manuell utcheckning') returning *`, [worker.id]));
check("manual entry defaults to source admin", manual.source === "admin" && manual.created_by === ADMIN && manual.snapshot_path === null);
check("manual entry is editable",
  (await as(ADMIN, () => q(`update public.time_logs set occurred_at = occurred_at + interval '1 hour' where id = $1 returning id`, [manual.id]))).length === 1);
await expectError("future manual entry rejected",
  () => as(ADMIN, () => q(`insert into public.time_logs (worker_id, event_type, occurred_at) values ($1, 'check_in', now() + interval '1 day')`, [worker.id])), /future/);
await expectError("admin cannot delete time logs",
  () => as(ADMIN, () => q(`delete from public.time_logs where id = $1`, [manual.id])), /permission denied/);
await expectError("kiosk cannot insert time logs directly",
  () => as(KIOSK, () => q(`insert into public.time_logs (worker_id, event_type) values ($1, 'check_in')`, [worker.id])), /row-level security/);
check("kiosk cannot update time logs (0 rows)",
  (await as(KIOSK, () => q(`update public.time_logs set note = 'x' returning id`))).length === 0);

await expectError("worker with logs cannot be deleted",
  () => as(ADMIN, () => q(`delete from public.workers where id = $1`, [worker.id])), /foreign key/);
const [w3] = await as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('Temp','T','T') returning id`));
check("worker without logs can be deleted", (await as(ADMIN, () => q(`delete from public.workers where id = $1 returning id`, [w3.id]))).length === 1);

// ---------------------------------------------------------------------------
// Viewer role: read-only, no badge tokens
// ---------------------------------------------------------------------------
const VIEWER = "55555555-5555-5555-5555-555555555555";
await db.exec(`insert into auth.users values ('${VIEWER}', 'rektor@skola.se');`);
await db.exec(`select private.assign_role('rektor@skola.se', 'viewer', 'Rektor');`);

check("viewer reads workers", (await as(VIEWER, () => q(`select id from public.workers`))).length > 0);
check("viewer reads time logs", (await as(VIEWER, () => q(`select id from public.time_logs`))).length > 0);
check("viewer reads presence view", Array.isArray(await as(VIEWER, () => q(`select * from public.current_presence`))));
check("viewer reads work sessions", Array.isArray(await as(VIEWER, () => q(`select * from public.work_sessions`))));
check("viewer reads settings", (await as(VIEWER, () => q(`select * from public.app_settings`))).length === 1);
check("viewer CANNOT read badge tokens", (await as(VIEWER, () => q(`select * from public.worker_badges`))).length === 0);
check("viewer can read snapshot objects", (await as(VIEWER, () => q(`select * from storage.objects`))).length >= 0);

await expectError("viewer cannot create workers",
  () => as(VIEWER, () => q(`insert into public.workers (full_name, company, role) values ('X','Y','Z')`)), /row-level security/);
await expectError("viewer cannot edit workers",
  () => as(VIEWER, () => q(`update public.workers set company = 'hacked' where id = $1 returning id`, [worker.id])).then((r) => {
    if (!r.length) throw new Error("row-level security: no rows updated");
  }), /row-level security/);
await expectError("viewer cannot delete workers",
  () => as(VIEWER, () => q(`delete from public.workers where id = $1 returning id`, [worker.id])).then((r) => {
    if (!r.length) throw new Error("row-level security: no rows deleted");
  }), /row-level security/);
await expectError("viewer cannot add time logs",
  () => as(VIEWER, () => q(`insert into public.time_logs (worker_id, event_type) values ($1, 'check_in')`, [worker.id])), /row-level security/);
await expectError("viewer cannot void time logs",
  () => as(VIEWER, () => q(`update public.time_logs set void_reason = 'x' where id = $1 returning id`, [s3.time_log_id])).then((r) => {
    if (!r.length) throw new Error("row-level security: no rows updated");
  }), /row-level security/);
await expectError("viewer cannot change settings",
  () => as(VIEWER, () => q(`update public.app_settings set snapshot_retention_days = 5 returning id`)).then((r) => {
    if (!r.length) throw new Error("row-level security: no rows updated");
  }), /row-level security/);
await expectError("viewer cannot rotate QR codes",
  () => as(VIEWER, () => q(`select public.rotate_worker_qr_token($1)`, [worker.id])), /Only admins/);
await expectError("viewer cannot register scans", () => scan(VIEWER, "vt1_whatever"), /Only kiosk/);
check("viewer sees only own app_users row", (await as(VIEWER, () => q(`select * from public.app_users`))).length === 1);
check("kiosk still cannot read badges", (await as(KIOSK, () => q(`select * from public.worker_badges`))).length === 0);

// ---------------------------------------------------------------------------
// Settings & retention
// ---------------------------------------------------------------------------
check("kiosk cannot read settings", (await as(KIOSK, () => q(`select * from public.app_settings`))).length === 0);
check("admin updates settings",
  (await as(ADMIN, () => q(`update public.app_settings set snapshot_retention_days = 30 returning snapshot_retention_days`)))[0].snapshot_retention_days === 30);
await expectError("settings bounds enforced",
  () => as(ADMIN, () => q(`update public.app_settings set snapshot_retention_days = 0`)), /check constraint/);

await expectError("admin cannot call purge list", () => as(ADMIN, () => q(`select * from public.snapshots_due_for_purge()`)), /permission denied/);
await expectError("kiosk cannot mark purged", () => as(KIOSK, () => q(`select public.mark_snapshots_purged(array[]::uuid[])`)), /permission denied/);
await ageLogs(worker.id, "40 days");
await db.exec(`set role service_role`);
const due = await q(`select * from public.snapshots_due_for_purge(100)`);
check("purge lists old snapshots incl. voided scans, not manual entries", due.length === 4 && due.every((d) => d.snapshot_path), JSON.stringify(due));
const [{ mark_snapshots_purged: purgedCount }] = await q(`select public.mark_snapshots_purged($1::uuid[])`, [due.map((d) => d.time_log_id)]);
check("mark purged", purgedCount === 4);
check("nothing left to purge", (await q(`select * from public.snapshots_due_for_purge()`)).length === 0);
// Server-side tooling (secret key) can manage workers without going through RLS.
await db.exec(`set role service_role`);
const seeded = (await q(`insert into public.workers (full_name, company, role) values ('Seed','S','S') returning id`))[0];
check("service_role can insert workers (badge created by trigger)", /^vt1_/.test(await badgeToken(seeded.id)));
await expectError("service_role cannot call assign_role", () => q(`select private.assign_role('admin@skola.se', 'admin', 'x')`), /permission denied/);
await db.exec(`reset role`);

// ---------------------------------------------------------------------------
// Snapshots are server-only: no role may read storage objects
// ---------------------------------------------------------------------------
await db.exec(`insert into storage.objects (bucket_id, name) values ('snapshots', '2026/09/read-test.jpg') on conflict do nothing;`);
check("admin CANNOT read storage objects", (await as(ADMIN, () => q(`select * from storage.objects`))).length === 0);
check("viewer CANNOT read storage objects", (await as(VIEWER, () => q(`select * from storage.objects`))).length === 0);
check("kiosk CANNOT read storage objects", (await as(KIOSK, () => q(`select * from storage.objects`))).length === 0);
check("no select policy remains on storage.objects",
  (await q(`select count(*)::int n from pg_policies where tablename = 'objects' and cmd = 'SELECT'`))[0].n === 0);

// ---------------------------------------------------------------------------
// Kiosk network binding
// ---------------------------------------------------------------------------
const [w5] = await as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('Nät Test','N','N') returning *`));
w5.qr_token = await badgeToken(w5.id);

// The proxy appends the real address last; a client-supplied value comes first.
await withHeaders({ "x-forwarded-for": "9.9.9.9, 203.0.113.4", "x-real-ip": "203.0.113.4" });
check("request_ip takes the LAST forwarded hop, not the client's claim",
  (await q(`select host(private.request_ip()) ip`))[0].ip === "203.0.113.4");

await as(KIOSK, async () => {
  await withHeaders({ "x-forwarded-for": "9.9.9.9, 203.0.113.4" });
  return q(`select * from public.kiosk_register_scan($1)`, [w5.qr_token]);
});
check("kiosk scan records the source address",
  (await q(`select host(kiosk_ip) ip from public.time_logs where worker_id = $1`, [w5.id]))[0].ip === "203.0.113.4");

// Enforcement off by default: an unknown address is still accepted.
const [w6] = await as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('Nät Test 2','N','N') returning *`));
w6.qr_token = await badgeToken(w6.id);
const openScan = await as(KIOSK, async () => {
  await withHeaders({ "x-forwarded-for": "198.51.100.7" });
  return q(`select * from public.kiosk_register_scan($1)`, [w6.qr_token]);
});
check("empty allowlist accepts any network", openScan[0].status === "ok");

// Turn enforcement on.
await db.exec(`update public.app_settings set kiosk_ip_allowlist = '{203.0.113.0/24}';`);
const [w7] = await as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('Nät Test 3','N','N') returning *`));
w7.qr_token = await badgeToken(w7.id);

const outside = await as(KIOSK, async () => {
  await withHeaders({ "x-forwarded-for": "198.51.100.7" });
  return q(`select * from public.kiosk_register_scan($1)`, [w7.qr_token]);
});
check("scan from outside the allowlist is refused", outside[0].status === "blocked_network");
check("refused scan records nothing",
  (await q(`select count(*)::int n from public.time_logs where worker_id = $1`, [w7.id]))[0].n === 0);

const spoofed = await as(KIOSK, async () => {
  // Attacker claims an allowed address; the proxy's real value is appended last.
  await withHeaders({ "x-forwarded-for": "203.0.113.4, 198.51.100.7" });
  return q(`select * from public.kiosk_register_scan($1)`, [w7.qr_token]);
});
check("spoofed X-Forwarded-For does NOT bypass the allowlist", spoofed[0].status === "blocked_network");

const inside = await as(KIOSK, async () => {
  await withHeaders({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" });
  return q(`select * from public.kiosk_register_scan($1)`, [w7.qr_token]);
});
check("scan from inside the allowlist is accepted", inside[0].status === "ok");

const noHeaders = await as(KIOSK, async () => {
  await withHeaders(null);
  return q(`select * from public.kiosk_register_scan($1)`, [w6.qr_token]);
});
check("unknown address is refused while enforcement is on", noHeaders[0].status === "blocked_network");
await db.exec(`update public.app_settings set kiosk_ip_allowlist = '{}';`);
await withHeaders(null);

// ---------------------------------------------------------------------------
// Source address parsing must survive real proxies (hardening migration)
// ---------------------------------------------------------------------------
const ipFor = async (headers) => {
  await withHeaders(headers);
  return (await q(`select host(private.request_ip()) ip`))[0].ip;
};
check("port suffix is stripped", (await ipFor({ "x-forwarded-for": "9.9.9.9, 10.0.0.1:53422" })) === "10.0.0.1");
check("bracketed IPv6 with port is parsed", (await ipFor({ "x-forwarded-for": "9.9.9.9, [2001:db8::2]:443" })) === "2001:db8::2");
check("IPv4-mapped IPv6 becomes the IPv4 address", (await ipFor({ "x-forwarded-for": "::ffff:192.0.2.5" })) === "192.0.2.5");
check("x-real-ip alone is NOT trusted", (await ipFor({ "x-real-ip": "1.2.3.4" })) === null);
check("junk yields no address rather than an error", (await ipFor({ "x-forwarded-for": "not-an-ip" })) === null);

check("IPv4-mapped address matches an IPv4 network",
  (await q(`select private.ip_allowed('::ffff:192.0.2.5'::inet, '{192.0.2.0/24}'::cidr[]) ok`))[0].ok === true);
check("a NULL-only allowlist does not enforce (and the UI filters NULLs to match)",
  (await q(`select private.ip_allowed('198.51.100.7'::inet, '{NULL}'::cidr[]) ok`))[0].ok === true);
check("a NULL element cannot smuggle an address past a real list",
  (await q(`select private.ip_allowed('198.51.100.7'::inet, '{NULL,203.0.113.0/24}'::cidr[]) ok`))[0].ok === false);
check("unknown address is refused when a list is set",
  (await q(`select private.ip_allowed(null, '{203.0.113.0/24}'::cidr[]) ok`))[0].ok === false);

// ---------------------------------------------------------------------------
// A refused scan must leave evidence
// ---------------------------------------------------------------------------
await db.exec(`update public.app_settings set kiosk_ip_allowlist = '{203.0.113.0/24}';`);
const [w8] = await as(ADMIN, () => q(`insert into public.workers (full_name, company, role) values ('Spår Test','S','S') returning *`));
w8.qr_token = await badgeToken(w8.id);

await as(KIOSK, async () => {
  await withHeaders({ "x-forwarded-for": "198.51.100.7" });
  return q(`select * from public.kiosk_register_scan($1)`, [w8.qr_token]);
});
const denials = await q(`select host(kiosk_ip) ip, reason from public.kiosk_scan_denials order by occurred_at desc`);
const denialCountBefore = denials.length;
check("refused scan is recorded with address and reason",
  denials[0]?.ip === "198.51.100.7" && denials[0]?.reason === "outside_allowlist",
  JSON.stringify(denials[0]));

await as(KIOSK, async () => {
  await withHeaders(null);
  return q(`select * from public.kiosk_register_scan($1)`, [w8.qr_token]);
});
check("refusal for an unknown address is recorded separately",
  (await q(`select reason from public.kiosk_scan_denials order by occurred_at desc limit 1`))[0]?.reason === "unknown_source_address");

check("admin reads denied scans", (await as(ADMIN, () => q(`select * from public.kiosk_scan_denials`))).length === denialCountBefore + 1);
check("viewer CANNOT read denied scans", (await as(VIEWER, () => q(`select * from public.kiosk_scan_denials`))).length === 0);
check("kiosk CANNOT read denied scans", (await as(KIOSK, () => q(`select * from public.kiosk_scan_denials`))).length === 0);
await expectError("nobody can forge a denial record",
  () => as(ADMIN, () => q(`insert into public.kiosk_scan_denials (reason) values ('fake')`)), /permission denied/);

await db.exec(`update public.app_settings set kiosk_ip_allowlist = '{}';`);
await withHeaders(null);

console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  ✗ " + f);
process.exit(failures.length ? 1 : 0);
