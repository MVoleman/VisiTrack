"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `Ange ${label}.`)
    .max(max, `Högst ${max} tecken.`);

const workerSchema = z.object({
  id: z.uuid().optional(),
  full_name: text(120, "namn"),
  company: text(120, "företag"),
  role: text(80, "roll"),
  email: z
    .union([z.literal(""), z.email("Ange en giltig e-postadress.")])
    .transform((v) => (v === "" ? null : v.toLowerCase())),
});

/** The badge token is created by a database trigger and fetched on demand. */
export type SavedWorker = { id: string; full_name: string; company: string; role: string };

export async function saveWorker(_prev: ActionResult<SavedWorker> | null, formData: FormData): Promise<ActionResult<SavedWorker>> {
  const { supabase } = await requireAdmin();

  const parsed = workerSchema.safeParse({
    id: formData.get("id") || undefined,
    full_name: formData.get("full_name") ?? "",
    company: formData.get("company") ?? "",
    role: formData.get("role") ?? "",
    email: String(formData.get("email") ?? "").trim(),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "Kontrollera de markerade fälten.", fieldErrors };
  }

  const { id, ...values } = parsed.data;
  const query = id
    ? supabase.from("workers").update(values).eq("id", id)
    : supabase.from("workers").insert(values);
  const { data, error } = await query.select("id, full_name, company, role").single();

  if (error) {
    console.error("saveWorker", error);
    return { ok: false, error: "Det gick inte att spara. Försök igen." };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: id ? "Ändringarna är sparade." : `${data.full_name} är tillagd.`, data };
}

export async function getWorkerQrToken(workerId: string): Promise<ActionResult<{ qr_token: string }>> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(workerId).success) return { ok: false, error: "Ogiltig person." };

  const { data, error } = await supabase
    .from("worker_badges")
    .select("token")
    .eq("worker_id", workerId)
    .single();
  if (error) return { ok: false, error: "QR-koden kunde inte hämtas." };
  return { ok: true, data: { qr_token: data.token } };
}

export async function setWorkerActive(workerId: string, active: boolean): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(workerId).success) return { ok: false, error: "Ogiltig person." };

  const { error } = await supabase.from("workers").update({ is_active: active }).eq("id", workerId);
  if (error) return { ok: false, error: "Statusen kunde inte ändras." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: active ? "Personen är aktiverad." : "Personen är inaktiverad. QR-koden fungerar inte längre." };
}

export async function rotateQrToken(workerId: string): Promise<ActionResult<{ qr_token: string }>> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(workerId).success) return { ok: false, error: "Ogiltig person." };

  const { data, error } = await supabase.rpc("rotate_worker_qr_token", { p_worker_id: workerId });
  if (error || !data) return { ok: false, error: "En ny QR-kod kunde inte skapas." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "En ny QR-kod är skapad. Den gamla fungerar inte längre.", data: { qr_token: data } };
}

export async function deleteWorker(workerId: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(workerId).success) return { ok: false, error: "Ogiltig person." };

  const { data, error } = await supabase.from("workers").delete().eq("id", workerId).select("id");

  if (error?.code === "23503") {
    return {
      ok: false,
      error: "Personen har tidrapporter och kan inte tas bort. Inaktivera personen i stället.",
    };
  }
  if (error || !data?.length) return { ok: false, error: "Personen kunde inte tas bort." };

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Personen är borttagen." };
}
