import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in Supabase emails (password reset, invitations).
 * Exchanges the one-time token for a session, then sends the person on to
 * `next` — normally the "choose a new password" page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  // Only allow redirects back into this app.
  const destination = next && /^\/[\w\-/]*$/.test(next) ? next : "/admin";

  const code = searchParams.get("code");

  if (!code && (!token_hash || !type)) {
    // Supabase's own /auth/v1/verify sends the session back in the URL fragment,
    // which never reaches a server. RecoveryLink picks that up in the browser -
    // the fragment survives this redirect.
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type!, token_hash: token_hash! });

  if (error) {
    console.warn("Email link verification failed", { status: error.status, code: error.code });
    return NextResponse.redirect(`${origin}/login?error=expired_link`);
  }

  return NextResponse.redirect(`${origin}${destination}`);
}
