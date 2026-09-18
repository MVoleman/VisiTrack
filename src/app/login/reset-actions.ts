"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/**
 * Absolute origin used for the link in the reset email.
 *
 * Deliberately configuration-only: deriving it from the Host or X-Forwarded-Host
 * header lets anyone who can spoof those headers redirect a recovery token to
 * their own domain, which is account takeover. Returns null when unset so the
 * caller can fail with a clear message instead of sending a broken link.
 */
function siteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) {
    return { ok: false, error: "Ange en giltig e-postadress." };
  }

  const origin = siteOrigin();
  if (!origin) {
    console.error("NEXT_PUBLIC_SITE_URL is not set; refusing to build a password reset link from request headers");
    return {
      ok: false,
      error: "Lösenordsåterställning är inte konfigurerad. Kontakta systemansvarig.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent("/login/nytt-losenord")}`,
  });

  // Never reveal whether an address exists; only surface real service problems.
  if (error && error.status !== 400) {
    console.error("requestPasswordReset failed", { status: error.status, code: error.code });
    if (error.status === 429) {
      return { ok: false, error: "För många försök. Vänta en stund och försök igen." };
    }
    return { ok: false, error: "Det gick inte att skicka återställningslänken just nu." };
  }

  return {
    ok: true,
    message: "Om adressen finns hos oss har ett mejl skickats med en länk för att välja nytt lösenord.",
  };
}

const passwordSchema = z
  .string()
  .min(10, "Lösenordet måste vara minst 10 tecken.")
  .max(72, "Lösenordet får vara högst 72 tecken.");

export async function updatePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const repeat = String(formData.get("password_repeat") ?? "");

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (password !== repeat) return { ok: false, error: "Lösenorden matchar inte." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    return { ok: false, error: "Länken har gått ut. Begär en ny återställningslänk." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.error("updatePassword failed", { status: error.status, code: error.code, message: error.message });
    return { ok: false, error: passwordErrorMessage(error) };
  }

  return { ok: true, message: "Lösenordet är uppdaterat." };
}

/**
 * Turns a Supabase auth error into something the person can act on. Anything
 * unrecognised keeps its code, so a failure can be diagnosed from a screenshot
 * instead of server logs.
 */
function passwordErrorMessage(error: { code?: string; status?: number; message?: string }) {
  switch (error.code) {
    case "same_password":
      return "Välj ett lösenord du inte redan använder.";
    case "weak_password":
      return "Lösenordet uppfyller inte projektets krav. Prova ett längre lösenord med både bokstäver och siffror.";
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      // The project has "Secure password change" enabled, which requires a
      // freshly confirmed login before the password may be replaced.
      return "Av säkerhetsskäl måste inloggningen bekräftas på nytt. Logga ut, logga in igen och byt lösenord direkt efteråt.";
    case "session_not_found":
    case "session_expired":
      return "Din session har gått ut. Logga in igen och försök på nytt.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "För många försök. Vänta en stund och försök igen.";
    default:
      if (error.status === 401 || error.status === 403) {
        return "Behörigheten saknas för att byta lösenord här. Logga ut och in igen.";
      }
      return `Lösenordet kunde inte sparas${error.code ? ` (felkod: ${error.code})` : ""}. Försök igen.`;
  }
}
