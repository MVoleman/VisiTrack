"use client";

import { useRef, useState } from "react";
import { LogOut, Minimize, RefreshCw, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const HOLD_MS = 2000;

/**
 * Hidden device menu: press and hold the logo for two seconds. Keeps staff
 * controls out of reach of people passing the entrance.
 */
export function KioskMenu({
  children,
  deviceName,
  pendingUploads,
  onRestartCamera,
  onSignOut,
}: {
  children: React.ReactNode;
  deviceName: string;
  pendingUploads: number;
  onRestartCamera: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <>
      <div
        onPointerDown={() => {
          cancel();
          timer.current = setTimeout(() => setOpen(true), HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {children}
      </div>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmSignOut(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg">Kioskinställningar</DialogTitle>
            <DialogDescription>{deviceName}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <p className="flex items-center gap-2 rounded-xl bg-muted/70 px-3 py-2.5 text-sm text-muted-foreground">
              <UploadCloud className="size-4" />
              {pendingUploads === 0 ? "Alla bilder är uppladdade." : `${pendingUploads} bild(er) väntar på uppladdning.`}
            </p>
            <Button
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => {
                onRestartCamera();
                setOpen(false);
              }}
            >
              <RefreshCw />
              Starta om kameran
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="justify-start"
              onClick={() => {
                void (document.fullscreenElement
                  ? document.exitFullscreen()
                  : document.documentElement.requestFullscreen?.()
                )?.catch(() => {});
                setOpen(false);
              }}
            >
              <Minimize />
              Växla helskärm
            </Button>
            {confirmSignOut ? (
              <div className="mt-2 grid gap-2 rounded-xl bg-destructive/[0.05] p-3">
                <p className="text-sm">
                  Kiosken slutar ta emot registreringar tills någon loggar in igen.
                  {pendingUploads > 0 && " Bilder som inte laddats upp går förlorade."}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmSignOut(false)}>
                    Avbryt
                  </Button>
                  <Button variant="destructive" onClick={() => void onSignOut()}>
                    Logga ut
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="lg"
                className="justify-start text-destructive hover:bg-destructive/[0.06] hover:text-destructive"
                onClick={() => setConfirmSignOut(true)}
              >
                <LogOut />
                Logga ut enheten
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
