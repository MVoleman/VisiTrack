"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/types";
import { updatePassword } from "@/app/login/reset-actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await updatePassword(prev, formData);
    if (result.ok) toast.success(result.message);
    return result;
  }, null);

  return (
    // Remounts after a successful save so the fields clear.
    <form key={state?.ok ? "saved" : "editing"} action={formAction} className="grid max-w-sm gap-6">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="new-password">Nytt lösenord</FieldLabel>
          <Input id="new-password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Field>
          <FieldLabel htmlFor="new-password-repeat">Upprepa lösenordet</FieldLabel>
          <Input id="new-password-repeat" name="password_repeat" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </FieldGroup>

      {state && !state.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <Spinner />}
        Spara lösenord
      </Button>
    </form>
  );
}
