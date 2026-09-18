"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertCircle, MonitorSmartphone } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Database } from "@/lib/supabase/database.types";

/** One-time setup: an administrator signs the tablet in with its kiosk account. */
export function KioskSignIn({
  supabase,
  initialError,
  onSignedIn,
}: {
  supabase: SupabaseClient<Database>;
  initialError?: string;
  onSignedIn: () => Promise<string | undefined>;
}) {
  const [error, setError] = useState(initialError);
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    setError(undefined);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
    });
    if (authError) {
      setError(
        authError.code === "invalid_credentials"
          ? "Fel e-postadress eller lösenord."
          : "Inloggningen misslyckades. Kontrollera nätverket och försök igen.",
      );
      setPending(false);
      return;
    }
    const roleError = await onSignedIn();
    if (roleError) {
      setError(roleError);
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">
          <MonitorSmartphone className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Konfigurera kiosk</h1>
        <p className="mt-1.5 text-muted-foreground">
          Logga in med enhetens kioskkonto. Det görs en gång per surfplatta.
        </p>

        <form action={submit} className="mt-8 grid gap-6 rounded-2xl bg-card p-6 shadow-lifted ring-1 ring-foreground/[0.06]">
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="kiosk-email">Kioskkonto (e-post)</FieldLabel>
              <Input id="kiosk-email" name="email" type="email" autoComplete="username" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="kiosk-password">Lösenord</FieldLabel>
              <Input id="kiosk-password" name="password" type="password" autoComplete="current-password" required />
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {pending && <Spinner />}
            Logga in enheten
          </Button>
        </form>
      </div>
    </main>
  );
}
