import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/security-headers";
import { updateSession } from "@/lib/supabase/proxy";

/** Routes where a Supabase session must be refreshed and admin access enforced. */
const SESSION_PATHS = ["/admin", "/login"];

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  // Next.js reads the nonce out of the request's CSP header while rendering and
  // stamps it onto its own script tags; nothing else needs to know it.
  const extraHeaders = { "Content-Security-Policy": csp };

  const { pathname } = request.nextUrl;
  const needsSession = SESSION_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const forwarded = new Headers(request.headers);
  for (const [key, value] of Object.entries(extraHeaders)) forwarded.set(key, value);

  const response = needsSession
    ? await updateSession(request, extraHeaders)
    : NextResponse.next({ request: { headers: forwarded } });

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets. The Next.js CSP guide also excludes
    // prefetches, but the matcher tests the REQUEST header, so a prefetched
    // document would lose both the policy and the session guard.
    "/((?!_next/static|_next/image|zxing|favicon.ico).*)",
  ],
};
