/**
 * analyze.mjs — 由 series.json（mic 每 10.7ms 一格嘅高頻譜通量）計 detector 表現。
 * 用真值時間做對齊（假音效裝置幾時開始播係未知），再掃幾個 threshold 睇 recall / precision / 誤差。
 */
import { readFileSync } from "node:fs";
const { series, truth } = JSON.parse(readFileSync(new URL("./series.json", import.meta.url), "utf8"));
const T = series.map((p) => p[0]), F = series.map((p) => p[1]);

const at = (t) => {
  let lo = 0, hi = T.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] < t) lo = m + 1; else hi = m; }
  return lo;
};
const peakNear = (t, win) => {
  let best = 0;
  for (let i = at(t - win); i < T.length && T[i] <= t + win; i++) best = Math.max(best, F[i]);
  return best;
};

// 1. 對齊：搜尋 offset 令真值時間點嘅 flux 總和最大
let bestOff = 0, bestScore = -1;
for (let off = 0; off <= 3; off += 0.005) {
  const s = truth.reduce((acc, tt) => acc + Math.min(1, peakNear(tt + off, 0.03)), 0);
  if (s > bestScore) { bestScore = s; bestOff = off; }
}
const truthAbs = truth.map((t) => t + bestOff);

// 2. 掃 threshold
function detect(thr, minGap = 0.09) {
  const out = [];
  let last = -1e9;
  for (let i = 1; i < F.length - 1; i++) {
    if (F[i] < thr) continue;
    if (F[i] < F[i - 1] || F[i] < F[i + 1]) continue;      // 局部極大
    if (T[i] - last < minGap) { if (out.length && F[i] > F[out.length - 1].f) { out[out.length - 1] = { t: T[i], f: F[i] }; last = T[i]; } continue; }
    out.push({ t: T[i], f: F[i] });
    last = T[i];
  }
  return out;
}

const pct = (arr, q) => arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : null;
const rows = [];
for (const thr of [0.15, 0.2, 0.3, 0.4, 0.55, 0.7, 0.9, 1.2]) {
  const det = detect(thr);
  const matched = new Set();
  const errs = [];
  for (const tt of truthAbs) {
    let bi = -1, bd = Infinity;
    det.forEach((d, i) => { const e = Math.abs(d.t - tt); if (e < bd && e <= 0.06) { bd = e; bi = i; } });
    if (bi >= 0) { matched.add(bi); errs.push((det[bi].t - tt) * 1000); }
  }
  const abs = errs.map(Math.abs);
  rows.push({
    thr,
    detected: det.length,
    recall: `${matched.size}/${truth.length}`,
    falsePositives: det.length - matched.size,
    medianAbsErrMs: abs.length ? +pct(abs, 0.5).toFixed(1) : null,
    p90AbsErrMs: abs.length ? +pct(abs, 0.9).toFixed(1) : null,
    biasMs: errs.length ? +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1) : null,
  });
}

// 3. 分段（按真值間距）
const sections = [
  { name: "四分 500ms", min: 0.3, max: 0.7 },
  { name: "8 分 250ms", min: 0.18, max: 0.3 },
  { name: "16 分 125ms", min: 0.05, max: 0.18 },
];
const best = rows.slice().sort((a, b) => {
  const r = (x) => Number(x.recall.split("/")[0]);
  return r(b) - r(a) || a.falsePositives - b.falsePositives;
})[0];
const det = detect(best.thr);
const perSection = sections.map((s) => {
  const ts = truthAbs.filter((t, i) => i > 0 && (truth[i] - truth[i - 1]) >= s.min && (truth[i] - truth[i - 1]) < s.max);
  const got = ts.filter((tt) => det.some((d) => Math.abs(d.t - tt) <= 0.06)).length;
  return { section: s.name, notes: ts.length, detected: got };
});

console.log(JSON.stringify({
  frames: T.length,
  frameMs: +(((T.at(-1) - T[0]) / (T.length - 1)) * 1000).toFixed(2),
  alignOffsetS: +bestOff.toFixed(3),
  threshold: best.thr,
  overall: best,
  perSection,
  all: rows,
}, null, 2));
