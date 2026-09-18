import type { Metadata, Viewport } from "next";
import { KioskApp } from "./kiosk-app";

// Rendered per request so the CSP nonce from src/proxy.ts reaches the scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Kiosk" };

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function KioskPage() {
  return <KioskApp />;
}
