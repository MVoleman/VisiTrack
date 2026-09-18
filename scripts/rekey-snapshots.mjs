#!/usr/bin/env node
// Retires every snapshot path, so that any Supabase signed URL still out there
// stops working.
//
//   npm run snapshots:rekey                  # dry run: says what it would do
//   npm run snapshots:rekey -- --apply       # move the photos
//   npm run snapshots:rekey -- --env=.env.production.local --apply
//
// WHEN TO RUN THIS
//   * a signed URL to a photo may have been created and shared (before
//     2026-09-18 the admin pages minted a 10-minute one per image, and anyone
//     with admin or viewer access could mint one with any expiry)
//   * SUPABASE_SECRET_KEY may have leaked - rotate the key first, then run this
//   * someone with admin or viewer access has left and you want certainty
//
// WHY IT WORKS
//   A signed URL is a token over the literal string "snapshots/<path>". It
//   names no user and is checked against no policy, so nothing can revoke it -
//   but it resolves the path at download time. Move the photo and the old link
//   answers "NoSuchKey" for good, because the new path carries 128 bits of
//   randomness that nothing will ever reproduce.
//
// The database update is a second step, so a run that is interrupted between
// the two can leave a photo the log does not point at. That is repaired, not
// lost: the new path starts with the time log's id, so the next run finds the
// object again and finishes the job.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "snapshots";
const PAGE = 1000; // PostgREST refuses to return more than db-max-rows at once.

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const unknown = args.filter((a) => !/^--(apply|dry-run|help)$/.test(a) && !a.startsWith("--env="));

if (unknown.length || flag("help")) {
  // A swallowed flag must never mean "go ahead": `npm run snapshots:rekey --dry-run`
  // (without the --) drops the flag before it reaches us, which is why moving
  // anything requires --apply rather than being the default.
  if (unknown.length) console.error(`Unrecognised argument(s): ${unknown.join(" ")}\n`);
  console.error("Usage: npm run snapshots:rekey -- [--apply] [--env=<file>]\n");
  console.error("  (no flags)   dry run: list the photos that would be moved");
  console.error("  --apply      move them");
  console.error("  --env=FILE   read NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from FILE");
  process.exit(unknown.length ? 2 : 0);
}

const apply = flag("apply");
const envFile = args.find((a) => a.startsWith("--env="))?.slice(6);

function envFromFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
    );
  } catch {
    console.error(`Could not read ${file}`);
    process.exit(1);
  }
}

// An explicit --env wins: being pointed at one project while the shell quietly
// holds another one's key is exactly how the wrong photos get moved.
const fileEnv = envFile ? envFromFile(envFile) : envFromFile(".env.local");
const source = envFile ?? "the environment, falling back to .env.local";
const url = envFile ? fileEnv.NEXT_PUBLIC_SUPABASE_URL : (process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL);
const secretKey = envFile ? fileEnv.SUPABASE_SECRET_KEY : (process.env.SUPABASE_SECRET_KEY ?? fileEnv.SUPABASE_SECRET_KEY);

if (!url || !secretKey) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (read from ${source}).`);
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** `<yyyy>/<mm>/<time_log_id>-<32 hex>.jpg` - the shape public.rekey_snapshot insists on. */
function newPath(id, occurredAt) {
  const at = new Date(occurredAt);
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${at.getUTCFullYear()}/${month}/${id}-${randomBytes(16).toString("hex")}.jpg`;
}

/** Every candidate row, in pages: PostgREST caps a single response at db-max-rows. */
async function allCandidates() {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("time_logs")
      .select("id, occurred_at, snapshot_path, snapshot_uploaded_at")
      .not("snapshot_path", "is", null)
      .is("snapshot_purged_at", null)
      .order("occurred_at")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("Could not list snapshots:", error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

/** Everything in one storage folder, listed once and reused (also paged). */
const folders = new Map();
async function folderContents(dir) {
  if (folders.has(dir)) return folders.get(dir);
  const names = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: PAGE, offset });
    if (error) {
      folders.set(dir, { names: [], error });
      return folders.get(dir);
    }
    names.push(...data.map((o) => o.name));
    if (data.length < PAGE) break;
  }
  folders.set(dir, { names });
  return folders.get(dir);
}

/** Objects belonging to one time log: its id is the start of every path it has had. */
async function objectsFor(row) {
  const dir = row.snapshot_path.slice(0, row.snapshot_path.lastIndexOf("/"));
  const { names, error } = await folderContents(dir);
  if (error) return { dir, names: [], error };
  return { dir, names: names.filter((n) => n.startsWith(row.id)).map((n) => `${dir}/${n}`) };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------
const rows = await allCandidates();
console.log(`${url}\n${rows.length} time log(s) with a photo that has not been purged.\n`);

const work = [];
const nothingThere = [];
for (const row of rows) {
  const { names, error } = await objectsFor(row);
  if (error) {
    console.error(`  ${row.snapshot_path}: could not look in storage (${error.message})`);
    process.exitCode = 1;
    continue;
  }
  // The object may sit at the recorded path, or - if an earlier run was
  // interrupted after the move but before the database update - at another
  // path starting with the same time log id.
  const actual = names.includes(row.snapshot_path) ? row.snapshot_path : names[0];
  if (!actual) {
    // Nothing to retire. Either the upload never happened, or the photo really is gone.
    nothingThere.push(row);
    continue;
  }
  work.push({ ...row, actual, stranded: actual !== row.snapshot_path });
}

const stranded = work.filter((w) => w.stranded);
if (stranded.length) console.log(`${stranded.length} photo(s) left behind by an interrupted run will be reconnected.\n`);

if (!apply) {
  for (const w of work) console.log(`  would move ${w.actual}${w.stranded ? "  (stranded, log still says " + w.snapshot_path + ")" : ""}`);
  console.log(`\n${work.length} photo(s) would be retired, ${nothingThere.length} log(s) have no photo in storage.`);
  console.log("Nothing has been moved. Re-run with --apply to do it.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------
let moved = 0;
const failures = [];

for (const row of work) {
  const target = newPath(row.id, row.occurred_at);
  let at = row.actual;

  if (at !== target) {
    const { error } = await supabase.storage.from(BUCKET).move(at, target);
    if (error) {
      failures.push(`${at}: could not move (${error.message})`);
      continue;
    }
    at = target;
  }

  const { error: rpcError } = await supabase.rpc("rekey_snapshot", { p_time_log_id: row.id, p_new_path: target });
  if (!rpcError) {
    moved += 1;
    console.log(`  ${row.snapshot_path} -> ${target}`);
    continue;
  }

  // The call failed - but it may have committed and lost the answer on the way
  // back, and moving the photo back then would undo a retirement that already
  // happened. Ask the database what it actually holds.
  const { data: after } = await supabase.from("time_logs").select("snapshot_path, snapshot_purged_at").eq("id", row.id).maybeSingle();

  if (after?.snapshot_path === target) {
    moved += 1;
    console.log(`  ${row.snapshot_path} -> ${target}  (confirmed after a failed reply)`);
    continue;
  }

  if (after?.snapshot_purged_at) {
    // The purge job reached this row while we were moving it. Retention wins:
    // the photo is due for deletion, and it must not be left behind.
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([target]);
    failures.push(
      removeError
        ? `${row.snapshot_path}: purged while moving, and the photo is still at ${target} (${removeError.message}) - delete it`
        : `${row.snapshot_path}: purged by the retention job while moving; the photo was deleted instead`,
    );
    continue;
  }

  const { error: backError } = await supabase.storage.from(BUCKET).move(target, row.snapshot_path);
  failures.push(
    backError
      ? `${row.snapshot_path}: NOT restored - the photo is at ${target} while the log still says ${row.snapshot_path} (${rpcError.message}; putting it back failed: ${backError.message}). Re-run to reconnect it.`
      : `${row.snapshot_path}: database not updated, photo moved back (${rpcError.message})`,
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(`\nRetired ${moved} of ${work.length} photo(s).`);
if (nothingThere.length) {
  console.log(`${nothingThere.length} log(s) had no photo in storage - nothing to retire for those.`);
}
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of failures) console.log(`  ${f}`);
  console.log("\nLinks to the paths listed above may still work. Fix the cause and run this again.");
  process.exitCode = 1;
} else if (moved === work.length) {
  console.log("Links to the old paths no longer resolve.");
}
