import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const out = process.env.TEMP + '/router-eta.mjs'
await build({ entryPoints: ['../src/route/router.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const { Router, humanEta, humanDistance } = await import(pathToFileURL(out).href)
const graph = JSON.parse(await readFile('../public/data/graph.json', 'utf8'))
const c = JSON.parse(await readFile('../public/data/campus.json', 'utf8'))
const P = (id) => c.pois.find((p) => p.id === id)
const r = new Router(graph)
const legs = [['r20995799', 'prp-e'], ['prp-e', 'n14070559047'], ['n14070559047', 'n14070559046']]
for (const [a, b] of legs) {
  const x = r.route(P(a), P(b), 'foot')
  console.log(P(a).name, '→', P(b).name, x ? `${humanEta(x.seconds)} · ${humanDistance(x.metres)} · ${x.coords?.length ?? Object.keys(x)} pts` : 'none')
}
