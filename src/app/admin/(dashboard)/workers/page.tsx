import type { Metadata } from "next";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { requireReader } from "@/lib/auth";
import { WorkersTable, type WorkerListItem } from "./workers-table";

export const metadata: Metadata = { title: "Personal" };

export default async function WorkersPage() {
  const { supabase, canManage } = await requireReader();

  // Badge tokens live in worker_badges (admin-only) and are fetched on demand.
  // badge_links is admin-only too, so a viewer's query simply comes back empty
  // and the "sent" marker stays hidden without a branch in the table.
  const [workers, presence, links] = await Promise.all([
    supabase
      .from("workers")
      .select("id, full_name, company, role, email, is_active, updated_at")
      .order("full_name"),
    supabase.from("current_presence").select("worker_id"),
    canManage
      ? supabase
          .from("badge_links")
          .select("worker_id, accepted_at, opened_at")
          .eq("status", "accepted")
          .order("accepted_at", { ascending: false })
      : Promise.resolve({ data: [] as { worker_id: string; accepted_at: string | null; opened_at: string | null }[] }),
  ]);

  if (workers.error) throw workers.error;

  const presentIds = new Set((presence.data ?? []).map((p) => p.worker_id));
  // Newest first, so the first row seen for a worker is their latest send.
  const lastSent = new Map<string, { at: string | null; opened: boolean }>();
  for (const link of links.data ?? []) {
    if (!lastSent.has(link.worker_id)) lastSent.set(link.worker_id, { at: link.accepted_at, opened: !!link.opened_at });
  }
  const items: WorkerListItem[] = workers.data.map((w) => ({
    id: w.id,
    full_name: w.full_name,
    company: w.company,
    role: w.role,
    email: w.email,
    is_active: w.is_active,
    present: presentIds.has(w.id),
    last_activity: w.updated_at,
    badge_sent_at: lastSent.get(w.id)?.at ?? null,
    badge_opened: lastSent.get(w.id)?.opened ?? false,
  }));

  return (
    <>
      <PageHeader
        title="Personal"
        description={
          canManage
            ? "Extern personal med personliga QR-koder för in- och utcheckning."
            : "Extern personal. Du har läsbehörighet."
        }
        actions={
          canManage && items.some((w) => w.is_active) && (
            <Button variant="outline" asChild className="h-10">
              <a href="/admin/badges/active" target="_blank" rel="noreferrer">
                <Printer />
                Skriv ut alla passerkort
              </a>
            </Button>
          )
        }
      />
      <WorkersTable workers={items} canManage={canManage} />
    </>
  );
}
