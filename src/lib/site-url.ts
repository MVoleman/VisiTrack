import "server-only";

/**
 * Absolute origin for links we put in emails.
 *
 * Deliberately configuration-only: deriving it from the Host or X-Forwarded-Host
 * header lets anyone who can spoof those headers point a recovery token - or a
 * badge link - at their own domain, which is account takeover. Returns null when
 * unset so the caller can fail with a clear message instead of sending a broken
 * or dangerous link.
 */
export function siteOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}
