"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AdminNav } from "./admin-nav";

export function MobileNav({ canManage, footer }: { canManage: boolean; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Öppna meny">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 p-4">
        <SheetTitle className="sr-only">Meny</SheetTitle>
        <Brand className="mb-8 px-2 pt-1" />
        <AdminNav canManage={canManage} onNavigate={() => setOpen(false)} />
        <div className="mt-auto">{footer}</div>
      </SheetContent>
    </Sheet>
  );
}
