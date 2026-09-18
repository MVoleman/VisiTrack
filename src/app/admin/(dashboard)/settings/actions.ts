"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

const int = (min: number, max: number) =>
  z.coerce.number({ error: "Ange ett heltal." }).int("Ange ett heltal.").min(min, `Minst ${min}.`).max(max, `Högst ${max}.`);

const settingsSchema = z.object({
  presence_window_hours: int(1, 72),
  duplicate_scan_seconds: int(0, 600),
  snapshot_retention_days: int(1, 365),
});

export async function updateSettings(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase } = await requireAdmin();

  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Kontrollera de markerade fälten.", fieldErrors };
  }

  const { error } = await supabase.from("app_settings").update(parsed.data).eq("id", true);
  if (error) {
    console.error("updateSettings", error);
    return { ok: false, error: "Inställningarna kunde inte sparas." };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Inställningarna är sparade." };
}
