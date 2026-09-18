"use client";

import { useState, useTransition } from "react";
import { Ban, CameraOff, Timer } from "lucide-react";
import { toast } from "sonner";
import { EventBadge } from "@/components/admin/event-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, isoTimeInZone } from "@/lib/time";
import { updateLogNote, voidLog } from "./actions";
import type { LogRow } from "./logs-table";

export function LogDetailDialog({
  log,
  timeZone,
  canManage,
  onOpenChange,
}: {
  log: LogRow | null;
  timeZone: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!log} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-2xl md:overflow-hidden"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Keyed so local form state resets per record. */}
        {log && <DetailBody key={log.id} log={log} timeZone={timeZone} canManage={canManage} />}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({ log, timeZone, canManage }: { log: LogRow; timeZone: string; canManage: boolean }) {
  const [note, setNote] = useState(log.note ?? "");
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [savingNote, startSaveNote] = useTransition();
  const [savingVoid, startVoid] = useTransition();

  // Difference between the kiosk's clock at capture and the server timestamp.
  const clockSkewSeconds =
    log.clientCapturedAt != null ? Math.round((Date.parse(log.occurredAt) - Date.parse(log.clientCapturedAt)) / 1000) : null;

  return (
    <div className="grid md:grid-cols-[1.1fr_1fr]">
      <div className="relative aspect-video bg-gray-950 md:aspect-auto md:min-h-[420px]">
        {log.snapshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={log.snapshotUrl}
            alt={`Bild tagen vid registrering av ${log.workerName}`}
            // Contain, never crop: the whole captured frame is the evidence.
            className="absolute inset-0 size-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-gray-400">
            <div className="grid justify-items-center gap-3">
              {log.snapshotState === "purged" ? <Timer className="size-8" /> : <CameraOff className="size-8" />}
              {
                {
                  purged: "Bilden har raderats enligt lagringspolicyn.",
                  missing: "Ingen bild laddades upp för den här registreringen.",
                  none: "Manuell registrering – ingen bild.",
                  available: "Bilden kunde inte laddas.",
                }[log.snapshotState]
              }
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 p-6 md:max-h-[85dvh] md:overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg">{log.workerName}</DialogTitle>
          <DialogDescription>
            {log.company} · {log.role}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Händelse</dt>
          <dd><EventBadge event={log.event} voided={!!log.voidedAt} /></dd>
          <dt className="text-muted-foreground">Tid</dt>
          <dd className="font-medium tabular-nums">
            {formatDateTime(log.occurredAt, timeZone)}
            <span className="font-normal text-muted-foreground">:{isoTimeInZone(log.occurredAt, timeZone).slice(6)}</span>
          </dd>
          <dt className="text-muted-foreground">Källa</dt>
          <dd>{log.source === "kiosk" ? (log.kioskName ?? "Kiosk") : "Manuell registrering"}</dd>
          {log.kioskIp && (
            <>
              <dt className="text-muted-foreground">Nätverk</dt>
              <dd className="tabular-nums">{log.kioskIp}</dd>
            </>
          )}
          {clockSkewSeconds !== null && Math.abs(clockSkewSeconds) >= 5 && (
            <>
              <dt className="text-muted-foreground">Kioskens klocka</dt>
              <dd className="text-[#9a5b00]">Avviker {Math.abs(clockSkewSeconds)} s från servern</dd>
            </>
          )}
        </dl>

        {log.voidedAt ? (
          <div className="rounded-xl bg-destructive/[0.06] p-4 text-sm">
            <p className="font-medium text-destructive">Makulerad {formatDateTime(log.voidedAt, timeZone)}</p>
            <p className="mt-1 text-foreground/80">{log.voidReason}</p>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="note">Anteckning</Label>
          <Textarea
            id="note"
            readOnly={!canManage}
            value={note}
            maxLength={500}
            placeholder="t.ex. Glömde checka ut, bekräftat med arbetsledare"
            onChange={(e) => setNote(e.target.value)}
          />
          {canManage && note !== (log.note ?? "") && (
            <Button
              size="sm"
              className="h-8 justify-self-end"
              disabled={savingNote}
              onClick={() =>
                startSaveNote(async () => {
                  const result = await updateLogNote(log.id, note);
                  if (result.ok) toast.success(result.message);
                  else toast.error(result.error);
                })
              }
            >
              {savingNote && <Spinner />}
              Spara anteckning
            </Button>
          )}
        </div>

        {canManage && !log.voidedAt && (
          <div className="mt-auto border-t pt-5">
            {voiding ? (
              <div className="grid gap-2">
                <Label htmlFor="reason">Orsak till makulering</Label>
                <Textarea
                  id="reason"
                  autoFocus
                  value={reason}
                  maxLength={500}
                  placeholder="t.ex. Dubbelregistrering, fel person skannades"
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Registreringen finns kvar i historiken men räknas inte i närvaro eller rapporter.
                </p>
                <div className="mt-1 flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setVoiding(false)} disabled={savingVoid}>
                    Avbryt
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={reason.trim().length < 3 || savingVoid}
                    onClick={() =>
                      startVoid(async () => {
                        const result = await voidLog(log.id, reason);
                        if (result.ok) {
                          toast.success(result.message);
                          setVoiding(false);
                        } else {
                          toast.error(result.error);
                        }
                      })
                    }
                  >
                    {savingVoid && <Spinner />}
                    Makulera
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="text-destructive hover:bg-destructive/[0.06] hover:text-destructive" onClick={() => setVoiding(true)}>
                <Ban />
                Makulera registrering
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
