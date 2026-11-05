/**
 * cdp-mic.mjs — 用 Chrome 假音效裝置餵一段「琴聲」wav 入 mic，
 * 量 onset detector 搵到嘅時間同真值差幾多。
 *   node spikes/004-acoustic/cdp-mic.mjs
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url).pathname;
const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9811);
const truth = JSON.parse(readFileSync(`${HERE}truth.json`, "utf8"));
const SECONDS = 11;

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${HERE}piano-test.wav`,
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/cdp-mic-${Date.now()}`,
  "about:blank",
], { stdio: "ignore" });
const hardStop = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} ; process.exit(2); }, 120000);
const cleanup = () => { clearTimeout(hardStop); try { child.kill("SIGKILL"); } catch {} };
process.on("exit", cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageWs() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("no page target");
}
const ws = new WebSocket(await pageWs());
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

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: `file://${HERE}mic-probe.html` });
await sleep(1200);

const info = await evalJs(`probe.start()`);
console.log("audio device:", JSON.stringify(info));
await sleep(SECONDS * 1000);
const st = await evalJs(`probe.stats()`);
writeFileSync(`${HERE}series.json`, JSON.stringify({ series: st.series, truth }));

// 對齊：真值第一個音 vs 偵測到第一個 onset
const onsets = st.onsets;
const t0det = onsets[0];
const t0true = truth[0];
const aligned = onsets.map((t) => +(t - t0det + t0true).toFixed(4));

const pairs = truth.map((tt) => {
  let best = null, bd = Infinity;
  for (const d of aligned) { const e = d - tt; if (Math.abs(e) < Math.abs(bd)) { bd = e; best = d; } }
  return { truth: tt, det: best, err: +(bd * 1000).toFixed(1) };
});
const errs = pairs.filter((p) => p.det !== null && Math.abs(p.err) < 150).map((p) => p.err);
const abs = errs.map(Math.abs).sort((a, b) => a - b);
const pct = (q) => abs.length ? abs[Math.min(abs.length - 1, Math.floor(abs.length * q))] : null;
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// 逐段統計（四分 / 8 分 / 16 分）
const sections = [
  { name: "四分 120bpm（500ms）", from: 0.5, to: 4.5 },
  { name: "8 分（250ms）", from: 5.0, to: 6.9 },
  { name: "16 分（125ms）", from: 7.5, to: 8.5 },
];
const perSection = sections.map((s) => {
  const t = truth.filter((x) => x >= s.from - 0.01 && x <= s.to + 0.01);
  const got = aligned.filter((x) => x >= s.from - 0.12 && x <= s.to + 0.2);
  return { name: s.name, truth: t.length, detected: got.length };
});

console.log(JSON.stringify({
  device: info,
  frames: st.frames,
  peak: st.peak,
  onsetsDetected: onsets.length,
  truthNotes: truth.length,
  matched: errs.length,
  meanErrMs: +mean(errs).toFixed(1),
  medianAbsErrMs: +pct(0.5).toFixed(1),
  p90AbsErrMs: +pct(0.9).toFixed(1),
  maxAbsErrMs: +Math.max(...abs).toFixed(1),
  perSection,
  sampleOnsets: aligned.slice(0, 10),
  sampleTruth: truth.slice(0, 10),
}, null, 2));

ws.close();
cleanup();
process.exit(0);
