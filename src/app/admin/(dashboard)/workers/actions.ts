"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { badgeMailContent } from "@/lib/badge-mail";
import { sendEmail } from "@/lib/mail/resend";
import { siteOrigin } from "@/lib/site-url";
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

/**
 * Emails a worker a link to their own QR code.
 *
 * The link, not the code, travels by mail: it expires in a week and lives on
 * our own domain, so the badge itself never reaches the mail provider. The
 * address the admin confirmed is passed back in and compared, because someone
 * else may have edited the person since the dialog was opened - and a badge
 * sent to the wrong address is a working key in a stranger's inbox.
 */
export async function sendBadgeLink(workerId: string, confirmedEmail: string): Promise<ActionResult> {
  const { supabase } = await requireAdmin();
  if (!z.uuid().safeParse(workerId).success) return { ok: false, error: "Ogiltig person." };

  const origin = siteOrigin();
  const from = process.env.BADGE_MAIL_FROM;
  if (!origin || !from) {
    // Named, not just logged: only an admin can reach this, and the person
    // looking at the screen is the one who can fix it. Chasing it through the
    // hosting provider's logs instead costs a round trip every time.
    const missing = !origin ? "NEXT_PUBLIC_SITE_URL" : "BADGE_MAIL_FROM";
    console.error("badge-mail-unconfigured:", missing, "is not set");
    return { ok: false, error: `E-postutskick är inte konfigurerat: ${missing} saknas.` };
  }

  const { data: worker, error: readError } = await supabase
    .from("workers")
    .select("id, full_name, company, email, is_active")
    .eq("id", workerId)
    .single();

  if (readError || !worker) return { ok: false, error: "Personen kunde inte hämtas." };
  if (!worker.email) return { ok: false, error: "Personen saknar e-postadress. Lägg till den under Redigera." };
  if (!worker.is_active) return { ok: false, error: "Personen är inaktiverad. Aktivera först om koden ska fungera." };
  if (worker.email !== confirmedEmail.trim().toLowerCase()) {
    return { ok: false, error: "Adressen har ändrats sedan rutan öppnades. Stäng och försök igen." };
  }

  const token = randomBytes(32).toString("base64url");
  const { data: linkId, error: linkError } = await supabase.rpc("create_badge_link", {
    p_worker_id: workerId,
    p_sent_to: worker.email,
    p_token: token,
  });

  if (linkError || !linkId) {
    console.error("sendBadgeLink: create_badge_link", { workerId, code: linkError?.code });
    if (linkError?.message?.includes("Too many links")) {
      return { ok: false, error: "Koden har redan skickats flera gånger den senaste timmen. Vänta en stund." };
    }
    return { ok: false, error: "Länken kunde inte skapas. Försök igen." };
  }

  const { data: link } = await supabase.from("badge_links").select("expires_at").eq("id", linkId).single();

  const mail = badgeMailContent({
    fullName: worker.full_name,
    url: `${origin}/kod/${token}`,
    expiresAt: link?.expires_at ?? new Date(),
  });

  const outcome = await sendEmail({
    from,
    to: worker.email,
    replyTo: process.env.BADGE_MAIL_REPLY_TO,
    ...mail,
    // One key per attempt: a timed-out request that did go through must not
    // become a second mail when the admin clicks again.
    idempotencyKey: linkId,
  });

  // Recorded either way. A link whose mail never went out stays unusable, so a
  // failed send cannot leave a working key behind.
  await supabase.rpc("record_badge_link_result", {
    p_id: linkId,
    p_status: outcome.ok ? "accepted" : "failed",
    p_provider_id: outcome.ok ? outcome.id : undefined,
  });

  if (!outcome.ok) {
    console.error("sendBadgeLink: send failed", { workerId, kind: outcome.kind, code: outcome.code });
    // The provider's own code comes along, the way passwordErrorMessage keeps
    // Supabase's: a failure should be diagnosable from a screenshot.
    return { ok: false, error: `${SEND_FAILURE[outcome.kind]} (felkod: ${outcome.code})` };
  }

  revalidatePath("/admin", "layout");
  return { ok: true, message: `QR-koden är skickad till ${worker.email}.` };
}

const SEND_FAILURE = {
  unconfigured: "E-postutskick är inte konfigurerat – avsändaren eller nyckeln avvisades.",
  quota: "Månadens e-postkvot är slut. Kontakta systemansvarig.",
  transient: "Mejlet kunde inte skickas just nu. Försök igen om en stund.",
} as const;
