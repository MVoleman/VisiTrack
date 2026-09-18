import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLE_LABEL, type AppRole } from "@/lib/types";
import { initials } from "@/lib/utils";

export function UserMenu({ name, email, role }: { name: string; email: string | null; role: AppRole }) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground">
        {initials(name)}
      </span>
      <Link
        href="/admin/konto"
        className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Kontoinställningar"
      >
        <span className="block truncate text-sm font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {role === "admin" ? (email ?? ROLE_LABEL[role]) : ROLE_LABEL[role]}
        </span>
      </Link>
      <form action={signOut}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="submit" variant="ghost" size="icon" aria-label="Logga ut">
              <LogOut className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Logga ut</TooltipContent>
        </Tooltip>
      </form>
    </div>
  );
}
