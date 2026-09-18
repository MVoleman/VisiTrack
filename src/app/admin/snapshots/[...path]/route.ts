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

  const admin = createAdminClient();
  if (!admin) {
    console.error("SUPABASE_SECRET_KEY is not configured; snapshots cannot be served");
    return new Response("Snapshot storage is not configured", { status: 500 });
  }

  const { data: file, error } = await admin.storage.from(SNAPSHOT_BUCKET).download(objectPath);
  if (error || !file) {
    console.warn("Snapshot download failed", objectPath, error?.message);
    return new Response("Not found", { status: 404 });
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
