import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only run where a session matters. The kiosk is intentionally excluded:
  // it runs unattended and must never be redirected to a login screen.
  matcher: ["/admin/:path*", "/login"],
};
