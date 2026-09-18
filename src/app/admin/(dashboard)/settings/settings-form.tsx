"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult, AppSettings } from "@/lib/types";
import { updateSettings } from "./actions";

const fields = [
  {
    name: "presence_window_hours",
    label: "Glömd utcheckning efter",
    unit: "timmar",
    min: 1,
    max: 72,
    description: "En incheckning äldre än så räknas inte längre som närvarande. Nästa skanning blir en ny incheckning.",
  },
  {
    name: "duplicate_scan_seconds",
    label: "Ignorera upprepad skanning inom",
    unit: "sekunder",
    min: 0,
    max: 600,
    description: "Förhindrar att någon checkas in och direkt ut igen om QR-koden hålls kvar framför kameran.",
  },
  {
    name: "snapshot_retention_days",
    label: "Spara bilder i",
    unit: "dagar",
    min: 1,
    max: 365,
    description: "Bilder raderas automatiskt därefter (GDPR). Själva tidrapporterna sparas.",
  },
] as const;

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await updateSettings(prev, formData);
    if (result.ok) toast.success(result.message);
    return result;
  }, null);

  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form action={formAction} className="grid gap-6">
      <FieldGroup className="gap-6">
        {fields.map((f) => (
          <Field key={f.name} data-invalid={!!errors[f.name]}>
            <FieldLabel htmlFor={f.name}>{f.label}</FieldLabel>
            <div className="flex items-center gap-3">
              <Input
                id={f.name}
                name={f.name}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                step={1}
                required
                defaultValue={settings[f.name]}
                className="w-28 tabular-nums"
                aria-invalid={!!errors[f.name]}
              />
              <span className="text-sm text-muted-foreground">{f.unit}</span>
            </div>
            {errors[f.name] ? <FieldError>{errors[f.name]}</FieldError> : <FieldDescription>{f.description}</FieldDescription>}
          </Field>
        ))}
      </FieldGroup>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          Spara inställningar
        </Button>
      </div>
    </form>
  );
}
