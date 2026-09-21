import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { RecoveryLink } from "@/components/recovery-link";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// next/font self-hosts the font files at build time, so no request reaches
// Google at runtime (GDPR-friendly).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "VisiTrack",
    template: "%s · VisiTrack",
  },
  description: "Närvaro och tidrapportering för extern personal.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f9fafb",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="sv"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <RecoveryLink />
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
