"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, PenLine } from "lucide-react";
import { EventBadge } from "@/components/admin/event-badge";
import { SnapshotThumb } from "@/components/admin/snapshot-thumb";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SnapshotState } from "@/lib/snapshots";
import { formatDayShort, formatTime } from "@/lib/time";
import type { TimeLogEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LogDetailDialog } from "./log-detail-dialog";
import { filtersToSearchParams, type LogFilters } from "./query";

export type LogRow = {
  id: string;
  workerName: string;
  company: string;
  role: string;
  event: TimeLogEvent;
  occurredAt: string;
  source: "kiosk" | "admin";
  kioskName: string | null;
  clientCapturedAt: string | null;
  snapshotState: SnapshotState;
  snapshotUrl: string | null;
  note: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

export function LogsTable({
  rows,
  total,
  filters,
  pageSize,
  timeZone,
  canManage,
}: {
  rows: LogRow[];
  total: number;
  filters: LogFilters;
  pageSize: number;
  timeZone: string;
  canManage: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (page: number) => `?${filtersToSearchParams({ ...filters, page })}`;

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.06]">
        {rows.length === 0 ? (
          <Empty className="py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList />
              </EmptyMedia>
              <EmptyTitle>Inga registreringar</EmptyTitle>
              <EmptyDescription>Det finns inga in- eller utcheckningar för vald period och filter.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Person</TableHead>
                <TableHead>Händelse</TableHead>
                <TableHead>Tid</TableHead>
                <TableHead className="max-md:hidden">Källa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={cn("cursor-pointer", row.voidedAt && "text-muted-foreground")}
                >
                  <TableCell className="pl-6">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedId(row.id);
                      }}
                      className="flex items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`Visa detaljer för ${row.workerName}, ${formatDayShort(row.occurredAt, timeZone)} ${formatTime(row.occurredAt, timeZone)}`}
                    >
                      <SnapshotThumb url={row.snapshotUrl} state={row.snapshotState} name={row.workerName} className={row.voidedAt ? "opacity-50" : undefined} />
                      <span className="min-w-0">
                        <span className={cn("block font-medium", row.voidedAt ? "line-through" : "text-foreground")}>
                          {row.workerName}
                        </span>
                        <span className="block text-xs text-muted-foreground">{row.company}</span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <EventBadge event={row.event} voided={!!row.voidedAt} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <span className={cn("block font-medium", !row.voidedAt && "text-foreground")}>
                      {formatTime(row.occurredAt, timeZone)}
                    </span>
                    <span className="block text-xs text-muted-foreground first-letter:uppercase">
                      {formatDayShort(row.occurredAt, timeZone)}
                    </span>
                  </TableCell>
                  <TableCell className="max-md:hidden">
                    {row.source === "kiosk" ? (
                      <span className="text-sm">{row.kioskName ?? "Kiosk"}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <PenLine className="size-3.5 text-muted-foreground" />
                        Manuell
                      </span>
                    )}
                    {row.voidedAt && <span className="block text-xs text-destructive">Makulerad</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {total === 1 ? "1 registrering" : `${total} registreringar`}
            {pages > 1 && ` · sida ${filters.page} av ${pages}`}
          </span>
          {pages > 1 && (
            <div className="flex gap-2">
              <Button variant="outline" size="icon" asChild disabled={filters.page <= 1} aria-label="Föregående sida">
                {filters.page > 1 ? (
                  <Link href={pageHref(filters.page - 1)} scroll={false}><ChevronLeft /></Link>
                ) : (
                  <span aria-disabled className="pointer-events-none opacity-50"><ChevronLeft /></span>
                )}
              </Button>
              <Button variant="outline" size="icon" asChild aria-label="Nästa sida">
                {filters.page < pages ? (
                  <Link href={pageHref(filters.page + 1)} scroll={false}><ChevronRight /></Link>
                ) : (
                  <span aria-disabled className="pointer-events-none opacity-50"><ChevronRight /></span>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      <LogDetailDialog
        log={selected}
        timeZone={timeZone}
        canManage={canManage}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </>
  );
}
