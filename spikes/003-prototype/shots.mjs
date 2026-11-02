/**
 * shots.mjs — 影三張截圖（設定頁 / 練習中 / 結果頁）證明 UI 真係行到。
 * node spikes/003-prototype/shots.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9341);
const URL = "http://127.0.0.1:8799/index.html";
const OUT = `${homedir()}/.hermes/profiles/friend/workspace/jazz-rhythm-spike/shots`;
mkdirSync(OUT, { recursive: true });

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=2",
  "--window-size=900,1500",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-shot-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; process.exit(2); }, 90000);
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, "base64"));
  console.log("saved", `${OUT}/${name}.png`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1500, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: URL });
await sleep(1800);
await shot("01-setup");

// 開始練習，等 count-in 過，然後只補頭幾拍嘅 tap（睇得到綠點）
await evalJs(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  __spike.state.feelId = 'swing-med'; __spike.state.bpm = 120; __spike.state.bars = 4; __spike.setCalib(0);
  __spike.start();
  await wait(2900);
  const tg = __spike.targets();
  let x = 7; const rnd = () => ((x = (x*48271)%2147483647)/2147483647);
  const gauss = (mu, sg) => mu + sg*Math.sqrt(-2*Math.log(Math.max(1e-9,rnd())))*Math.cos(2*Math.PI*rnd());
  const nowMs = performance.now();
  for (let i = 0; i < Math.min(6, tg.length); i++) __spike.tapAtAudio(tg[i] + gauss(2, 9));
  await wait(60);
  return 'ok';
})()`);
await sleep(300);
await shot("02-session");

await evalJs(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tg = __spike.targets();
  let x = 31; const rnd = () => ((x = (x*48271)%2147483647)/2147483647);
  const gauss = (mu, sg) => mu + sg*Math.sqrt(-2*Math.log(Math.max(1e-9,rnd())))*Math.cos(2*Math.PI*rnd());
  const s = __spike.state.session;
  const already = s.taps.length;
  for (let i = already; i < tg.length; i++) __spike.tapAtAudio(tg[i] + gauss(-9, 10));
  await wait(80);
  __spike.finish();
  await wait(150);
  return __spike.result().total;
})()`);
await sleep(400);
await shot("03-result");

ws.close(); cleanup();
process.exit(0);
