import type { Metadata } from "next";
import { Monitor, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings, requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/time";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Inställningar" };

export default async function SettingsPage() {
  const { supabase } = await requireAdmin(); // settings are admin-only
  const settings = await getSettings();

  const { data: accounts } = await supabase
    .from("app_users")
    .select("user_id, role, display_name, created_at")
    .order("role")
    .order("display_name");

  const kiosks = (accounts ?? []).filter((a) => a.role === "kiosk");
  const admins = (accounts ?? []).filter((a) => a.role === "admin");

  return (
    <>
      <PageHeader title="Inställningar" description="Regler för närvaro och hur länge bilder sparas." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Närvaro och integritet</CardTitle>
            <CardDescription>Gäller alla kiosker direkt när du sparar.</CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm settings={settings} />
          </CardContent>
        </Card>

        <div className="grid content-start gap-6 lg:col-span-2">
          <AccountList
            title="Kioskenheter"
            description="Konton som surfplattorna vid entrén är inloggade med."
            icon={Monitor}
            accounts={kiosks}
            empty="Inga kioskkonton ännu."
          />
          <AccountList
            title="Administratörer"
            description="Har full åtkomst till personal, rapporter och bilder."
            icon={ShieldCheck}
            accounts={admins}
            empty="Inga administratörer."
          />
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Nya konton skapas i Supabase (Authentication → Users) och tilldelas en roll i SQL Editor, se{" "}
            <code className="rounded bg-muted px-1 py-0.5">supabase/README.md</code>.
          </p>
        </div>
      </div>
    </>
  );
}

function AccountList({
  title,
  description,
  icon: Icon,
  accounts,
  empty,
}: {
  title: string;
  description: string;
  icon: typeof Monitor;
  accounts: { user_id: string; display_name: string; created_at: string }[];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="-mx-2 grid">
            {accounts.map((a) => (
              <li key={a.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="grid size-9 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.display_name}</span>
                <span className="text-xs text-muted-foreground">sedan {formatDate(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
