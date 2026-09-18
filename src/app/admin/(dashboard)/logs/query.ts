import { z } from "zod";
import { dayRangeInZone, isoDateInZone, isValidIsoDate, shiftIsoDate } from "@/lib/time";

export const PAGE_SIZE = 50;

export type LogFilters = {
  from: string;
  to: string;
  worker: string | null;
  event: "check_in" | "check_out" | null;
  voided: boolean;
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Parses URL search params into validated filters. Defaults to the last 7 days. */
export function parseLogFilters(params: RawParams, timeZone: string, now: number): LogFilters {
  const today = isoDateInZone(now, timeZone);
  let from = one(params.from);
  let to = one(params.to);
  if (!isValidIsoDate(to)) to = today;
  if (!isValidIsoDate(from)) from = shiftIsoDate(to, -6);
  if (from > to) [from, to] = [to, from];

  const worker = one(params.worker);
  const event = one(params.event);
  const page = Number.parseInt(one(params.page) ?? "1", 10);

  return {
    from,
    to,
    worker: worker && z.uuid().safeParse(worker).success ? worker : null,
    event: event === "check_in" || event === "check_out" ? event : null,
    voided: one(params.voided) === "1",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function filtersToSearchParams(filters: Partial<LogFilters>) {
  const sp = new URLSearchParams();
  if (filters.from) sp.set("from", filters.from);
  if (filters.to) sp.set("to", filters.to);
  if (filters.worker) sp.set("worker", filters.worker);
  if (filters.event) sp.set("event", filters.event);
  if (filters.voided) sp.set("voided", "1");
  if (filters.page && filters.page > 1) sp.set("page", String(filters.page));
  return sp;
}

export function rangeFor(filters: LogFilters, timeZone: string) {
  return dayRangeInZone(filters.from, filters.to, timeZone);
}
