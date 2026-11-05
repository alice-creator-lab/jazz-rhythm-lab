// 產生一段「似琴聲」嘅測試音檔：三個速度段落，每段 8 粒音
import { writeFileSync } from "node:fs";
const SR = 48000, DUR = 10;
const n = SR * DUR;
const buf = new Float32Array(n);
const sections = [
  { at: 0.5, gap: 0.5, count: 8 },   // 120bpm 四分
  { at: 5.0, gap: 0.25, count: 8 },  // 8 分
  { at: 7.5, gap: 0.125, count: 8 }, // 16 分
];
const truth = [];
for (const s of sections) {
  for (let i = 0; i < s.count; i++) {
    const t = s.at + i * s.gap;
    truth.push(+t.toFixed(4));
    const start = Math.floor(t * SR);
    const f0 = 440 * (1 + 0.02 * ((i % 3) - 1));
    for (let k = 0; k < SR * 0.4 && start + k < n; k++) {
      const tt = k / SR;
      const env = Math.exp(-tt * 7) * (1 - Math.exp(-tt * 400));
      let v = 0;
      for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f0 * h * tt) / h;
      buf[start + k] += 0.22 * v * env;
    }
  }
}
// 加少少底噪
for (let i = 0; i < n; i++) buf[i] += (Math.random() - 0.5) * 0.0015;

const data = Buffer.alloc(44 + n * 2);
data.write("RIFF", 0); data.writeUInt32LE(36 + n * 2, 4); data.write("WAVE", 8);
data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
data.write("data", 36); data.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(buf[i] * 32767))), 44 + i * 2);
writeFileSync(new URL("./piano-test.wav", import.meta.url), data);
writeFileSync(new URL("./truth.json", import.meta.url), JSON.stringify(truth));
console.log("wrote piano-test.wav", (data.length / 1024).toFixed(0) + "KB", "notes:", truth.length);
