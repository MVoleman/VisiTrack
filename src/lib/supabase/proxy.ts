import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

const PROTECTED_PREFIXES = ["/admin"];

/**
 * Refreshes the Supabase auth session on each request and guards admin routes.
 * Fails closed: if Supabase is not configured, admin routes redirect to /login.
 */
export async function updateSession(request: NextRequest, extraHeaders: Record<string, string>) {
  /**
   * Headers to forward to the render, built fresh each time: refreshing the
   * session rewrites request.cookies, and a snapshot taken before that would
   * hand the renderer an expired token (and bounce the user to /login).
   */
  const forward = () => {
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
    return headers;
  };

  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const env = getSupabaseEnv();
  if (!env) {
    return isProtected ? redirectToLogin(request) : NextResponse.next({ request: { headers: forward() } });
  }

  let response = NextResponse.next({ request: { headers: forward() } });

  const supabase = createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: forward() } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not run code between createServerClient and getClaims(): it validates
  // the JWT and triggers a token refresh when needed.
  const { data } = await supabase.auth.getClaims();

  if (isProtected && !data?.claims) {
    // Carry over anything Supabase wrote - notably the cookie-clearing headers
    // from a failed refresh, which would otherwise leave a dead session cookie.
    return redirectToLogin(request, response);
  }

  return response;
}

function redirectToLogin(request: NextRequest, carry?: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname);
  const redirect = NextResponse.redirect(url);
  for (const cookie of carry?.cookies.getAll() ?? []) redirect.cookies.set(cookie);
  return redirect;
}
