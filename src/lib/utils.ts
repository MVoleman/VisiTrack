export { cn } from "cn"

/** "Erik Svensson" → "ES" */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * "Erik Svensson" → "erik-svensson", for download filenames.
 *
 * Latin-only by design, and a name written in another script survives as the
 * fallback rather than as an empty string: a file called "qr-.png" helps nobody.
 */
export function slugify(value: string, fallback = "qr") {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}
