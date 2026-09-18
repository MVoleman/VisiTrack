"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error?: string; email?: string };

const credentials = z.object({
  email: z.email(),
  password: z.string().min(1),
});

/** Only allow redirects back into the admin area (prevents open redirects). */
function safeNext(next: FormDataEntryValue | null) {
  return typeof next === "string" && /^\/admin(\/[\w\-/]*)?$/.test(next) ? next : "/admin";
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const parsed = credentials.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Ange en giltig e-postadress och ditt lösenord.", email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    if (error?.code === "invalid_credentials") {
      return { error: "Fel e-postadress eller lösenord.", email };
    }
    if (error?.status === 429) {
      return { error: "För många försök. Vänta en stund och försök igen.", email };
    }
    // Anything else is a configuration or service problem, not the user's input.
    console.error("signIn failed", { status: error?.status, code: error?.code, message: error?.message });
    return { error: "Inloggningen är inte tillgänglig just nu. Kontakta systemansvarig.", email };
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (appUser?.role !== "admin" && appUser?.role !== "viewer") {
    await supabase.auth.signOut();
    return { error: "Kontot har inte behörighet till administrationen.", email };
  }

  redirect(safeNext(formData.get("next")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
