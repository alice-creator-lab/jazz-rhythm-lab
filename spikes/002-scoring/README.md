# 002 — 評分模型：分得出 swing 嗎？

## 問題

Given taps with human jitter (σ 5–30ms), when scored against a swing grid,
then can the app (a) recover the player's swing ratio, (b) tell 1.5 / 2.0 / 2.5 apart,
and (c) rank playing quality sensibly?

## 方法

`jazz-core.js`（純 logic，無 DOM）＋ `sim.mjs`（seeded 高斯抖動模擬，唔需要瀏覽器）。

評分設計：
- `err = tap − target`（target 可整體偏移，代表「目標 pocket」）。
- 單下得分：`|err| ≤ 0.4·tol` 100 分 → `tol` 時 70 分 → `2·tol` 時 0 分。
- `tol = clamp(0.16 × min(最短相鄰音符, 一拍), 15ms, 45ms)`。
- swing ratio：逐個後半拍量 `f = (tap_off − 該拍起點) / 一拍長`，`ratio = f/(1−f)`，取 median。
  （唔用「連續三下之間隔」— 華爾茲 / ballad 嘅 pattern 會爆，實測過會報 5.28。）

## 結果

估 swing ratio（目標 2.0，4 小節，20 次）：

| σ | 中位數 | 範圍 |
|---|---|---|
| 4ms | 2.00 | 1.92–2.06 |
| 12ms | 2.00 | 1.77–2.19 |
| 20ms | 2.01 | 1.63–2.33 |
| 30ms | 2.00 | 1.50–2.32 |

分辨 1.5 / 2.0 / 2.5（σ=12ms）：1 小節 78%、2 小節 91%、4 小節 96%、8 小節 100%。

分數 vs 抖動：σ5 → 97.1、σ10 → 93.6、σ18 → 85.2、σ28 → 72.1；拉後 25ms（σ10）→ 74.0；
目標偏移設 −25ms 後同一個演奏 → 92.9。

容差窗口：60bpm ballad 45ms、120bpm swing 26.7ms、200bpm 18.5ms、260bpm 15ms。

## Verdict: VALIDATED

### What worked
- 估 swing ratio 無系統偏差，σ 到 30ms 都冇偏。
- 4 小節已經有 96% 分辨率，足夠做「你嘅 swing 係 1:1.9，目標 1:2.0」呢種回饋。
- 分數同 σ 單調對應，等級分得開「穩」同「散」。
- 「整體拉後」同「唔穩」分開報：pocket 同 σ 係兩個獨立數字，目標偏移可以由用家調。

### What didn't
- 1 小節嘅 ratio 只有 78% 準 — 一定要設最低樣本量，否則會亂報。
- 高速（260bpm）tol 得 15ms，比觸控抖動仲細，分數會偏嚴（MIDI 冇問題）。

### Surprises
- 「相鄰三下」嘅 ratio 公式喺華爾茲／ballad 會報到 5.28（因為後半拍之後嘅正拍唔係同一拍）。改成「量後半拍喺所屬拍內嘅位置」之後所有 feel 都通。
- 全部一致地拉後 25ms 會由 S 掉到 C — 呢個係設計選擇，唔係 bug；所以 UI 一定要有「目標偏移」。

### Recommendation for the real build
- ratio / σ 回饋最少 4 小節才出；8 小節才講「穩定度」。
- tol 跟最短音符間隔縮放，但底下要留 15ms 地板，並且喺 UI 講清楚。
- 保留「目標偏移」滑桿：jazz 嘅 laid-back 係要練嘅，唔應該一律當錯。
