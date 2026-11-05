# Spike 004 — 用 mic 聽琴聲去評分（acoustic mode）

**問題**：除咗手指 tap，可唔可以直接聽鋼琴聲判斷每一下準唔準？

**結論：可以，但如果唔戴耳機就唔實際。** 量到嘅時間誤差中位數 ~9–13ms、p90 ~19ms，對比 120bpm swing 嘅容差 ±27ms 係夠用；難度全部喺「唔好偵測到拍子機自己嘅 click」。

## 點量

冇真琴，所以用 Chrome 嘅假音效裝置餵一段自己合成嘅「琴聲」入 mic：

```bash
node spikes/004-acoustic/gen-wav.mjs     # piano-test.wav：24 粒音，三個速度段落
node spikes/004-acoustic/cdp-mic.mjs     # 開 Chrome（--use-file-for-fake-audio-capture）跑 mic probe
node spikes/004-acoustic/analyze.mjs     # 掃 threshold、計 recall / 誤差
```

- 音檔：6 個諧波、指數衰減 400ms、attack 5ms、加 −56dB 底噪；段落 = 四分 500ms / 8 分 250ms / 16 分 125ms。
- 偵測：高頻譜通量（spectral flux，1.5–8kHz），AnalyserNode `fftSize 2048`，每 512 samples 取一次，自適應門檻 + 局部極大 + 最小間隔。
- 對齊：假裝置幾時開始播係未知，用「真值時間點嘅 flux 總和最大」搜出 offset（實測 55ms）。

## 量到嘅結果

| threshold | 偵測到 | recall | false positive | 中位誤差 | p90 誤差 | bias |
|---|---|---|---|---|---|---|
| 0.15 | 48 | 22/24 | 26 | 12.6ms | 18.9ms | +8.7ms |
| 0.30 | 37 | 21/24 | 16 | 11.6ms | 18.8ms | +7.7ms |
| 0.55 | 36 | 21/24 | 15 | 9.3ms | 18.7ms | +11.6ms |
| 0.90 | 35 | 21/24 | 14 | 9.3ms | 18.7ms | +11.6ms |

分段（threshold 0.15）：四分 7/7、8 分 6/7、16 分 7/7 —— **速度唔係限制**，因為 attack 嘅寬頻衝擊喺低音仲響緊嘅時候都分得出（純 RMS 能量法就死：四分 8/8、8 分 2/8、16 分 1/8，因為上一粒仲未衰減完）。

限制：frame 實際係 21.7ms（ScriptProcessor 512 @ 44.1kHz 有掉格），所以時間分辨率 ~±11ms；生產版應該用 AudioWorklet 128-frame（~3ms）＋亞 frame 插值。false positive 主要係同一粒音嘅諧波拍頻造成第二次 flux 峰，要加「同一粒音」後處理或者用 neural onset（e.g. `@spotify/basic-pitch`、CREPE 嘅 onset head）。

## 真正嘅難題

1. **拍子機自己嘅 click 會入 mic** → 每個目標音都會「自動命中」。解法：
   - 練習模式預設**要求戴耳機**（UI 直接寫明），或者
   - click 只用 count-in，練習段落完全冇 click（改用燈／震動做參考），或者
   - 用一個唔喺 pattern 頻段嘅標記音（如 4kHz 短 chirp）做 count-in，同時做**聲學延遲自動校準**：mic 收到自己嘅 chirp，就知道「輸出→空氣→mic」嘅 round trip，之後所有 onset 都用呢個 offset 校正。
2. **mic 延遲唔同 tap 延遲**：手機 mic 通常 50–150ms，desktop 10–30ms，而且唔會喺 `getOutputTimestamp()` 反映。必須獨立校準（上面嘅 chirp 方法最乾淨）。
3. **iOS Safari**：`getUserMedia` 要 HTTPS（GitHub Pages 已經係）；AudioWorklet 要 iOS 14.5+；藍牙耳機嘅 mic path 會再差幾十 ms。
4. **環境**：房間 reverb 會令 onset 變濛（尤其原聲鋼琴 + 大廳）；手機 AGC 要關（`autoGainControl:false`）。
5. **複音**：一次落三粒音只會偵測到一個 onset —— 但要嘅只係時間，所以冇問題；想知彈錯音就要 pitch detection（難度高一個數量級）。

## 建議

做成 **「Acoustic mode（beta）」**，同 tap mode 並存：

- 預設戴耳機；冇戴就彈警告，並建議只用 count-in click。
- count-in 用 4kHz chirp，順便自動量 round trip 延遲（比 tap 校準更貼近真實）。
- onset：AudioWorklet + spectral flux + 自適應門檻 + 最小間隔 60ms；同一粒音 30ms 內合併。
- 評分沿用同一套 `scoreSession`（taps 換成 onset 時間），所以 swing ratio / pocket / σ 全部照用。
- UI 上寫清楚「acoustic 模式誤差 ~±20ms，比 tap（±5ms）粗」，唔好假裝一樣準。
