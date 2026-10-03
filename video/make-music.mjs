// Synthesises the film's music bed — no samples, no licences.
// 100 BPM: warm pad chords (Cmaj9 → Am9 → Fmaj9 → G6/9, one bar each),
// a soft sub "heartbeat" on beats 1 and 3, and quiet off-beat hats.
//   node make-music.mjs [seconds]      → public/music.wav
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SR = 44100
const BPM = 100
const BEAT = 60 / BPM
const BAR = BEAT * 4
const SECONDS = Number(process.argv[2] ?? 40)
const N = Math.floor(SR * SECONDS)

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)
// Voicings in MIDI, spread wide so the pad sounds open, not muddy.
const CHORDS = [
  [48, 55, 64, 71, 74], // Cmaj9
  [45, 52, 60, 67, 71], // Am9
  [41, 48, 57, 64, 67], // Fmaj9
  [43, 50, 59, 64, 69], // G6/9
]

const L = new Float32Array(N)
const R = new Float32Array(N)

// Pad: three slightly detuned triangle-ish voices per note, slow attack/release.
const tri = (p) => 1 - 4 * Math.abs(((p / (2 * Math.PI)) % 1) - 0.5)
for (let i = 0; i < N; i++) {
  const t = i / SR
  const bar = Math.floor(t / BAR)
  const inBar = t - bar * BAR
  const chord = CHORDS[bar % CHORDS.length]
  const next = CHORDS[(bar + 1) % CHORDS.length]
  // Crossfade the last 0.6 s of each bar into the next chord.
  const xf = Math.min(1, Math.max(0, (inBar - (BAR - 0.6)) / 0.6))
  let l = 0, r = 0
  for (const [notes, w] of [[chord, 1 - xf], [next, xf]]) {
    if (w <= 0) continue
    for (let n = 0; n < notes.length; n++) {
      const f = hz(notes[n])
      for (const [d, pan] of [[-0.11, 0.3], [0, 0.5], [0.13, 0.7]]) {
        const s = tri(2 * Math.PI * f * (1 + d / 100) * t) * w / (notes.length * 3)
        l += s * (1 - pan); r += s * pan
      }
    }
  }
  // Gentle swell over the first beats, so the film opens on movement, not silence.
  const intro = Math.min(1, t / 1.2)
  L[i] += l * 0.32 * intro
  R[i] += r * 0.32 * intro
}

// One-pole low-pass on the pad for warmth.
for (const ch of [L, R]) {
  let y = 0
  const a = 1 - Math.exp((-2 * Math.PI * 1800) / SR)
  for (let i = 0; i < N; i++) { y += a * (ch[i] - y); ch[i] = y }
}

// Heartbeat kick: a short sine sweep 110 → 45 Hz on beats 1 and 3.
for (let b = 0; b * BEAT < SECONDS; b++) {
  if (b % 2 !== 0) continue
  const start = Math.floor(b * BEAT * SR)
  for (let k = 0; k < SR * 0.35 && start + k < N; k++) {
    const t = k / SR
    const f = 45 + 65 * Math.exp(-t * 28)
    const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.38
    L[start + k] += s; R[start + k] += s
  }
}

// Off-beat hats: very short filtered noise, barely there.
let seed = 7
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
for (let e = 0; e * (BEAT / 2) < SECONDS; e++) {
  if (e % 2 === 0) continue
  const start = Math.floor(e * (BEAT / 2) * SR)
  let prev = 0
  for (let k = 0; k < SR * 0.05 && start + k < N; k++) {
    const n = noise()
    const hp = n - prev; prev = n
    const s = hp * Math.exp(-(k / SR) * 70) * 0.035
    L[start + k] += s * 0.8; R[start + k] += s
  }
}

// Fade out the last 1.5 s, normalise to -1 dBFS, write 16-bit WAV.
let peak = 0
for (let i = 0; i < N; i++) {
  const tail = Math.min(1, (N - i) / (SR * 1.5))
  L[i] *= tail; R[i] *= tail
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
}
const gain = 0.89 / peak
const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * gain)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * gain)) * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)
await writeFile(join(HERE, 'public/music.wav'), Buffer.concat([header, data]))
console.log(`music.wav — ${SECONDS}s at ${BPM} BPM`)
