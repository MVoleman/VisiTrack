"use client";

import { useActionState } from "react";
import { AlertCircle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/types";
import { requestPasswordReset } from "../reset-actions";

export function ResetRequestForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(requestPasswordReset, null);

  if (state?.ok) {
    return (
      <div className="grid gap-3 text-sm">
        <span className="grid size-10 place-items-center rounded-xl bg-success-soft text-success">
          <MailCheck className="size-5" />
        </span>
        <p className="font-medium">Kontrollera din e-post</p>
        <p className="text-muted-foreground">{state.message}</p>
        <p className="text-muted-foreground">Länken gäller i en timme.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-6">
      <Field>
        <FieldLabel htmlFor="email">E-post</FieldLabel>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>

      {state && !state.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Spinner />}
        Skicka återställningslänk
      </Button>
    </form>
  );
}
