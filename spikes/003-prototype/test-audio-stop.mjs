/**
 * test-audio-stop.mjs — 驗證三個回報問題嘅修正：
 *  1. 觸控區唔會被瀏覽器手勢搶走（touch-action）
 *  2. 停 → 即刻收聲（queue / scheduler / oscillator 全清）
 *  3. 揀 feel 即示範一個 bar，之後自動停
 * node spikes/003-prototype/test-audio-stop.mjs
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9351);
const URL = process.env.TEST_URL || "http://127.0.0.1:8799/index.html";

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-stop-${Date.now()}`, "about:blank",
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
const pageErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.text);
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
};
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });
await sleep(1600);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// --- 1. touch-action CSS
const css = await evalJs(`(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).touchAction : null; };
  return { pad: g('#tapPad'), body: g('body'), feel: g('.feel'), btn: g('#startBtn') };
})()`);
check(css.pad === "none", `tap pad touch-action 應該係 none，實際 ${css.pad}`);
check(css.body === "manipulation", `body touch-action 應該係 manipulation，實際 ${css.body}`);
check(css.feel === "manipulation", `feel chip touch-action 應該係 manipulation，實際 ${css.feel}`);

// --- 2. 揀 feel 示範一個 bar
const previewStart = await evalJs(`(() => { __spike.preview('swing-med'); return __spike.audio(); })()`);
check(previewStart.queue > 0 || previewStart.oscillators > 0, `preview 應該即刻排/響，實際 ${JSON.stringify(previewStart)}`);
check(previewStart.schedActive, "preview 應該開 scheduler");

// 120bpm 4/4 = 2s 一個 bar，+450ms lead → 3.5s 後應該完全停
await sleep(3600);
const previewEnd = await evalJs(`__spike.audio()`);
check(previewEnd.queue === 0, `preview 完後 queue 應該清空，實際 ${previewEnd.queue}`);
check(previewEnd.oscillators === 0, `preview 完後唔應該有 oscillator，實際 ${previewEnd.oscillators}`);
check(!previewEnd.schedActive, "preview 完後 scheduler 應該停");

// --- 3. 練習中途停 → 即刻收聲
await evalJs(`(async () => {
  __spike.state.feelId = 'swing-med'; __spike.state.bpm = 120; __spike.state.bars = 4;
  __spike.state.targetOffset = 0; __spike.setCalib(0); __spike.start();
  await new Promise(r => setTimeout(r, 400));
  return true;
})()`);
const mid = await evalJs(`__spike.audio()`);
check(mid.queue > 0 || mid.oscillators > 0, `練習中應該有待播/發聲事件，實際 ${JSON.stringify(mid)}`);

const afterStop = await evalJs(`(() => { __spike.finish(); return __spike.audio(); })()`);
check(afterStop.queue === 0, `停之後 queue 應該 0，實際 ${afterStop.queue}`);
check(!afterStop.schedActive, "停之後 scheduler 應該停");
check(afterStop.oscillators === 0, `停之後 oscillator 應該 0，實際 ${afterStop.oscillators}`);

await sleep(1200);
const later = await evalJs(`__spike.audio()`);
check(later.oscillators === 0 && later.queue === 0, `停咗 1.2 秒後仍然有聲：${JSON.stringify(later)}`);

check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);

console.log(JSON.stringify({ css, previewStart, previewEnd, mid, afterStop, later }, null, 2));
console.log(fails.length ? "\nFAIL\n- " + fails.join("\n- ") : "\nPASS — 三個修正全部通過");
ws.close(); cleanup();
process.exit(fails.length ? 1 : 0);
