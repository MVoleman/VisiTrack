import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { ResetRequestForm } from "./reset-request-form";

// Rendered per request so the CSP nonce from src/proxy.ts reaches the scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Glömt lösenord" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Glömt lösenord</h1>
        <p className="mt-1.5 text-muted-foreground">
          Ange din e-postadress så skickar vi en länk för att välja ett nytt lösenord.
        </p>

        <div className="mt-8 rounded-2xl bg-card p-6 shadow-lifted ring-1 ring-foreground/[0.06]">
          <ResetRequestForm />
        </div>

        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Tillbaka till inloggningen
        </Link>
      </div>
    </main>
  );
}
