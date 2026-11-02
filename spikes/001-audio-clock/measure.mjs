// Runs the full audio-clock + input-timestamp probe in headless Chrome.
// node measure.mjs
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = 9312;
const URL = "http://127.0.0.1:8799/spikes/001-audio-clock/probe.html";

const child = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/cdp-prof-${Date.now()}`,
  "about:blank",
], { stdio: "ignore" });

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
  const r = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: URL });
await sleep(1200);

// 1) input timestamps from real key events
await evalJs("startInputTest()");
const t0 = performance.now();
for (let i = 0; i < 12; i++) {
  await send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65,
  });
  await sleep(60);
}
const input = await evalJs("getInputResults()");

// 2) audio clock
const audio = await evalJs("window.probe()");

const report = { input, audio, harnessMs: +(performance.now() - t0).toFixed(0) };
console.log(JSON.stringify(report, null, 2));
ws.close();
child.kill("SIGKILL");
process.exit(0);
