import { TZDate } from "@date-fns/tz";

export const DEFAULT_TIME_ZONE = "Europe/Stockholm";
const LOCALE = "sv-SE";

type DateInput = string | number | Date;

const toDate = (value: DateInput) => (value instanceof Date ? value : new Date(value));

export function formatTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", timeZone }).format(
    toDate(value),
  );
}

/** "17 sep. 2026" */
export function formatDate(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone }).format(
    toDate(value),
  );
}

/** "tors 17 sep." */
export function formatDayShort(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "short", day: "numeric", month: "short", timeZone }).format(
    toDate(value),
  );
}

/** "torsdag 17 september" */
export function formatDayLong(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone }).format(
    toDate(value),
  );
}

/** "17 sep. 2026 08:42" */
export function formatDateTime(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return `${formatDate(value, timeZone)} ${formatTime(value, timeZone)}`;
}

/** "2026-09-17" in the given time zone. */
export function isoDateInZone(value: DateInput = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(
    toDate(value),
  );
}

/** "08:42:07" in the given time zone. */
export function isoTimeInZone(value: DateInput, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(toDate(value));
}

export function isValidIsoDate(value: string | undefined | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/** UTC instant for local midnight at the start of `isoDate` in `timeZone`. */
export function startOfDayInZone(isoDate: string, timeZone = DEFAULT_TIME_ZONE) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(+new TZDate(y, m - 1, d, 0, 0, 0, timeZone));
}

/** Half-open range [start of `from`, start of the day after `to`) as ISO strings. */
export function dayRangeInZone(from: string, to: string, timeZone = DEFAULT_TIME_ZONE) {
  const [y, m, d] = to.split("-").map(Number);
  const end = new Date(+new TZDate(y, m - 1, d + 1, 0, 0, 0, timeZone));
  return { start: startOfDayInZone(from, timeZone).toISOString(), end: end.toISOString() };
}

/** Converts an `<input type="datetime-local">` value ("2026-09-17T08:30") to a UTC ISO string. */
export function localDateTimeToIso(value: string, timeZone = DEFAULT_TIME_ZONE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  return new Date(+new TZDate(y, mo - 1, d, h, mi, 0, timeZone)).toISOString();
}

export function shiftIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "3 tim 12 min", "45 min", "under 1 min" */
export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "under 1 min";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} tim` : `${hours} tim ${minutes} min`;
}

/** Parses a Postgres interval as returned by PostgREST ("07:30:12", "1 day 02:00:00") into ms. */
export function intervalToMs(interval: string | null) {
  if (!interval) return null;
  const match = /^(?:(\d+) days? )?(-)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(interval.trim());
  if (!match) return null;
  const [, days, negative, h, m, s] = match;
  const ms = ((Number(days ?? 0) * 24 + Number(h)) * 3600 + Number(m) * 60 + Number(s)) * 1000;
  return negative ? -ms : ms;
}
