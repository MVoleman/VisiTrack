import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Sidan finns inte" };

// Rendered per request so the CSP nonce from src/proxy.ts reaches the scripts.
// Next.js would otherwise prerender this page, and 'strict-dynamic' blocks every
// script in HTML that carries no nonce - which would leave the framework's own
// English fallback page here with no working navigation.
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight">Sidan finns inte</h1>
        <p className="mt-1.5 text-muted-foreground text-pretty">
          Adressen är felstavad eller så har sidan tagits bort.
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-card px-4 py-2.5 text-sm font-medium shadow-soft ring-1 ring-foreground/[0.06] transition-all hover:-translate-y-0.5 hover:shadow-lifted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4 text-muted-foreground" />
          Till startsidan
        </Link>
      </div>
    </main>
  );
}
