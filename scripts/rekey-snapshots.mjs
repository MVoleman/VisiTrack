#!/usr/bin/env node
// Retires every snapshot path, so that any Supabase signed URL still out there
// stops working.
//
//   npm run snapshots:rekey -- --dry-run     # list what would move
//   npm run snapshots:rekey                  # move them
//
// WHEN TO RUN THIS
//   * a signed URL to a photo may have been created and shared (before
//     2026-09-18 the admin pages minted one per image, and anyone signed in
//     could mint one with any expiry)
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
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from the environment,
// or from the env file given with --env (default .env.local).

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envFile = args.find((a) => a.startsWith("--env="))?.slice(6) ?? ".env.local";

function envFromFile(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
    );
  } catch {
    return {};
  }
}

const fileEnv = envFromFile(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? fileEnv.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error(`Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (looked in the environment and ${envFile}).`);
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

// <yyyy>/<mm>/<time_log_id>-<32 hex>.jpg - the shape public.rekey_snapshot insists on.
function newPath(id, occurredAt) {
  const at = new Date(occurredAt);
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${at.getUTCFullYear()}/${month}/${id}-${randomBytes(16).toString("hex")}.jpg`;
}

const { data: rows, error } = await supabase
  .from("time_logs")
  .select("id, occurred_at, snapshot_path, snapshot_uploaded_at")
  .not("snapshot_path", "is", null)
  .is("snapshot_purged_at", null)
  .order("occurred_at");

if (error) {
  console.error("Could not list snapshots:", error.message);
  process.exit(1);
}

const pending = rows.filter((r) => r.snapshot_uploaded_at);
const reserved = rows.length - pending.length;

console.log(`${url}`);
console.log(`${pending.length} photo(s) to retire${reserved ? `, ${reserved} reserved path(s) skipped (upload not confirmed)` : ""}.`);
if (dryRun) {
  for (const row of pending) console.log(`  would move ${row.snapshot_path}`);
  process.exit(0);
}

let moved = 0;
for (const row of pending) {
  const target = newPath(row.id, row.occurred_at);

  // Move first: if the database update then fails, the photo is put back, and
  // the log still points at a path that holds it.
  const { error: moveError } = await supabase.storage.from("snapshots").move(row.snapshot_path, target);
  if (moveError) {
    console.error(`  ${row.snapshot_path}: could not move (${moveError.message})`);
    continue;
  }

  const { error: rpcError } = await supabase.rpc("rekey_snapshot", { p_time_log_id: row.id, p_new_path: target });
  if (rpcError) {
    await supabase.storage.from("snapshots").move(target, row.snapshot_path);
    console.error(`  ${row.snapshot_path}: database not updated, photo moved back (${rpcError.message})`);
    continue;
  }

  moved += 1;
  console.log(`  ${row.snapshot_path} -> ${target}`);
}

console.log(`\nRetired ${moved} of ${pending.length}. Links to the old paths no longer resolve.`);
if (moved < pending.length) process.exitCode = 1;
