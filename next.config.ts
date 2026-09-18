import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The webcam is only ever used by our own origin (the kiosk). Everything else is off.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the workspace root so stray lockfiles in parent folders are never picked up.
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Versioned file name (see scripts/copy-zxing-wasm.mjs), so it can be cached forever.
      { source: "/zxing/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
