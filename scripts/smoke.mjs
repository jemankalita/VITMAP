// Headless smoke test of the two pure-logic modules — the search index and the
// router. Bundles the TS with esbuild (already a Vite dependency), runs campus
// queries, and asserts the answers are sane.
//
//   npm run smoke

import { build } from 'esbuild'
import { readFile, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TMP = join(ROOT, 'node_modules/.cache/smoke.mjs')

let failures = 0
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
const note = (label, detail = '') =>
  console.log(`  note ${label}${detail ? ` — ${detail}` : ''}`)

await build({
  entryPoints: [join(ROOT, 'src/search/engine.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: TMP, logLevel: 'silent',
})
const { SearchIndex } = await import(pathToFileURL(TMP).href + `?t=${Date.now()}`)

const ROUTER_TMP = join(ROOT, 'node_modules/.cache/smoke-router.mjs')
await build({
  entryPoints: [join(ROOT, 'src/route/router.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: ROUTER_TMP, logLevel: 'silent',
})
const { Router, humanEta } = await import(pathToFileURL(ROUTER_TMP).href + `?t=${Date.now()}`)

const campus = JSON.parse(await readFile(join(ROOT, 'public/data/campus.json'), 'utf8'))
const graph = JSON.parse(await readFile(join(ROOT, 'public/data/graph.json'), 'utf8'))

/* ── search ──────────────────────────────────────────────────────────────── */

console.log('\nsearch')
const index = new SearchIndex(campus, { onLayer: () => {}, onAction: () => {} })
console.log(`  ${index.docs.length} documents indexed`)

const top = (q) => index.search(q)[0]
const titles = (q, n = 3) => index.search(q).slice(0, n).map((h) => h.title)
const has = (q, re) => index.search(q).some((h) => re.test(h.title))

ok(/prp/i.test(top('prp')?.title ?? ''), 'prp -> a PRP block', top('prp')?.title)
ok(/327/.test(top('327')?.title ?? '') || /block e/i.test(top('327')?.title ?? ''),
  '327 -> PRP Block E', top('327')?.title)
ok(/gate 11/i.test(top('gate 11')?.title ?? ''), 'gate 11', top('gate 11')?.title)
ok(/gate 1a/i.test(top('gate 1a')?.title ?? ''), 'gate 1a', top('gate 1a')?.title)
ok(/gate 3/i.test(top('gate 3')?.title ?? ''), 'gate 3', top('gate 3')?.title)
ok(/sjt|jubilee/i.test(top('sjt')?.title ?? ''), 'sjt -> SJT', top('sjt')?.title)
ok(/tt|technology tower/i.test(top('tt')?.title ?? ''), 'tt -> TT', top('tt')?.title)
ok(/k block|mh k/i.test(top('mh k')?.title ?? ''), 'mh k -> K Block', top('mh k')?.title)
ok(index.search('gdn').length > 0, 'gdn', titles('gdn').join(' / '))
ok(index.search('smv').length > 0, 'smv', titles('smv').join(' / '))
ok(index.search('gate').length > 0 || has('gate', /gate/i),
  'gate', titles('gate').join(' / '))
ok(index.search('library').length > 0, 'library', titles('library').join(' / '))
ok(top('atm') != null, 'atm', top('atm')?.title)

if (campus.mess?.items?.length) {
  ok(/Mess/i.test(top('mess dinner')?.title ?? '') && !/Mess Mess/i.test(top('mess dinner')?.title ?? ''),
   'mess dinner -> a mess', top('mess dinner')?.title)
  ok((index.search('mess dinner')[0]?.sub ?? '').length > 10, 'mess dinner shows the actual menu',
     (index.search('mess dinner')[0]?.sub ?? '').slice(0, 60))
} else {
  note('mess menus absent — skipping mess dinner assertions')
}

const person = index.search('professor').find((h) => h.kind === 'person')
if (campus.faculty?.items?.length) {
  ok(campus.faculty.items.length > 200, `faculty roll is populated (${campus.faculty.items.length})`)
  ok(!!person, 'professor -> a person', person?.title)
  const someone = campus.faculty.items.find((f) => {
    const parts = f.name.replace(/\./g, ' ').split(/\s+/).filter(Boolean)
    const surname = parts[parts.length - 1] ?? ''
    return surname.length > 3 && /^[A-Za-z]+$/.test(surname) && !/^(Doctor|Professor)$/i.test(surname)
  })
  if (someone) {
    const surname = someone.name.replace(/\./g, ' ').split(/\s+/).filter(Boolean).pop()
    const found = index.search(surname).some((h) => h.person?.name === someone.name)
    ok(found, `surname "${surname}" finds ${someone.name}`)
  }
  const byUrl = new Map()
  for (const f of campus.faculty.items) byUrl.set(f.url + '|' + f.name, (byUrl.get(f.url + '|' + f.name) ?? 0) + 1)
  const repeats = [...byUrl].filter(([, n]) => n > 1)
  ok(repeats.length === 0, 'no duplicate faculty records')
} else {
  note('faculty directory absent — skipping person assertions')
}

ok(index.search('PH101').every((h) => h.kind !== 'place' || !/PH101/i.test(h.title)),
   'PH101 has no fake course result')

console.log('\n  latency')
for (const q of ['m', 'mess dinner', 'sjt', 'hostel', 'a']) {
  const t0 = performance.now()
  for (let i = 0; i < 50; i++) index.search(q)
  const per = (performance.now() - t0) / 50
  ok(per < 12, `"${q}" ${per.toFixed(2)}ms/query`)
}

/* ── routing ─────────────────────────────────────────────────────────────── */

console.log('\nrouting')
const router = new Router(graph)
ok(graph.lat.length > 20, `graph has nodes (${graph.lat.length})`)
ok(graph.edges.length > 20, `graph has edges (${graph.edges.length})`)

const pinned = campus.pois.filter((p) => campus.categories[p.cat]?.pin && !p.unnamed)
ok(pinned.length > 0, `pinned POIs exist (${pinned.length})`)

const centre = { lat: campus.meta.center[1], lon: campus.meta.center[0] }
if (pinned.length >= 2) {
  const a = pinned[0], b = pinned[Math.min(pinned.length - 1, 3)]
  const walk = router.route(a, b, 'foot')
  const bike = router.route(a, b, 'bike')
  ok(!!walk, `${a.name} -> ${b.name} walk`, walk ? `${walk.metres}m ${humanEta(walk.seconds)}` : 'no route')
  ok(!!bike, `${a.name} -> ${b.name} bike`, bike ? `${bike.metres}m ${humanEta(bike.seconds)}` : 'no route')
}

for (const profile of ['foot', 'bike']) {
  const bad = pinned.filter((p) => !router.route(centre, p, profile))
  const ratio = pinned.length ? bad.length / pinned.length : 1
  ok(ratio < 0.4, `most pinned POIs reachable by ${profile}`,
     bad.length ? `${bad.length}/${pinned.length} unreachable, e.g. ${bad.slice(0, 3).map((p) => p.name).join(', ')}` : '')
}

if (pinned.length) {
  const t0 = performance.now()
  for (let i = 0; i < 30; i++) router.route(centre, pinned[i % pinned.length], 'foot')
  ok((performance.now() - t0) / 30 < 40, `route latency ${((performance.now() - t0) / 30).toFixed(1)}ms`)
}

/* ── duplicate + overlap checks ──────────────────────────────────────────── */

console.log('\nduplicates and overlaps')

const normName = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const metres = (a, b) =>
  Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 99600)

const curatedRaw = JSON.parse(
  await readFile(join(ROOT, 'data/curated/places.json'), 'utf8')).items ?? []

const byId = new Map()
const byName = new Map()
let curatedDupes = 0
for (const p of curatedRaw) {
  for (const [map, key] of [[byId, p.id], [byName, normName(p.name)]]) {
    if (!key) continue
    if (map.has(key)) { curatedDupes++; note(`curated duplicate: ${key}`) }
    map.set(key, p)
  }
}
ok(curatedDupes === 0, `no duplicate ids or names in curated places (${curatedRaw.length} entries)`)

const placed = campus.pois
const curated = placed.filter((p) => p.src !== 'osm')
const fromOsm = placed.filter((p) => p.src === 'osm')

const osmNames = new Set(fromOsm.map((p) => normName(p.name)))
let superseded = 0
for (const p of curatedRaw) {
  if (osmNames.has(normName(p.name))) {
    superseded++
    note(`"${p.name}" is now in OSM — delete it from data/curated/places.json`)
  }
}
if (!superseded) ok(true, `no curated place is shadowed by OSM (${curated.length} curated on the map)`)

let curatedOverlap = 0
for (const p of curated) {
  for (const q of fromOsm) {
    if (metres(p, q) < 12) {
      curatedOverlap++
      note(`curated "${p.name}" is ${metres(p, q).toFixed(1)}m from OSM "${q.name}"`)
    }
  }
}
if (!curatedOverlap) ok(true, 'no curated place sits on top of an OSM feature')

const groups = new Map()
for (const p of placed) {
  if (!p.name) continue
  const k = normName(p.name)
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(p)
}
const namePairs = []
for (const list of groups.values()) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const d = metres(list[i], list[j])
      if (d < 25) namePairs.push({ a: list[i], b: list[j], d })
    }
  }
}
const stacked = namePairs.filter((p) => p.d < 2)
for (const p of stacked) {
  note(`stacked: "${p.a.name}" ${p.d.toFixed(1)}m — ${p.a.osm} / ${p.b.osm}`)
}
ok(stacked.length === 0, 'no two places share a name at the same spot')

const crossCat = namePairs.filter((p) => p.a.cat !== p.b.cat && p.d < 25)
for (const p of crossCat) {
  note(`double-mapped: "${p.a.name}" ${p.d.toFixed(1)}m — ${p.a.cat} vs ${p.b.cat}`)
}
note(`${namePairs.length} same-name pairs within 25m`,
  `${crossCat.length} across categories, ${namePairs.length - crossCat.length} plausible repeats`)

/* ── live location ───────────────────────────────────────────────────────── */

console.log('\nlocation')
const LOC_TMP = join(ROOT, 'node_modules/.cache/smoke-location.mjs')
await build({
  entryPoints: [join(ROOT, 'src/location/watch.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: LOC_TMP, logLevel: 'silent',
})
const loc = await import(pathToFileURL(LOC_TMP).href + `?t=${Date.now()}`)

ok(loc.youCollection(null).features.length === 0, 'no fix → empty you source')
{
  const col = loc.youCollection({ lat: 12.972, lon: 79.158, accuracy: 18, heading: 90, ts: 1 })
  ok(col.features.length === 1, 'fix → one you feature')
  ok(col.features[0].geometry.coordinates[0] === 79.158
    && col.features[0].geometry.coordinates[1] === 12.972, 'you feature uses lon,lat order')
  ok(col.features[0].properties.accuracy === 18, 'accuracy rides on the feature')
}

ok(Math.abs(loc.metresBetween({ lat: 12.97, lon: 79.15 }, { lat: 12.97, lon: 79.15 }) ) < 0.01,
  'identical points are 0 m apart')
ok(loc.metresBetween({ lat: 12.97, lon: 79.15 }, { lat: 12.971, lon: 79.15 }) > 100, '1e-3° latitude is >100 m')

ok(loc.insideBounds(12.97, 79.16, [[79.15, 12.96], [79.17, 12.98]]), 'point inside campus bounds')
ok(!loc.insideBounds(13.1, 79.16, [[79.15, 12.96], [79.17, 12.98]]), 'point north of campus is outside')

const padded = loc.padBounds([[79.15, 12.96], [79.17, 12.98]], 0.01)
ok(padded[0][0] < 79.15 && padded[1][1] > 12.98, 'padBounds expands both corners')

const rClose = loc.accuracyRadiusPx(20, 12.97, 17)
const rFar = loc.accuracyRadiusPx(20, 12.97, 14)
ok(rClose > rFar, `accuracy circle grows with zoom (${rFar.toFixed(1)}px @z14 → ${rClose.toFixed(1)}px @z17)`)
ok(loc.accuracyRadiusPx(50_000, 12.97, 16) <= 140, 'huge uncertainty is clamped')
ok(loc.accuracyRadiusPx(1, 12.97, 13) >= 12, 'tiny uncertainty still has a visible halo')

ok(!loc.shouldNudgeCamera(false, null, { lat: 12.97, lon: 79.16, accuracy: 8, heading: null, ts: 1 }),
  'camera stays put when not following')
ok(loc.shouldNudgeCamera(true, null, { lat: 12.97, lon: 79.16, accuracy: 8, heading: null, ts: 1 }),
  'first follow fix always recentres')
ok(!loc.shouldNudgeCamera(true,
  { lat: 12.97, lon: 79.16, accuracy: 8, heading: null, ts: 1 },
  { lat: 12.970001, lon: 79.16, accuracy: 8, heading: null, ts: 2 }),
  'sub-metre jitter does not recentre')

{
  const fixes = []
  const errors = []
  let watchId = 0
  const fake = {
    watchPosition(ok, err) {
      watchId = 7
      ok({
        coords: { latitude: 12.971, longitude: 79.159, accuracy: 12, heading: 180 },
        timestamp: 99,
      })
      if (typeof err === 'function') { /* unused */ }
      return watchId
    },
    clearWatch(id) { watchId = id === 7 ? 0 : watchId },
  }
  const handle = loc.startWatch(fake, {
    onFix: (f) => fixes.push(f),
    onError: (e) => errors.push(e),
  })
  ok(fixes.length === 1 && fixes[0].lat === 12.971 && fixes[0].heading === 180, 'watchPosition delivers a Fix')
  handle.stop()
  handle.stop()
  ok(watchId === 0, 'stop() clears the watch once')
  ok(errors.length === 0, 'happy path reports no error')
}

/* ── map style ───────────────────────────────────────────────────────────── */

console.log('\nmap style')
const STYLE_TMP = join(ROOT, 'node_modules/.cache/smoke-style.mjs')
await build({
  entryPoints: [join(ROOT, 'src/map/style.ts')],
  bundle: true, format: 'esm', platform: 'node', outfile: STYLE_TMP, logLevel: 'silent',
  external: ['maplibre-gl'],
})
const { buildStyle } = await import(pathToFileURL(STYLE_TMP).href + `?t=${Date.now()}`)
const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec')

const geo = JSON.parse(await readFile(join(ROOT, 'public/data/geo.json'), 'utf8'))
for (const theme of ['dark']) {
  const style = buildStyle(geo, campus)
  const sat = buildStyle(geo, campus, '/', true)
  const satErr = validateStyleMin(sat)
  ok(satErr.length === 0, `${theme} satellite style validates`, satErr.map((e) => e.message).join(' | '))
  const errors = validateStyleMin(style)
  ok(errors.length === 0, `${theme} style validates (${style.layers.length} layers)`,
     errors.map((e) => e.message).join(' | '))

  const missing = style.layers.filter((l) => l.source && !style.sources[l.source]).map((l) => l.id)
  ok(missing.length === 0, `${theme}: every layer has a source`, missing.join(', '))
  ok(style.sources.you && style.layers.some((l) => l.id === 'you-dot')
    && style.layers.some((l) => l.id === 'you-acc'), `${theme}: live location layers present`)

  const bad = JSON.stringify(style).match(/"(?:[a-z-]*color)":\s*(null|"undefined")/g)
  ok(!bad, `${theme}: no undefined colours`, bad?.join(', ') ?? '')
}

/* ── PRP 3D model ────────────────────────────────────────────────────────── */

console.log('\nprp model')
{
  const flat = buildStyle(geo, campus)
  const tilted = buildStyle(geo, campus, '/', false, true)
  const b3d = (s) => s.layers.find((l) => l.id === 'campus3d')?.layout?.visibility
  ok(b3d(flat) === 'none' && b3d(tilted) === 'visible', '3D buildings only show in the 3D view')
  const errs = validateStyleMin(tilted)
  ok(errs.length === 0, '3D style validates', errs.map((e) => e.message).join(' | '))

  const model = flat.sources.prp3d.data.features
  const blockIds = geo.prp.features.map((f) => f.properties.id)
  const modelled = new Set(model.map((f) => f.properties.id))
  const unmodelled = blockIds.filter((id) => !modelled.has(id))
  ok(unmodelled.length === 0, `every PRP block is modelled (${blockIds.length} blocks, ${model.length} parts)`, unmodelled.join(', '))
  const badSpan = model.filter((f) => f.properties.part === 'solid' && !(f.properties.top > f.properties.base))
  ok(badSpan.length === 0, 'every solid part has top above base', `${badSpan.length} bad`)
  const tallest = (id) => Math.max(...model.filter((f) => f.properties.id === id).map((f) => f.properties.top))
  ok(tallest('prp-entry') > tallest('prp-a'), 'clock tower rises above the blocks',
     `${tallest('prp-entry')} vs ${tallest('prp-a')}`)
  const roofA = model.some((f) => f.properties.id === 'prp-a' && f.properties.color === '#2f9de4')
  ok(roofA, 'Block A carries the sign\'s blue roof')
  ok(model.some((f) => f.properties.id === 'prp-courtyard') && model.some((f) => f.properties.id === 'prp-shed'),
     'courtyard and road shed are present')

  const city = tilted.sources.campus3d.data.features
  const tall = city.filter((f) => f.properties.top > 30).length
  ok(city.length > 500 && tall > 0, `campus model has buildings, trees and walls (${city.length} parts, ${tall} above 30 m)`)
  const named = new Set(geo.buildings.features.map((f) => f.properties.name))
  const lost = ['Silver Jubilee Tower', 'Technology Tower', 'Main Building'].filter((n) => !named.has(n))
  ok(lost.length === 0, 'courtyard buildings (OSM multipolygon relations) have footprints', lost.join(', '))
  const mainLine = (geo.rail?.features ?? []).filter((f) => f.properties.kind === 'rail')
  ok(mainLine.length >= 2, `main line between the plots is kept (${mainLine.length} tracks) for the track and train`)
  ok(['rail-bed', 'rail-steel-l', 'rail-steel-r', 'train'].every((id) => flat.layers.some((l) => l.id === id)),
     'railway and train layers present')
}

/* ── nearest amenities ───────────────────────────────────────────────────── */

console.log('\nnearest')
{
  const NEAR_TMP = join(ROOT, 'node_modules/.cache/smoke-nearest.mjs')
  await build({
    entryPoints: [join(ROOT, 'src/search/nearest.ts')],
    bundle: true, format: 'esm', platform: 'node', outfile: NEAR_TMP, logLevel: 'silent',
  })
  const { nearestAmenities } = await import(pathToFileURL(NEAR_TMP).href + `?t=${Date.now()}`)
  const sjt = campus.pois.find((p) => /Silver Jubilee|^SJT$/i.test(p.name)) ?? campus.pois[0]
  const near = nearestAmenities(campus, sjt)
  ok(near.length > 0, `something useful near ${sjt.name}`, near.map((n) => `${n.poi.name} ${Math.round(n.metres)}m`).join(', '))
  ok(near.every((n, i) => i === 0 || near[i - 1].metres <= n.metres), 'nearest first')
  ok(new Set(near.map((n) => n.poi.cat)).size === near.length, 'one result per amenity kind')
  ok(!near.some((n) => n.poi.id === sjt.id), 'never lists the place itself')
}

/* ── DOM contract ────────────────────────────────────────────────────────── */

console.log('\ndom')

const srcDir = join(ROOT, 'src')
const walk = async (dir) => {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(p))
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}
const allSrc = await walk(srcDir)
const RUNTIME_IDS = new Set(['route-badge', 'layers-scrim', 'pick-bar', 'gps-note'])

const html = await readFile(join(ROOT, 'index.html'), 'utf8')
const present = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))

const wanted = new Map()
for (const file of allSrc) {
  const code = await readFile(file, 'utf8')
  for (const m of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) {
    if (!wanted.has(m[1])) wanted.set(m[1], file.replace(ROOT + '\\', '').replace(ROOT + '/', ''))
  }
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]/g)) {
    if (!wanted.has(m[1])) wanted.set(m[1], file.replace(ROOT + '\\', '').replace(ROOT + '/', ''))
  }
}

const orphans = [...wanted].filter(([id]) => !present.has(id) && !RUNTIME_IDS.has(id))
ok(orphans.length === 0, `index.html: all ${wanted.size} referenced ids exist`,
   orphans.map(([id, f]) => `#${id} (${f})`).join(', '))

await rm(TMP, { force: true })
await rm(ROUTER_TMP, { force: true })
await rm(STYLE_TMP, { force: true })
await rm(LOC_TMP, { force: true })

console.log(failures ? `\n${failures} failure(s)\n` : '\nall good\n')
process.exit(failures ? 1 : 0)
