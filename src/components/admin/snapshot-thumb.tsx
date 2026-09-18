import { CameraOff, ImageOff, Timer } from "lucide-react";
import { cn, initials } from "@/lib/utils";
import type { SnapshotState } from "@/lib/snapshots";

const sizes = {
  sm: "size-10 rounded-xl",
  md: "size-12 rounded-xl",
  lg: "size-14 rounded-2xl",
};

/**
 * Square thumbnail of the webcam snapshot for a check-in/out. Falls back to an
 * explanatory icon (missing upload, purged by retention policy) or initials.
 */
export function SnapshotThumb({
  url,
  state,
  name,
  size = "md",
  className,
}: {
  url?: string | null;
  state: SnapshotState;
  name: string;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const base = cn("relative shrink-0 overflow-hidden bg-muted ring-1 ring-foreground/[0.06]", sizes[size], className);

  if (url) {
    return (
      <span className={base}>
        {/* Served by /admin/snapshots after a role check; never a shareable URL, so no caching. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`Bild tagen vid registrering av ${name}`} className="size-full object-cover" loading="lazy" />
      </span>
    );
  }

  const fallback = {
    missing: { icon: CameraOff, label: "Bild saknas" },
    purged: { icon: Timer, label: "Bild raderad enligt lagringspolicy" },
    available: { icon: ImageOff, label: "Bilden kunde inte laddas" },
    none: null,
  }[state];

  return (
    <span className={cn(base, "grid place-items-center text-muted-foreground")} title={fallback?.label}>
      {fallback ? (
        <>
          <fallback.icon className="size-4" aria-hidden />
          <span className="sr-only">{fallback.label}</span>
        </>
      ) : (
        <span className="text-xs font-semibold text-foreground/70">{initials(name)}</span>
      )}
    </span>
  );
}
