"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSettings, requireAdmin } from "@/lib/auth";
import { localDateTimeToIso } from "@/lib/time";
import type { ActionResult } from "@/lib/types";

const manualSchema = z.object({
  worker_id: z.uuid("Välj en person."),
  event_type: z.enum(["check_in", "check_out"], "Välj typ av registrering."),
  occurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Ange datum och tid."),
  note: z.string().trim().min(3, "Beskriv varför registreringen läggs till manuellt.").max(500, "Högst 500 tecken."),
});

export async function addManualLog(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const settings = await getSettings();

  const parsed = manualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Kontrollera de markerade fälten.", fieldErrors };
  }

  const occurredAt = localDateTimeToIso(parsed.data.occurred_at, settings.time_zone);
  if (!occurredAt) return { ok: false, error: "Ogiltig tid.", fieldErrors: { occurred_at: "Ogiltig tid." } };
  if (Date.parse(occurredAt) > Date.now() + 60_000) {
    return { ok: false, error: "Tiden kan inte vara i framtiden.", fieldErrors: { occurred_at: "Tiden kan inte vara i framtiden." } };
  }

  const { error } = await supabase.from("time_logs").insert({
    worker_id: parsed.data.worker_id,
    event_type: parsed.data.event_type,
    occurred_at: occurredAt,
    note: parsed.data.note,
  });

  if (error) {
    console.error("addManualLog", error);
    return { ok: false, error: "Registreringen kunde inte sparas." };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Den manuella registreringen är sparad." };
}

export async function updateLogNote(logId: string, note: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = z.object({ id: z.uuid(), note: z.string().trim().max(500) }).safeParse({ id: logId, note });
  if (!parsed.success) return { ok: false, error: "Anteckningen får vara högst 500 tecken." };

  const { error } = await supabase
    .from("time_logs")
    .update({ note: parsed.data.note || null })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: "Anteckningen kunde inte sparas." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Anteckningen är sparad." };
}

export async function voidLog(logId: string, reason: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  const parsed = z
    .object({ id: z.uuid(), reason: z.string().trim().min(3, "Ange en orsak.").max(500) })
    .safeParse({ id: logId, reason });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ange en orsak." };

  // voided_at/voided_by are set by the database trigger.
  const { error } = await supabase
    .from("time_logs")
    .update({ void_reason: parsed.data.reason })
    .eq("id", parsed.data.id)
    .is("voided_at", null);
  if (error) {
    console.error("voidLog", error);
    return { ok: false, error: "Registreringen kunde inte makuleras." };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Registreringen är makulerad." };
}
