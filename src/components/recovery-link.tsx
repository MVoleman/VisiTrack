"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Catches a password recovery link that arrives as a URL fragment.
 *
 * Supabase's default email template links to its own /auth/v1/verify, which
 * verifies the token and then bounces the browser back with the session in the
 * fragment: `#access_token=...&type=recovery`. A fragment is never sent to the
 * server, so /auth/confirm cannot see it - and which page it lands on depends
 * on the project's Site URL and redirect allowlist. So this listens everywhere:
 * wherever a recovery link drops the person, they end up on the page where a
 * new password is chosen, signed in for that one purpose.
 *
 * Links built with `{{ .TokenHash }}` instead are verified server-side by
 * /auth/confirm and never reach this component.
 */
export function RecoveryLink() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("type=recovery") && !hash.includes("error")) return;

    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const failed = params.get("error");

    // Take the tokens out of the address bar before doing anything else: they
    // are credentials, and they would otherwise sit in history and be sent on
    // as a referrer.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (failed || !accessToken || !refreshToken) {
      if (failed || params.get("type") === "recovery") router.replace("/login?error=expired_link");
      return;
    }

    createClient()
      .auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        router.replace(error ? "/login?error=expired_link" : "/login/nytt-losenord");
        router.refresh();
      });
  }, [router]);

  return null;
}
