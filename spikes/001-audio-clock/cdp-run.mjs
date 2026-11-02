// Minimal CDP driver: launches Chrome headless, navigates, evaluates JS, prints JSON.
// Usage: node cdp-run.mjs <url> <script-file-containing-awaited-expression>
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const CHROME = `${homedir()}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`;
const PORT = Number(process.env.CDP_PORT || 9311);

const url = process.argv[2];
const exprFile = process.argv[3];
const expr = readFileSync(exprFile, "utf8");

const child = spawn(CHROME, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/cdp-prof-${Date.now()}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(100);
  }
  throw new Error("chrome did not expose a page target");
}

const ws = new WebSocket(await getWsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
function send(method, params = {}) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(900);

const r = await send("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
});
if (r.result?.exceptionDetails) {
  console.error("JS ERROR:", JSON.stringify(r.result.exceptionDetails, null, 2));
}
console.log(JSON.stringify(r, null, 2));
ws.close();
child.kill("SIGKILL");
process.exit(0);
