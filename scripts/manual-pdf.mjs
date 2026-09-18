#!/usr/bin/env node
// Renders docs/manual/visitrack-manual.html to PDF with headless Chrome
// (CDP printToPDF, which supports a footer template with page numbers).
//
//   npm run manual:pdf
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const HTML = `file://${join(ROOT, "docs/manual/visitrack-manual.html")}`;
const OUT = join(ROOT, "docs/manual/VisiTrack-manual.pdf");
const PROFILE = "/tmp/visitrack-pdf-profile";
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${PROFILE}`,
  "--no-first-run", "--disable-extensions", "--allow-file-access-from-files",
], { stdio: ["ignore", "ignore", "pipe"] });

const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("chrome did not start")), 20000);
  chrome.stderr.on("data", (b) => { const m = /ws:\/\/[^\s]+/.exec(b.toString()); if (m) { clearTimeout(t); resolve(m[0]); } });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });

const { targetInfos } = await send("Target.getTargets");
const page = targetInfos.find((t) => t.type === "page");
const { sessionId } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const cdp = (m, p) => send(m, p, sessionId);

await cdp("Page.enable");
await cdp("Page.navigate", { url: HTML });
await new Promise((r) => setTimeout(r, 3500));

const footer = `<div style="width:100%;font-size:8px;color:#5b6472;font-family:-apple-system,sans-serif;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>VisiTrack · Manual</span><span>Sida <span class="pageNumber"></span> av <span class="totalPages"></span></span></div>`;

const { data } = await cdp("Page.printToPDF", {
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: footer,
  marginTop: 0.67, marginBottom: 0.63, marginLeft: 0.63, marginRight: 0.63,
});
writeFileSync(OUT, Buffer.from(data, "base64"));
ws.close(); chrome.kill();
console.log("PDF:", OUT);
