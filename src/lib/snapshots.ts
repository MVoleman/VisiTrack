export const SNAPSHOT_BUCKET = "snapshots";

type SnapshotFields = {
  snapshot_path: string | null;
  snapshot_uploaded_at: string | null;
  snapshot_purged_at: string | null;
};

export type SnapshotState = "available" | "missing" | "purged" | "none";

/**
 * Storage path of a kiosk snapshot: `<yyyy>/<mm>/<time_log_id>-<random>.jpg`.
 *
 * The random half is what makes a path unguessable, and lets a leaked path be
 * retired for good (see supabase/migrations/20260918190000). Paths written
 * before that migration have no random half, so both shapes are accepted until
 * `npm run snapshots:rekey` has moved them.
 */
export const SNAPSHOT_PATH_PATTERN =
  /^\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9a-f]{32})?\.jpg$/;

export function snapshotState(row: SnapshotFields): SnapshotState {
  if (!row.snapshot_path) return "none";
  if (row.snapshot_purged_at) return "purged";
  if (!row.snapshot_uploaded_at) return "missing";
  return "available";
}

/**
 * URL for a snapshot, served by our own route handler.
 *
 * Snapshots are never handed out as Supabase signed URLs: a signed URL can be
 * created with any expiry and then works for anyone who has the link, which
 * would put staff photos outside the retention policy with no trace. The route
 * checks the caller's role and re-checks the row through their own RLS policies
 * on every request instead.
 */
export function snapshotUrl(row: SnapshotFields): string | null {
  return snapshotState(row) === "available" ? `/admin/snapshots/${row.snapshot_path}` : null;
}
