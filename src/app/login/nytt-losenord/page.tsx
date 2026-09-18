import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { NewPasswordForm } from "./new-password-form";

export const metadata: Metadata = { title: "Välj nytt lösenord" };

export default function NewPasswordPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold tracking-tight">Välj nytt lösenord</h1>
        <p className="mt-1.5 text-muted-foreground">Minst 10 tecken. Använd gärna en lösenordshanterare.</p>

        <div className="mt-8 rounded-2xl bg-card p-6 shadow-lifted ring-1 ring-foreground/[0.06]">
          <NewPasswordForm />
        </div>
      </div>
    </main>
  );
}
