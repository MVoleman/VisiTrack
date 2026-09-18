"use client";

import { Camera, Play } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { unlockAudio } from "@/lib/kiosk/sounds";
import type { KioskDevice } from "./kiosk-app";

/**
 * Shown until the camera permission has been granted once. The tap is also the
 * user gesture browsers require for sound and full screen.
 */
export function KioskStart({ device, onStart }: { device: KioskDevice; onStart: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-white px-6 text-center">
      <Brand className="mb-12" />
      <span className="grid size-20 place-items-center rounded-[1.75rem] bg-primary-soft text-primary">
        <Camera className="size-9" />
      </span>
      <h1 className="mt-8 text-4xl font-semibold tracking-tight">Redo att starta</h1>
      <p className="mt-3 max-w-md text-lg text-muted-foreground text-balance">
        Kiosken använder kameran för att läsa QR-koder. Tillåt kameran när webbläsaren frågar.
      </p>
      <Button
        size="lg"
        className="mt-10 h-14 rounded-2xl px-8 text-lg"
        onClick={() => {
          unlockAudio();
          void document.documentElement.requestFullscreen?.().catch(() => {});
          onStart();
        }}
      >
        <Play className="size-5" />
        Starta kiosken
      </Button>
      <p className="mt-16 text-sm text-muted-foreground">{device.name}</p>
    </main>
  );
}
