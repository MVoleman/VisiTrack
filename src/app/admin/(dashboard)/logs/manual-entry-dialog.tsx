"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { isoDateInZone, isoTimeInZone } from "@/lib/time";
import type { ActionResult } from "@/lib/types";
import { addManualLog } from "./actions";
import type { WorkerOption } from "./log-filters";

export function ManualEntryDialog({ workers, timeZone }: { workers: WorkerOption[]; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [defaultTime, setDefaultTime] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await addManualLog(prev, formData);
    if (result.ok) {
      toast.success(result.message);
      setOpen(false);
    }
    return result;
  }, null);

  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          const now = new Date();
          setDefaultTime(`${isoDateInZone(now, timeZone)}T${isoTimeInZone(now, timeZone).slice(0, 5)}`);
          setFormKey((k) => k + 1);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10">
          <Plus />
          Manuell registrering
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-lg">Manuell registrering</DialogTitle>
          <DialogDescription>
            För glömda in- eller utcheckningar. Manuella registreringar markeras tydligt och saknar bild.
          </DialogDescription>
        </DialogHeader>

        <form key={formKey} action={formAction} className="grid gap-6">
          <FieldGroup className="gap-4">
            <Field data-invalid={!!errors.worker_id}>
              <FieldLabel>Person</FieldLabel>
              <Select name="worker_id" required>
                <SelectTrigger className="w-full" aria-invalid={!!errors.worker_id} aria-label="Person">
                  <SelectValue placeholder="Välj person" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.label} <span className="text-muted-foreground">· {w.description}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError>{errors.worker_id}</FieldError>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!errors.event_type}>
                <FieldLabel>Typ</FieldLabel>
                <Select name="event_type" defaultValue="check_out">
                  <SelectTrigger className="w-full" aria-label="Typ">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check_in">Incheckning</SelectItem>
                    <SelectItem value="check_out">Utcheckning</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError>{errors.event_type}</FieldError>
              </Field>
              <Field data-invalid={!!errors.occurred_at}>
                <FieldLabel htmlFor="occurred_at">Datum och tid</FieldLabel>
                <Input id="occurred_at" name="occurred_at" type="datetime-local" required defaultValue={defaultTime} max={defaultTime} aria-invalid={!!errors.occurred_at} />
                <FieldError>{errors.occurred_at}</FieldError>
              </Field>
            </div>

            <Field data-invalid={!!errors.note}>
              <FieldLabel htmlFor="manual-note">Orsak</FieldLabel>
              <Textarea id="manual-note" name="note" required minLength={3} maxLength={500} placeholder="t.ex. Glömde checka ut, bekräftat med arbetsledare" aria-invalid={!!errors.note} />
              <FieldError>{errors.note}</FieldError>
            </Field>
          </FieldGroup>

          {state && !state.ok && !state.fieldErrors && <p role="alert" className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Spara
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
