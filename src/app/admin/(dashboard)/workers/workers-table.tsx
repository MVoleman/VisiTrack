"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Printer,
  QrCode as QrIcon,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDayShort } from "@/lib/time";
import { cn, initials } from "@/lib/utils";
import { deleteWorker, setWorkerActive } from "./actions";
import { QrDialog, type QrWorker } from "./qr-dialog";
import { SendBadgeDialog } from "./send-badge-dialog";
import { WorkerFormDialog, type EditableWorker } from "./worker-form-dialog";

export type WorkerListItem = EditableWorker & {
  is_active: boolean;
  present: boolean;
  last_activity: string | null;
  /** When the badge was last emailed, and whether that link was ever opened. Admins only. */
  badge_sent_at: string | null;
  badge_opened: boolean;
};

type StatusFilter = "active" | "inactive" | "all";

export function WorkersTable({ workers, canManage }: { workers: WorkerListItem[]; canManage: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EditableWorker | null>(null);
  const [qrWorker, setQrWorker] = useState<QrWorker | null>(null);
  const [deleting, setDeleting] = useState<WorkerListItem | null>(null);
  const [sendingTo, setSendingTo] = useState<WorkerListItem | null>(null);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(
    () => ({
      active: workers.filter((w) => w.is_active).length,
      inactive: workers.filter((w) => !w.is_active).length,
      all: workers.length,
    }),
    [workers],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers.filter((w) => {
      if (status === "active" && !w.is_active) return false;
      if (status === "inactive" && w.is_active) return false;
      if (!q) return true;
      return [w.full_name, w.company, w.role, w.email ?? ""].some((v) => v.toLowerCase().includes(q));
    });
  }, [workers, query, status]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function toggleActive(worker: WorkerListItem) {
    startTransition(async () => {
      const result = await setWorkerActive(worker.id, !worker.is_active);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    startTransition(async () => {
      const result = await deleteWorker(target.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setDeleting(null);
    });
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Sök namn, företag eller roll"
            aria-label="Sök personal"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={status}
            onValueChange={(v) => v && setStatus(v as StatusFilter)}
            variant="outline"
            aria-label="Filtrera på status"
            className="bg-white"
          >
            <ToggleGroupItem value="active" className="h-10 px-3.5">Aktiva <span className="text-muted-foreground tabular-nums">{counts.active}</span></ToggleGroupItem>
            <ToggleGroupItem value="inactive" className="h-10 px-3.5">Inaktiva <span className="text-muted-foreground tabular-nums">{counts.inactive}</span></ToggleGroupItem>
            <ToggleGroupItem value="all" className="h-10 px-3.5">Alla</ToggleGroupItem>
          </ToggleGroup>
          {canManage && (
            <Button onClick={openCreate} className="h-10 max-sm:hidden">
              <Plus />
              Lägg till person
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/[0.06]">
        {workers.length === 0 ? (
          <Empty className="py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Ingen personal ännu</EmptyTitle>
              <EmptyDescription>
                {canManage
                  ? "Lägg till extern personal för att skapa deras personliga QR-koder."
                  : "En administratör lägger till personal."}
              </EmptyDescription>
            </EmptyHeader>
            {canManage && (
              <EmptyContent>
                <Button onClick={openCreate}>
                  <UserPlus />
                  Lägg till första personen
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : visible.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">Ingen matchar din sökning.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6">Namn</TableHead>
                <TableHead className="max-md:hidden">Företag</TableHead>
                <TableHead className="max-lg:hidden">Roll</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0 pr-6"><span className="sr-only">Åtgärder</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((worker) => (
                <TableRow key={worker.id} className={worker.is_active ? undefined : "text-muted-foreground"}>
                  <TableCell className="pl-6">
                    <button
                      type="button"
                      onClick={() => canManage && setQrWorker(worker)}
                      disabled={!canManage}
                      aria-label={canManage ? `Visa QR-kod för ${worker.full_name}` : undefined}
                      className="flex items-center gap-3 rounded-lg text-left outline-none disabled:cursor-default focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground/80">
                        {initials(worker.full_name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{worker.full_name}</span>
                        <span className="block text-xs text-muted-foreground md:hidden">{worker.company} · {worker.role}</span>
                        <span className="hidden text-xs text-muted-foreground md:block lg:hidden">{worker.role}</span>
                        {worker.email && (
                          <span className="block text-xs text-muted-foreground max-lg:hidden">
                            {worker.email}
                            {worker.badge_sent_at && (
                              <span className="text-muted-foreground/80">
                                {" · kod skickad "}
                                {formatDayShort(worker.badge_sent_at)}
                                {worker.badge_opened && " · öppnad"}
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="max-md:hidden">{worker.company}</TableCell>
                  <TableCell className="max-lg:hidden">{worker.role}</TableCell>
                  <TableCell>
                    <StatusPill worker={worker} />
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <div className={cn("flex items-center justify-end gap-1", !canManage && "hidden")}>
                      <Button variant="ghost" size="icon" aria-label={`Visa QR-kod för ${worker.full_name}`} onClick={() => setQrWorker(worker)} className="max-sm:hidden">
                        <QrIcon />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Fler åtgärder för ${worker.full_name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuItem onSelect={() => setQrWorker(worker)}>
                            <QrIcon /> Visa QR-kod
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a href={`/admin/badges/${worker.id}`} target="_blank" rel="noreferrer">
                              <Printer /> Skriv ut passerkort
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => setSendingTo(worker)}
                            disabled={!worker.email}
                            title={worker.email ? undefined : "Personen saknar e-postadress"}
                          >
                            <Mail /> Mejla QR-koden
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(worker);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil /> Redigera
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => toggleActive(worker)} disabled={pending}>
                            {worker.is_active ? <PowerOff /> : <Power />}
                            {worker.is_active ? "Inaktivera" : "Aktivera"}
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(worker)}>
                            <Trash2 /> Ta bort
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {canManage && (
        <Button onClick={openCreate} size="lg" className="fixed right-5 bottom-5 z-20 rounded-full shadow-lifted sm:hidden">
          <Plus />
          Lägg till
        </Button>
      )}

      <WorkerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        worker={editing}
        onSaved={(saved, created) => {
          setFormOpen(false);
          // Hand the new QR code over straight away — the natural next step.
          if (created) setQrWorker(saved);
        }}
      />

      <QrDialog
        worker={qrWorker}
        onOpenChange={(open) => !open && setQrWorker(null)}
        onSend={(worker) => {
          setQrWorker(null);
          setSendingTo(workers.find((w) => w.id === worker.id) ?? null);
        }}
      />

      <SendBadgeDialog worker={sendingTo} onOpenChange={(open) => !open && setSendingTo(null)} />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort {deleting?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Det går bara att ta bort personer som aldrig har registrerats. Personer med tidrapporter
              inaktiveras i stället så att historiken finns kvar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {pending && <Spinner />}
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusPill({ worker }: { worker: WorkerListItem }) {
  if (!worker.is_active) {
    return <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">Inaktiv</span>;
  }
  if (worker.present) {
    return (
      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-xs font-medium text-success">
        <span className="size-1.5 rounded-full bg-success" />
        På plats
      </span>
    );
  }
  return <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-xs font-medium text-secondary-foreground">Aktiv</span>;
}
