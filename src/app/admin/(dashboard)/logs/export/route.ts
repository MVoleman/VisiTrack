import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { snapshotState } from "@/lib/snapshots";
import { intervalToMs, isoDateInZone, isoTimeInZone } from "@/lib/time";
import { EVENT_LABEL } from "@/lib/types";
import { parseLogFilters, rangeFor } from "../query";

// PostgREST caps responses; page through in chunks.
const CHUNK = 1000;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { supabase } = session;

  const { data: settings, error: settingsError } = await supabase.from("app_settings").select("time_zone").single();
  if (settingsError) return new Response("Could not load settings", { status: 500 });
  const tz = settings.time_zone;

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = parseLogFilters(params, tz, Date.now());
  const { start, end } = rangeFor(filters, tz);
  const kind = params.kind === "events" ? "events" : "sessions";

  let rows: string[][];

  if (kind === "sessions") {
    const header = ["Datum", "Namn", "Företag", "Roll", "Incheckning", "Utcheckning", "Arbetad tid (h:mm)", "Arbetad tid (timmar)", "Status"];
    const data = await fetchAll((from, to) => {
      let q = supabase
        .from("work_sessions")
        .select("check_in_log_id, check_in_at, check_out_at, duration, workers(full_name, company, role)")
        .gte("check_in_at", start)
        .lt("check_in_at", end)
        .order("check_in_at")
        .range(from, to);
      if (filters.worker) q = q.eq("worker_id", filters.worker);
      return q;
    });
    if (data instanceof Response) return data;

    rows = [
      header,
      ...data.map((s) => {
        const ms = intervalToMs(s.duration);
        return [
          isoDateInZone(s.check_in_at!, tz),
          s.workers?.full_name ?? "",
          s.workers?.company ?? "",
          s.workers?.role ?? "",
          isoTimeInZone(s.check_in_at!, tz).slice(0, 5),
          s.check_out_at ? `${isoDateInZone(s.check_out_at, tz) === isoDateInZone(s.check_in_at!, tz) ? "" : `${isoDateInZone(s.check_out_at, tz)} `}${isoTimeInZone(s.check_out_at, tz).slice(0, 5)}` : "",
          ms == null ? "" : `${Math.floor(ms / 3_600_000)}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}`,
          ms == null ? "" : (ms / 3_600_000).toFixed(2).replace(".", ","),
          s.check_out_at ? "Komplett" : "Utcheckning saknas",
        ];
      }),
    ];
  } else {
    const header = ["Datum", "Tid", "Händelse", "Namn", "Företag", "Roll", "Källa", "Bild", "Makulerad", "Orsak till makulering", "Anteckning", "Registrerings-ID"];
    const data = await fetchAll((from, to) => {
      let q = supabase
        .from("time_logs")
        .select("id, event_type, occurred_at, source, snapshot_path, snapshot_uploaded_at, snapshot_purged_at, note, voided_at, void_reason, workers(full_name, company, role), app_users(display_name)")
        .gte("occurred_at", start)
        .lt("occurred_at", end)
        .order("occurred_at")
        .range(from, to);
      if (filters.worker) q = q.eq("worker_id", filters.worker);
      if (filters.event) q = q.eq("event_type", filters.event);
      if (!filters.voided) q = q.is("voided_at", null);
      return q;
    });
    if (data instanceof Response) return data;

    const photo = { available: "Ja", missing: "Saknas", purged: "Raderad (lagringspolicy)", none: "Nej (manuell)" };
    rows = [
      header,
      ...data.map((l) => [
        isoDateInZone(l.occurred_at, tz),
        isoTimeInZone(l.occurred_at, tz),
        EVENT_LABEL[l.event_type],
        l.workers?.full_name ?? "",
        l.workers?.company ?? "",
        l.workers?.role ?? "",
        l.source === "kiosk" ? `Kiosk${l.app_users?.display_name ? ` (${l.app_users.display_name})` : ""}` : "Manuell",
        photo[snapshotState(l)],
        l.voided_at ? "Ja" : "Nej",
        l.void_reason ?? "",
        l.note ?? "",
        l.id,
      ]),
    ];
  }

  const filename = `visitrack-${kind === "sessions" ? "arbetspass" : "registreringar"}-${filters.from}_${filters.to}.csv`;
  // Semicolon-separated with a UTF-8 BOM: opens correctly in Excel with Swedish regional settings.
  const body = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[] | Response> {
  const all: T[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    const { data, error } = await page(offset, offset + CHUNK - 1);
    if (error) {
      console.error("CSV export failed", error);
      return new Response("Export failed", { status: 500 });
    }
    all.push(...(data ?? []));
    if (!data || data.length < CHUNK) return all;
  }
}

function csvCell(value: string) {
  // Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start of a cell).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
