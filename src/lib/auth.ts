import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

/**
 * Resolves the signed-in admin or viewer for this request, or null.
 * Data access is still enforced by RLS; this is for routing and for failing
 * fast in Server Actions and Route Handlers (reachable by direct POST/GET).
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role, display_name")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (appUser?.role !== "admin" && appUser?.role !== "viewer") return null;

  return {
    supabase,
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    displayName: appUser.display_name,
    role: appUser.role satisfies AppRole,
    canManage: appUser.role === "admin",
  };
});

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Pages and reads: admins and viewers. */
export async function requireReader() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Everything that changes data: admins only. */
export async function requireAdmin() {
  const session = await requireReader();
  if (session.role !== "admin") redirect("/admin");
  return session;
}

export const getSettings = cache(async () => {
  const { supabase } = await requireReader();
  const { data, error } = await supabase.from("app_settings").select("*").single();
  if (error) throw error;
  return data;
});

/** One consistent "now" for everything rendered in this request. */
export const getRequestTime = cache(() => Date.now());
