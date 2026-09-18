"use client";

import { useEffect, useState, useTransition } from "react";
import { Download, Printer, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { QrCode, renderBadgePng, slugify } from "@/components/admin/qr-code";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getWorkerQrToken, rotateQrToken } from "./actions";

export type QrWorker = { id: string; full_name: string; company: string; role: string; qr_token?: string };

export function QrDialog({ worker, onOpenChange }: { worker: QrWorker | null; onOpenChange: (open: boolean) => void }) {
  const [token, setToken] = useState<{ workerId: string; value: string } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rotating, startRotate] = useTransition();
  const [downloading, setDownloading] = useState(false);

  const workerId = worker?.id;
  const knownToken = worker?.qr_token;
  const currentToken = token?.workerId === workerId ? token?.value : knownToken;

  useEffect(() => {
    if (!workerId || knownToken) return;
    let cancelled = false;
    getWorkerQrToken(workerId).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data) setToken({ workerId, value: result.data.qr_token });
      else if (!result.ok) toast.error(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [workerId, knownToken]);

  async function download() {
    if (!worker || !currentToken) return;
    setDownloading(true);
    try {
      const url = await renderBadgePng({ token: currentToken, name: worker.full_name, company: worker.company });
      const link = document.createElement("a");
      link.href = url;
      link.download = `qr-${slugify(worker.full_name)}.png`;
      link.click();
    } finally {
      setDownloading(false);
    }
  }

  function rotate() {
    if (!worker) return;
    startRotate(async () => {
      const result = await rotateQrToken(worker.id);
      if (result.ok && result.data) {
        setToken({ workerId: worker.id, value: result.data.qr_token });
        toast.success(result.message);
      } else if (!result.ok) {
        toast.error(result.error);
      }
      setConfirmRotate(false);
    });
  }

  return (
    <>
      <Dialog open={!!worker} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">{worker?.full_name}</DialogTitle>
            <DialogDescription>
              {worker?.company} · {worker?.role}
            </DialogDescription>
          </DialogHeader>

          <div className="mx-auto w-full max-w-[260px] rounded-2xl bg-white p-5 ring-1 ring-foreground/[0.08]">
            {currentToken ? (
              <QrCode key={currentToken} value={currentToken} label={`QR-kod för ${worker?.full_name}`} />
            ) : (
              <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
            )}
          </div>

          <p className="flex gap-2 rounded-xl bg-muted/70 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldAlert className="mt-px size-4 shrink-0" />
            QR-koden fungerar som en personlig nyckel. Dela den bara med personen själv.
          </p>

          <div className="grid gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={download} disabled={!currentToken || downloading}>
                {downloading ? <Spinner /> : <Download />}
                Ladda ner
              </Button>
              <Button variant="outline" asChild disabled={!currentToken}>
                <a href={worker ? `/admin/badges/${worker.id}` : "#"} target="_blank" rel="noreferrer">
                  <Printer />
                  Skriv ut
                </a>
              </Button>
            </div>
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setConfirmRotate(true)}
              disabled={!currentToken}
            >
              <RefreshCw />
              Skapa ny QR-kod
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skapa en ny QR-kod?</AlertDialogTitle>
            <AlertDialogDescription>
              Den nuvarande koden för {worker?.full_name} slutar fungera direkt. Använd detta om en kod har
              tappats bort eller delats med fel person.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                rotate();
              }}
              disabled={rotating}
            >
              {rotating && <Spinner />}
              Skapa ny kod
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
