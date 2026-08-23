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

  buildings: `[out:json][timeout:180][bbox:${BBOX}];
(way["building"];);
out geom tags;`,

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

async function overpass(query, name) {
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
      if (!Array.isArray(json.elements)) throw new Error('missing elements[]')
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
  await mkdir(RAW, { recursive: true })

  for (const [name, query] of Object.entries(QUERIES)) {
    const path = join(RAW, `${name}.json`)
    if (!force && existsSync(path)) {
      const n = JSON.parse(await readFile(path, 'utf8')).elements.length
      console.log(`= ${name}: cached (${n} elements) — use --force to refetch`)
      continue
    }
    console.log(`> ${name}: fetching…`)
    const json = await overpass(query, name)
    await writeFile(path, JSON.stringify(json))
    console.log(`  ${name}: ${json.elements.length} elements`)
    await sleep(2000)
  }
  console.log('\nDone. Run `npm run build:data` to regenerate public/data.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
