import { Brand } from "@/components/brand";
import { AdminNav } from "@/components/admin/admin-nav";
import { MobileNav } from "@/components/admin/mobile-nav";
import { UserMenu } from "@/components/admin/user-menu";
import { requireReader } from "@/lib/auth";

export default async function DashboardLayout({ children }: LayoutProps<"/admin">) {
  const { displayName, email, role, canManage } = await requireReader();
  const userMenu = <UserMenu name={displayName} email={email} role={role} />;

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex">
        <Brand className="mb-9 px-2 pt-1" />
        <AdminNav canManage={canManage} />
        <div className="mt-auto">{userMenu}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/70 bg-background/80 px-4 backdrop-blur-md lg:hidden">
          <MobileNav canManage={canManage} footer={userMenu} />
          <Brand />
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 lg:px-10 lg:py-12">{children}</main>
      </div>
    </div>
  );
}
