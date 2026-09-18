"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_TIME_ZONE, formatDayLong, formatTime } from "@/lib/time";

function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}

// Minute resolution keeps the snapshot stable between ticks.
const getMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

export function KioskClock() {
  const minute = useSyncExternalStore(subscribe, getMinute, () => 0);
  if (!minute) return <div className="h-14" />;

  return (
    <div className="text-right">
      <div className="text-4xl leading-none font-semibold tracking-tight tabular-nums">
        {formatTime(minute, DEFAULT_TIME_ZONE)}
      </div>
      <div className="mt-1.5 text-base text-muted-foreground first-letter:uppercase">
        {formatDayLong(minute, DEFAULT_TIME_ZONE)}
      </div>
    </div>
  );
}
