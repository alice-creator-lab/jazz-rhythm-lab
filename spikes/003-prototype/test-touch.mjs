/**
 * test-touch.mjs — iOS Safari double-tap zoom 修正驗證
 *  1. viewport 有 maximum-scale=1（iOS 上關掉 double-tap zoom）
 *  2. 練習期間 body 有 touch-action:none（.playing）
 *  3. touchstart 喺打拍子區／練習區會被 preventDefault（呢個才真正擋到 Safari 嘅手勢）
 *  4. 撳「停」掣唔會被當成拍子，亦唔會被 preventDefault 擋住
 *  5. 練習區任何位置（唔止 pad）都收得到拍子
 * node spikes/003-prototype/test-touch.mjs
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9451);
const URL = process.env.TEST_URL || "http://127.0.0.1:8799/index.html";

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-touch-${Date.now()}`, "about:blank",
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
// 模擬 iPhone
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL });
await sleep(1600);

const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// 1. viewport
const meta = await evalJs(`document.querySelector('meta[name=viewport]').content`);
check(/maximum-scale=1/.test(meta), `viewport 應該有 maximum-scale=1，實際：${meta}`);

// 2. 未開始：body 正常可以 scroll
const before = await evalJs(`({ bodyTA: getComputedStyle(document.body).touchAction, cls: document.body.className })`);
check(before.bodyTA === "manipulation", `未開始時 body touch-action 應該 manipulation，實際 ${before.bodyTA}`);

// 3. 開始練習 → body.playing + touch-action none
const during = await evalJs(`(async () => {
  __spike.state.feelId = 'basic-a'; __spike.state.bpm = 110; __spike.state.bars = 4;
  __spike.state.targetOffset = 0; __spike.setCalib(0); __spike.start();
  await new Promise(r => setTimeout(r, 300));
  return {
    cls: document.body.className,
    bodyTA: getComputedStyle(document.body).touchAction,
    padTA: getComputedStyle(document.getElementById('tapPad')).touchAction,
    taps: __spike.state.session.taps.length,
  };
})()`);
check(/playing/.test(during.cls), `練習中 body 應該有 playing class，實際「${during.cls}」`);
check(during.bodyTA === "none", `練習中 body touch-action 應該 none，實際 ${during.bodyTA}`);
check(during.padTA === "none", `tap pad touch-action 應該 none，實際 ${during.padTA}`);

// 4. touchstart 喺練習區會被 preventDefault（= 唔會 double-tap zoom）
const touchRes = await evalJs(`(() => {
  const mk = (el) => {
    const ev = new Event('touchstart', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
  return {
    onPad: mk(document.getElementById('tapPad')),
    onLane: mk(document.getElementById('lane')),
    onStopBtn: mk(document.getElementById('stopBtn')),
    tapsAfter: __spike.state.session.taps.length,
  };
})()`);
check(touchRes.onPad === true, "tap pad 上嘅 touchstart 應該被 preventDefault");
check(touchRes.onLane === true, "練習區（lane）上嘅 touchstart 應該被 preventDefault");
check(touchRes.onStopBtn === false, "『停』掣上嘅 touchstart 唔應該被 preventDefault（否則撳唔到）");

// 5. 練習區任何位置都收到拍子（pointerdown）；等 count-in 過咗先打，否則會被 count-in 守衛擋掉
const pointerTaps = await evalJs(`(async () => {
  const s = __spike.state.session;
  await new Promise(r => setTimeout(r, 2800)); // 等 count-in 過（110bpm 一小節 ≈ 2.2s + lead）
  const before = s.taps.length;
  const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
  document.getElementById('lane').dispatchEvent(ev);
  return { before, after: s.taps.length };
})()`);
check(pointerTaps.after === pointerTaps.before + 1, `撳 lane 應該計一下 tap，實際 ${pointerTaps.before} → ${pointerTaps.after}`);

// 6. 收工 → playing class 移除
const after = await evalJs(`(() => { __spike.finish(); return { cls: document.body.className, bodyTA: getComputedStyle(document.body).touchAction }; })()`);
check(!/playing/.test(after.cls), `收工後唔應該再有 playing class，實際「${after.cls}」`);
check(after.bodyTA === "manipulation", `收工後 body touch-action 應該回復 manipulation，實際 ${after.bodyTA}`);

check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);

console.log(JSON.stringify({ meta, before, during, touchRes, pointerTaps, after }, null, 2));
console.log(fails.length ? "\nFAIL\n- " + fails.join("\n- ") : "\nPASS — double-tap zoom 防護全部通過");
ws.close(); cleanup();
process.exit(fails.length ? 1 : 0);
