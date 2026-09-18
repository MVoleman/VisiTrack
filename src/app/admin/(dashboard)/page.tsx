import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CameraOff, DoorOpen, LogIn, Users } from "lucide-react";
import { Elapsed } from "@/components/admin/elapsed";
import { EventBadge } from "@/components/admin/event-badge";
import { PageHeader } from "@/components/admin/page-header";
import { PresenceLive } from "@/components/admin/presence-live";
import { SnapshotThumb } from "@/components/admin/snapshot-thumb";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getRequestTime, getSettings, requireReader } from "@/lib/auth";
import { snapshotState, snapshotUrl } from "@/lib/snapshots";
import { formatDayLong, formatTime, isoDateInZone, startOfDayInZone } from "@/lib/time";

export const metadata: Metadata = { title: "Översikt" };

function greeting(hour: number) {
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgon";
  if (hour < 18) return "Hej";
  return "God kväll";
}

export default async function OverviewPage() {
  const { supabase, displayName } = await requireReader();
  const settings = await getSettings();
  const tz = settings.time_zone;
  const now = getRequestTime();
  const todayStart = startOfDayInZone(isoDateInZone(now, tz), tz).toISOString();
  // Uploads normally land within seconds; older kiosk scans without a photo are flagged.
  const uploadGrace = new Date(now - 2 * 60_000).toISOString();

  const [presence, checkInsToday, activeWorkers, missingSnapshots, recent] = await Promise.all([
    supabase.from("current_presence").select("*").order("checked_in_at", { ascending: false }),
    supabase
      .from("time_logs")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "check_in")
      .is("voided_at", null)
      .gte("occurred_at", todayStart),
    supabase.from("workers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("time_logs")
      .select("id", { count: "exact", head: true })
      .eq("source", "kiosk")
      .is("snapshot_uploaded_at", null)
      .is("voided_at", null)
      .gte("occurred_at", todayStart)
      .lt("occurred_at", uploadGrace),
    supabase
      .from("time_logs")
      .select("id, event_type, occurred_at, voided_at, snapshot_path, snapshot_uploaded_at, snapshot_purged_at, workers(full_name, company)")
      .gte("occurred_at", todayStart)
      .order("occurred_at", { ascending: false })
      .limit(8),
  ]);

  const present = presence.data ?? [];
  const recentRows = recent.data ?? [];
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));

  const stats = [
    { label: "I byggnaden nu", value: present.length, icon: DoorOpen, tone: "text-success bg-success-soft" },
    { label: "Incheckningar idag", value: checkInsToday.count ?? 0, icon: LogIn, tone: "text-primary bg-primary-soft" },
    { label: "Aktiv personal", value: activeWorkers.count ?? 0, icon: Users, tone: "text-foreground bg-muted" },
    {
      label: "Registreringar utan bild idag",
      value: missingSnapshots.count ?? 0,
      icon: CameraOff,
      tone: (missingSnapshots.count ?? 0) > 0 ? "text-[#9a5b00] bg-[#fff6e5]" : "text-muted-foreground bg-muted",
    },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting(hour)}, ${displayName.split(" ")[0]}`}
        description={<span className="first-letter:uppercase">{formatDayLong(now, tz)}</span>}
      />

      <section aria-label="Nyckeltal" className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} size="sm" className="gap-3">
            <CardContent className="flex flex-col gap-4">
              <span className={`grid size-9 place-items-center rounded-xl ${tone}`}>
                <Icon className="size-[18px]" />
              </span>
              <div>
                <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
                <div className="mt-0.5 text-sm text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">I byggnaden just nu</CardTitle>
            <CardDescription>Uppdateras automatiskt vid varje registrering.</CardDescription>
            <CardAction>
              <PresenceLive />
            </CardAction>
          </CardHeader>
          <CardContent>
            {present.length === 0 ? (
              <Empty className="py-10">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <DoorOpen />
                  </EmptyMedia>
                  <EmptyTitle>Ingen är incheckad</EmptyTitle>
                  <EmptyDescription>När någon checkar in vid kiosken visas de här direkt.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="-mx-2 grid">
                {present.map((p) => (
                  <li key={p.worker_id} className="flex items-center gap-4 rounded-xl px-2 py-3">
                    <SnapshotThumb
                      url={snapshotUrl(p)}
                      state={snapshotState(p)}
                      name={p.full_name ?? ""}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.full_name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {p.company} · {p.role}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium tabular-nums">In {formatTime(p.checked_in_at!, tz)}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        <Elapsed since={p.checked_in_at!} serverNow={now} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Senaste registreringar</CardTitle>
            <CardDescription>Idag</CardDescription>
            <CardAction>
              <Link
                href="/admin/logs"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Alla <ArrowRight className="size-3.5" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Inga registreringar ännu idag.</p>
            ) : (
              <ul className="-mx-2 grid">
                {recentRows.map((log) => (
                  <li key={log.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
                    <SnapshotThumb
                      size="sm"
                      url={snapshotUrl(log)}
                      state={snapshotState(log)}
                      name={log.workers?.full_name ?? ""}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{log.workers?.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{log.workers?.company}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <EventBadge event={log.event_type} voided={!!log.voided_at} />
                      <span className="text-xs text-muted-foreground tabular-nums">{formatTime(log.occurred_at, tz)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
