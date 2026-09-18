"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/** Absolute origin of this deployment, used for the link in the reset email. */
async function origin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) {
    return { ok: false, error: "Ange en giltig e-postadress." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/confirm?next=${encodeURIComponent("/login/nytt-losenord")}`,
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
    console.error("updatePassword failed", { status: error.status, code: error.code });
    if (error.code === "same_password") return { ok: false, error: "Välj ett lösenord du inte redan använder." };
    if (error.code === "weak_password") return { ok: false, error: "Lösenordet är för svagt. Välj ett längre lösenord." };
    return { ok: false, error: "Lösenordet kunde inte sparas. Försök igen." };
  }

  return { ok: true, message: "Lösenordet är uppdaterat." };
}
