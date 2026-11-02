# 001 — 音訊時鐘精度

## 問題

Given a browser page using Web Audio, when I schedule a click at `t` and timestamp a tap,
then can I resolve both to ≤ 5ms?

拆成四條子問題：
1. 排程嘅 audio event 有冇落在指定 sample？
2. 讀 `AudioContext.currentTime` 嘅粒度有幾大？
3. 可唔可以用 `getOutputTimestamp()` 把 `performance.now()` 映射去 audio 時鐘？噪聲幾大？
4. Lookahead scheduler 喺 main thread 抖動下會唔會排到過去（= 甩拍）？

## 方法

`probe.html` + `measure.mjs`（自寫 CDP driver，headless Chrome 149 / Linux / 44.1kHz null sink）：

- 用 `OfflineAudioContext` render 8 個非整數時間嘅 click，逐個找回第一個非零 sample，量誤差。
- 連續讀 `currentTime` 250ms，統計每次跳變嘅步長。
- 200ms 內每 100ms 取 `getOutputTimestamp()` 同 `currentTime`，比較「正在聽到」同「正在 render」嘅差。
- 25ms tick / 100ms lookahead 跑 3 秒，記錄每個 event 排程時距離播放嘅提前量。
- 用 CDP `Input.dispatchKeyEvent` 送 12 個真 key event，量 `event.timeStamp` 同 handler 內 `performance.now()` 嘅差。

## 結果

| 項目 | 實測 |
|---|---|
| render 誤差 | −0.025 … +0.025 ms（sample-exact，1 sample = 0.023ms）|
| `currentTime` 步長 | 2.9025 / 5.805 / 8.707 / 11.61 ms（128 frames 嘅倍數）|
| `getOutputTimestamp` 映射噪聲 | σ 3.18 ms，平均值 −35.5 ms（null sink，真機未驗）|
| `performance.now()` 解析度 | 0.1 ms |
| scheduler | 60 events，最早提前 69.07ms，最遲 99.95ms，**0 個排到過去** |
| key `event.timeStamp` → handler | 中位 0.5 ms（首下 21.9ms 係 warm-up）|
| audio clock vs wall clock | +295 / −682 ppm（兩個 run 差好遠 → null sink 時鐘唔可信；真機一般 20–200ppm）|

## Verdict: PARTIAL

### What worked
- 聲音路徑完全冇問題：event 落 sample，誤差細過 1 個 sample。
- Lookahead scheduler 喺 2 核 VM + headless 下都冇試過排到過去，100ms 提前量綽綽有餘。
- 軟件層嘅輸入時間戳（`event.timeStamp`）誤差 0.5ms，可以當免費。

### What didn't
- `currentTime` 讀數只有 ~2.9ms 粒度，直接當 tap 時間戳會把量化噪聲入落評分（容差 27ms 嘅一成）。
- `getOutputTimestamp()` 喺 headless null sink 下行為唔可信（輸出延遲報 0、平均值 −35ms、漂移數字亂跳），**真機精度未驗**。

### Surprises
- 「正在 render」同「正在聽到」差 35ms — 如果用 `currentTime` 做 tap 時間戳，所有分數會系統性偏遲一個 outputLatency，而且隨裝置改變。
- audio 時鐘同牆鐘嘅漂移喺呢個環境大到幾百 ppm，即 10 分鐘可以差 0.2 秒；一定要用 audio 時鐘，唔可以牆鐘累加。

### Recommendation for the real build
- 排程用 `audioContext.currentTime` + 100ms lookahead（唔使改）。
- tap 時間戳一律經 `getOutputTimestamp()` 映射，`performanceTime` 唔可用時 fallback 去 `currentTime − outputLatency`。
- 每次 session 開始重新取時間基準；唔好跨 session 累加。
- **必須**做用戶校準，並且要喺真機（USB MIDI / 內建鍵盤 / 觸控 / 藍牙）各量一次實際 latency。
