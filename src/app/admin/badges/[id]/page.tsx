import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { BrandMark } from "@/components/brand";
import { requireAdmin } from "@/lib/auth";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Passerkort" };

type BadgeWorker = { id: string; full_name: string; company: string; role: string; worker_badges: { token: string } | null };

/**
 * Printable ID-1 (credit card, 85.6 × 54 mm) badges.
 * /admin/badges/<worker-id> prints one badge; /admin/badges/active prints all active workers.
 */
export default async function BadgesPage({ params }: PageProps<"/admin/badges/[id]">) {
  const { id } = await params;
  const { supabase } = await requireAdmin();

  const query = supabase.from("workers").select("id, full_name, company, role, worker_badges(token)").order("full_name");
  const { data, error } = id === "active" ? await query.eq("is_active", true) : await query.eq("id", id);

  if (error?.code === "22P02") notFound(); // not a uuid
  if (error) throw error;
  if (!data.length) notFound();

  const badges = await Promise.all(
    data.map(async (worker: BadgeWorker) => ({
      ...worker,
      svg: await QRCode.toString(worker.worker_badges?.token ?? "", {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
        color: { dark: "#111827", light: "#ffffff" },
      }),
    })),
  );

  return (
    <main className="min-h-dvh bg-background print:bg-white">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>

      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 pt-10 pb-6 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {badges.length === 1 ? "Passerkort" : `${badges.length} passerkort`}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Skrivs ut i kreditkortsformat. Klipp ut längs kanten och plasta gärna in.
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="mx-auto grid max-w-3xl grid-cols-1 justify-items-center gap-6 px-6 pb-16 sm:grid-cols-2 print:grid-cols-2 print:gap-[6mm] print:px-0 print:pb-0">
        {badges.map((badge) => (
          <article
            key={badge.id}
            className="flex h-[54mm] w-[85.6mm] break-inside-avoid items-stretch gap-[4mm] overflow-hidden rounded-[3mm] bg-white p-[4mm] shadow-lifted ring-1 ring-foreground/10 print:shadow-none print:ring-[0.3mm] print:ring-gray-300"
          >
            <div
              className="aspect-square h-full shrink-0 [&>svg]:size-full"
              role="img"
              aria-label={`QR-kod för ${badge.full_name}`}
              dangerouslySetInnerHTML={{ __html: badge.svg }}
            />
            <div className="flex min-w-0 flex-1 flex-col py-[1mm]">
              <div className="flex items-center gap-[1.5mm]">
                <BrandMark className="size-[4.5mm] rounded-[1.2mm] shadow-none" />
                <span className="text-[2.6mm] font-semibold tracking-tight text-gray-500">VisiTrack</span>
              </div>
              <div className="mt-auto">
                <p className="text-[4.2mm] leading-tight font-semibold tracking-tight text-gray-900 [overflow-wrap:anywhere]">
                  {badge.full_name}
                </p>
                {/* Both may wrap. The block is bottom-anchored, so a second line
                    for the role grows upwards into the space under the logo
                    instead of being cut off at the edge of the card. */}
                <p className="mt-[1mm] line-clamp-2 text-[3mm] leading-snug text-gray-600">{badge.company}</p>
                <p className="mt-[0.8mm] line-clamp-2 text-[3mm] leading-snug text-gray-600">{badge.role}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
