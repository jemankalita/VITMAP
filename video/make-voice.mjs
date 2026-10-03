// Regenerates the voiceover: one MP3 per line in public/vo/, then prints each
// clip's length in frames so `len` in src/brand.ts can be updated.
//
// Voice: Microsoft Edge neural text-to-speech via the open-source `edge-tts`
// Python package (pip install edge-tts). Free, no API key; needs internet.
//
//   node make-voice.mjs                               # default voice
//   node make-voice.mjs en-IN-PrabhatNeural           # any voice from:
//   python -m edge_tts --list-voices
//
// The lines here must match VO in src/brand.ts (same order, same words).
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VOICE = process.argv[2] ?? 'en-US-AndrewMultilingualNeural'
const RATE = '+4%'
const FPS = 30

const LINES = [
  'This is VIT Vellore. Every building, in 3D.',
  'Got a class in PRP? Just type the room.',
  'Room 327. Block E, third floor. Six minutes from SJT.',
  'Need a pharmacy? Saravana Medical. Seven minutes away.',
  'Need cash? The nearest ATM is three minutes from there.',
  "Hungry? See tonight's dinner, in every mess.",
  "And find any professor's cabin, in seconds.",
  'Even the trains run live.',
  'VIT Map. Find your way.',
]

const FFPROBE = join(HERE, 'node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe')
mkdirSync(join(HERE, 'public/vo'), { recursive: true })

LINES.forEach((text, i) => {
  const out = join(HERE, `public/vo/${String(i + 1).padStart(2, '0')}.mp3`)
  execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, `--rate=${RATE}`, '--text', text, '--write-media', out], { stdio: 'ignore' })
  let frames = '?'
  try {
    const s = Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
    frames = String(Math.ceil(s * FPS))
  } catch { /* ffprobe ships with Remotion on Windows; elsewhere use your own */ }
  console.log(`${String(i + 1).padStart(2, '0')}  len ${frames.padStart(3)}  ${text}`)
})
console.log(`\nvoice ${VOICE} @ ${RATE} — update \`len\` in src/brand.ts if any length changed.`)
