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
  const [workers, presence] = await Promise.all([
    supabase
      .from("workers")
      .select("id, full_name, company, role, email, is_active, updated_at")
      .order("full_name"),
    supabase.from("current_presence").select("worker_id"),
  ]);

  if (workers.error) throw workers.error;

  const presentIds = new Set((presence.data ?? []).map((p) => p.worker_id));
  const items: WorkerListItem[] = workers.data.map((w) => ({
    id: w.id,
    full_name: w.full_name,
    company: w.company,
    role: w.role,
    email: w.email,
    is_active: w.is_active,
    present: presentIds.has(w.id),
    last_activity: w.updated_at,
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
