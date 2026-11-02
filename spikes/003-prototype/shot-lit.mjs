/**
 * shot-lit.mjs — 影一張「亮燈中」嘅截圖（揀完 chip 播示範嗰刻）
 * node spikes/003-prototype/shot-lit.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9381);
const URL = process.env.TEST_URL || "http://127.0.0.1:8799/index.html";
const OUT = `${homedir()}/.hermes/profiles/friend/workspace/jazz-rhythm-spike/shots`;
mkdirSync(OUT, { recursive: true });

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=2",
  "--window-size=900,1200",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-lit-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; process.exit(2); }, 60000);
const cleanup = () => { clearTimeout(hardStop); try { child.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageWsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("no page target");
}
const ws = new WebSocket(await pageWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
};
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1200, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: URL });
await sleep(1500);

// 揀 chip → 示範一個 bar
await evalJs(`[...document.querySelectorAll('.feel')].find(b => b.textContent.includes('中速 Swing')).click()`);

// 等到有一格亮住先影
let ok = false;
for (let i = 0; i < 80; i++) {
  const l = await evalJs(`__spike.lights()`);
  if (l.lit.length) {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    writeFileSync(`${OUT}/04-counts-lit.png`, Buffer.from(r.result.data, "base64"));
    console.log("saved", `${OUT}/04-counts-lit.png`, "lit slots:", JSON.stringify(l.lit));
    ok = true;
    break;
  }
  await sleep(35);
}
if (!ok) console.log("影唔到亮燈（可能太快）");
ws.close(); cleanup();
process.exit(0);
