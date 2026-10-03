// Re-runnable Overpass fetch. Writes data/raw/*.json.
//   node scripts/fetch-osm.mjs            # fetch anything missing
//   node scripts/fetch-osm.mjs --force    # refetch everything
//
// Data (c) OpenStreetMap contributors, ODbL.

import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data/raw')

// VIT Vellore campus: OSM relation 15931944 (multipolygon, amenity=university).
// BBox padded slightly past Nominatim's bounding box.
export const CAMPUS_REL = 15931944
export const BBOX = '12.9660,79.1510,12.9780,79.1695'

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const QUERIES = {
  boundary: `[out:json][timeout:90];
rel(${CAMPUS_REL});
out geom;`,

  pois: `[out:json][timeout:180][bbox:${BBOX}];
(
  nwr["amenity"];
  nwr["shop"];
  nwr["building"]["name"];
  nwr["office"];
  nwr["leisure"];
  nwr["tourism"];
  nwr["healthcare"];
  nwr["emergency"];
  nwr["man_made"];
  nwr["indoor"]["name"];
  nwr["room"]["name"];
  nwr["barrier"="gate"];
  nwr["highway"="bus_stop"];
  nwr["public_transport"="stop_position"];
  nwr["public_transport"="platform"];
  nwr["railway"="station"];
  nwr["railway"="halt"];
  node["highway"="street_lamp"];
);
out center tags;`,

  // Courtyard buildings (SJT, TT, hostel blocks) are multipolygon relations;
  // they need full member geometry, which `tags` mode strips.
  buildings: `[out:json][timeout:180][bbox:${BBOX}];
way["building"];
out geom tags;
relation["building"]["type"="multipolygon"];
out geom;`,

  highways: `[out:json][timeout:180][bbox:${BBOX}];
(way["highway"];);
out geom tags;`,

  land: `[out:json][timeout:180][bbox:${BBOX}];
(
  way["natural"];
  way["landuse"];
  way["waterway"];
  relation["natural"="water"];
  way["barrier"="wall"];
  way["barrier"="fence"];
  way["railway"];
  way["tunnel"];
);
out geom tags;`,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const UA = 'vit-vellore-map/0.1 (campus map; modeled on iitk.nis.pet)'

/** Mirrors lag the main instance by weeks at times; anything older than this is refused. */
const MAX_AGE_DAYS = 10

const osmBase = (json) => Date.parse(json?.osm3s?.timestamp_osm_base ?? '') || 0

/**
 * Refuse answers that would quietly make the map worse: a query that hit its
 * timeout (Overpass still returns 200 with a partial element list and a
 * "runtime error" remark), or a mirror whose database is older than what we
 * already have. Both used to land as "the campus lost a quarter of its buildings".
 */
function vet(json, cachedBase) {
  if (!Array.isArray(json.elements)) throw new Error('missing elements[]')
  if (/error/i.test(json.remark ?? '')) throw new Error(`partial result: ${json.remark.slice(0, 80)}`)
  const base = osmBase(json)
  if (!base) throw new Error('no osm3s timestamp')
  if (cachedBase && base < cachedBase) {
    throw new Error(`stale mirror (${json.osm3s.timestamp_osm_base} is older than the cached copy)`)
  }
  const ageDays = (Date.now() - base) / 86400000
  if (ageDays > MAX_AGE_DAYS) throw new Error(`stale mirror (data is ${ageDays.toFixed(0)} days old)`)
}

async function overpass(query, name, cachedBase = 0) {
  let lastErr
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: query,
        headers: { 'User-Agent': UA, 'Content-Type': 'text/plain;charset=UTF-8' },
      })
      const text = await res.text()
      if (!text.startsWith('{')) throw new Error(`non-JSON from ${endpoint}: ${text.slice(0, 160)}`)
      const json = JSON.parse(text)
      vet(json, cachedBase)
      return json
    } catch (err) {
      lastErr = err
      const wait = 5000 * (attempt + 1)
      console.warn(`  ${name}: attempt ${attempt + 1} failed (${err.message.slice(0, 80)}), retrying in ${wait / 1000}s`)
      await sleep(wait)
    }
  }
  throw new Error(`${name}: all attempts failed — ${lastErr?.message}`)
}

async function main() {
  const force = process.argv.includes('--force')
  let failures = 0
  await mkdir(RAW, { recursive: true })

  for (const [name, query] of Object.entries(QUERIES)) {
    const path = join(RAW, `${name}.json`)
    if (!force && existsSync(path)) {
      const n = JSON.parse(await readFile(path, 'utf8')).elements.length
      console.log(`= ${name}: cached (${n} elements) — use --force to refetch`)
      continue
    }
    const cached = existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null
    console.log(`> ${name}: fetching…`)
    let json
    try {
      json = await overpass(query, name, osmBase(cached))
    } catch (err) {
      // One flaky layer should not cost the others their update.
      if (!cached) throw err
      console.warn(`  ${name}: keeping cached copy (${cached.elements.length} elements) — ${err.message.slice(0, 120)}`)
      failures++
      continue
    }
    await writeFile(path, JSON.stringify(json))
    console.log(`  ${name}: ${json.elements.length} elements`)
    await sleep(2000)
  }
  if (failures === Object.keys(QUERIES).length) throw new Error('every Overpass query failed')
  const kept = failures ? ` (${failures} layer(s) kept from cache)` : ''
  console.log(`\nDone${kept}. Run \`npm run build:data\` to regenerate public/data.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
