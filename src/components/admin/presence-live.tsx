"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Presence also changes when check-ins age out of the presence window, so refresh periodically too. */
const FALLBACK_REFRESH_MS = 60_000;
/** Coalesces bursts (scan + snapshot confirmation arrive ~1 s apart) into one refresh. */
const DEBOUNCE_MS = 400;

type Status = "connecting" | "live" | "offline";

/**
 * Subscribes to time_logs changes over Supabase Realtime (RLS applies, so only
 * admins receive events) and re-renders the server components on every change.
 */
export function PresenceLive() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>("connecting");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };

    const channel = supabase
      .channel("admin-presence")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_logs" }, refresh)
      .subscribe((state) => {
        if (state === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          setStatus("live");
          // Catch up on anything that happened while disconnected.
          refresh();
        } else if (state === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || state === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
          setStatus("offline");
        } else if (state === REALTIME_SUBSCRIBE_STATES.CLOSED) {
          setStatus("connecting");
        }
      });

    const interval = setInterval(() => router.refresh(), FALLBACK_REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  const label = { connecting: "Ansluter", live: "Live", offline: "Frånkopplad" }[status];

  return (
    <span
      role="status"
      aria-label={`Realtidsuppdatering: ${label}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
        status === "live" && "bg-success-soft text-success",
        status === "connecting" && "bg-muted text-muted-foreground",
        status === "offline" && "bg-destructive/[0.08] text-destructive",
      )}
    >
      <span className="relative flex size-2">
        {status === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "live" ? "bg-success" : status === "offline" ? "bg-destructive" : "bg-muted-foreground/60",
          )}
        />
      </span>
      {label}
    </span>
  );
}
