import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { SNAPSHOT_BUCKET, SNAPSHOT_PATH_PATTERN } from "@/lib/snapshots";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Serves a kiosk snapshot to a signed-in admin or viewer.
 *
 * The storage bucket has no read policy for any browser-facing role, so the
 * image is fetched here with the secret key. Two checks run before that:
 * the caller must have a role, and the row must still be visible through the
 * caller's OWN client — so row level security, not this handler, decides who
 * sees what. Nothing cacheable or shareable leaves the server.
 */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/webp"]);

export async function GET(_request: NextRequest, ctx: RouteContext<"/admin/snapshots/[...path]">) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { path } = await ctx.params;
  const objectPath = (Array.isArray(path) ? path.join("/") : path) ?? "";
  if (!SNAPSHOT_PATH_PATTERN.test(objectPath)) {
    return new Response("Not found", { status: 404 });
  }

  // Re-check visibility as the caller, not as the service role.
  const { data: row } = await session.supabase
    .from("time_logs")
    .select("id")
    .eq("snapshot_path", objectPath)
    .is("snapshot_purged_at", null)
    .not("snapshot_uploaded_at", "is", null)
    .maybeSingle();

  if (!row) return new Response("Not found", { status: 404 });

  // One neutral body for every caller and every cause. The status code is what
  // carries the difference, so the server log and a viewer's screen never
  // disagree about what a viewer is allowed to know.
  const unavailable = (status: number) => new Response("Bilden kan inte visas", { status });

  const admin = createAdminClient();
  if (!admin) {
    console.error("snapshot-storage-unavailable: SUPABASE_SECRET_KEY is not set");
    return unavailable(503);
  }

  const { data: file, error } = await admin.storage.from(SNAPSHOT_BUCKET).download(objectPath);
  if (error || !file) {
    // A wrong key and a deleted photo both answer "Object not found" here, and
    // the difference matters: one is a broken deployment, the other is data
    // loss to report. Asking for the bucket separates them - it succeeds only
    // if the credentials are good.
    const { error: bucketError } = await admin.storage.getBucket(SNAPSHOT_BUCKET);
    if (bucketError) {
      console.error("snapshot-storage-unavailable:", bucketError.message);
      return unavailable(503);
    }

    // The row says the photo was uploaded and not purged, but it is gone.
    console.error("snapshot-object-missing:", objectPath, error?.message);
    return unavailable(410);
  }

  return new Response(file, {
    headers: {
      "Content-Type": ALLOWED_TYPES.has(file.type) ? file.type : "image/jpeg",
      "Content-Length": String(file.size),
      // Personal data: never stored by a shared cache, never written to disk.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
