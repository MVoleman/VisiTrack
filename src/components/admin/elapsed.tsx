"use client";

import { useSyncExternalStore } from "react";
import { formatDuration } from "@/lib/time";

// One shared minute ticker for every <Elapsed /> on the page.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Live "3 tim 12 min" since `since`. Renders the server value first to avoid hydration mismatch. */
export function Elapsed({ since, serverNow }: { since: string; serverNow: number }) {
  const current = useSyncExternalStore(subscribe, () => now, () => serverNow);
  return <>{formatDuration(current - Date.parse(since))}</>;
}
