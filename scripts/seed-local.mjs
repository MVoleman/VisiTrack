#!/usr/bin/env node
// Seeds the LOCAL Supabase stack (supabase start) with demo accounts and workers.
// Refuses to run against anything that is not localhost.
//
//   npm run db:seed
//
// Accounts created (local development only):
//   admin@visitrack.local  / visitrack-dev   → admin
//   kiosk@visitrack.local  / visitrack-dev   → kiosk ("Entré, Hus A")
//   rektor@visitrack.local / visitrack-dev   → viewer (read-only)

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = "visitrack-dev";

const status = JSON.parse(execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const url = status.API_URL;
const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error(`Refusing to seed non-local Supabase at ${url}`);
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function ensureUser(email, role, displayName) {
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    user = data.user;
  }
  const { error } = await supabase
    .from("app_users")
    .upsert({ user_id: user.id, role, display_name: displayName }, { onConflict: "user_id" });
  if (error) throw error;
  console.log(`✓ ${role.padEnd(5)} ${email} / ${PASSWORD}`);
}

await ensureUser("admin@visitrack.local", "admin", "Anna Admin");
await ensureUser("kiosk@visitrack.local", "kiosk", "Entré, Hus A");
await ensureUser("rektor@visitrack.local", "viewer", "Rektor Rekström");

const demoWorkers = [
  { full_name: "Erik Svensson", company: "Städbolaget Norden AB", role: "Städ", email: "erik.svensson@example.com" },
  { full_name: "Sara Lindqvist", company: "El & Data i Mälardalen", role: "Elektriker" },
  { full_name: "Mohammed Al-Hassan", company: "Fastighetsservice Syd", role: "Fastighetsskötare" },
  { full_name: "Lena Björk", company: "Skolmat Sverige", role: "Kock" },
  { full_name: "Jonas Ek", company: "VVS-Teknik AB", role: "Rörmokare" },
];

const { count } = await supabase.from("workers").select("id", { count: "exact", head: true });
if (!count) {
  const { error } = await supabase.from("workers").insert(demoWorkers);
  if (error) throw error;
  console.log(`✓ ${demoWorkers.length} demo workers`);
} else {
  console.log(`• ${count} workers already exist, skipping demo workers`);
}
