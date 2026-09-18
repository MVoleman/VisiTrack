import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { getRequestTime, getSettings, requireReader } from "@/lib/auth";
import { signSnapshotUrls, snapshotState } from "@/lib/snapshots";
import { ExportMenu } from "./export-menu";
import { LogFiltersBar } from "./log-filters";
import { LogsTable, type LogRow } from "./logs-table";
import { ManualEntryDialog } from "./manual-entry-dialog";
import { PAGE_SIZE, parseLogFilters, rangeFor } from "./query";

export const metadata: Metadata = { title: "Tidrapporter" };

export default async function LogsPage({ searchParams }: PageProps<"/admin/logs">) {
  const { supabase, canManage } = await requireReader();
  const settings = await getSettings();
  const tz = settings.time_zone;
  const filters = parseLogFilters(await searchParams, tz, getRequestTime());
  const { start, end } = rangeFor(filters, tz);

  let query = supabase
    .from("time_logs")
    .select(
      "id, worker_id, event_type, occurred_at, source, client_captured_at, snapshot_path, snapshot_uploaded_at, snapshot_purged_at, note, voided_at, void_reason, created_at, workers(full_name, company, role), app_users(display_name)",
      { count: "exact" },
    )
    .gte("occurred_at", start)
    .lt("occurred_at", end)
    .order("occurred_at", { ascending: false })
    .range((filters.page - 1) * PAGE_SIZE, filters.page * PAGE_SIZE - 1);

  if (filters.worker) query = query.eq("worker_id", filters.worker);
  if (filters.event) query = query.eq("event_type", filters.event);
  if (!filters.voided) query = query.is("voided_at", null);

  const [logs, workers] = await Promise.all([
    query,
    supabase.from("workers").select("id, full_name, company, is_active").order("full_name"),
  ]);
  if (logs.error) throw logs.error;

  const urls = await signSnapshotUrls(supabase, logs.data);
  const rows: LogRow[] = logs.data.map((log) => ({
    id: log.id,
    workerName: log.workers?.full_name ?? "Okänd",
    company: log.workers?.company ?? "",
    role: log.workers?.role ?? "",
    event: log.event_type,
    occurredAt: log.occurred_at,
    source: log.source,
    kioskName: log.app_users?.display_name ?? null,
    clientCapturedAt: log.client_captured_at,
    snapshotState: snapshotState(log),
    snapshotUrl: log.snapshot_path ? (urls.get(log.snapshot_path) ?? null) : null,
    note: log.note,
    voidedAt: log.voided_at,
    voidReason: log.void_reason,
  }));

  const workerOptions = (workers.data ?? []).map((w) => ({
    id: w.id,
    label: w.full_name,
    description: w.company,
    active: w.is_active,
  }));

  return (
    <>
      <PageHeader
        title="Tidrapporter"
        description="Alla in- och utcheckningar med bild för verifiering."
        actions={
          <>
            {canManage && <ManualEntryDialog workers={workerOptions.filter((w) => w.active)} timeZone={tz} />}
            <ExportMenu filters={filters} />
          </>
        }
      />
      <LogFiltersBar filters={filters} workers={workerOptions} />
      <LogsTable
        rows={rows}
        total={logs.count ?? rows.length}
        filters={filters}
        pageSize={PAGE_SIZE}
        timeZone={tz}
        canManage={canManage}
      />
    </>
  );
}
