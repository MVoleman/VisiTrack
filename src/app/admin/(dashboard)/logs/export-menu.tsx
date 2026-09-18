"use client";

import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { filtersToSearchParams, type LogFilters } from "./query";

export function ExportMenu({ filters }: { filters: LogFilters }) {
  const href = (kind: "sessions" | "events") => {
    const sp = filtersToSearchParams({ ...filters, page: 1 });
    sp.set("kind", kind);
    return `/admin/logs/export?${sp}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-10">
          <Download />
          Exportera
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          CSV för vald period och filter
        </DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <a href={href("sessions")} download className="flex-col items-start gap-0.5">
            <span className="font-medium">Arbetspass</span>
            <span className="text-xs text-muted-foreground">In- och utcheckning per pass med arbetad tid</span>
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={href("events")} download className="flex-col items-start gap-0.5">
            <span className="font-medium">Alla registreringar</span>
            <span className="text-xs text-muted-foreground">Varje händelse, inklusive källa och bildstatus</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
