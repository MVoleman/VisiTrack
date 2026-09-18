"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CameraOff, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { CameraError, openCamera, stopCamera, waitForVideo, type CameraErrorKind } from "@/lib/kiosk/camera";
import { QrScanner, type ScanHit } from "@/lib/kiosk/scanner";
import { playError, playNotice, playSuccess, unlockAudio } from "@/lib/kiosk/sounds";
import { SnapshotUploader } from "@/lib/kiosk/uploader";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import type { KioskDevice } from "./kiosk-app";
import { KioskClock } from "./kiosk-clock";
import { KioskMenu } from "./kiosk-menu";
import { KioskResult, type ScanResult } from "./kiosk-result";

const RESULT_MS = 3000;
/** The same badge is ignored for a moment after its result, so it isn't read twice while being lowered. */
const SAME_TOKEN_COOLDOWN_MS = 6000;

type CameraState = { status: "starting" } | { status: "live" } | { status: "error"; kind: CameraErrorKind };

export function KioskScreen({
  supabase,
  device,
  onSignOut,
}: {
  supabase: SupabaseClient<Database>;
  device: KioskDevice;
  onSignOut: () => Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const uploaderRef = useRef<SnapshotUploader | null>(null);
  const busyRef = useRef(false);
  const lastTokenRef = useRef<{ token: string; at: number } | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoUrlRef = useRef<string | null>(null);

  const [camera, setCamera] = useState<CameraState>({ status: "starting" });
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [flash, setFlash] = useState(0);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    uploaderRef.current = new SnapshotUploader(supabase, setPendingUploads);
  }, [supabase]);

  const dismissResult = useCallback(() => {
    if (resultTimer.current) clearTimeout(resultTimer.current);
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setResult(null);
    busyRef.current = false;
  }, []);

  const showResult = useCallback(
    (next: ScanResult) => {
      if (resultTimer.current) clearTimeout(resultTimer.current);
      setResult(next);
      if (next.kind === "ok") playSuccess();
      else if (next.kind === "duplicate") playNotice();
      else playError();
      resultTimer.current = setTimeout(dismissResult, RESULT_MS);
    },
    [dismissResult],
  );

  const handleHit = useCallback(
    async (hit: ScanHit) => {
      if (busyRef.current) return;
      const last = lastTokenRef.current;
      if (last && last.token === hit.token && Date.now() - last.at < SAME_TOKEN_COOLDOWN_MS) return;

      busyRef.current = true;
      lastTokenRef.current = { token: hit.token, at: Date.now() };
      setFlash((n) => n + 1);

      // The snapshot of this exact frame is already encoding; register the scan in parallel.
      const [rpc, blob] = await Promise.all([
        supabase.rpc("kiosk_register_scan", {
          p_token: hit.token,
          p_client_captured_at: hit.capturedAt.toISOString(),
        }),
        hit.snapshot,
      ]);
      lastTokenRef.current = { token: hit.token, at: Date.now() };

      if (rpc.error || !rpc.data?.[0]) {
        console.error("kiosk_register_scan failed", rpc.error);
        if (rpc.error?.code === "42501") {
          await onSignOut();
          return;
        }
        showResult({ kind: "error" });
        return;
      }

      const row = rpc.data[0];
      const photoUrl = blob && row.status === "ok" ? URL.createObjectURL(blob) : undefined;
      if (photoUrl) photoUrlRef.current = photoUrl;

      if (row.status === "ok" && row.snapshot_path && row.time_log_id) {
        if (blob) uploaderRef.current?.enqueue(row.time_log_id, row.snapshot_path, blob);
        else console.error("Snapshot could not be encoded", row.time_log_id);
      }

      switch (row.status) {
        case "ok":
        case "duplicate":
          showResult({
            kind: row.status,
            event: row.event_type,
            name: row.worker_name,
            occurredAt: row.occurred_at,
            photoUrl,
          });
          break;
        case "inactive_worker":
          showResult({ kind: "inactive", name: row.worker_name });
          break;
        case "blocked_network":
          // The database refused the scan: this kiosk is outside the allowlist.
          showResult({ kind: "blocked_network" });
          break;
        default:
          showResult({ kind: "invalid" });
      }
    },
    [supabase, showResult, onSignOut],
  );

  // The scanner calls the latest handler through a ref, so re-renders never restart the camera.
  const handleHitRef = useRef(handleHit);
  useEffect(() => {
    handleHitRef.current = handleHit;
  }, [handleHit]);

  // Camera + scanner lifecycle.
  useEffect(() => {
    const video = videoRef.current!;
    let stream: MediaStream | null = null;
    let cancelled = false;

    (async () => {
      setCamera({ status: "starting" });
      try {
        stream = await openCamera();
        if (cancelled) return stopCamera(stream);
        video.srcObject = stream;
        await video.play().catch(() => {});
        await waitForVideo(video);

        stream.getVideoTracks()[0]?.addEventListener("ended", () => setCamera({ status: "error", kind: "not-found" }));

        const scanner = new QrScanner(video, (hit) => void handleHitRef.current(hit));
        scannerRef.current = scanner;
        await scanner.prepare();
        if (cancelled) return;
        scanner.start();
        setCamera({ status: "live" });
      } catch (error) {
        if (cancelled) return;
        console.warn("Camera start failed", error);
        setCamera({ status: "error", kind: error instanceof CameraError ? error.kind : "unknown" });
      }
    })();

    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
      stopCamera(stream);
      video.srcObject = null;
    };
  }, [cameraAttempt]);

  // Keep the screen awake, unlock audio on first touch, track connectivity.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen");
      } catch {
        // Not supported or denied; the device's own power settings apply.
      }
    };
    void acquire();

    const onVisible = () => void acquire();
    const onPointer = () => unlockAudio();
    const onOnline = () => setOnline(navigator.onLine);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    onOnline();

    return () => {
      void lock?.release().catch(() => {});
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);

  useEffect(() => () => {
    if (resultTimer.current) clearTimeout(resultTimer.current);
  }, []);

  return (
    <main className="fixed inset-0 flex touch-manipulation flex-col overflow-hidden bg-white select-none [overscroll-behavior:none]">
      <header className="flex shrink-0 items-center justify-between px-8 pt-7 lg:px-12 lg:pt-9">
        <KioskMenu
          deviceName={device.name}
          pendingUploads={pendingUploads}
          onRestartCamera={() => setCameraAttempt((n) => n + 1)}
          onSignOut={onSignOut}
        >
          <span className="flex items-center gap-3">
            <BrandMark className="size-10 rounded-[0.9rem]" />
            <span className="text-lg font-semibold tracking-tight">VisiTrack</span>
          </span>
        </KioskMenu>
        <KioskClock />
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-8 py-6 landscape:lg:flex-row landscape:lg:gap-16 lg:px-12">
        <section className="min-w-0 shrink-0 text-center landscape:lg:flex-1 landscape:lg:shrink landscape:lg:text-left">
          <h1 className="text-5xl leading-none font-semibold tracking-tight text-balance sm:text-6xl xl:text-7xl 2xl:text-8xl">Välkommen</h1>
          <p className="mt-4 text-xl text-muted-foreground text-balance sm:mt-6 sm:text-2xl xl:text-3xl">
            Visa din QR-kod för kameran för att checka in eller ut.
          </p>
        </section>

        <section className="flex min-h-0 w-full min-w-0 flex-1 items-center justify-center landscape:lg:h-full landscape:lg:max-h-[72vh] landscape:lg:flex-[1.1]">
          {/* Fills the available height, keeps 4:3 where possible and never overflows the screen. */}
          <div className="relative aspect-[4/3] h-full max-h-full max-w-full overflow-hidden rounded-[2rem] bg-gray-100 shadow-lifted ring-1 ring-foreground/[0.06]">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              aria-label="Kamerabild"
              // Mirrored so it feels like a mirror; decoding and snapshots use the unmirrored frame.
              className={cn(
                "absolute inset-0 size-full -scale-x-100 object-cover transition-opacity duration-500",
                camera.status === "live" ? "opacity-100" : "opacity-0",
              )}
            />
            {camera.status === "live" && <ScanFrame />}
            {camera.status === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-lg text-muted-foreground">Startar kameran…</div>
            )}
            {camera.status === "error" && (
              <CameraProblem kind={camera.kind} onRetry={() => setCameraAttempt((n) => n + 1)} />
            )}
            {flash > 0 && (
              <div key={flash} className="pointer-events-none absolute inset-0 animate-[kiosk-flash_450ms_ease-out_forwards] bg-white" />
            )}
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-6 px-8 pb-7 text-sm text-muted-foreground lg:px-12 lg:pb-9">
        <p className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" />
          En bild sparas vid varje registrering för att verifiera identiteten och raderas automatiskt.
        </p>
        {!online && (
          <p className="flex shrink-0 items-center gap-2 rounded-full bg-destructive/[0.08] px-3 py-1.5 font-medium text-destructive">
            <WifiOff className="size-4" />
            Ingen anslutning
          </p>
        )}
      </footer>

      {result && <KioskResult result={result} durationMs={RESULT_MS} onDismiss={dismissResult} />}
    </main>
  );
}

function ScanFrame() {
  const corner = "absolute size-14 border-white/90 motion-safe:animate-[kiosk-breathe_2.4s_ease-in-out_infinite]";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-[14%]">
      <span className={cn(corner, "top-0 left-0 rounded-tl-3xl border-t-4 border-l-4")} />
      <span className={cn(corner, "top-0 right-0 rounded-tr-3xl border-t-4 border-r-4")} />
      <span className={cn(corner, "bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4")} />
      <span className={cn(corner, "right-0 bottom-0 rounded-br-3xl border-r-4 border-b-4")} />
    </div>
  );
}

const cameraMessages: Record<CameraErrorKind, { title: string; body: string }> = {
  denied: {
    title: "Kameran är blockerad",
    body: "Tillåt kameran för den här sidan i webbläsarens inställningar och försök igen.",
  },
  "not-found": { title: "Ingen kamera hittades", body: "Kontrollera att kameran är ansluten." },
  "in-use": { title: "Kameran används av ett annat program", body: "Stäng andra program som använder kameran." },
  insecure: { title: "Osäker anslutning", body: "Kiosken måste öppnas via https för att kunna använda kameran." },
  unsupported: { title: "Webbläsaren stöds inte", body: "Använd en aktuell version av Chrome, Edge eller Safari." },
  unknown: { title: "Kameran kunde inte startas", body: "Försök igen. Starta om enheten om felet kvarstår." },
};

function CameraProblem({ kind, onRetry }: { kind: CameraErrorKind; onRetry: () => void }) {
  const message = cameraMessages[kind];
  return (
    <div role="alert" className="absolute inset-0 grid place-items-center bg-gray-50 p-8 text-center">
      <div className="grid max-w-sm justify-items-center gap-3">
        <span className="grid size-16 place-items-center rounded-2xl bg-white text-muted-foreground shadow-soft">
          <CameraOff className="size-7" />
        </span>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">{message.title}</h2>
        <p className="text-muted-foreground">{message.body}</p>
        <Button size="lg" variant="outline" className="mt-3" onClick={onRetry}>
          <RefreshCw />
          Försök igen
        </Button>
      </div>
    </div>
  );
}
