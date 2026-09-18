import type { Metadata, Viewport } from "next";
import { KioskApp } from "./kiosk-app";

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
