/**
 * jazz-core.js — 節奏練習核心：拍子網格、對位評分、swing ratio 估算。
 * 純 logic，無 DOM，可在瀏覽器（ESM）同 Node 測試中共用。
 *
 * 單位：時間一律用毫秒，以 Web Audio 時鐘（audioContext.currentTime * 1000）為準。
 */

// ---------------------------------------------------------------------------
// 1. 常見 jazz 拍子（feel）定義
//    pattern: [拍位(以四分音符為單位), 'on'|'off']
//    'off' 代表該拍嘅「後半拍」，實際位置由 swing 比例決定：
//      位置 = 拍位 + f， f = ratio / (1 + ratio)   (ratio 1 → 0.5 平均, 2 → 0.667 三連音感)
// ---------------------------------------------------------------------------
export const FEELS = [
  {
    id: "swing-med", name: "中速 Swing", sub: "spang-a-lang ride pattern",
    beatsPerBar: 4, bars: 2, swing: 2.0, bpm: 110,
    pattern: [[0, "on"], [1, "on"], [1, "off"], [2, "on"], [3, "on"], [3, "off"]],
  },
  {
    id: "swing-fast", name: "快速 Swing", sub: "2-feel，1 同 3 落，後半拍點綴",
    beatsPerBar: 4, bars: 2, swing: 1.6, bpm: 200,
    pattern: [[0, "on"], [1, "off"], [2, "on"], [3, "off"]],
  },
  {
    id: "ballad", name: "Ballad 慢歌", sub: "1、3 落地，4 後半拍 pickup",
    beatsPerBar: 4, bars: 2, swing: 2.2, bpm: 60,
    pattern: [[0, "on"], [2, "on"], [3, "off"]],
  },
  {
    id: "waltz", name: "Jazz Waltz", sub: "3/4：1，2 後半拍，3",
    beatsPerBar: 3, bars: 2, swing: 2.0, bpm: 140,
    pattern: [[0, "on"], [1, "off"], [2, "on"]],
  },
  {
    id: "bossa", name: "Bossa Nova", sub: "平直 8 分，唔 swing",
    beatsPerBar: 4, bars: 2, swing: 1.0, bpm: 130,
    pattern: [[0, "on"], [0, "off"], [1, "on"], [1, "off"], [2, "on"], [2, "off"], [3, "on"], [3, "off"]],
  },
  {
    id: "charleston", name: "Charleston 伴奏", sub: "1 同 2 後半拍，經典 comping",
    beatsPerBar: 4, bars: 2, swing: 2.0, bpm: 120,
    pattern: [[0, "on"], [1, "off"]],
  },
  {
    id: "funk", name: "Straight / Funk", sub: "平直 8 分，ECM／modern jazz 常用",
    beatsPerBar: 4, bars: 2, swing: 1.0, bpm: 96,
    pattern: [[0, "on"], [1, "on"], [2, "on"], [3, "on"], [3, "off"]],
  },
];

export function feelById(id) {
  return FEELS.find((f) => f.id === id) || FEELS[0];
}

export function swingOffset(ratio) {
  const r = Math.max(1, ratio);
  return r / (1 + r); // 1 → .5, 1.5 → .6, 2 → .6667
}

export function ratioFromOffset(offBeatFraction) {
  const f = Math.min(0.95, Math.max(0.05, offBeatFraction));
  return f / (1 - f);
}

/**
 * 產生練習用嘅目標時間表。
 * @returns {{beatMs:number, barMs:number, tolMs:number, targets:Array<{t:number,bar:number,kind:string,beat:number,label:string}>}}
 */
export function buildGrid(feel, bpm, { barsOverride = null, startMs = 0 } = {}) {
  const beatMs = 60000 / bpm;
  const f = swingOffset(feel.swing);
  const nBars = barsOverride ?? feel.bars;
  const barMs = beatMs * feel.beatsPerBar;
  const targets = [];
  for (let b = 0; b < nBars; b++) {
    for (const [beat, kind] of feel.pattern) {
      const pos = beat + (kind === "off" ? f : 0);
      targets.push({
        t: startMs + b * barMs + pos * beatMs,
        bar: b,
        kind,
        beat,
        label: `${Math.floor(beat) + 1}${kind === "off" ? "&" : ""}`,
      });
    }
  }
  targets.sort((a, b) => a.t - b.t);
  // 最短相鄰間隔 → 容許誤差窗口
  let minGap = Infinity;
  for (let i = 1; i < targets.length; i++) minGap = Math.min(minGap, targets[i].t - targets[i - 1].t);
  const tolMs = Math.max(15, Math.min(45, 0.16 * Math.min(minGap, beatMs)));
  return { beatMs, barMs, tolMs, targets };
}

// ---------------------------------------------------------------------------
// 2. 對位：每個 tap 配一個目標音
// ---------------------------------------------------------------------------
function matchTaps(targets, taps, winMs) {
  const hits = [];
  const used = new Set();
  const remaining = [];
  for (const tg of targets) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(taps[i] - tg.t);
      if (d < bestD && d <= winMs) { bestD = d; best = i; }
    }
    if (best >= 0) { used.add(best); hits.push({ target: tg, tap: taps[best], err: taps[best] - tg.t }); }
    else hits.push({ target: tg, tap: null, err: null });
  }
  for (let i = 0; i < taps.length; i++) if (!used.has(i)) remaining.push(taps[i]);
  return { hits, extras: remaining };
}

// ---------------------------------------------------------------------------
// 3. 評分
// ---------------------------------------------------------------------------
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** 單下分數：完美區 0.4·tol 內 100 分，tol 時 70 分，2·tol 時 0 分 */
export function hitScore(errMs, tolMs) {
  const e = Math.abs(errMs);
  if (e <= 0.4 * tolMs) return 100;
  if (e <= tolMs) return 100 - 30 * ((e - 0.4 * tolMs) / (0.6 * tolMs));
  if (e <= 2 * tolMs) return 70 * (1 - (e - tolMs) / tolMs);
  return 0;
}

/**
 * @param {object} o
 * @param {number[]} o.taps   已校正嘅 tap 時間（ms，audio 時鐘）
 * @param {Array} o.targets   buildGrid().targets
 * @param {number} o.tolMs
 * @param {number} o.beatMs
 * @param {number} [o.targetOffsetMs] 容許／要求嘅整體偏移（>0 = 推前，<0 = 拉後）
 */
export function scoreSession({ taps, targets, tolMs, beatMs, targetOffsetMs = 0 }) {
  const shifted = targets.map((t) => ({ ...t, t: t.t + targetOffsetMs }));
  const winMs = tolMs * 2.5;
  const { hits, extras } = matchTaps(shifted, [...taps].sort((a, b) => a - b), winMs);
  const scored = hits.map((h) => ({
    ...h,
    score: h.err === null ? 0 : hitScore(h.err, tolMs),
    kind: h.target.kind,
  }));

  const errs = scored.filter((s) => s.err !== null).map((s) => s.err);
  const onErrs = scored.filter((s) => s.err !== null && s.kind === "on").map((s) => s.err);
  const offErrs = scored.filter((s) => s.err !== null && s.kind === "off").map((s) => s.err);

  const hit = scored.filter((s) => s.err !== null);
  const ratio = estimateSwingRatio(scored, beatMs);

  const accuracy = mean(scored.map((s) => s.score));
  const sigma = sd(errs);
  const consistencyScore = sigma === null ? null : clamp(100 * (1 - sigma / (2 * tolMs)), 0, 100);
  const total = accuracy === null ? 0
    : 0.6 * accuracy + 0.4 * (consistencyScore ?? accuracy);

  return {
    tolMs,
    nTargets: scored.length,
    nHits: errs.length,
    nMissed: scored.length - errs.length,
    nExtras: extras.length,
    accuracy: accuracy === null ? 0 : +accuracy.toFixed(1),
    consistencyScore: consistencyScore === null ? null : +consistencyScore.toFixed(1),
    total: +total.toFixed(1),
    grade: gradeOf(total),
    // 整體「pocket」：負 = 拉後（laid back），正 = 推前（on top）
    pocketMs: mean(errs) === null ? null : +mean(errs).toFixed(1),
    sigmaMs: sigma === null ? null : +sigma.toFixed(1),
    onPocketMs: mean(onErrs) === null ? null : +mean(onErrs).toFixed(1),
    offPocketMs: mean(offErrs) === null ? null : +mean(offErrs).toFixed(1),
    onSigmaMs: sd(onErrs) === null ? null : +sd(onErrs).toFixed(1),
    offSigmaMs: sd(offErrs) === null ? null : +sd(offErrs).toFixed(1),
    swingRatio: ratio === null ? null : +ratio.toFixed(2),
    scored,
  };
}

/**
 * 實測 swing ratio。
 *
 * 做法：唔用「相鄰三下」嘅間隔（華爾茲、ballad 呢啲 pattern 會爆），
 * 而係逐個後半拍，量佢落喺所屬四分音符嘅邊個位置：
 *   f = (tap_off − 該拍起點) / 一拍長度      → ratio = f / (1 − f)
 * 拍嘅邊界用「下一個正拍目標音」回推（正拍位置唔受後半拍影響），
 * 再整體加減正拍嘅平均偏移（pocket），令量到嘅係「相對」擺位而唔係整體拉後。
 * 最後取 median 抵抗離群值。
 */
export function estimateSwingRatio(hits, beatMs) {
  if (!beatMs) return null;
  const ons = hits.filter((h) => h.kind === "on").map((h) => h.target.t).sort((a, b) => a - b);
  if (!ons.length) return null;
  const onErrs = hits.filter((h) => h.kind === "on" && h.err !== null).map((h) => h.err);
  const pocket = onErrs.length ? median(onErrs) : 0;

  const rs = [];
  for (const h of hits) {
    if (h.kind !== "off" || h.err === null) continue;
    const qEnd = ons.find((t) => t > h.target.t);
    if (qEnd === undefined) continue;
    const qStart = qEnd - beatMs + pocket;
    const f = (h.tap - qStart) / beatMs;
    if (!(f > 0.08 && f < 0.92)) continue;
    rs.push(f / (1 - f));
  }
  return median(rs);
}

export function gradeOf(total) {
  if (total >= 92) return "S";
  if (total >= 84) return "A";
  if (total >= 74) return "B";
  if (total >= 60) return "C";
  return "D";
}

/**
 * 開場校正：跟住已知嘅 click 打 N 下，回傳「你嘅輸入比 click 遲幾多 ms」。
 * 正數 = 你嘅 tap 遲過 click（包括輸出延遲 + 你嘅反應 + 輸入延遲），
 * 之後所有 tap 都會減走呢個值。負數 = 你打前咗。
 */
export function calibrate(taps, clickTimes) {
  if (taps.length < 3 || clickTimes.length < 3) return null;
  const errs = [];
  const used = new Set();
  for (const c of clickTimes) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < taps.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(taps[i] - c);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < 250) { used.add(best); errs.push(taps[best] - c); }
  }
  if (errs.length < 3) return null;
  const m = median(errs);
  return {
    offsetMs: +m.toFixed(1),
    sdMs: sd(errs) === null ? null : +sd(errs).toFixed(1),
    n: errs.length,
    // 穩定度差 → 校準唔可信
    reliable: sd(errs) !== null && sd(errs) < 25,
  };
}

/** 文字回饋（粵語） */
export function feedback(r) {
  const out = [];
  if (r.pocketMs !== null) {
    if (r.pocketMs < -0.6 * r.tolMs) out.push(`整體拉後 ${Math.abs(r.pocketMs)}ms（laid-back）`);
    else if (r.pocketMs > 0.6 * r.tolMs) out.push(`整體推前 ${r.pocketMs}ms（on top）`);
    else out.push("整體正中拍心");
  }
  if (r.sigmaMs !== null) {
    if (r.sigmaMs < 0.5 * r.tolMs) out.push("穩定度好");
    else if (r.sigmaMs < 1.0 * r.tolMs) out.push("穩定度中等");
    else out.push("穩定度散，先減速再練");
  }
  if (r.offPocketMs !== null && r.onPocketMs !== null) {
    const d = r.offPocketMs - r.onPocketMs;
    if (d > 8) out.push("後半拍拖得比正拍後，swing 感偏重");
    else if (d < -8) out.push("後半拍比正拍前，swing 感偏平");
  }
  if (r.nMissed > 0) out.push(`漏咗 ${r.nMissed} 下`);
  if (r.nExtras > 0) out.push(`多咗 ${r.nExtras} 下`);
  return out;
}
