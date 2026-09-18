import "server-only";
import type { Session } from "@/lib/auth";

export const SNAPSHOT_BUCKET = "snapshots";
/** Signed URLs are short-lived: long enough to view a page, short enough to be useless if leaked. */
const SIGNED_URL_SECONDS = 10 * 60;

type SnapshotFields = {
  snapshot_path: string | null;
  snapshot_uploaded_at: string | null;
  snapshot_purged_at: string | null;
};

export type SnapshotState = "available" | "missing" | "purged" | "none";

export function snapshotState(row: SnapshotFields): SnapshotState {
  if (!row.snapshot_path) return "none";
  if (row.snapshot_purged_at) return "purged";
  if (!row.snapshot_uploaded_at) return "missing";
  return "available";
}

/** Returns a map of snapshot_path → signed URL for every row with an available snapshot. */
export async function signSnapshotUrls(supabase: Session["supabase"], rows: SnapshotFields[]) {
  const paths = [
    ...new Set(rows.filter((r) => snapshotState(r) === "available").map((r) => r.snapshot_path!)),
  ];
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;

  const { data, error } = await supabase.storage.from(SNAPSHOT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (error) {
    console.error("Failed to sign snapshot URLs", error);
    return urls;
  }
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}
