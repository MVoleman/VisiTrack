import { CameraOff, ImageOff, Timer } from "lucide-react";
import { SnapshotImage } from "@/components/admin/snapshot-image";
import { cn, initials } from "@/lib/utils";
import type { SnapshotState } from "@/lib/snapshots";

const sizes = {
  sm: "size-10 rounded-xl",
  md: "size-12 rounded-xl",
  lg: "size-14 rounded-2xl",
};

const labels = {
  missing: { icon: CameraOff, label: "Bild saknas" },
  purged: { icon: Timer, label: "Bild raderad enligt lagringspolicy" },
  failed: { icon: ImageOff, label: "Bilden kunde inte hämtas" },
};

function Explanation({ kind }: { kind: keyof typeof labels }) {
  const { icon: Icon, label } = labels[kind];
  return (
    <span className="grid size-full place-items-center text-muted-foreground" title={label}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Square thumbnail of the webcam snapshot for a check-in/out. Falls back to an
 * explanatory icon (missing upload, purged by retention policy, could not be
 * fetched) or the worker's initials.
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
        <SnapshotImage
          src={url}
          alt={`Bild tagen vid registrering av ${name}`}
          className="size-full object-cover"
          fallback={<Explanation kind="failed" />}
        />
      </span>
    );
  }

  return (
    <span className={base}>
      {state === "missing" || state === "purged" ? (
        <Explanation kind={state} />
      ) : (
        <span className="grid size-full place-items-center text-xs font-semibold text-foreground/70">
          {initials(name)}
        </span>
      )}
    </span>
  );
}
