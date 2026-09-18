"use client";

import { Info, ShieldAlert, UserX, WifiOff, X } from "lucide-react";
import { DEFAULT_TIME_ZONE, formatTime } from "@/lib/time";
import type { TimeLogEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ScanResult =
  | { kind: "ok" | "duplicate"; event: TimeLogEvent; name: string; occurredAt: string; photoUrl?: string }
  | { kind: "inactive"; name: string }
  | { kind: "invalid" }
  | { kind: "blocked_network" }
  | { kind: "error" };

export function KioskResult({
  result,
  durationMs,
  onDismiss,
}: {
  result: ScanResult;
  durationMs: number;
  onDismiss: () => void;
}) {
  const view = describe(result);

  return (
    <div
      role="status"
      aria-live="assertive"
      onPointerDown={onDismiss}
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center px-8 text-center motion-safe:animate-[kiosk-result-in_320ms_cubic-bezier(0.2,0.9,0.3,1.2)]",
        view.background,
      )}
    >
      <div className="relative">
        {view.icon}
        {result.kind === "ok" && result.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.photoUrl}
            alt=""
            className="absolute -right-6 -bottom-3 size-20 -scale-x-100 rounded-2xl object-cover shadow-lifted ring-4 ring-white motion-safe:animate-[kiosk-pop_400ms_300ms_both]"
          />
        )}
      </div>

      <p className={cn("mt-12 text-2xl font-medium lg:text-3xl", view.accent)}>{view.kicker}</p>
      {view.title && <h2 className="mt-3 text-5xl font-semibold tracking-tight text-balance lg:text-7xl">{view.title}</h2>}
      {view.subtitle && <p className="mt-5 max-w-2xl text-2xl text-muted-foreground text-balance">{view.subtitle}</p>}

      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/[0.04]">
        <div
          className={cn("h-full origin-left", view.bar)}
          style={{ animation: `kiosk-countdown ${durationMs}ms linear forwards` }}
        />
      </div>
    </div>
  );
}

function describe(result: ScanResult) {
  const firstName = "name" in result ? result.name.split(" ")[0] : "";

  switch (result.kind) {
    case "ok": {
      const time = formatTime(result.occurredAt, DEFAULT_TIME_ZONE);
      const checkIn = result.event === "check_in";
      return {
        background: "bg-success-soft",
        accent: "text-success",
        bar: "bg-success",
        icon: <SuccessCheck />,
        kicker: checkIn ? `Incheckad kl. ${time}` : `Utcheckad kl. ${time}`,
        title: result.name,
        subtitle: checkIn ? `Välkommen, ${firstName}!` : `Tack för idag, ${firstName}!`,
      };
    }
    case "duplicate": {
      const time = formatTime(result.occurredAt, DEFAULT_TIME_ZONE);
      return {
        background: "bg-primary-soft",
        accent: "text-primary",
        bar: "bg-primary",
        icon: <IconCircle className="bg-primary text-white"><Info className="size-20" strokeWidth={2.2} /></IconCircle>,
        kicker: result.event === "check_in" ? "Du är redan incheckad" : "Du är redan utcheckad",
        title: result.name,
        subtitle: `Registrerades kl. ${time}. Ingen ny registrering gjordes.`,
      };
    }
    case "inactive":
      return {
        background: "bg-[#fff6e5]",
        accent: "text-[#9a5b00]",
        bar: "bg-[#d98a00]",
        icon: <IconCircle className="bg-[#d98a00] text-white"><UserX className="size-20" strokeWidth={2.2} /></IconCircle>,
        kicker: "Behörigheten är inaktiverad",
        title: result.name,
        subtitle: "Kontakta skolans reception.",
      };
    case "invalid":
      return {
        background: "bg-[#fdf0ef]",
        accent: "text-destructive",
        bar: "bg-destructive",
        icon: <IconCircle className="bg-destructive text-white"><X className="size-20" strokeWidth={2.6} /></IconCircle>,
        kicker: "QR-koden känns inte igen",
        title: null,
        subtitle: "Använd din personliga QR-kod från VisiTrack. Kontakta receptionen om problemet kvarstår.",
      };
    case "blocked_network":
      return {
        background: "bg-[#fdf0ef]",
        accent: "text-destructive",
        bar: "bg-destructive",
        icon: <IconCircle className="bg-destructive text-white"><ShieldAlert className="size-20" strokeWidth={2.2} /></IconCircle>,
        kicker: "Kiosken är inte godkänd här",
        title: null,
        subtitle: "Registreringen gjordes från ett nätverk som inte är tillåtet. Kontakta systemansvarig.",
      };
    case "error":
      return {
        background: "bg-gray-50",
        accent: "text-foreground",
        bar: "bg-muted-foreground",
        icon: <IconCircle className="bg-gray-700 text-white"><WifiOff className="size-20" strokeWidth={2.2} /></IconCircle>,
        kicker: "Något gick fel",
        title: null,
        subtitle: "Registreringen kunde inte sparas. Kontrollera nätverket och försök igen.",
      };
  }
}

function IconCircle({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("grid size-44 place-items-center rounded-full shadow-lifted motion-safe:animate-[kiosk-pop_420ms_both]", className)}>
      {children}
    </span>
  );
}

/** Large green circle with a check mark that draws itself. */
function SuccessCheck() {
  return (
    <span className="grid size-44 place-items-center rounded-full bg-success shadow-[0_20px_60px_-15px_rgb(21_128_61/0.55)] motion-safe:animate-[kiosk-pop_420ms_both]">
      <svg viewBox="0 0 52 52" className="size-24 text-white" aria-hidden>
        <path
          d="M14 27.5l8 8 16-19"
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="[stroke-dasharray:48] [stroke-dashoffset:0] motion-safe:animate-[kiosk-draw_450ms_180ms_ease-out_both]"
        />
      </svg>
    </span>
  );
}
