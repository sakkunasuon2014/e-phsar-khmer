#!/usr/bin/env node
// Mobile responsiveness verification harness for apps/web.
// Usage: node tasks/mobile-verify.mjs [--base http://localhost:3011] [--widths 320,390,768] [--shots] [--routes /en,...]
// Exits 1 if any route horizontally overflows its layout viewport.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : def; };
const BASE = arg("base", "http://localhost:3011").replace(/\/$/, "");
const WIDTHS = arg("widths", "320,390,768").split(",").map(Number);
const SHOTS = argv.includes("--shots");
const OUT = arg("out", "tasks/mobile-verify.json");
const ROUTES = arg("routes", "/en,/en/all-ads,/en/category/cars-and-vehicles,/en/search,/en/login").split(",");
const CHROME = arg("chrome", "C:\\Users\\Admin\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe");
const PORT = 9400 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function measureFn() {
  const iw = window.innerWidth, out = [];
  const clipped = (el) => { let p = el.parentElement; while (p) { const s = getComputedStyle(p); if (["auto", "scroll", "hidden"].includes(s.overflowX)) return true; p = p.parentElement; } return false; };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (r.right <= iw + 1 && r.left >= -1) continue;
    if (clipped(el)) continue;
    out.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || "").slice(0, 120), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), text: (el.textContent || "").trim().slice(0, 30) });
    if (out.length >= 30) break;
  }
  const smallMap = new Map();
  for (const el of document.querySelectorAll('a,button,[role="button"],input,select,textarea,[role="tab"],[role="menuitem"]')) {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || s.visibility === "hidden" || s.display === "none") continue;
    if (r.width >= 44 && r.height >= 44) continue;
    const key = el.tagName.toLowerCase() + "|" + Math.round(r.width) + "x" + Math.round(r.height) + "|" + String(el.className || "").slice(0, 55);
    smallMap.set(key, (smallMap.get(key) || 0) + 1);
  }
  const small = [...smallMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ k, n }));
  let tiny = 0;
  for (const el of document.querySelectorAll("p,span,li,a,button,label")) { if (el.children.length === 0 && el.textContent.trim().length > 2 && parseFloat(getComputedStyle(el).fontSize) < 12) tiny++; }
  return { href: location.href, iw, ih: window.innerHeight, sw: document.documentElement.scrollWidth, overflowCount: out.length, overflow: out, small, tiny };
}
const MEASURE = "(" + measureFn.toString() + ")()";

const cp = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", "--window-size=900,1000", "--remote-debugging-port=" + PORT, "--user-data-dir=" + path.join(os.tmpdir(), "ma-verify-" + Date.now()), "about:blank"], { detached: true, stdio: "ignore" });
cp.unref();

async function pageTarget() {
  for (let i = 0; i < 120; i++) {
    try { const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json(); const p = list.find((t) => t.type === "page"); if (p && p.webSocketDebuggerUrl) return p; } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not start");
}
class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } }; }
  open() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error("ws error")); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
}

const c = new CDP((await pageTarget()).webSocketDebuggerUrl);
await c.open();
await c.send("Page.enable");
await c.send("Runtime.enable");
const results = [];
for (const route of ROUTES) {
  for (const width of WIDTHS) {
    const height = Math.round(width * 2.16);
    await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await c.send("Page.navigate", { url: BASE + route });
    for (let i = 0; i < 40; i++) { await sleep(200); try { const r = await c.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }); if (r.result && r.result.value === "complete") break; } catch {} }
    await sleep(1600);
    await c.send("Runtime.evaluate", { expression: "window.scrollTo(0,0)" });
    const m = (await c.send("Runtime.evaluate", { expression: MEASURE, returnByValue: true })).result.value;
    results.push({ route, width, ...m });
    if (SHOTS) {
      await fs.mkdir("tasks/mobile-audit-shots", { recursive: true });
      const s = await c.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } }).catch(() => null);
      if (s) await fs.writeFile(path.join("tasks/mobile-audit-shots", "verify" + route.replace(/\W+/g, "-") + "-" + width + ".png"), Buffer.from(s.data, "base64"));
    }
    const bad = m.sw > m.iw + 1;
    const extra = bad ? "  (+" + (m.sw - m.iw) + ")" : "";
    const redirect = m.href && m.href !== BASE + route ? "  -> " + m.href.replace(BASE, "") : "";
    console.log((bad ? "FAIL " : "PASS ") + route.padEnd(42) + " " + width + "px  iw=" + m.iw + " sw=" + m.sw + extra + "  overflowEls=" + m.overflowCount + "  tiny=" + m.tiny + "  smallKinds=" + (m.small ? m.small.length : 0) + redirect);
  }
}
await fs.writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, widths: WIDTHS, routes: ROUTES, results }, null, 2));
try { cp.kill(); } catch {}
const fails = results.filter((r) => r.sw > r.iw + 1).length;
console.log("\n" + results.length + " checks, " + fails + " overflow failure(s). Details: " + OUT);
process.exit(fails ? 1 : 0);
