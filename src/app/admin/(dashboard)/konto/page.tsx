import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireReader } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/types";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Mitt konto" };

export default async function AccountPage() {
  const { displayName, email, role } = await requireReader();

  return (
    <>
      <PageHeader title="Mitt konto" description="Dina uppgifter och ditt lösenord." />

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Uppgifter</CardTitle>
            <CardDescription>Ändras av en administratör i Supabase.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Namn</dt>
                <dd className="font-medium">{displayName}</dd>
              </div>
              {email && (
                <div>
                  <dt className="text-muted-foreground">E-post</dt>
                  <dd className="font-medium break-all">{email}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Behörighet</dt>
                <dd className="font-medium">{ROLE_LABEL[role]}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Byt lösenord</CardTitle>
            <CardDescription>Minst 10 tecken. Du förblir inloggad på den här enheten.</CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
