# 003 — 端到端 prototype

## 問題

Given the validated clock + scoring model, when wired into a single-page app in a real browser,
then does a full session (count-in → taps → score → report) run without errors and report the
values the model predicts?

## 方法

`test-headless.mjs` 用 CDP 開 `http://127.0.0.1:8799/index.html`，用 `window.__spike`（app 內嘅測試掛鉤）
開 session、注入合成 tap、`finish()`、再讀 `__spike.result()`。五個情境 + 一個「目標偏移」情境。
`shots.mjs` 影三張截圖（設定 / 練習中 / 結果）。

## 結果

| 情境 | 總分 | 等級 | pocket | σ | ratio | 漏/多 |
|---|---|---|---|---|---|---|
| σ8 正中（swing 1:2.0）| 92.6 | S | +0.9 | 8.5 | 2.06 | 0/0 |
| σ28 | 66.5 | C | −0.8 | 23.3 | 1.84 | 2/2 |
| σ9 拉後 18ms | 85.6 | A | −16.8 | 8.0 | 1.96 | 0/0 |
| Bossa（目標平直）| 96.0 | S | −0.5 | 7.1 | 1.01 | 0/0 |
| Jazz waltz | 81.4 | B | −0.9 | 14.5 | 2.19 | 0/0 |
| 拉後 25ms + 目標偏移 −25ms | 92.9 | S | +0.5 | 8.5 | 1.93 | 0/0 |

JS error：0。`node test-headless.mjs` 全部斷言 PASS。

`midi` 狀態報「唔支援」— headless Chrome 冇 Web MIDI（真 Chrome 有），所以 MIDI 路徑只做過代碼審視，未做過自動化測試。

## Verdict: VALIDATED

### What worked
- 由音訊排程、count-in、tap 捕獲、即時統計到結果頁，成條路喺真瀏覽器跑得通。
- 所有量出嚟嘅數字同模型預測一致（pocket、σ、ratio 都喺預期範圍）。
- 平直 feel（bossa）正確報 ratio 1.01，唔會硬套 swing。

### What didn't
- Web MIDI 喺 headless 用唔到 → MIDI 路徑未經自動化驗證。
- UI 只做過截圖目視檢查，未做真人試玩。

### Surprises
- 華爾茲因為每小節只有一個後半拍，4 小節只得 4 個樣本，ratio 波動偏大（2.19）→ 短 pattern 要更多小節。
- 和弦（comping 一次三四粒音）會令 MIDI 每粒音都算一下 tap，所以要有 35ms dedupe，否則「多拍」爆表。

### Recommendation for the real build
- 保留 `window.__spike` 測試掛鉤（成本低，回報大）。
- 正式版要真人 + 真 MIDI 試玩；尤其要驗證裝置延遲補償同 iOS 觸控。
