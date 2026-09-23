import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { QrCode } from "@/components/admin/qr-code";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/time";
import { SaveBadge } from "./save-badge";

export const metadata: Metadata = { title: "Din QR-kod" };

// Per request, and never cached: the page shows one person's badge.
export const dynamic = "force-dynamic";

/**
 * The page an emailed badge link opens.
 *
 * No sign-in: the token in the address is the credential, the way a password
 * reset link is. public.redeem_badge_link decides whether it still counts -
 * unknown, expired, revoked and never-sent all come back empty, and all four
 * produce the same message below, so the page cannot be used to find out
 * whether a link ever existed.
 */
export default async function BadgeLinkPage({ params }: PageProps<"/kod/[token]">) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("redeem_badge_link", { p_token: token });

  if (error) console.error("redeem_badge_link failed", { code: error.code });

  const badge = data?.[0];
  if (!badge) {
    return (
      <Frame>
        <h1 className="text-2xl font-semibold tracking-tight">Länken gäller inte längre</h1>
        <p className="mt-1.5 text-muted-foreground text-pretty">
          Länken i mejlet är tidsbegränsad. Kontakta skolan så skickar vi en ny.
        </p>
        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground text-pretty">
          <span className="font-medium text-foreground/70">This link is no longer valid.</span> The link
          in the email expires after a week. Contact the school and we will send you a new one.
        </p>
      </Frame>
    );
  }

  return (
    <Frame>
      <h1 className="text-2xl font-semibold tracking-tight">Din QR-kod</h1>
      <p className="mt-1.5 text-muted-foreground text-pretty">
        Visa koden för kameran vid entrén när du kommer och när du går.
      </p>
      {/* The people this page is for are external staff, and not all of them
          read Swedish. The English text says the same thing, quieter. */}
      <p className="mt-1.5 text-sm text-muted-foreground/90 text-pretty">
        Show the code to the camera at the entrance when you arrive and when you leave.
      </p>

      <div className="mt-8 rounded-2xl bg-card p-6 shadow-lifted ring-1 ring-foreground/[0.06]">
        <div className="rounded-xl bg-white p-4">
          <QrCode value={badge.qr_token} label={`QR-kod för ${badge.full_name}`} />
        </div>
        <p className="mt-5 text-center text-lg font-semibold tracking-tight">{badge.full_name}</p>
        <p className="text-center text-sm text-muted-foreground">
          {badge.company} · {badge.role}
        </p>

        <div className="mt-6">
          <SaveBadge token={badge.qr_token} name={badge.full_name} company={badge.company} />
        </div>
      </div>

      <p className="mt-6 flex gap-2 rounded-xl bg-muted/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-px size-4 shrink-0" />
        <span>
          Koden är personlig och fungerar som en nyckel – skicka den inte vidare. Tappar du telefonen, säg
          till på skolan så spärras koden och du får en ny.
          <span className="mt-2 block text-muted-foreground/90">
            The code is personal and works like a key – do not pass it on. If you lose your phone, tell
            the school and the code will be blocked and replaced.
          </span>
        </span>
      </p>

      <p className="mt-3 text-center text-xs text-muted-foreground text-balance">
        Länken gäller till {formatDate(badge.expires_at)}. Spara gärna bilden innan dess.
        <span className="mt-1 block">The link works until {formatDate(badge.expires_at)} – please save the picture before then.</span>
      </p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Brand className="mb-10" />
        {children}
      </div>
    </main>
  );
}
