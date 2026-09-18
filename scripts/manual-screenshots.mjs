#!/usr/bin/env node
// Regenerates the screenshots in docs/manual/img for the PDF manual.
// LOCAL ONLY: needs `supabase start`, `npm run db:seed` and `npm run dev`.
//
//   npm run manual:shots   # screenshots
//   npm run manual:pdf     # docs/manual/VisiTrack-manual.pdf
//
// It drives headless Chrome over CDP: injects the seeded admin and kiosk
// sessions, fakes the kiosk camera with a canvas stream, and saves PNGs.
// Drives headless Chrome over CDP: injects the seeded admin/kiosk sessions,
// fakes the kiosk camera with a canvas stream, and saves PNGs.
import { execSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT = join(import.meta.dirname, "..");
const OUT = process.argv[2] ?? join(PROJECT, "docs/manual/img");
const PROFILE = "/tmp/visitrack-shots-profile";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";

const { session, WORKERS } = JSON.parse(
  execSync(`node ${join(import.meta.dirname, "manual-session.mjs")}`, { encoding: "utf8" }),
);

mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });

const chrome = spawn(CHROME, [
  "--headless=new",
  "--remote-debugging-port=9333",
  `--user-data-dir=${PROFILE}`,
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  "--no-first-run",
  "--disable-extensions",
  "--window-size=1280,860",
], { stdio: ["ignore", "ignore", "pipe"] });

const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Chrome did not start")), 20000);
  chrome.stderr.on("data", (buf) => {
    const m = /ws:\/\/[^\s]+/.exec(buf.toString());
    if (m) { clearTimeout(timer); resolve(m[0]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });

// Attach to the first page target.
const { targetInfos } = await send("Target.getTargets");
const page = targetInfos.find((t) => t.type === "page");
const { sessionId } = await send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const cdp = (method, params) => send(method, params, sessionId);

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });

const applyAdminSession = async () => {
  for (const c of session.cookies) {
    await cdp("Network.setCookie", { name: c.name, value: c.value, domain: "localhost", path: "/" });
  }
};

// Kiosk session + fake camera, installed before any page script runs.
const kioskBoot = `
(() => {
  try {
    ${session.localStorage.map((i) => `localStorage.setItem(${JSON.stringify(i.key)}, ${JSON.stringify(i.value)});`).join("\n")}
  } catch {}
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  window.__fakeCam = { badge: null };
  const draw = () => {
    const g = ctx.createLinearGradient(0, 0, 0, 720);
    g.addColorStop(0, '#e8edf3'); g.addColorStop(1, '#c9d4e2');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = '#9aa7b8';
    ctx.beginPath(); ctx.arc(500, 300, 118, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(500, 640, 205, 215, 0, Math.PI, 0); ctx.fill();
    const img = window.__fakeCam.badge;
    if (img) { ctx.fillStyle = '#fff'; ctx.fillRect(760, 250, 330, 330); ctx.drawImage(img, 790, 280, 270, 270); }
  };
  setInterval(draw, 40); draw();
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30);
})();`;
await cdp("Page.addScriptToEvaluateOnNewDocument", { source: kioskBoot });

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? "evaluate failed");
  return result.value;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name, { url, height = 860, before, wait = 1200, fullPage = false }) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height, deviceScaleFactor: 2, mobile: false });
  if (url) {
    await cdp("Page.navigate", { url: BASE + url });
    await sleep(wait);
  }
  if (before) await evaluate(before);
  await sleep(500);
  // Crop to the content so the manual has no dead space.
  const contentHeight = await evaluate(`(() => {
    const dialog = document.querySelector('[data-slot=dialog-content]');
    if (dialog) return Math.ceil(dialog.getBoundingClientRect().bottom + 24);
    const main = document.querySelector('main');
    const kiosk = getComputedStyle(main).position === 'fixed';
    if (kiosk) return window.innerHeight;
    const last = [...main.querySelectorAll('*')].reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom), 0);
    return Math.min(window.innerHeight, Math.ceil(last + 40));
  })()`);
  // scale 1: the device scale factor already renders at 2x.
  const clip = { x: 0, y: 0, width: 1280, height: Math.max(360, contentHeight), scale: 1 };
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, clip });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log(`✓ ${name}.png`);
}

const loadBadge = (worker) => `
(async () => {
  const doc = new DOMParser().parseFromString(await (await fetch('/admin/badges/${WORKERS[worker]}')).text(), 'text/html');
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(doc.querySelector('article [role=img] svg')));
  await img.decode();
  window.__fakeCam.badge = img;
  return true;
})()`;

// ── Admin screens ──────────────────────────────────────────────────────────
// Signed out first: with a session, /login redirects to /admin.
await cdp("Network.clearBrowserCookies");
await shot("login", { url: "/login", height: 760 });
await applyAdminSession();
await shot("oversikt", { url: "/admin", height: 900, wait: 2000 });
await shot("personal", { url: "/admin/workers", height: 720 });
await shot("qr-kod", {
  before: `(async () => {
    const find = () => document.querySelector('button[aria-label^="Visa QR-kod"]');
    for (let i = 0; i < 60 && !find(); i++) await new Promise(r => setTimeout(r, 100));
    const button = find();
    if (!button) throw new Error('QR-knappen hittades inte på ' + location.pathname);
    button.click();
    await new Promise(r => setTimeout(r, 1500));
    return true;
  })()`,
  height: 820,
});
// ── Kiosk ──────────────────────────────────────────────────────────────────
await cdp("Browser.grantPermissions", { origin: BASE, permissions: ["videoCapture"] }).catch(() => {});
await shot("kiosk-vilolage", {
  url: "/kiosk",
  height: 800,
  wait: 2500,
  before: `(async () => {
    const start = [...document.querySelectorAll('button')].find(b => b.innerText.includes('Starta kiosken'));
    if (start) start.click();
    await new Promise(r => setTimeout(r, 4000));
    return true;
  })()`,
});
await evaluate(loadBadge("unscanned"));
await shot("kiosk-incheckad", {
  height: 800,
  before: `(async () => {
    const img = window.__fakeCam.badge;
    window.__fakeCam.badge = img;
    let o = null;
    for (let i = 0; i < 120 && !o; i++) { await new Promise(r => setTimeout(r, 50)); o = document.querySelector('[role=status][aria-live=assertive]'); }
    window.__fakeCam.badge = null;
    await new Promise(r => setTimeout(r, 600));
    return o ? o.innerText : 'no overlay';
  })()`,
  wait: 0,
});

// ── Admin screens that need a scan to exist ─────────────────────────────────
await shot("tidrapporter", { url: "/admin/logs", height: 860, wait: 2000 });
await shot("tidrapport-detalj", {
  before: `(async () => {
    const find = () => document.querySelector('button[aria-label^="Visa detaljer"]');
    for (let i = 0; i < 60 && !find(); i++) await new Promise(r => setTimeout(r, 100));
    const button = find();
    if (!button) throw new Error('Ingen tidrapport att öppna på ' + location.pathname);
    button.click();
    await new Promise(r => setTimeout(r, 1500));
    return true;
  })()`,
  height: 760,
});
await shot("installningar", { url: "/admin/settings", height: 860, wait: 1500 });
await shot("passerkort", { url: "/admin/badges/active", height: 900, wait: 1500 });

ws.close();
chrome.kill();
console.log("done");
