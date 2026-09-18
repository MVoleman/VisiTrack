"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/types";
import { updatePassword } from "../reset-actions";

export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(updatePassword, null);

  if (state?.ok) {
    return (
      <div className="grid gap-4 text-sm">
        <span className="grid size-10 place-items-center rounded-xl bg-success-soft text-success">
          <CheckCircle2 className="size-5" />
        </span>
        <p className="font-medium">{state.message}</p>
        <Button asChild size="lg" className="mt-1 w-full">
          <Link href="/admin">Till administrationen</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-6">
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="password">Nytt lösenord</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
        </Field>
        <Field>
          <FieldLabel htmlFor="password_repeat">Upprepa lösenordet</FieldLabel>
          <Input id="password_repeat" name="password_repeat" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
      </FieldGroup>

      {state && !state.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending && <Spinner />}
        Spara lösenord
      </Button>
    </form>
  );
}
