"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ActionResult } from "@/lib/types";
import { saveWorker, type SavedWorker } from "./actions";

export type EditableWorker = { id: string; full_name: string; company: string; role: string; email: string | null };

export function WorkerFormDialog({
  open,
  onOpenChange,
  worker,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worker: EditableWorker | null;
  onSaved: (worker: SavedWorker, created: boolean) => void;
}) {
  const [state, formAction, pending] = useActionState<ActionResult<SavedWorker> | null, FormData>(
    async (prev, formData) => {
      const result = await saveWorker(prev, formData);
      if (result.ok && result.data) {
        toast.success(result.message);
        onSaved(result.data, !worker);
      }
      return result;
    },
    null,
  );

  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const values = worker ?? { full_name: "", company: "", role: "", email: "" };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-lg">{worker ? "Redigera person" : "Lägg till person"}</DialogTitle>
          <DialogDescription>
            {worker
              ? "Ändringar syns direkt i kiosken och i rapporterna."
              : "En personlig QR-kod skapas automatiskt när personen sparas."}
          </DialogDescription>
        </DialogHeader>

        {/* Keyed so the uncontrolled fields reset when switching between people. */}
        <form key={worker?.id ?? "new"} action={formAction} className="grid gap-6">
          {worker && <input type="hidden" name="id" value={worker.id} />}
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.full_name}>
              <FieldLabel htmlFor="full_name">Namn</FieldLabel>
              <Input id="full_name" name="full_name" defaultValue={values.full_name} autoComplete="off" required maxLength={120} autoFocus aria-invalid={!!errors.full_name} />
              <FieldError>{errors.full_name}</FieldError>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.company}>
                <FieldLabel htmlFor="company">Företag</FieldLabel>
                <Input id="company" name="company" defaultValue={values.company} autoComplete="off" required maxLength={120} aria-invalid={!!errors.company} />
                <FieldError>{errors.company}</FieldError>
              </Field>
              <Field data-invalid={!!errors.role}>
                <FieldLabel htmlFor="role">Roll</FieldLabel>
                <Input id="role" name="role" defaultValue={values.role} placeholder="t.ex. Städ, Elektriker" autoComplete="off" required maxLength={80} aria-invalid={!!errors.role} />
                <FieldError>{errors.role}</FieldError>
              </Field>
            </div>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">
                E-post <span className="font-normal text-muted-foreground">(valfritt)</span>
              </FieldLabel>
              <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} autoComplete="off" aria-invalid={!!errors.email} />
              {errors.email ? <FieldError>{errors.email}</FieldError> : <FieldDescription>Används för att skicka QR-koden i en senare version.</FieldDescription>}
            </Field>
          </FieldGroup>

          {state && !state.ok && !state.fieldErrors && (
            <p role="alert" className="text-sm text-destructive">{state.error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {worker ? "Spara ändringar" : "Lägg till"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
