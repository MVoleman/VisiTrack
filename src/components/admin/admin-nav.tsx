"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, ExternalLink, LayoutDashboard, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Översikt", icon: LayoutDashboard, exact: true },
  { href: "/admin/workers", label: "Personal", icon: Users },
  { href: "/admin/logs", label: "Tidrapporter", icon: Clock },
  { href: "/admin/settings", label: "Inställningar", icon: Settings, adminOnly: true },
];

export function AdminNav({ canManage, onNavigate }: { canManage: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Huvudmeny" className="grid gap-1">
      {items.filter((item) => canManage || !item.adminOnly).map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </Link>
        );
      })}

      <div className="my-3 h-px bg-border/70" />

      <a
        href="/kiosk"
        target="_blank"
        rel="noreferrer"
        className="flex h-10 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ExternalLink className="size-[18px]" />
        Öppna kiosk
      </a>
    </nav>
  );
}
