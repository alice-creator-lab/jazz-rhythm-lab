/**
 * test-counts.mjs — 驗證基本拍子計數（1 & 2 & 3 & 4 &）+ LONG/short 標籤 + 揀 chip 亮燈
 * node spikes/003-prototype/test-counts.mjs
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9361);
const URL = process.env.TEST_URL || "http://127.0.0.1:8799/index.html";

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cdp-cnt-${Date.now()}`, "about:blank",
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

// --- 1. 4/4 swing 嘅計數格
const swing = await evalJs(`__spike.counts()`);
check(swing.length === 8, `4/4 應該 8 格，實際 ${swing.length}`);
check(swing.map((c) => c.label).join("") === "1&2&3&4&", `標籤應該係 1&2&3&4&，實際 ${swing.map((c) => c.label).join("")}`);
check(swing[0].feel === "LONG" && swing[1].feel === "short", `1 應該 LONG、& 應該 short，實際 ${swing[0].feel}/${swing[1].feel}`);
check(swing.every((c, i) => c.feel === (i % 2 ? "short" : "LONG")), "LONG/short 應該逐格交替");

// --- 2. 揀 chip（華爾茲）→ 6 格，拍號跟足
const waltz = await evalJs(`(async () => {
  [...document.querySelectorAll('.feel')].find(b => b.textContent.includes('Jazz Waltz')).click();
  await new Promise(r => setTimeout(r, 120));
  return { counts: __spike.counts(), hint: document.getElementById('countHint').textContent };
})()`);
check(waltz.counts.length === 6, `3/4 應該 6 格，實際 ${waltz.counts.length}`);
check(waltz.counts.map((c) => c.label).join("") === "1&2&3&", `3/4 標籤錯：${waltz.counts.map((c) => c.label).join("")}`);
check(/1 : 2\.0/.test(waltz.hint), `hint 應該寫目標比例，實際：${waltz.hint}`);

// --- 3. 平直 feel（bossa）→ even
const bossa = await evalJs(`(async () => {
  [...document.querySelectorAll('.feel')].find(b => b.textContent.includes('Bossa')).click();
  await new Promise(r => setTimeout(r, 120));
  return { counts: __spike.counts(), hint: document.getElementById('countHint').textContent };
})()`);
check(bossa.counts.length === 8, `bossa 應該 8 格，實際 ${bossa.counts.length}`);
check(bossa.counts.every((c) => c.feel === "even"), `bossa 應該全部 even，實際 ${bossa.counts.map((c) => c.feel).join(",")}`);
check(/平直/.test(bossa.hint), `bossa hint 應該講平直，實際：${bossa.hint}`);

// --- 4. 揀 chip 之後有亮燈（燈 = 拍點視覺化）
const lit = await evalJs(`(async () => {
  [...document.querySelectorAll('.feel')].find(b => b.textContent.includes('中速 Swing')).click();
  const seen = new Set();
  let frames = 0;
  const t0 = performance.now();
  while (performance.now() - t0 < 3400) {
    const l = __spike.lights();
    if (l.lit.length) { frames++; l.lit.forEach(s => seen.add(s)); }
    await new Promise(r => setTimeout(r, 60));
  }
  return { litFrames: frames, slotsSeen: [...seen].sort(), pending: __spike.lights().pending };
})()`);
check(lit.litFrames >= 3, `預覽期間應該見到多次亮燈，實際 ${lit.litFrames} 次`);
check(lit.slotsSeen.length >= 4, `應該亮過至少 4 個唔同格，實際 ${JSON.stringify(lit.slotsSeen)}`);
check(lit.pending === 0, `一個 bar 之後燈應該燒完，實際仲有 ${lit.pending}`);

check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);

console.log(JSON.stringify({ swing, waltzCounts: waltz.counts.length, bossaHint: bossa.hint, lit }, null, 2));
console.log(fails.length ? "\nFAIL\n- " + fails.join("\n- ") : "\nPASS — 計數格 + LONG/short + 亮燈全部通過");
ws.close(); cleanup();
process.exit(fails.length ? 1 : 0);
