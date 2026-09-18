import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Brand } from "@/components/brand";
import { getSession } from "@/lib/auth";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Logga in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const configured = getSupabaseEnv() !== null;

  if (configured && (await getSession())) {
    redirect(typeof next === "string" && next.startsWith("/admin") ? next : "/admin");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Logga in</h1>
        <p className="mt-1.5 text-muted-foreground">Administration av närvaro och personal.</p>

        {(error === "expired_link" || error === "invalid_link") && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-xl bg-destructive/[0.06] px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            Länken är ogiltig eller har gått ut. Begär en ny återställningslänk.
          </p>
        )}

        <div className="mt-8 rounded-2xl bg-card p-6 shadow-lifted ring-1 ring-foreground/[0.06]">
          {configured ? (
            <LoginForm next={typeof next === "string" ? next : undefined} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Supabase är inte konfigurerat ännu. Fyll i <code>.env.local</code> enligt{" "}
              <code>.env.example</code>.
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-3 text-center">
          <Link href="/login/glomt-losenord" className="text-sm font-medium text-primary hover:underline">
            Glömt lösenord?
          </Link>
          <p className="text-xs text-muted-foreground">Konton skapas av en administratör.</p>
        </div>
      </div>
    </main>
  );
}
