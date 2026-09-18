import { LogIn, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_LABEL, type TimeLogEvent } from "@/lib/types";

export function EventBadge({ event, voided, className }: { event: TimeLogEvent; voided?: boolean; className?: string }) {
  const Icon = event === "check_in" ? LogIn : LogOut;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        event === "check_in" ? "bg-success-soft text-success" : "bg-secondary text-secondary-foreground",
        voided && "bg-muted text-muted-foreground line-through",
        className,
      )}
    >
      <Icon className="size-3.5" />
      {EVENT_LABEL[event]}
    </span>
  );
}
