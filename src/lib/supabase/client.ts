import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { requireSupabaseEnv } from "./env";

/** Supabase client for Client Components (admin dashboard, realtime subscriptions). */
export function createClient() {
  const { url, key } = requireSupabaseEnv();
  return createBrowserClient<Database>(url, key);
}

let kioskClient: SupabaseClient<Database> | null = null;

/**
 * Supabase client for the kiosk. Its session lives in localStorage under its own
 * key, fully separate from the admin cookie session: signing a browser in as a
 * kiosk never signs out an admin on the same device, and vice versa. The kiosk
 * session is never needed server-side (the proxy does not run for /kiosk).
 */
export function createKioskClient() {
  const { url, key } = requireSupabaseEnv();
  kioskClient ??= createSupabaseClient<Database>(url, key, {
    auth: { storageKey: "visitrack-kiosk-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return kioskClient;
}
