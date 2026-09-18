export const SNAPSHOT_BUCKET = "snapshots";

type SnapshotFields = {
  snapshot_path: string | null;
  snapshot_uploaded_at: string | null;
  snapshot_purged_at: string | null;
};

export type SnapshotState = "available" | "missing" | "purged" | "none";

/** Storage path of a kiosk snapshot: snapshots/<yyyy>/<mm>/<time_log_id>.jpg */
export const SNAPSHOT_PATH_PATTERN =
  /^\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;

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
