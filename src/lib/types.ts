import type { Database } from "@/lib/supabase/database.types";

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type Worker = Tables["workers"]["Row"];
export type TimeLog = Tables["time_logs"]["Row"];
export type AppSettings = Tables["app_settings"]["Row"];
export type TimeLogEvent = Database["public"]["Enums"]["time_log_event"];
export type PresenceRow = Views["current_presence"]["Row"];

/** Result of a Server Action used with useActionState. */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Roles that may sign in to the admin area. `kiosk` accounts cannot. */
export type AppRole = "admin" | "viewer";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administratör",
  viewer: "Läsbehörighet",
};

export const EVENT_LABEL: Record<TimeLogEvent, string> = {
  check_in: "Incheckning",
  check_out: "Utcheckning",
};
