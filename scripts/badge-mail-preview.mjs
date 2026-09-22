#!/usr/bin/env node
// Renders the badge mail without sending it, so the wording and the layout can
// be read before anything leaves the machine.
//
//   npm run badge-mail:preview
//
// Writes the HTML part next to the project and prints the plain-text part,
// which is what a screen reader and a stripped-down mail client will show.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { badgeMailContent } from "../src/lib/badge-mail.ts";

const OUT = process.argv[2] ?? join(import.meta.dirname, "..", "badge-mail-preview.html");

const { subject, html, text } = badgeMailContent({
  fullName: "Erik Svensson",
  url: "https://www.visitrack.se/kod/weD3PBmsa-KQAMw54ZuyEgSyXmJKS8MIo2dcCuQQPXI",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

writeFileSync(OUT, html);

console.log(`Ämne: ${subject}\n`);
console.log(text);
console.log(`\nHTML-versionen: ${OUT}`);
