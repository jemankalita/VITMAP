// Copies the app's built data and map glyphs into video/public so the film
// renders the same campus the site does. Run after `npm run build:data` in
// the app (the parent folder).
import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = join(HERE, '..')
const OUT = join(HERE, 'public')

for (const f of ['data/geo.json', 'data/campus.json', 'data/graph.json']) {
  if (!existsSync(join(APP, 'public', f))) throw new Error(`missing ${f} — run \`npm run build:data\` in the app first`)
}
await mkdir(join(OUT, 'data'), { recursive: true })
await cp(join(APP, 'public/data/geo.json'), join(OUT, 'data/geo.json'))
await cp(join(APP, 'public/data/campus.json'), join(OUT, 'data/campus.json'))
await cp(join(APP, 'public/data/graph.json'), join(OUT, 'data/graph.json'))
await cp(join(APP, 'public/font'), join(OUT, 'font'), { recursive: true })
await cp(join(APP, 'public/logo.svg'), join(OUT, 'logo.svg'))
console.log('video/public ready')
