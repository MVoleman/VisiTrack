#!/usr/bin/env node
// Helper for scripts/manual-screenshots.mjs: signs in with the seeded LOCAL
// accounts and prints the browser session payloads plus demo worker ids.
// Refuses to run against anything that is not localhost.
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
);
const url = status.API_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("local only");

const jar = [];
const admin = createServerClient(url, status.PUBLISHABLE_KEY, {
  cookies: { getAll: () => [], setAll: (c) => jar.push(...c) },
});
const signedIn = await admin.auth.signInWithPassword({ email: "admin@visitrack.local", password: "visitrack-dev" });
if (signedIn.error) throw signedIn.error;

const store = new Map();
const kiosk = createClient(url, status.PUBLISHABLE_KEY, {
  auth: {
    storageKey: "visitrack-kiosk-auth", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
  },
});
const kioskSignIn = await kiosk.auth.signInWithPassword({ email: "kiosk@visitrack.local", password: "visitrack-dev" });
if (kioskSignIn.error) throw kioskSignIn.error;

// Pick demo workers: two for the presence list, one never scanned for the
// kiosk check-in screenshot.
const service = createClient(url, status.SECRET_KEY, { auth: { persistSession: false } });
const { data: workers } = await service.from("workers").select("id, full_name").order("full_name");
const { data: logs } = await service.from("time_logs").select("worker_id");
const scanned = new Set((logs ?? []).map((l) => l.worker_id));
const unscanned = workers.find((w) => !scanned.has(w.id)) ?? workers[0];

console.log(JSON.stringify({
  session: {
    cookies: jar.map(({ name, value }) => ({ name, value })),
    localStorage: [...store.entries()].map(([key, value]) => ({ key, value })),
  },
  WORKERS: Object.fromEntries([
    ...workers.slice(0, 3).map((w, i) => [["erik", "lena", "jonas"][i], w.id]),
    ["unscanned", unscanned.id],
  ]),
}));
