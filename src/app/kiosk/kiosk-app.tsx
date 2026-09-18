"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createKioskClient } from "@/lib/supabase/client";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { KioskScreen } from "./kiosk-screen";
import { KioskSignIn } from "./kiosk-sign-in";
import { KioskStart } from "./kiosk-start";

export type KioskDevice = { userId: string; name: string };

type State =
  | { phase: "loading" }
  | { phase: "unconfigured" }
  | { phase: "signed-out"; error?: string }
  | { phase: "ready"; device: KioskDevice }
  | { phase: "running"; device: KioskDevice };

export function KioskApp() {
  const configured = getSupabaseEnv() !== null;
  const supabase = useMemo(() => (configured ? createKioskClient() : null), [configured]);
  const [state, setState] = useState<State>(configured ? { phase: "loading" } : { phase: "unconfigured" });

  /** Loads the device identity for the current session, or signs out non-kiosk accounts. */
  const resolveDevice = useCallback(async (): Promise<State> => {
    if (!supabase) return { phase: "unconfigured" };
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return { phase: "signed-out" };

    const { data: appUser, error } = await supabase
      .from("app_users")
      .select("role, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return { phase: "signed-out", error: "Kunde inte kontrollera kontot. Kontrollera nätverket." };
    if (appUser?.role !== "kiosk") {
      await supabase.auth.signOut();
      return { phase: "signed-out", error: "Kontot är inte ett kioskkonto." };
    }
    return { phase: "ready", device: { userId: user.id, name: appUser.display_name } };
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    void resolveDevice().then(async (next) => {
      if (cancelled) return;
      // After a reload (e.g. power cut) resume scanning without a tap if the
      // camera permission was already granted.
      if (next.phase === "ready" && (await cameraPermissionGranted())) {
        setState({ phase: "running", device: next.device });
      } else {
        setState(next);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setState({ phase: "signed-out" });
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase, resolveDevice]);

  switch (state.phase) {
    case "loading":
      return <div className="flex-1 bg-white" aria-busy="true" />;
    case "unconfigured":
      return (
        <main className="grid flex-1 place-items-center bg-white p-8 text-center text-muted-foreground">
          Supabase är inte konfigurerat.
        </main>
      );
    case "signed-out":
      return (
        <KioskSignIn
          supabase={supabase!}
          initialError={state.error}
          onSignedIn={async () => {
            const next = await resolveDevice();
            setState(next);
            return next.phase === "signed-out" ? next.error : undefined;
          }}
        />
      );
    case "ready":
      return <KioskStart device={state.device} onStart={() => setState({ phase: "running", device: state.device })} />;
    case "running":
      return (
        <KioskScreen
          supabase={supabase!}
          device={state.device}
          onSignOut={async () => {
            await supabase!.auth.signOut();
            setState({ phase: "signed-out" });
          }}
        />
      );
  }
}

async function cameraPermissionGranted() {
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}
