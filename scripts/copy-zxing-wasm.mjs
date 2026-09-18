#!/usr/bin/env node
// Self-hosts the ZXing WebAssembly binary used by the kiosk QR scanner, so no
// request goes to a third-party CDN (GDPR). The file name carries the version
// so browsers can cache it forever. Runs automatically before dev and build.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pkgDir = join(root, "node_modules", "zxing-wasm");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const outDir = join(root, "public", "zxing");
const target = `zxing_reader-${version}.wasm`;

mkdirSync(outDir, { recursive: true });
for (const file of readdirSync(outDir)) {
  if (file !== target) rmSync(join(outDir, file));
}
copyFileSync(join(pkgDir, "dist", "reader", "zxing_reader.wasm"), join(outDir, target));
console.log(`✓ public/zxing/${target}`);
