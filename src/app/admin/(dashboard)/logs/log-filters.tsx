"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { filtersToSearchParams, type LogFilters } from "./query";

export type WorkerOption = { id: string; label: string; description: string; active: boolean };

const ALL = "all";

export function LogFiltersBar({ filters, workers }: { filters: LogFilters; workers: WorkerOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function apply(patch: Partial<LogFilters>) {
    const next = { ...filters, ...patch, page: 1 };
    const qs = filtersToSearchParams(next).toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const hasExtraFilters = !!filters.worker || !!filters.event || filters.voided;

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-card p-4 shadow-soft ring-1 ring-foreground/[0.06] transition-opacity",
        pending && "opacity-70",
      )}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="from" className="text-xs text-muted-foreground">Från</Label>
        <Input
          id="from"
          type="date"
          value={filters.from}
          max={filters.to}
          onChange={(e) => e.target.value && apply({ from: e.target.value })}
          className="w-40"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="to" className="text-xs text-muted-foreground">Till</Label>
        <Input
          id="to"
          type="date"
          value={filters.to}
          min={filters.from}
          onChange={(e) => e.target.value && apply({ to: e.target.value })}
          className="w-40"
        />
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Person</Label>
        <Select value={filters.worker ?? ALL} onValueChange={(v) => apply({ worker: v === ALL ? null : v })}>
          <SelectTrigger className="w-56 bg-white" aria-label="Person">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alla personer</SelectItem>
            {workers.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.label}
                {!w.active && <span className="text-muted-foreground"> (inaktiv)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Typ</Label>
        <Select
          value={filters.event ?? ALL}
          onValueChange={(v) => apply({ event: v === ALL ? null : (v as LogFilters["event"]) })}
        >
          <SelectTrigger className="w-40 bg-white" aria-label="Typ">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alla</SelectItem>
            <SelectItem value="check_in">Incheckningar</SelectItem>
            <SelectItem value="check_out">Utcheckningar</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl px-2 text-sm select-none">
        <input
          type="checkbox"
          checked={filters.voided}
          onChange={(e) => apply({ voided: e.target.checked })}
          className="size-4 accent-primary"
        />
        Visa makulerade
      </label>

      <div className="ml-auto flex h-10 items-center gap-2">
        {pending && <Spinner className="text-muted-foreground" />}
        {hasExtraFilters && (
          <Button variant="ghost" onClick={() => apply({ worker: null, event: null, voided: false })}>
            <X />
            Rensa filter
          </Button>
        )}
      </div>
    </div>
  );
}
