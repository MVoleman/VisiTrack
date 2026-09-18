import Link from "next/link";
import { ArrowRight, LayoutDashboard, ScanLine } from "lucide-react";
import { Brand } from "@/components/brand";

const destinations = [
  {
    href: "/kiosk",
    icon: ScanLine,
    title: "Kiosk",
    description: "Starta incheckningsskärmen på surfplattan vid entrén.",
  },
  {
    href: "/admin",
    icon: LayoutDashboard,
    title: "Administration",
    description: "Närvaro, personal, QR-koder och tidrapporter.",
  },
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <Brand className="mb-10" />
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Närvaro för extern personal
        </h1>
        <p className="mt-3 text-lg text-muted-foreground text-pretty">
          Enkel in- och utcheckning med QR-kod, med bildverifiering för varje registrering.
        </p>

        <nav className="mt-10 grid gap-3">
          {destinations.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-lifted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{title}</span>
                <span className="block text-sm text-muted-foreground">{description}</span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </nav>
      </div>
    </main>
  );
}
