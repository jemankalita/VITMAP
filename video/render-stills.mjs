// One still per scene — check the storyboard before anything moves.
//   node render-stills.mjs            # all scenes
//   node render-stills.mjs 450 610    # specific frames
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCENES = { '1-hook': 70, '2-prp-search': 205, '3-prp-route': 340, '4-pharmacy': 560, '5-atm': 680, '6-dinner': 800, '7-prof': 945, '8-train': 1015, '9-end': 1120 }
const only = process.argv.slice(2).map(Number)
const shots = only.length ? only.map((f) => [`f${f}`, f]) : Object.entries(SCENES)

const serveUrl = await bundle({ entryPoint: join(HERE, 'src/index.ts') })
const chromiumOptions = { gl: 'angle' }
const composition = await selectComposition({ serveUrl, id: 'Film', chromiumOptions })
await mkdir(join(HERE, 'out/stills'), { recursive: true })
for (const [name, frame] of shots) {
  const t0 = Date.now()
  await renderStill({ composition, serveUrl, frame, output: join(HERE, `out/stills/${name}.png`), chromiumOptions, timeoutInMilliseconds: 120_000 })
  console.log(`${name} (frame ${frame}) ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
