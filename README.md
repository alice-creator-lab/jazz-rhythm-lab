# Jazz 拍子實驗室 — 可行性研究（spike）

**問題**：jazz 嘅「拍子」同 classical 唔同 — 唔係對死一個 grid，而係**後半拍擺喺邊**（swing ratio）、**每一下穩唔穩**（σ）、同**整體拉後幾多**（pocket / laid-back）。
**問**：可唔可以喺瀏覽器做一個練習 app，逐下量到呢三樣嘢並評分？
**答**：**可以**。已經有一個跑得嘅 prototype，同三組實測數據支持。

| # | Spike | 驗證咗咩 | 結論 |
|---|---|---|---|
| 001 | 音訊時鐘精度 | 排程誤差、時鐘量化、輸入時間戳噪聲 | **PARTIAL**：排程 sample-exact（±0.025ms）、scheduler 唔會甩拍；但 `getOutputTimestamp` 喺 headless 唔可信，真機輸入延遲要另測 |
| 002 | 評分／swing ratio 估算 | 合成 tap 下估得到 swing 比例、分得出 1.5 / 2.0 / 2.5 | **VALIDATED**（σ≤20ms 無偏差；4 小節 96% 分辨率）|
| 003 | 可操作 prototype | 真 Chrome 開 app、跑 session、計分、出報告 | **VALIDATED**（headless 斷言全過，見 `spikes/003-prototype/test-headless.mjs`）|

---

## 1. 為什麼 jazz 要用另一套評分

古典練習 app 通常咁評分：tap 對唔對到格 → 誤差 < X ms 就滿分。呢個對 jazz 有三個問題：

1. **後半拍唔喺 50%**。Swing 8 分係長─短，medium tempo 大約 1.5:1–2.2:1（即後半拍落在每拍 60%–69% 位置）。用「平均格」去評分會把正確嘅 swing 當成錯。
2. **一致嘅「拉後」係風格，唔係錯**。研究量到職業爵士鋼琴家嘅 downbeat 平均遲 30ms 左右（≈150bpm 時四分音符嘅 9%，見 Nelias et al. 2022, *Commun Phys* 5:237）。全部一致地拉後 = 有 pocket；忽前忽後 = 唔穩。所以「平均偏差」同「標準差」要分開報。
3. **後半拍本身有獨立嘅穩定度**。Swing feel 死喺後半拍，唔係正拍。所以 σ 要分開計 on-beat / off-beat。

呢個 app 就係照呢三點設計：`pocket`（平均偏差，負 = 拉後）、`σ`（穩定度）、`swing ratio`（實測 vs 目標）。

## 2. 實測數據（spike 001：瀏覽器時鐘夠唔夠準？）

喺 headless Chrome 149（Linux，44.1kHz null sink）跑 `spikes/001-audio-clock/measure.mjs`：

| 項目 | 實測 | 意義 |
|---|---|---|
| 排程落 sample 嘅誤差 | −0.025 ~ +0.025 ms | `OscillatorNode.start(t)` 係 sample-exact（1 sample = 0.0227ms），音本身冇抖 |
| `AudioContext.currentTime` 粒度 | 2.9025 ms（= 128 frames @44.1k），只會跳 2.9 / 5.8 / 8.7 ms | **唔可以**用 `currentTime` 直接做 tap 時間戳，量化誤差已經佔容差一成 |
| `performance.now()` 解像度 | 0.1 ms | 夠用 |
| 用 `getOutputTimestamp()` 映射 perf → audio | 噪聲 σ ≈ 3.2 ms（headless null sink） | 映射本身有幾 ms 抖，但遠細過人手抖動（σ 10–25ms） |
| 排程 lookahead（25ms tick / 100ms 提前） | 60 個 event，最遲提前 69ms，**0 個排到過去** | 一般 CPU 抖動唔會甩拍 |
| 音訊時鐘 vs 牆鐘漂移 | headless 下 295 ~ −682 ppm（唔可信，null sink 係合成時鐘）| 真機一般 20–200ppm；所以每次練習都要**重新錨定**，唔可以靠牆鐘累加 |
| 鍵盤 `event.timeStamp` vs handler 內 `performance.now()` | 中位 0.5 ms（首下 22ms 係 warm-up） | 軟件路徑可忽略，真正延遲喺硬件／OS |

**結論**：聲音可以做到 sample-exact；量度誤差嘅瓶頸唔係程式，而係**硬件輸入/輸出延遲**（鍵盤 5–30ms、觸控 50–100ms、USB MIDI 1–5ms、藍牙 MIDI 20–40ms）。所以校準係必需功能，唔係選項。

## 3. 評分可唔可信？（spike 002：合成 tap 模擬）

`spikes/002-scoring/sim.mjs`：用高斯抖動模擬人手，跑返同一套評分核心。

**a) swing ratio 估得返上唔上**（中速 swing，目標 1:2.0，4 小節）

| 人手抖動 σ | 估到嘅 ratio（中位數） | 20 次範圍 | 準確度分 |
|---|---|---|---|
| 4 ms | 2.00 | 1.92–2.06 | 100 |
| 8 ms | 2.00 | 1.84–2.12 | 98.6 |
| 12 ms | 2.00 | 1.77–2.19 | 95.2 |
| 20 ms | 2.01 | 1.63–2.33 | 84.5 |
| 30 ms | 2.00 | 1.50–2.32 | 69.9 |

**無系統偏差**：σ 到 30ms 個中位數都仍然係 2.00，只係每個 session 嘅範圍變闊。

**b) 分唔分得出 1.5 vs 2.0 vs 2.5**（σ = 12ms，即普通人嘅水平）

| 練習小節數 | 1.5 → 估 | 2.0 → 估 | 2.5 → 估 | 分辨正確率 |
|---|---|---|---|---|
| 1 | 1.54 | 2.02 | 2.49 | 78% |
| 2 | 1.52 | 1.98 | 2.54 | 91% |
| 4 | 1.50 | 2.03 | 2.56 | **96%** |
| 8 | 1.50 | 2.02 | 2.55 | **100%** |

→ **產品規則：最少 4 小節才報 swing ratio，8 小節才報「穩定」。** 1 小節就報會誤導。

**c) 分數有冇 discriminates**

| 演奏 | 總分 | 等級 | 量到 pocket |
|---|---|---|---|
| σ 5ms，正中 | 97.1 | S | −1.1ms |
| σ 10ms，正中 | 93.6 | S | −2.2ms |
| σ 18ms，正中 | 85.2 | A | −4.0ms |
| σ 28ms，正中 | 72.1 | C | −6.2ms |
| σ 10ms，全部拉後 25ms | 74.0 | C | −27.2ms |
| σ 10ms，全部推前 60ms | 37.1 | D | +56.1ms |

同一個「拉後 25ms」嘅演奏，把「目標偏移」設成 −25ms 之後 → **92.9 分 S 級**（headless 實測）。即係話：**工具要分得開「有 pocket 嘅拉後」同「唔穩」**，而呢個係用家自己揀嘅目標。

## 4. Prototype（spike 003）

單頁 web app，`index.html` + `app.js` + `jazz-core.js`（純 logic，瀏覽器同 Node 共用）：

- 7 個 feel：中速 swing（spang-a-lang）、快速 2-feel、ballad、jazz waltz、bossa、charleston comping、straight/funk
- 輸入：鍵盤任何鍵 / 觸控 pad / **Web MIDI**（數碼鋼琴、電鋼；和弦自動 dedupe 35ms）
- 校準：跟 8 下 click 打，計出「你嘅輸入比 click 遲幾多」並之後扣返
- 即時：最後一下偏差、running pocket、σ、swing ratio；每粒音上色（綠/黃/紅）
- 結果：等級 + pocket + σ（正拍／後半拍分開）+ 實測 swing vs 目標 + 漏拍/多拍 + 連續 12 次trend
- 容差：`tol = clamp(0.16 × min(最短音符間隔, 一拍), 15ms, 45ms)`（60bpm ballad 45ms、120bpm swing 27ms、260bpm 15ms）

Headless 驗證（`node spikes/003-prototype/test-headless.mjs`，真 Chrome）：

| 情境 | 結果 |
|---|---|
| σ=8ms 正中 | 92.6 分 S，pocket +0.9，σ 8.5，ratio 2.06，0 漏 0 多 |
| σ=28ms | 66.5 分 C，σ 23.3（分數明顯低過上面）|
| σ=9ms 拉後 18ms | 85.6 分 A，pocket −16.8（準確量到）|
| Bossa（平直） | 96.0 分 S，ratio 1.01（正確報「冇 swing」）|
| Jazz waltz | ratio 2.19（12 下只有 4 個後半拍，樣本少，偏差合理）|
| 拉後 25ms + 目標偏移 −25ms | 92.9 分 S |
| JS errors | 0 |

## 5. 限制／風險（老實講）

1. **硬件延遲主導誤差**。藍牙耳機 + 藍牙 MIDI 可以疊加 60–120ms；校準可以吸收固定偏移，但吸收唔到抖動。App 應該偵測並提示「用有線耳機 / USB MIDI」。
2. **`getOutputTimestamp` 嘅真機精度未驗**。呢次係 headless null sink（σ≈3ms、漂移數字不可信）。要真人 + 真音效卡再測一次，用 loopback（輸出 → 輸入）量實際 round-trip。
3. **iOS Safari 冇 Web MIDI**（要用觸控，延遲大；iPhone 上只可以當「感覺練習」而唔係精準評分）。
4. **速度越快容差越緊**：260bpm 時 tol 只剩 15ms，比一般手機觸控抖動仲細 → 高速練習只適合 MIDI。
5. **「對唔對」同「好唔好聽」唔完全同一件事**。呢個 app 量到嘅係時值，量唔到 articulation、dynamic accent（hi-hat 2/4、ride 嘅輕重）。將來要加入力度（MIDI velocity 已經有）。
6. **校準假設延遲穩定**。系統更新、換耳機、換瀏覽器 tab 都要重做。

## 6. 如果正式做（建議次序）

**Phase 1（1–2 日，已有 90%）**：把 prototype 變成可收藏嘅 PWA，加：練習紀錄（per-feel 最佳分）、分開 on/off beat 嘅 σ 趨勢、藍牙延遲警告、`getOutputTimestamp` 用唔到時嘅 fallback。
**Phase 2**：用真機量 input latency（USB MIDI / 內建鍵盤 / 觸控，各 30 次），把量到嘅數字寫成「校準建議」；加埋 loopback 自我測試頁。
**Phase 3**：加 lesson 結構（先 4 小節達標才加 bars／提速）、加力度評分、加「跟 backing track」（ii-V-I 或 12-bar blues 循環）而唔止 click。

**未做／唔喺呢個 spike 範圍**：真機延遲量測、iOS 測試、用戶帳戶／雲端同步、多聲部（左手 comping + 右手旋律同時評分）。

## 7. 實機回饋修正（iOS Safari）

實際用家喺 Safari 試玩後報咗三個問題，已修並加測試（`spikes/003-prototype/test-audio-stop.mjs`）：
1. **tap 變 double-tap 放大** → 打拍子區 `touch-action: none`、其餘 `manipulation`，加 `user-select: none`／`-webkit-touch-callout: none`。
   教訓：iOS Safari 嘅 double-tap zoom 唔受 `preventDefault()` 控制，只受 CSS `touch-action` 控制。
2. **停咗仲有聲** → 原本 `finish()` 只 cancel 畫面 loop，已經排入 audio graph 嘅 click 同 `setInterval` scheduler 照跑。
   修法：keep 一組 live `OscillatorNode`，停嘅時候清 queue、`clearInterval`、逐個 `stop(0)` + `disconnect()`。
   教訓：Web Audio 嘅 event 一排咗就收唔返，一定要自己保存 handle 才停得到。
3. **揀 feel 後想聽示範** → 揀 chip 即播一個 bar（前面加一下數拍，後半拍細聲啲），一個 bar 後自動收工；再揀另一個 chip 會先停上一個。

驗證：`test-audio-stop.mjs` 量到 `touch-action` 係 `none`／`manipulation`、preview 一個 bar 後 queue／scheduler／oscillator 全部歸零、練習中途停同樣即刻歸零、停後 1.2 秒仍然零、0 個 JS error。

## 8. 基本拍子計數 + 亮燈（第二次回饋）

用家要一個「最基本」嘅視覺層：`1 & 2 & 3 & 4 &`，每格下面標 **LONG / short**，同埋揀 style 嘅時候要有燈睇得到拍點。

- 頂部常駐「基本拍子計數」卡：每拍兩格（正拍 + 後半拍），拍號自動跟 feel（4/4 → 8 格、3/4 → 6 格）。
- 格下面嘅字由 swing 比例計出嚟：`feel.swing > 1.05` → 正拍 `LONG`、後半拍 `short`；平直 feel（bossa / funk）→ 兩邊都 `even`。
- 該 feel 冇打嘅位置（例如 spang-a-lang 嘅 1&、3&）會變暗，一睇就知 pattern 嘅形狀。
- 亮燈由**音訊時鐘**驅動（唔係 setTimeout）：`scheduleLights()` 記住每個 click 嘅 audio 時間，rAF 比較 `audioNowMs()` 去亮格，所以燈同聲係同一個時基。正拍亮琥珀色、後半拍亮綠松色，LONG/short 嘅分別一眼睇得出。
- 揀 chip → **兩個 bar** 嘅示範（唔加數拍，第一下就係第一拍）+ 同步亮燈，兩個 bar 後自動停；練習時 count-in 同每一粒目標音都會亮。

兩個更基礎嘅 pattern（用家指定嘅 long/short 組合）：

| id | 名 | 拍點 | pattern |
|---|---|---|---|
| `basic-a` | 基本節奏 A | 1, 2&, 3, 4 | LONG short LONG LONG |
| `basic-b` | 基本節奏 B | 1, 2, 3&, 4 | LONG LONG short LONG |

（決策：`short` 一律解讀成「嗰一拍嘅後半拍」（`&`），即該拍唔打正拍、打後半拍。如果原意係「短音打喺拍頭」，改 `pattern` 一行就可以。）

測試 `test-counts.mjs`（真 Chrome）：4/4 = 8 格、標籤 `1&2&3&4&`、LONG/short 逐格交替；華爾茲 = 6 格；bossa 全部 `even`；示範排到 **12 盞燈（2 bars × 6，冇多一粒數拍）**；兩個 bar 後燈燒完、queue／scheduler／oscillator 歸零；基本節奏 A/B 嘅亮格分別係 `0,3,4,6` 同 `0,2,5,6`；0 JS error。390px 闊亦做過目視檢查（媒體查詢收細字級，冇橫向溢出）。

## 9. 第三次回饋：明明打啱都冇燈、好低分

報告：「明明無漏拍佢都無著燈同好低分」。重現方法：用合成 tap 模擬**整體遲 120–250ms**（藍牙耳機／未校準嘅裝置延遲），結果係：

| 偏移 | 修之前 | 修之後 |
|---|---|---|
| 0 ms | 100 分 | 100 分 |
| 60 ms | 40 分 D | 100 分 S（偵測 60ms）|
| 180 ms | **56.6 分 D，17 漏 17 多，冇 ratio** | **88 分 A，0 漏 0 多，ratio 1.97**（偵測 175ms）|
| 250 ms | **0 分，24 漏 24 多** | 100 分 S（偵測 250ms）|

三個原因同修法：

1. **配對窗口太窄**（原本 `tol × 2.5` ≈ 67ms）。延遲 180ms 時每個 tap 都配唔上目標 → 全部變「漏拍 + 多拍」。而家先用**偏移搜索**（−300…+300ms，5ms 一格）估系統性偏移：逐個候選計「有幾多下落入容差」，同分就揀平均誤差最細、再揀最細偏移；只有偏移 ≥ 50ms、命中 ≥ 3、而且 σ ≤ 70ms（唔係亂打）才接納。
2. **冇燈係因為 `paintHit` 直接 return**（誤差 > tol×2.5 就唔畫）。而家**一定**會亮最近嘅格，綠／黃／紅 + 顯示誤差數字，所以打錯都有反應。
3. **用戶唔知係延遲**：結果頁新增「偵測到嘅系統偏移」＋「用呢個偏移做校準」一鍵按鈕，練習中亦會提示「已自動對齊 遲 175ms（建議校準）」。另外底部有診斷行（時鐘路徑 OTS／fallback、outputLatency、baseLatency、取樣率、校準值），方便用戶截圖回報。

另外 `getOutputTimestamp()` 加咗合理性檢查：如果映射結果同 `currentTime` 相差超過 1 秒（Safari 有機會回 0 或亂值），就轉用 `currentTime − outputLatency`，並在診斷行顯示 `fallback`。

測試：`test-headless.mjs` 新增 180ms 延遲情境，斷言 `align ≈ 180 ± 20`、總分 > 80、0 漏拍；原有 8 個情境（準／散／拉後／bossa／華爾茲／目標偏移）全部仍然 PASS。

## 10. 第四次回饋：double-tap 放大又返嚟

第一次只加咗 `.tap-pad{touch-action:none}`，喺 Chrome 量到係 `none`，但 iPhone 上照樣縮放。原因：**iOS Safari 嘅 double-tap zoom 唔係由 `touch-action` 單獨決定**，佢係一個手勢判定，最可靠嘅抑制點係 `touchstart` 入面 `preventDefault()`（要 `{passive:false}`）；而且用家好可能唔係打正個 pad（打咗去 lane／旁邊），嗰啲位置只有 `manipulation`。

而家四層一齊做（v6）：

1. `<meta viewport>` 加 `maximum-scale=1, user-scalable=no`。
2. `.tap-pad{touch-action:none}`；**練習期間 `body.playing{touch-action:none}`**（`startSession()` 加、`finish()` 移除）。
3. `document.addEventListener("touchstart", …, {passive:false})`：喺練習區／pad 上 `preventDefault()`，iOS 順便喺呢度收拍子（同 `pointerdown` 撞嘅話由 35ms chord dedupe 合併），按鈕（停、chips）除外。
4. `dblclick` 一律 `preventDefault()`，另外 `pointerdown` 由「只食 pad」擴大到「整個練習區」（撳 lane 都算），但唔會食到掣。

加咗 **版本 chip（`v6`）喺標題旁**，因為 Safari 會好硬咁 cache：見到 `v6` 就代表載到新 build，否則就係舊 cache（唔好用「又壞咗」去 debug 一個根本未載入嘅版本）。

測試 `test-touch.mjs`（iPhone 模擬：390×844、dpr 3、touch emulation）：viewport 有 `maximum-scale=1`、練習中 `body` 同 pad 都係 `touch-action:none`、pad／lane 嘅 `touchstart` 被 `preventDefault`、停掣唔會被攔、撳 lane 計得到一下 tap、收工後 `playing` class 移除、0 JS error。

## 11. 第五次回饋：「短後面個長就 sense 唔到」

用家講嘅位置係 `LONG short LONG LONG` 裡面 2& → 3 嗰下（110bpm 只差 182ms）。呢個位有兩個可能成因，兩個都補咗：

**(A) 聽唔出／感覺唔到**——之前所有 click 音色一模一樣，短同長之間得 182ms，好易糊成一嚿。而家 click 音色跟 pattern 走：
- `on`（LONG）→ 660Hz + 1320Hz、衰減 100ms，低、長、厚
- `off`（short）→ 1040Hz + 2080Hz、衰減 38ms，高、短促
- `sub`（細分參考）→ 1500Hz 單音、衰減 22ms、音量 0.16

另外加咗 **「細分 tick」開關**：開咗之後 `1 & 2 & 3 & 4 &` 每一格都有聲（pattern 冇打嘅格用細細聲嘅 `sub`），所以「短」同「長」之間嗰格聽得到，唔會斷咗條線。

**(B) app 收唔到嗰下拍**——練習中新增 `已收 N / 目標 M 下`（同埋 `合併咗 N 下（當和弦）`）。咁就可以一眼分得出係「app 冇收到」定「收到但評錯」。

順帶查過嘅嘢（都唔係成因）：`scoreSession` 對 2& → 3 冇系統性偏差（模擬 4 小節人性抖動：0 漏拍、總分 80.7）；自動對齊喺 σ=30/38/45 之下 40 個種子全部冇誤觸發（σ=55 只有 1/40 跳到 50ms）。

版面：LONG 點喺上排（top 46px）、short 點喺下排（top 74px），最短間隔 182ms 喺 390px 機身大約 14px 水平 + 28px 垂直，仍然分得開。

## 12. 第六次回饋：唔要長短唔同音色

用家：「唔鍾意轉左長短的音，唔關個音事」→ 即刻 rollback：**目標音（LONG 同 short）一律回復同一個 click 聲**（830/1660Hz、衰減 85ms），只保留 downbeat accent；`sub` 細分參考改為**同一個音高、只係細聲同短**（vol 0.32），唔會再聽落似另一件樂器。

既然唔關聲事，就當係**視覺**去修：

- 練習時間軸由 2 bars 收窄到 **1 bar**（`viewMs()`）：182ms 嘅「短→長」距離由 14px 變成約 28px，加上上下兩排（on 46px / off 74px）就分得開。
- 點由 14px 加大到 17px。
- **下一個目標有淡淡光環**（`.dot.next`），望得到下一步。

保留上一版嘅 `已收 N / 目標 M 下` 計數器，因為佢係分「輸入冇收到」同「評分話唔準」嘅唯一方法。

## 13. 第七次回饋：揀 style 唔再示範、chips 分組

- **揀 chip 唔再自動示範**（連亮燈都唔會排），要聽就撳新加嘅 **「試聽 2 小節」** 掣 —— 明確、唔會次次揀都被迫聽一次。
- **chips 分組**：`基礎`（基本 A–D）、`進階`（中速 Swing／快速 Swing／Ballad／Charleston）、`其他風格`（Jazz Waltz／Bossa／Straight-Funk）。實作係 `FEELS[].group` + `renderFeels()` 逐組砌 `.gname` + `.feelgrid`。
- 補齊 **基本 C、D**：
  | id | pattern | 拍點 |
  |---|---|---|
  | `basic-c` | LONG short LONG short | 1, 2&, 3, 4& |
  | `basic-d` | LONG LONG LONG short | 1, 2, 3, 4&（4& 提前入下一小節）|
- 預設 feel 改為 `basic-a`（110bpm），因為「基礎」擺第一組；開機時 `syncSetupControls()` 會將 slider 同 state 對齊（之前 slider 寫死 120 而 hint 寫 110，兩邊唔一致）。

測試 `test-counts.mjs` 加咗：開機 slider/bpm 標籤/state 三者一致、預設係 `basic-a`、**撳 chip 之後 0 盞燈**（證明唔會自動示範）、撳「試聽 2 小節」之後排 12 盞燈（2 bars × 6，冇數拍 click）。

## 14. 點跑


```bash
cd jazz-rhythm-spike
python3 -m http.server 8799        # 開 http://127.0.0.1:8799/
node spikes/002-scoring/sim.mjs    # 評分模型模擬（唔需要瀏覽器）
node spikes/003-prototype/test-headless.mjs   # 真 Chrome 端到端斷言（需要上面個 server）
node spikes/003-prototype/test-audio-stop.mjs # touch-action / 停聲 / 一個 bar 示範
node spikes/003-prototype/test-counts.mjs     # 計數格 + LONG/short + 亮燈
node spikes/003-prototype/shots.mjs           # 影截圖去 shots/
```

檔案：`jazz-core.js` 拍子網格／評分／swing ratio；`app.js` 音訊排程同 UI；`spikes/001-audio-clock/` 時鐘量測；`spikes/002-scoring/` 模擬；`spikes/003-prototype/` 端到端測試同截圖。
