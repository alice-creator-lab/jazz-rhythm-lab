/**
 * test-headless.mjs — 喺真 Chrome 開個 app，用合成 tap 驗證評分流程。
 * node spikes/003-prototype/test-headless.mjs
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9313);
const URL = "http://127.0.0.1:8799/index.html";

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/cdp-test-${Date.now()}`,
  "about:blank",
], { stdio: "ignore" });

// 任何情況都要收屍，唔好留 orphan chrome 食記憶體
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; process.exit(2); }, 120000);
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
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(m.params.exceptionDetails.text + " " + (m.params.exceptionDetails.exception?.description || ""));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") pageErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
};
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 800));
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });
await sleep(1500);

const boot = await evalJs(`({ hasSpike: !!window.__spike, feels: document.querySelectorAll('.feel').length, midi: document.getElementById('midiState').textContent })`);

// 練習情境：準、散、拉後、平直 feel、華爾茲
const script = ({ sigma, bias, feelId, bpm, bars, seed, targetOffset = 0 }) => `(async () => {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  __spike.state.feelId = ${JSON.stringify(feelId)};
  __spike.state.bpm = ${bpm};
  __spike.state.bars = ${bars};
  __spike.state.targetOffset = ${targetOffset};
  __spike.setCalib(0);
  __spike.start();
  await wait(150);
  const tg = __spike.targets();
  let x = ${seed};
  const rnd = () => ((x = (x * 48271) % 2147483647) / 2147483647);
  const gauss = (mu, sg) => { const u = Math.max(1e-9, rnd()), v = rnd(); return mu + sg * Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v); };
  for (const t of tg) __spike.tapAtAudio(t + ${bias} + gauss(0, ${sigma}));
  await wait(60);
  __spike.finish();
  const r = __spike.result();
  return { n: tg.length, total: r.total, grade: r.grade, pocket: r.pocketMs, sigma: r.sigmaMs,
           ratio: r.swingRatio, hits: r.nHits, missed: r.nMissed, extras: r.nExtras, tol: +r.tolMs.toFixed(1) };
})()`;

const tight = await evalJs(script({ sigma: 8, bias: 0, feelId: "swing-med", bpm: 120, bars: 4, seed: 11 }));
const loose = await evalJs(script({ sigma: 28, bias: 0, feelId: "swing-med", bpm: 120, bars: 4, seed: 22 }));
const laidback = await evalJs(script({ sigma: 9, bias: -18, feelId: "swing-med", bpm: 120, bars: 4, seed: 33 }));
const straight = await evalJs(script({ sigma: 8, bias: 0, feelId: "bossa", bpm: 130, bars: 4, seed: 44 }));
const waltz = await evalJs(script({ sigma: 10, bias: 0, feelId: "waltz", bpm: 140, bars: 4, seed: 55 }));
// 同一個「拉後 25ms」嘅演奏，但目標偏移設成 -25ms：應該由 C 變返高分
const offsetMatch = await evalJs(script({ sigma: 8, bias: -25, feelId: "swing-med", bpm: 120, bars: 4, seed: 66, targetOffset: -25 }));

const out = { boot, tight, loose, laidback, straight, waltz, offsetMatch, pageErrors };
console.log(JSON.stringify(out, null, 2));

// ---- assertions ----
const fails = [];
const near = (name, got, want, tol) => { if (got === null || Math.abs(got - want) > tol) fails.push(`${name}: got ${got}, want ~${want}±${tol}`); };
near("tight pocket", tight.pocket, 0, 5);
near("tight sigma", tight.sigma, 8, 4);
near("tight swing ratio", tight.ratio, 2.0, 0.3);
near("loose sigma", loose.sigma, 28, 6);
near("laidback pocket", laidback.pocket, -18, 6);
near("bossa ratio (straight)", straight.ratio, 1.0, 0.25);
near("waltz swing ratio", waltz.ratio, 2.0, 0.35);
if (!(tight.total > loose.total + 15)) fails.push(`tight (${tight.total}) should beat loose (${loose.total}) by >15`);
if (tight.missed !== 0 || tight.extras !== 0) fails.push(`tight should have no misses/extras, got ${tight.missed}/${tight.extras}`);
if (tight.hits !== tight.n) fails.push(`tight hits ${tight.hits} != targets ${tight.n}`);
if (!(offsetMatch.total > 85)) fails.push(`offset-matched laid-back playing should score >85, got ${offsetMatch.total}`);
if (pageErrors.length) fails.push(`page errors: ${pageErrors.join(" | ")}`);

console.log(fails.length ? "\nFAIL\n- " + fails.join("\n- ") : "\nPASS — 所有斷言通過");
ws.close(); cleanup();
process.exit(fails.length ? 1 : 0);
