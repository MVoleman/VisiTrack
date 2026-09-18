import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Content Security Policy for every HTML response.
 *
 * Nonce-based: Next.js reads the nonce out of this header during server
 * rendering and stamps it onto its own scripts, so no inline script an attacker
 * injects can run. That only works for dynamically rendered pages — pages that
 * would otherwise be static opt in with `export const dynamic = "force-dynamic"`.
 *
 * What each non-obvious source is for:
 *   'wasm-unsafe-eval'  the kiosk decodes QR codes with the ZXing WebAssembly module
 *   blob:               object URLs for the captured snapshot and generated QR images
 *   data:               QR codes rendered as data URLs for download
 *   connect-src supabase  REST, auth and the realtime websocket
 */
export function buildContentSecurityPolicy(nonce: string, isDev: boolean) {
  const supabase = getSupabaseEnv();
  const api = supabase ? new URL(supabase.url).origin : "";
  const socket = api.replace(/^http/, "ws");

  const connect = ["'self'", api, socket, isDev ? "ws: http://localhost:* http://127.0.0.1:*" : ""]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ""}`,
    // Styles are deliberately looser than scripts. Radix sets inline style
    // attributes, Turbopack injects <style> tags in development, and the toast
    // library appends a stylesheet at runtime with no way to pass a nonce - and
    // a nonce would make the browser ignore 'unsafe-inline' in this directive
    // anyway. The exfiltration routes CSS injection would need (external image
    // and font loads) are closed by img-src, font-src and connect-src below, and
    // scripts stay nonce-locked, which is the class of injection that matters.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    // default-src would otherwise allow same-origin frames.
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
