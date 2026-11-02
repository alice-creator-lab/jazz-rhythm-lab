/**
 * app.js — Jazz 拍子實驗室（spike prototype）
 * 音訊排程：Web Audio lookahead。輸入：鍵盤 / 觸控 / Web MIDI。
 * 評分核心喺 jazz-core.js（同 Node 測試共用）。
 */
import {
  FEELS, feelById, buildGrid, scoreSession, feedback, calibrate, swingOffset,
} from "./jazz-core.js";

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

const S = {
  feelId: "swing-med",
  bpm: 120,
  bars: 4,
  targetOffset: 0,
  subdiv: false,
  calibMs: 0,
  calibrated: false,
  ctx: null,
  session: null,
  calibMode: null,
  queue: [],
  sched: null,
  raf: null,
  dots: new Map(),
  hist: [],
};

// ---------------------------------------------------------------------------
// 音訊
// ---------------------------------------------------------------------------
function ensureCtx() {
  if (!S.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    S.ctx = new AC({ latencyHint: "interactive" });
  }
  return S.ctx;
}

let clockPath = "ots";

/**
 * performance.now() 時間 → audio 時鐘時間（ms）。
 * 用 getOutputTimestamp，因為 currentTime 係「正在 render」而唔係「正在聽到」，
 * 兩者相差一個 outputLatency（幾十 ms，足以毀掉整個評分）。
 */
function perfToAudioMs(perfMs) {
  const c = ensureCtx();
  const ts = c.getOutputTimestamp ? c.getOutputTimestamp() : null;
  if (ts && ts.performanceTime > 0) {
    const mapped = (ts.contextTime + (perfMs - ts.performanceTime) / 1000) * 1000;
    // Safari 有時會回 0 或者亂值；偏離 currentTime 太遠就當唔可信，改用 fallback
    if (Math.abs(mapped - c.currentTime * 1000) < 1000) {
      clockPath = "ots";
      return mapped;
    }
    clockPath = "ots-bad";
  }
  const outLat = c.outputLatency || c.baseLatency || 0;
  clockPath = "fallback";
  return (c.currentTime - outLat) * 1000;
}

const audioNowMs = () => perfToAudioMs(performance.now());

// 所有仍然存在嘅發聲源；停嘅時候要即刻收聲（iOS 上尤其緊要）
const activeOsc = new Set();

/**
 * 一種 click 音。目標音（LONG 同 short）一律同一個聲——用家要求唔好靠音色分長短。
 * `sub` 只係細分參考聲：同一個音高，但細聲同短促。
 */
function click(atSec, { accent = false, vol = 1, kind = "on" } = {}) {
  const c = ensureCtx();
  if (!Number.isFinite(atSec) || atSec < 0) return;
  const when = Math.max(atSec, c.currentTime + 0.001); // 唔好排去過去
  const g = c.createGain();
  g.connect(c.destination);
  const o1 = c.createOscillator(), o2 = c.createOscillator();
  const sub = kind === "sub";
  o1.type = "triangle"; o1.frequency.value = accent ? 1150 : 830;
  o2.type = "sine"; o2.frequency.value = accent ? 2300 : 1660;
  o1.connect(g); o2.connect(g);
  const decay = sub ? 0.045 : 0.085;
  const peak = (accent ? 0.85 : 0.5) * vol; // sub 嘅細聲由 vol 控制
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0006, when + decay);
  o1.start(when); o2.start(when);
  o1.stop(when + decay + 0.04); o2.stop(when + decay + 0.04);
  activeOsc.add(o1); activeOsc.add(o2);
  o1.onended = () => {
    activeOsc.delete(o1); activeOsc.delete(o2);
    try { g.disconnect(); } catch {}
  };
}

function pumpQueue() {
  const c = ensureCtx();
  const now = c.currentTime;
  // lookahead 150ms：就算 main thread 卡一下都唔會甩拍
  while (S.queue.length && S.queue[0].atSec < now + 0.15) {
    const ev = S.queue.shift();
    click(ev.atSec, { accent: ev.accent, vol: ev.vol ?? 1, kind: ev.kind ?? "on" });
  }
}

/** 即刻收聲：清 queue、停所有已排程嘅 oscillator、停 scheduler。 */
function stopAudio() {
  S.queue.length = 0;
  clearLights();
  if (S.sched) { clearInterval(S.sched); S.sched = null; }
  for (const o of activeOsc) {
    try { o.onended = null; o.stop(0); } catch {}
    try { o.disconnect(); } catch {}
  }
  activeOsc.clear();
}

// ---------------------------------------------------------------------------
// 基本拍子計數（1 & 2 & 3 & 4 &）＋ 亮燈
// ---------------------------------------------------------------------------
function renderCounts(feel = feelById(S.feelId)) {
  const el = $("counts");
  if (!el) return;
  const beats = feel.beatsPerBar;
  const f = swingOffset(feel.swing);
  const swingy = feel.swing > 1.05;
  el.style.gridTemplateColumns = `repeat(${beats * 2}, minmax(0,1fr))`;
  el.innerHTML = "";
  for (let b = 0; b < beats; b++) {
    for (const kind of ["on", "off"]) {
      const d = document.createElement("div");
      const played = feel.pattern.some(([p, k]) => p === b && k === kind);
      d.className = "cnt" + (kind === "off" ? " off" : "") + (played ? "" : " muted");
      const posPct = Math.round((kind === "off" ? f : 0) * 100);
      const posMs = Math.round(((kind === "off" ? f : 0) * 60000) / S.bpm);
      d.title = kind === "off"
        ? `後半拍：拍內 ${posPct}%（@${S.bpm}bpm = ${posMs}ms）`
        : `正拍：拍頭（${S.bpm}bpm）`;
      d.innerHTML = `<b>${kind === "on" ? b + 1 : "&"}</b><span>${swingy ? (kind === "off" ? "short" : "LONG") : "even"}</span>`;
      d.dataset.slot = String(b * 2 + (kind === "off" ? 1 : 0));
      el.appendChild(d);
    }
  }
  const total = beats * 2;
  $("countHint").innerHTML = swingy
    ? `${beats}/4 拍 × 2 = ${total} 格。後半拍（&）擺喺每拍 ${(f * 100).toFixed(0)}% 位置，即 LONG : short = 1 : ${feel.swing.toFixed(1)}（@${S.bpm}bpm，後半拍落喺 ${((f * 60000) / S.bpm).toFixed(0)}ms）。`
    : `${beats}/4 拍 × 2 = ${total} 格。呢個 feel 係平直嘅 — LONG 同 short 一樣長，後半拍就喺正中（50%）。`;
}

/** 排定一串「幾時要亮邊一格」嘅燈 */
function scheduleLights(events) {
  S.beatLights = events.filter((e) => Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  if (!S.lightRaf) S.lightRaf = requestAnimationFrame(lightLoop);
}

function lightLoop() {
  const now = audioNowMs();
  const cells = $("counts") ? $("counts").children : [];
  while (S.beatLights.length && S.beatLights[0].t <= now + 8) {
    const ev = S.beatLights.shift();
    const cell = cells[ev.slot];
    if (cell) {
      cell.classList.add("lit");
      clearTimeout(cell._litT);
      cell._litT = setTimeout(() => cell.classList.remove("lit"), 130);
    }
  }
  S.lightRaf = S.beatLights.length ? requestAnimationFrame(lightLoop) : null;
}

function clearLights() {
  S.beatLights = [];
  if (S.lightRaf) { cancelAnimationFrame(S.lightRaf); S.lightRaf = null; }
  if ($("counts")) for (const c of $("counts").children) c.classList.remove("lit");
}

/** 揀 feel 之後試聽兩個 bar（未開始練習前；唔加數拍，直接由第一拍開始） */
function previewFeel(feel) {
  if (S.running) return;
  const c = ensureCtx();
  c.resume();
  stopAudio();
  const grid = buildGrid(feel, S.bpm, { barsOverride: 2 });
  const t0 = audioNowMs() + 450;
  for (const tg of grid.targets) {
    S.queue.push({
      atSec: (t0 + tg.t) / 1000,
      accent: tg.kind === "on" && tg.beat === 0,
      vol: 1,
      kind: tg.kind,
    });
  }
  S.queue.sort((a, b) => a.atSec - b.atSec);
  S.sched = setInterval(pumpQueue, 25);
  pumpQueue();
  // 亮燈同樣兩個 bar
  scheduleLights(grid.targets.map((tg) => ({ t: t0 + tg.t, slot: tg.beat * 2 + (tg.kind === "off" ? 1 : 0) })));
  // 兩個 bar 之後自動收工
  clearTimeout(S.previewEnd);
  S.previewEnd = setTimeout(() => { if (!S.running) stopAudio(); }, grid.barMs * 2 + 450);
}

// ---------------------------------------------------------------------------
// 校準
// ---------------------------------------------------------------------------
async function runCalibration() {
  const c = ensureCtx();
  await c.resume();
  const beatMs = 60000 / S.bpm;
  const n = 8;
  const t0 = audioNowMs() + 700;
  S.calibMode = { taps: [], clicks: [], until: t0 + n * beatMs + 400 };
  for (let i = 0; i < n; i++) S.queue.push({ atSec: (t0 + i * beatMs) / 1000, accent: i % 4 === 0 });
  S.calibMode.clicks = Array.from({ length: n }, (_, i) => t0 + i * beatMs);
  $("calibTxt").innerHTML = "跟住 8 下 click 打（而家打緊…）";
  pumpQueue();
  if (!S.sched) S.sched = setInterval(pumpQueue, 25);

  const wait = setInterval(() => {
    if (audioNowMs() > S.calibMode.until) {
      clearInterval(wait);
      const cal = calibrate(S.calibMode.taps, S.calibMode.clicks);
      const m = S.calibMode;
      S.calibMode = null;
      if (cal && cal.n >= 3) {
        S.calibMs = cal.offsetMs;
        S.calibrated = true;
        $("calibTxt").innerHTML = `校準完成：<b>${cal.offsetMs > 0 ? "+" : ""}${cal.offsetMs} ms</b>（${cal.n} 下，σ ${cal.sdMs} ms${cal.reliable ? "" : " · 打得唔穩，建議再做一次"}）`;
      } else {
        $("calibTxt").innerHTML = "校準失敗：打唔夠 8 下，再試一次。";
      }
    }
  }, 60);
}

// ---------------------------------------------------------------------------
// 練習 session
// ---------------------------------------------------------------------------
function startSession({ testMode = false } = {}) {
  const c = ensureCtx();
  const feel = feelById(S.feelId);
  const grid = buildGrid(feel, S.bpm, { barsOverride: S.bars });
  const nowMs = audioNowMs();
  const countBeats = feel.beatsPerBar;
  // 確保 count-in 一定有位：t0 至少要而家 + 一小節
  const lead = testMode ? 250 : 700;
  const t0 = nowMs + Math.max(lead, grid.beatMs * countBeats + 250);

  const targets = grid.targets.map((t) => ({ ...t, t: t.t + t0 }));
  S.session = {
    feel, bpm: S.bpm, bars: S.bars, targetOffset: S.targetOffset,
    beatMs: grid.beatMs, barMs: grid.barMs, tolMs: grid.tolMs,
    t0, targets, taps: [], aux: [], testMode, alignMs: 0, lastTap: -Infinity,
    endMs: targets.at(-1).t + grid.barMs * 0.6,
  };

  // count-in：一小節四分音符 click
  S.queue = [];
  const countStart = t0 - countBeats * grid.beatMs;
  for (let i = 0; i < countBeats; i++) {
    S.queue.push({ atSec: (countStart + i * grid.beatMs) / 1000, accent: i === 0, kind: "on" });
  }
  for (const tg of targets) {
    S.queue.push({
      atSec: tg.t / 1000,
      accent: tg.kind === "on" && tg.beat % 4 === 0,
      kind: tg.kind,
    });
  }
  // 細分參考 tick：每個「格」（1 & 2 & 3 & 4 &）都有聲，但 pattern 冇打嘅位置只係細細聲
  // —— 用嚟聽得返「短」同「長」之間嗰個位。
  if (S.subdiv) {
    const f = swingOffset(feel.swing);
    for (let b = 0; b < S.bars; b++) {
      for (let beat = 0; beat < feel.beatsPerBar; beat++) {
        for (const kind of ["on", "off"]) {
          const tt = t0 + b * grid.barMs + (beat + (kind === "off" ? f : 0)) * grid.beatMs;
          if (!targets.some((tg) => Math.abs(tg.t - tt) < 12)) {
            S.queue.push({ atSec: tt / 1000, kind: "sub", vol: 0.32 });
          }
        }
      }
    }
  }
  S.queue.sort((a, b) => a.atSec - b.atSec);
  if (!S.sched) S.sched = setInterval(pumpQueue, 25);
  pumpQueue();

  // 亮燈：count-in 每一拍 + 所有目標音
  scheduleLights([
    ...Array.from({ length: countBeats }, (_, i) => ({ t: countStart + i * grid.beatMs, slot: i * 2 })),
    ...targets.map((tg) => ({ t: tg.t, slot: tg.beat * 2 + (tg.kind === "off" ? 1 : 0) })),
  ]);

  S.dots = new Map();
  buildLane();
  $("setup").classList.add("hidden");
  $("result").classList.add("hidden");
  $("stage").classList.remove("hidden");
  $("stageBadge").textContent = "count-in";
  $("alignWarn").textContent = "";
  $("trace").textContent = "";
  TRACE.length = 0;
  document.body.classList.add("playing"); // 練習期間封鎖瀏覽器手勢（iOS double-tap zoom）
  S.running = true;
  loop();
}

function viewMs() {
  // 一次睇一個 bar：時間軸短啲，點同點之間就分得開（「短→長」呢種 182ms 嘅距）
  return S.session ? S.session.barMs : 2000;
}

function buildLane() {
  const lane = $("lane");
  [...lane.querySelectorAll(".dot,.barline,.float")].forEach((n) => n.remove());
  const s = S.session;
  for (let b = 0; b <= s.bars; b++) {
    const d = document.createElement("div");
    d.className = "barline";
    d.dataset.t = s.t0 + b * s.barMs;
    d.style.left = "0px";
    lane.appendChild(d);
  }
  for (const tg of s.targets) {
    const d = document.createElement("div");
    d.className = "dot" + (tg.kind === "off" ? " off" : "");
    d.style.top = (tg.kind === "off" ? 74 : 46) + "px";
    lane.appendChild(d);
    S.dots.set(tg, d);
  }
}

function loop() {
  if (!S.running) return;
  const lane = $("lane");
  const W = lane.clientWidth;
  const phX = W * 0.34;
  const now = audioNowMs();
  const s = S.session;
  const vw = viewMs();
  const x = (t) => phX + ((t - now) / vw) * W;

  // 下一個要打嘅目標：加個淡淡嘅光環，望得到「下一步嚟緊」
  let nextTg = null;
  for (const tg of s.targets) { if (tg.t >= now) { nextTg = tg; break; } }
  for (const [tg, el] of S.dots) {
    const px = x(tg.t);
    if (px < -40 || px > W + 40) { el.style.display = "none"; continue; }
    el.style.display = "block";
    el.style.left = px + "px";
    el.classList.toggle("next", tg === nextTg);
  }
  for (const bl of lane.querySelectorAll(".barline")) {
    const px = x(+bl.dataset.t);
    bl.style.display = px < -2 || px > W + 2 ? "none" : "block";
    bl.style.left = px + "px";
  }

  $("stageBadge").textContent = now < s.t0 ? "count-in" : `bar ${Math.min(s.bars, Math.floor((now - s.t0) / s.barMs) + 1)} / ${s.bars}`;

  if (now > s.endMs) { finish(); return; }
  S.raf = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// 輸入
// ---------------------------------------------------------------------------
function handleTapAt(audioMs, source = "tap") {
  if (S.calibMode) {
    S.calibMode.taps.push(audioMs);
    flashPad(source);
    return { counted: true, reason: "calib" };
  }
  const s = S.session;
  if (!s || !S.running) return { counted: false, reason: "冇練習中" };
  const t = audioMs - S.calibMs;
  if (t < s.t0 - s.beatMs * 0.45) { flashPad(source); return { counted: false, reason: "count-in" }; }

  // 同一 gesture 去重：只擋「唔同來源、同一瞬間」嘅重複（touchstart + pointerdown + mousedown）。
  // 唔可以用「時間差 < 35ms 就掉」去擋兩個真拍子 —— 短→長可以只差 180ms，
  // 而且時間映射一有抖動就會誤殺。
  const sameGesture = source !== s.lastSource && t - s.lastTap < 60 && t >= s.lastTap - 60;
  if (sameGesture) {
    s.chordIgnored = (s.chordIgnored || 0) + 1;
    flashPad(source);
    return { counted: false, reason: "重複事件" };
  }
  s.lastTap = t;
  s.lastSource = source;

  s.taps.push(t);
  paintHit(t);
  updateLive();
  flashPad(source);
  return { counted: true, reason: source };
}

// --- 輸入 trace：練習時將每一個收到嘅 event 顯示出嚟（診斷「app 收唔到」用） ---
const TRACE = [];
function recordTap(type, ev, res) {
  TRACE.push({
    type,
    t: Math.round(ev.timeStamp),
    ok: !!res.counted,
    why: res.counted ? "" : (res.reason || ""),
  });
  if (TRACE.length > 60) TRACE.shift();
  const el = $("trace");
  if (el) {
    el.textContent = TRACE.slice(-6)
      .map((x) => `${x.type}@${x.t}${x.ok ? " ✓" : " ✗ " + x.why}`)
      .join("   ");
  }
}

function nearestTarget(t) {
  const s = S.session;
  let best = null, bd = Infinity;
  for (const tg of s.targets) {
    const d = Math.abs(t - (tg.t + s.targetOffset));
    if (d < bd) { bd = d; best = tg; }
  }
  return { target: best, err: t - (best.t + s.targetOffset) };
}

function paintHit(t) {
  const s = S.session;
  const { target, err } = nearestTarget(t);
  if (!target) return;
  // 用「扣咗系統偏移」嘅誤差去上色，同評分一致
  const e = err - (s.alignMs || 0);
  const el = S.dots.get(target);
  if (!el) return;
  el.classList.remove("hit-good", "hit-ok", "hit-bad");
  const cls = Math.abs(e) <= s.tolMs * 0.5 ? "hit-good" : Math.abs(e) <= s.tolMs ? "hit-ok" : "hit-bad";
  el.classList.add(cls); // 就算差好遠都照樣上色，唔會「靜英英冇反應」

  const lane = $("lane");
  const f = document.createElement("div");
  f.className = "float";
  f.textContent = (e > 0 ? "+" : "") + Math.round(e);
  f.style.color = cls === "hit-good" ? "var(--good)" : cls === "hit-ok" ? "var(--accent)" : "var(--bad)";
  f.style.left = el.style.left;
  f.style.top = (target.kind === "off" ? 68 : 40) + "px";
  lane.appendChild(f);
  setTimeout(() => f.classList.add("fade"), 30);
  setTimeout(() => f.remove(), 700);
}

function updateLive() {
  const s = S.session;
  if (!s.taps.length) return;
  const r = scoreSession({
    taps: s.taps, targets: s.targets, tolMs: s.tolMs, beatMs: s.beatMs, targetOffsetMs: s.targetOffset,
  });
  s.alignMs = r.alignMs;
  const last = r.scored.filter((x) => x.err !== null).at(-1);
  $("sLast").textContent = last ? `${last.err > 0 ? "+" : ""}${Math.round(last.err)} ms` : "—";
  $("sLast").style.color = last && Math.abs(last.err) <= s.tolMs ? "var(--good)" : "var(--bad)";
  $("sPocket").textContent = r.pocketMs === null ? "—" : `${r.pocketMs > 0 ? "+" : ""}${r.pocketMs}`;
  $("sSigma").textContent = r.sigmaMs === null ? "—" : `${r.sigmaMs}`;
  $("sRatio").textContent = r.swingRatio === null ? "—" : `1 : ${r.swingRatio}`;
  const parts = [`已收 ${s.taps.length} / 目標 ${s.targets.length} 下`];
  if (r.alignMs) {
    parts.push(`已自動對齊 <b>${r.alignMs > 0 ? "遲" : "早"} ${Math.abs(r.alignMs)} ms</b>（多數係耳機延遲）`);
  }
  if (s.chordIgnored) parts.push(`合併咗 ${s.chordIgnored} 下（當和弦）`);
  $("alignWarn").innerHTML = parts.join(" · ");
}

function flashPad(source) {
  const p = $("tapPad");
  p.style.background = "#1b2a3d";
  setTimeout(() => { p.style.background = ""; }, 70);
}

// ---------------------------------------------------------------------------
// 結束 + 結果
// ---------------------------------------------------------------------------
function finish() {
  if (!S.session) return;
  S.running = false;
  cancelAnimationFrame(S.raf);
  document.body.classList.remove("playing");
  stopAudio(); // 即刻收聲：唔好留返已經排咗嘅 click 繼續響
  const s = S.session;
  const r = scoreSession({
    taps: s.taps, targets: s.targets, tolMs: s.tolMs, beatMs: s.beatMs, targetOffsetMs: s.targetOffset,
  });
  const targetRatio = s.feel.swing;

  $("stage").classList.add("hidden");
  $("result").classList.remove("hidden");
  $("rGrade").textContent = r.grade;
  $("rGrade").style.color = r.grade === "S" ? "var(--good)" : r.grade === "A" ? "var(--accent2)" : r.grade === "B" ? "var(--accent)" : "var(--bad)";
  $("rTotal").textContent = r.total;
  $("rFeel").textContent = `${s.feel.name} · ${s.bpm} bpm · ${s.bars} 小節 · 目標 swing 1:${targetRatio.toFixed(1)}`;
  $("rPocket").textContent = r.pocketMs === null ? "—" : `${r.pocketMs > 0 ? "推前 " : r.pocketMs < 0 ? "拉後 " : "正中 "}${Math.abs(r.pocketMs)} ms`;
  $("rSigma").textContent = r.sigmaMs === null ? "—" : `${r.sigmaMs} ms`;
  $("rOnOff").textContent = `${r.onSigmaMs ?? "—"} / ${r.offSigmaMs ?? "—"} ms`;
  $("rRatio").textContent = r.swingRatio === null ? "—" : `1 : ${r.swingRatio}（目標 1:${targetRatio.toFixed(1)}）`;
  $("rCounts").textContent = `${r.nHits} / ${r.nMissed} / ${r.nExtras}`;
  $("rTol").textContent = `±${r.tolMs.toFixed(0)} ms`;
  $("rAlign").textContent = r.alignMs
    ? `${r.alignMs > 0 ? "遲" : "早"} ${Math.abs(r.alignMs)} ms（已對齊）`
    : "冇（打得準）";
  if (r.alignMs) {
    $("alignRow").style.display = "flex";
    $("alignNote").innerHTML = `偵測到你整體${r.alignMs > 0 ? "遲" : "早"}咗 ${Math.abs(r.alignMs)} ms，已自動對齊先評分。如果係耳機／裝置延遲，做一次校準就唔使每次靠自動對齊。`;
    $("applyAlign").onclick = () => {
      S.calibMs = +(S.calibMs + r.alignMs).toFixed(1);
      S.calibrated = true;
      $("calibTxt").innerHTML = `校準更新：<b>${S.calibMs > 0 ? "+" : ""}${S.calibMs} ms</b>（由系統偏移推算）`;
      $("alignRow").style.display = "none";
    };
  } else {
    $("alignRow").style.display = "none";
  }
  $("rFb").innerHTML = feedback(r).map((x) => `<li>${x}</li>`).join("");

  const c = ensureCtx();
  $("clockInfo").textContent =
    `v9 · 時鐘 ${clockPath} · 輸出延遲 ${Math.round((c.outputLatency || 0) * 1000)}ms · 緩衝 ${Math.round((c.baseLatency || 0) * 1000)}ms · ${c.sampleRate}Hz · 校準 ${S.calibMs}ms`;

  S.hist.push({ t: Date.now(), feel: s.feel.id, bpm: s.bpm, total: r.total, grade: r.grade, pocket: r.pocketMs, sigma: r.sigmaMs, ratio: r.swingRatio });
  S.hist = S.hist.slice(-12);
  try { localStorage.setItem("jazz-rhythm-hist", JSON.stringify(S.hist)); } catch {}
  renderHist();
  S.session = null;
  window.__lastResult = r;
}

function renderHist() {
  const el = $("rHist");
  el.innerHTML = "";
  const max = 100;
  for (const h of S.hist) {
    const d = document.createElement("div");
    d.style.height = `${clamp((h.total / max) * 100, 4, 100)}%`;
    if (h.grade === "S" || h.grade === "A") d.classList.add("hi");
    d.title = `${h.total} · ${h.grade}`;
    el.appendChild(d);
  }
}

// ---------------------------------------------------------------------------
// UI 綁定
// ---------------------------------------------------------------------------
function renderFeels() {
  const el = $("feels");
  el.innerHTML = "";
  for (const f of FEELS) {
    const b = document.createElement("button");
    b.className = "feel" + (f.id === S.feelId ? " on" : "");
    b.innerHTML = `<b>${f.name}</b><small>${f.sub}</small>`;
    b.onclick = () => {
      S.feelId = f.id;
      S.bpm = f.bpm;
      $("bpm").value = f.bpm;
      $("bpmVal").textContent = `${f.bpm} bpm`;
      renderFeels();
      renderHint();
      renderCounts(f);
      previewFeel(f); // 揀完即聽一個 bar + 亮燈
    };
    el.appendChild(b);
  }
}

function renderHint() {
  const f = feelById(S.feelId);
  const g = buildGrid(f, S.bpm, { barsOverride: S.bars });
  const fpos = swingOffset(f.swing);
  $("feelHint").innerHTML = f.swing === 1
    ? `平直 feel：後半拍就喺拍中間（${(fpos * 100).toFixed(0)}%）。容差 ±${g.tolMs.toFixed(0)} ms。`
    : `目標 swing 1:${f.swing.toFixed(1)} → 後半拍擺喺每拍 ${(fpos * 100).toFixed(1)}% 位置（${S.bpm} bpm 時即 ${(fpos * 60000 / S.bpm).toFixed(0)} ms）。容差 ±${g.tolMs.toFixed(0)} ms。`;
}

function bindUI() {
  $("bpm").oninput = (e) => { S.bpm = +e.target.value; $("bpmVal").textContent = `${S.bpm} bpm`; renderHint(); renderCounts(); };
  $("bars").oninput = (e) => { S.bars = +e.target.value; $("barsVal").textContent = `${S.bars} 小節`; renderHint(); };
  $("offset").oninput = (e) => {
    S.targetOffset = +e.target.value;
    $("subdiv").addEventListener("change", (e) => { S.subdiv = e.target.checked; });
  $("offsetVal").textContent = S.targetOffset === 0 ? "0 ms" : `${S.targetOffset > 0 ? "+" : ""}${S.targetOffset} ms`;
    renderHint();
  };
  $("calibBtn").onclick = () => { ensureCtx().resume(); runCalibration(); };
  $("startBtn").onclick = async () => { await ensureCtx().resume(); startSession(); };
  $("stopBtn").onclick = () => finish();
  $("againBtn").onclick = () => { $("result").classList.add("hidden"); $("setup").classList.remove("hidden"); startSession(); };
  $("backBtn").onclick = () => { $("result").classList.add("hidden"); $("setup").classList.remove("hidden"); };

  // 打拍子：整個練習區都食（唔止個 pad），但唔可以食到「停」掣
  const isControl = (el) => !!(el && el.closest && el.closest("button, input, .btn, .feel"));
  $("stage").addEventListener("pointerdown", (e) => {
    if (isControl(e.target)) return;
    e.preventDefault();
    recordTap("pointerdown", e, handleTapAt(perfToAudioMs(e.timeStamp), "pointer"));
  });

  // iOS Safari：pointerdown 嘅 preventDefault 擋唔到 double-tap zoom，
  // 一定要喺 touchstart 呢個手勢判定點 preventDefault。順便喺呢度收拍子，
  // 同 pointerdown 撞嘅話會被 35ms chord dedupe 合併。
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const touchGuard = (e) => {
    const t = e.target;
    if (isControl(t)) { recordTap("touchstart", e, { counted: false, reason: "控制" }); return; }
    if (!S.running && !(t.closest && t.closest("#tapPad"))) return;
    e.preventDefault();
    const res = isIOS
      ? handleTapAt(perfToAudioMs(e.timeStamp), "touch")
      : { counted: false, reason: "非 iOS" };
    recordTap("touchstart", e, res);
  };
  document.addEventListener("touchstart", touchGuard, { passive: false });

  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") e.preventDefault();
    recordTap("key", e, handleTapAt(perfToAudioMs(e.timeStamp), "key"));
  });

  // Web MIDI（jazz pianist 最實用：數碼鋼琴 → USB MIDI）
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess({ sysex: false }).then((midi) => {
      const attach = () => {
        const names = [...midi.inputs.values()].map((i) => i.name);
        for (const input of midi.inputs.values()) {
          input.onmidimessage = (msg) => {
            const [status, note, vel] = msg.data;
            if ((status & 0xf0) === 0x90 && vel > 0) handleTapAt(perfToAudioMs(msg.timeStamp), "midi");
          };
        }
        $("midiState").textContent = names.length ? `MIDI：${names.join(", ")}` : "MIDI：未連接";
      };
      attach();
      midi.onstatechange = attach;
    }).catch(() => { $("midiState").textContent = "MIDI：唔支援"; });
  } else {
    $("midiState").textContent = "MIDI：瀏覽器唔支援";
  }
}

// ---------------------------------------------------------------------------
// 測試掛鉤（headless 驗證用）
// ---------------------------------------------------------------------------
window.__spike = {
  state: S,
  start: (opts = {}) => { ensureCtx(); startSession({ testMode: true }); },
  targets: () => (S.session ? S.session.targets.map((t) => t.t) : []),
  tapAtAudio: (ms) => handleTapAt(ms, "test"),
  finish: () => finish(),
  result: () => window.__lastResult,
  setCalib: (v) => { S.calibMs = v; S.calibrated = true; },
  // 音訊狀態（測試用）
  audio: () => ({
    queue: S.queue.length,
    schedActive: !!S.sched,
    oscillators: activeOsc.size,
    running: S.running,
  }),
  preview: (feelId) => previewFeel(feelById(feelId || S.feelId)),
  stopAudio: () => stopAudio(),
  lights: () => ({
    pending: (S.beatLights || []).length,
    lit: [...document.querySelectorAll("#counts .cnt")].filter((c) => c.classList.contains("lit")).map((c) => c.dataset.slot),
  }),
  counts: () => [...document.querySelectorAll("#counts .cnt")].map((c) => ({
    slot: c.dataset.slot,
    label: c.querySelector("b").textContent,
    feel: c.querySelector("span").textContent,
    muted: c.classList.contains("muted"),
  })),
  trace: () => TRACE.slice(-12),
  clock: () => {
    const c = ensureCtx();
    return {
      path: clockPath,
      outputLatency: c.outputLatency ?? null,
      baseLatency: c.baseLatency ?? null,
      sampleRate: c.sampleRate,
      calibMs: S.calibMs,
    };
  },
};

// boot
renderFeels();
renderHint();
renderCounts();
bindUI();
try { S.hist = JSON.parse(localStorage.getItem("jazz-rhythm-hist") || "[]"); } catch {}
