/**
 * sim.mjs — 用合成 tap 測試評分核心：可唔可以分得出 swing 比例？分數有冇 discriminates？
 * node spikes/002-scoring/sim.mjs
 */
import {
  FEELS, feelById, buildGrid, scoreSession, hitScore, swingOffset, ratioFromOffset, calibrate,
} from "../../jazz-core.js";

// ---- seeded RNG ----
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = (mu = 0, sigma = 1) => {
  const u = Math.max(1e-9, rnd()), v = rnd();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** 模擬一個人打一次練習：對每個目標音加 jitter + 整體偏移 */
function simulate(feelId, bpm, { sigma = 12, bias = 0, bars = null, missRate = 0, extraRate = 0, seedv = null } = {}) {
  if (seedv !== null) seed = seedv;
  const feel = feelById(feelId);
  const g = buildGrid(feel, bpm, { barsOverride: bars ?? Math.max(4, feel.bars) });
  const taps = [];
  for (const tg of g.targets) {
    if (rnd() < missRate) continue;
    taps.push(tg.t + gauss(bias, sigma));
  }
  const nExtra = Math.floor(g.targets.length * extraRate);
  for (let i = 0; i < nExtra; i++) taps.push(g.targets[0].t + rnd() * (g.targets.at(-1).t - g.targets[0].t));
  return { g, taps, feel };
}

const results = [];
const line = (...a) => console.log(...a);

line("=== A. swing ratio 估得上唔上（中速 swing，目標 2.0，4 小節） ===");
line("σ(ms)  估到嘅 ratio (20 次中位數)   範圍           準確度分  穩定度分");
for (const sigma of [4, 8, 12, 16, 20, 30]) {
  const ests = [];
  let acc = 0, cons = 0;
  for (let i = 0; i < 20; i++) {
    const { g, taps } = simulate("swing-med", 120, { sigma, bars: 4, seedv: 1000 + i * 7 });
    const r = scoreSession({ taps, targets: g.targets, tolMs: g.tolMs, beatMs: g.beatMs });
    if (r.swingRatio) ests.push(r.swingRatio);
    acc += r.accuracy; cons += r.consistencyScore ?? 0;
  }
  const s = ests.sort((a, b) => a - b);
  line(
    String(sigma).padEnd(7),
    median(ests).toFixed(2).padEnd(29),
    `${s[0].toFixed(2)}–${s.at(-1).toFixed(2)}`.padEnd(15),
    (acc / 20).toFixed(1).padEnd(10),
    (cons / 20).toFixed(1),
  );
}

line("\n=== B. 分唔分得出 1.5 vs 2.0 vs 2.5 swing（σ=12ms）===");
line("小節數  1.5→估      2.0→估      2.5→估      分辨正確率");
for (const bars of [1, 2, 4, 8]) {
  const rows = [];
  for (const target of [1.5, 2.0, 2.5]) {
    const feel = { ...feelById("swing-med"), swing: target };
    const ests = [];
    for (let i = 0; i < 40; i++) {
      seed = 5000 + i * 13 + target * 100;
      const g = buildGrid(feel, 120, { barsOverride: bars });
      const taps = g.targets.map((t) => t.t + gauss(0, 12));
      const r = scoreSession({ taps, targets: g.targets, tolMs: g.tolMs, beatMs: g.beatMs });
      if (r.swingRatio) ests.push(r.swingRatio);
    }
    rows.push(median(ests));
  }
  // 正確率：最近嘅目標
  let ok = 0, tot = 0;
  for (const target of [1.5, 2.0, 2.5]) {
    const feel = { ...feelById("swing-med"), swing: target };
    for (let i = 0; i < 40; i++) {
      seed = 9000 + i * 17 + target * 100;
      const g = buildGrid(feel, 120, { barsOverride: bars });
      const taps = g.targets.map((t) => t.t + gauss(0, 12));
      const r = scoreSession({ taps, targets: g.targets, tolMs: g.tolMs, beatMs: g.beatMs });
      const nearest = [1.5, 2.0, 2.5].reduce((p, c) => (Math.abs(c - r.swingRatio) < Math.abs(p - r.swingRatio) ? c : p));
      ok += nearest === target ? 1 : 0; tot++;
    }
  }
  line(
    String(bars).padEnd(7),
    rows[0].toFixed(2).padEnd(11), rows[1].toFixed(2).padEnd(11), rows[2].toFixed(2).padEnd(11),
    `${((ok / tot) * 100).toFixed(0)}%`,
  );
}

line("\n=== C. 分數排得到好壞（中速 swing，4 小節） ===");
line("σ(ms)  總分   等級  pocket(ms)  σ實測  回饋");
for (const [sigma, bias] of [[5, 0], [10, 0], [10, -25], [18, 0], [28, 0], [10, 60]]) {
  const { g, taps } = simulate("swing-med", 120, { sigma, bias, bars: 4, seedv: 77 });
  const r = scoreSession({ taps, targets: g.targets, tolMs: g.tolMs, beatMs: g.beatMs });
  line(
    `${sigma}/${bias}`.padEnd(7),
    String(r.total).padEnd(6), r.grade.padEnd(5),
    String(r.pocketMs).padEnd(10), String(r.sigmaMs).padEnd(6),
    // 動態 import 避免頂部重覆
    "",
  );
}

line("\n=== D. 容差窗口 vs 速度 ===");
line("tempo  feel        tolMs  最短間隔(ms)");
for (const [id, bpm] of [["ballad", 60], ["swing-med", 120], ["swing-fast", 200], ["swing-fast", 260], ["waltz", 140], ["bossa", 130]]) {
  const g = buildGrid(feelById(id), bpm);
  let minGap = Infinity;
  for (let i = 1; i < g.targets.length; i++) minGap = Math.min(minGap, g.targets[i].t - g.targets[i - 1].t);
  line(String(bpm).padEnd(6), id.padEnd(11), String(g.tolMs.toFixed(1)).padEnd(7), minGap.toFixed(1));
}

line("\n=== E. 漏拍／多拍偵測 ===");
{
  const { g, taps } = simulate("swing-med", 120, { sigma: 10, bars: 4, missRate: 0.15, extraRate: 0.1, seedv: 4321 });
  const r = scoreSession({ taps, targets: g.targets, tolMs: g.tolMs, beatMs: g.beatMs });
  line(`targets=${r.nTargets} hits=${r.nHits} missed=${r.nMissed} extras=${r.nExtras} (期望 miss≈15%, extra≈10%)`);
}

line("\n=== F. 校正（tap 9 下四分音符，系統遲 35ms、jitter 8ms） ===");
{
  seed = 999;
  const beatMs = 500;
  const clicks = Array.from({ length: 9 }, (_, i) => 1000 + i * beatMs);
  const taps = clicks.map((c) => c + 35 + gauss(0, 8));
  line("真值 +35ms →", JSON.stringify(calibrate(taps, clicks)));
  const sloppy = clicks.map((c) => c + 35 + gauss(0, 45));
  line("亂打（σ=45）→", JSON.stringify(calibrate(sloppy, clicks)));
}

line("\n=== G. swing ratio 換算 ===");
for (const r of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
  const f = swingOffset(r);
  line(`ratio ${r}  →  後半拍在拍內 ${(f * 100).toFixed(1)}%  （120bpm 時 = ${(f * 500).toFixed(0)}ms）  回推 = ${ratioFromOffset(f).toFixed(2)}`);
}
