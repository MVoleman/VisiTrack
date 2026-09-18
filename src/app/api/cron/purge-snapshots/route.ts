import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deletes webcam snapshots older than app_settings.snapshot_retention_days (GDPR).
 * Scheduled daily by Vercel Cron (vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
 * Storage objects can only be removed through the Storage API, hence a job rather than SQL.
 */
const BATCH = 500;
const TIME_BUDGET_MS = 50_000;

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  if (!supabase) return Response.json({ error: "SUPABASE_SECRET_KEY is not configured" }, { status: 500 });

  const started = Date.now();
  let purged = 0;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: due, error } = await supabase.rpc("snapshots_due_for_purge", { p_limit: BATCH });
    if (error) return failure("list", error, purged);
    if (!due.length) break;

    const { error: removeError } = await supabase.storage.from("snapshots").remove(due.map((d) => d.snapshot_path));
    // Only mark as purged once the objects are really gone; the next run retries otherwise.
    if (removeError) return failure("remove", removeError, purged);

    const { data: marked, error: markError } = await supabase.rpc("mark_snapshots_purged", {
      p_time_log_ids: due.map((d) => d.time_log_id),
    });
    if (markError) return failure("mark", markError, purged);

    purged += marked ?? 0;
    if (due.length < BATCH) break;
  }

  console.info(`Purged ${purged} snapshots in ${Date.now() - started} ms`);
  return Response.json({ purged });
}

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function failure(step: string, error: { message: string }, purged: number) {
  console.error(`Snapshot purge failed at ${step}`, error.message);
  return Response.json({ error: `Purge failed at ${step}`, purged }, { status: 500 });
}
