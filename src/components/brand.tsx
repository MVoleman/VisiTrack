import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 place-items-center rounded-xl bg-primary text-primary-foreground shadow-soft",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[58%]">
        <path
          d="M5 12.5l4.2 4.2L19 7"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="text-[0.9375rem] font-semibold tracking-tight">VisiTrack</span>
    </span>
  );
}
