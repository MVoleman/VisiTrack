"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import { sendBadgeLink } from "./actions";

export type SendableWorker = { id: string; full_name: string; email: string | null };

/**
 * Confirms where the code is about to go.
 *
 * The address is shown in full and selectable rather than summarised: a QR code
 * sent to a mistyped address is a working key in a stranger's inbox, and a
 * typosquatted domain accepts the mail without ever bouncing. This is the last
 * point at which a human can catch that.
 */
export function SendBadgeDialog({
  worker,
  onOpenChange,
}: {
  worker: SendableWorker | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [sending, startSending] = useTransition();

  function send() {
    if (!worker?.email) return;
    startSending(async () => {
      const result = await sendBadgeLink(worker.id, worker.email!);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      onOpenChange(false);
    });
  }

  return (
    <AlertDialog open={!!worker} onOpenChange={(open) => !open && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Skicka QR-koden till {worker?.full_name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-3">
              <span>Mejlet skickas till:</span>
              <span className="rounded-xl bg-muted px-3 py-2.5 font-mono text-sm break-all text-foreground select-all">
                {worker?.email}
              </span>
              <span>
                Mejlet innehåller en länk till koden, inte koden själv. Länken slutar gälla efter sju dagar.
                Koden fungerar som en nyckel – kontrollera att adressen stämmer.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sending}>Avbryt</AlertDialogCancel>
          <AlertDialogAction
            disabled={sending}
            onClick={(e) => {
              e.preventDefault();
              send();
            }}
          >
            {sending && <Spinner />}
            Skicka
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
