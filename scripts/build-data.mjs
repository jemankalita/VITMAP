// Turns data/raw/*.json (OpenStreetMap) + data/curated/*.json (hand-maintained)
// into the three files the app loads: public/data/{campus,geo,graph}.json
//
//   node scripts/build-data.mjs
//
// Curated POIs carry either surveyed lat/lon or an `anchor` — the name of
// a real OSM feature to sit beside, resolved to its position here.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RAW = join(ROOT, 'data/raw')
const CURATED = join(ROOT, 'data/curated')
const LIVE = join(ROOT, 'data/live')
const OUT = join(ROOT, 'public/data')

const warnings = []
const warn = (m) => warnings.push(m)

/* ── categories ─────────────────────────────────────────────────────────── */

export const CATEGORIES = {
  lecture:  { label: 'Lecture halls',     color: '#ffb454', pin: true },
  academic: { label: 'Academic & admin',  color: '#8ab4f8', pin: true },
  hostel:   { label: 'Hostels',           color: '#c792ea', pin: true },
  mess:     { label: 'Messes',            color: '#7ee787', pin: true },
  canteen:  { label: 'Stores & canteens', color: '#7ee787', pin: true },
  shop:     { label: 'Shops',             color: '#a5d6ff', pin: false },
  print:    { label: 'Printing',          color: '#f0883e', pin: false },
  water:    { label: 'Water',             color: '#56d4dd', pin: false },
  atm:      { label: 'ATMs & banks',      color: '#ffdd57', pin: false },
  cycle:    { label: 'Bike parking',      color: '#79c0ff', pin: false },
  parking:  { label: 'Car parking',       color: '#9aa4b2', pin: false },
  laundry:  { label: 'Laundry',           color: '#d2a8ff', pin: false },
  health:   { label: 'Health',            color: '#ff7b72', pin: false },
  sports:   { label: 'Sports',            color: '#3fb950', pin: false },
  toilet:   { label: 'Toilets',           color: '#8b949e', pin: false },
  vending:  { label: 'Vending',           color: '#e3b341', pin: false },
  worship:  { label: 'Worship',           color: '#bc8cff', pin: false },
  transport:{ label: 'Shuttle',           color: '#ff9bce', pin: true },
  gate:     { label: 'Gates',             color: '#ff6b8a', pin: true },
  prp:      { label: 'PRP classrooms',    color: '#ff8a3d', pin: true },
  admin:    { label: 'Offices',           color: '#9ea7b3', pin: false },
  green:    { label: 'Parks & grounds',   color: '#2ea043', pin: false },
  light:    { label: 'Street lights',     color: '#ffd97a', pin: false },
}

function classify(t) {
  const name = t.name || ''
  const { amenity: a, shop: s, leisure: l, office: o, healthcare: h, tourism: tr, building: b } = t
  const lu = t.landuse

  if (lu === 'residential' && (t.residential === 'hostel' || /Hostel/i.test(name))) return 'hostel'

  if (/\b(office|staff|store|pantry|toilet)\b/i.test(name) && t.indoor) return 'admin'

  if (/^Lecture Hall\b/i.test(name) || /Lecture Hall Complex/i.test(name) ||
      /^Tutorial Block/i.test(name) || a === 'lecture_hall' ||
      /\b(SJT Ground|Induction)\b/i.test(name)) return 'lecture'
  if (a === 'theatre' || a === 'cinema' || a === 'conference_centre' || /Auditorium$/i.test(name)) return 'lecture'

  // MessIT halls are curated as MH/LH × Special/Veg/Non-Veg. OSM vendor names
  // ("Darling SPL Mess") stay on the map as canteens so the mess layer is the six types.
  if (/^(MH|LH)\b/i.test(name) && /\bMess\b/i.test(name)) return 'mess'
  if (a === 'canteen' || /\bMess\b/i.test(name)) return 'canteen'
  if (/\bCanteen\b/i.test(name) || /Food Court/i.test(name)) return 'canteen'
  if (a === 'restaurant' || a === 'fast_food' || a === 'cafe' || a === 'ice_cream' ||
      a === 'food_court' || s === 'bakery') return 'canteen'

  if (a === 'atm' || a === 'bank' || a === 'bureau_de_change') return 'atm'
  if (a === 'drinking_water' || t.man_made === 'water_tap' || a === 'water_point') return 'water'
  if (a === 'bicycle_parking' || a === 'bicycle_repair_station' || s === 'bicycle' ||
      /Bike Parking/i.test(name)) return 'cycle'
  if (s === 'laundry' || s === 'dry_cleaning' || a === 'laundry' || /Laundry/i.test(name)) return 'laundry'
  if (s === 'copyshop' || a === 'printer' || /\b(xerox|photocopy|printout|print)\b/i.test(name)) return 'print'
  if (t.highway === 'street_lamp' || t.man_made === 'street_lamp') return 'light'
  if (a === 'vending_machine') return 'vending'
  if (a === 'toilets') return 'toilet'
  if (a === 'place_of_worship' || /Temple|Mosque|Church|Gurudwara/i.test(name)) return 'worship'

  if (a === 'hospital' || a === 'clinic' || a === 'doctors' || a === 'pharmacy' ||
      a === 'dentist' || a === 'veterinary' || h) return 'health'

  if (a === 'fountain') { /* fall through */ }
  else if (/^Gate\s*\d/i.test(name) || /^Main Gate$/i.test(name) || t.barrier === 'gate') return 'gate'
  if (/\bPRP\b|Perl Research Park|Pearl Research Park/i.test(name)) return 'prp'
  if (/Shuttle/i.test(name) || /^S\d+\b/i.test(name) ||
      a === 'bus_station' || a === 'taxi' || t.highway === 'bus_stop' ||
      t.public_transport === 'stop_position' || t.public_transport === 'platform') {
    return 'transport'
  }

  if (a === 'parking' || /Car Parking/i.test(name)) return 'parking'
  if (a === 'fuel' || a === 'charging_station' || a === 'bicycle_rental' || a === 'car_rental') return 'transport'

  if (a === 'police' || a === 'fire_station' || a === 'post_office' || a === 'townhall' ||
      o === 'security' || o === 'government' || a === 'community_centre' ||
      a === 'childcare' || a === 'library' || a === 'social_facility') return 'admin'

  if (l === 'pitch' || l === 'sports_centre' || l === 'fitness_centre' || l === 'swimming_pool' ||
      l === 'track' || l === 'playground' || l === 'stadium' || l === 'bleachers' ||
      /\bGym\b/i.test(name) || /Swimming Pool|Basketball|Tennis|Boxing|Stadium/i.test(name)) {
    return 'sports'
  }
  if (l === 'park' || l === 'garden' || l === 'nature_reserve' || /VIT (Lake|Fields)/i.test(name)) return 'green'

  if (s || a === 'marketplace') return 'shop'

  if (/^MH\b|^LH\b|Men'?s Hostel|Ladies'? Hostel|Ladies Hostel|Mens Hostel/i.test(name) ||
      tr === 'hostel' || b === 'dormitory' || a === 'dormitory' || /Hostel|Bhawan/i.test(name)) {
    return 'hostel'
  }

  if (o === 'university' || o === 'research' || a === 'university' || a === 'research_institute' ||
      a === 'college' || a === 'school' || o === 'educational_institution' ||
      /\b(SJT|Silver Jubilee|Technology Tower|\bTT\b|CDMR|SMV|GDN|PRP|MGB|MGR|Main Block|Department|Dept|Laboratory|Lab|Centre|Center|Institute|Academy|Facility|Building|Block|Complex|Wing)\b/i.test(name)) {
    return 'academic'
  }
  if (o) return 'admin'

  if (lu === 'retail' || lu === 'commercial') return 'shop'
  if (lu === 'recreation_ground') return 'sports'
  if (lu === 'orchard' || lu === 'plant_nursery' || lu === 'forest' || lu === 'meadow') return 'green'
  if (lu === 'residential') return 'hostel'
  return null
}

/* ── geo helpers ────────────────────────────────────────────────────────── */

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

function haversine(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat)
  const dLon = rad(bLon - aLon)
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function centroid(geometry) {
  const g = geometry.filter(Boolean)
  if (g.length < 3) {
    const lat = g.reduce((s, p) => s + p.lat, 0) / g.length
    const lon = g.reduce((s, p) => s + p.lon, 0) / g.length
    return [lon, lat]
  }
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < g.length - 1; i++) {
    const p = g[i], q = g[i + 1]
    const f = p.lon * q.lat - q.lon * p.lat
    a += f
    cx += (p.lon + q.lon) * f
    cy += (p.lat + q.lat) * f
  }
  if (Math.abs(a) < 1e-12) {
    const lat = g.reduce((s, p) => s + p.lat, 0) / g.length
    const lon = g.reduce((s, p) => s + p.lon, 0) / g.length
    return [lon, lat]
  }
  a *= 0.5
  return [cx / (6 * a), cy / (6 * a)]
}

function pointInRing(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

const samePt = (a, b) => Math.abs(a[0] - b[0]) < 1e-8 && Math.abs(a[1] - b[1]) < 1e-8

function stitchOuterRings(members) {
  const segs = (members ?? [])
    .filter((m) => (m.role === 'outer' || !m.role) && m.geometry?.length >= 2)
    .map((m) => m.geometry.map((p) => [p.lon, p.lat]))
  const used = new Set()
  const rings = []
  while (used.size < segs.length) {
    let start = segs.findIndex((_, i) => !used.has(i))
    if (start < 0) break
    used.add(start)
    const ring = segs[start].slice()
    let grew = true
    while (grew) {
      grew = false
      const end = ring[ring.length - 1]
      const begin = ring[0]
      if (samePt(end, begin) && ring.length > 3) break
      for (let i = 0; i < segs.length; i++) {
        if (used.has(i)) continue
        const s = segs[i]
        if (samePt(s[0], end)) {
          used.add(i); ring.push(...s.slice(1)); grew = true; break
        }
        if (samePt(s[s.length - 1], end)) {
          used.add(i); ring.push(...s.slice(0, -1).reverse()); grew = true; break
        }
      }
    }
    if (!samePt(ring[0], ring[ring.length - 1])) ring.push(ring[0])
    if (ring.length >= 4) rings.push(ring)
  }
  return rings
}

function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return Math.abs(a) / 2
}

function displayName(t) {
  const name = t.name || ''
  const aliases = []
  let display = name

  const mh = /^(?:Men'?s\s+Hostel(?:\s+Block)?|MH(?:\s+Block)?)\s+([A-Z])(?:\s+Annexe)?$/i.exec(name)
  const lh = /^(?:Ladies'?\s+Hostel(?:\s+Block)?|LH(?:\s+Block)?)\s+([A-Z])$/i.exec(name)
  if (mh) {
    const annexe = /annexe/i.test(name)
    display = annexe ? `MH ${mh[1].toUpperCase()} Annexe` : `MH ${mh[1].toUpperCase()}`
    aliases.push(name, `Men's Hostel ${mh[1].toUpperCase()}`, `MH${mh[1].toUpperCase()}`)
  } else if (lh) {
    display = `LH ${lh[1].toUpperCase()}`
    aliases.push(name, `Ladies Hostel ${lh[1].toUpperCase()}`, `LH${lh[1].toUpperCase()}`)
  }

  const letterBlock = /^([A-T]) Block$/i.exec(name)
  const letterAnnexe = /^([A-T]) Annexe$/i.exec(name)
  if (letterBlock) {
    const L = letterBlock[1].toUpperCase()
    aliases.push(`MH ${L}`, `MH${L}`, `MH ${L} Block`, `Men's Hostel ${L}`, `Men's Hostel Block ${L}`)
  }
  if (letterAnnexe) {
    const L = letterAnnexe[1].toUpperCase()
    aliases.push(`MH ${L} Annexe`, `MH${L} Annexe`, `Men's Hostel ${L} Annexe`)
  }

  const known = [
    [/silver jubilee|^\s*sjt\s*$/i, 'SJT', ['Silver Jubilee Tower', 'SJT']],
    [/technology tower|^\s*tt\s*$/i, 'TT', ['Technology Tower', 'TT']],
    [/cdmm|cdmr/i, 'CDMM', ['CDMM', 'CDMR', 'CDMR Building', 'CDMM Building']],
    [/visvesvaraya|\bsmv\b/i, 'SMV', ['SMV', 'SMV Block', 'Sir M Visvesvaraya Block']],
    [/g\.?\s*d\.?\s*naidu|\bgdn\b/i, 'GDN', ['GDN', 'G.D Naidu', 'GD Naidu Block', 'G.D.N']],
    [/perl research park|pearl research park|\bprp\b/i, 'PRP', ['PRP', 'Perl Research Park', 'Pearl Research Park']],
    [/mahatma gandhi|\bmg[rb]\b/i, 'MGB', ['MGR', 'MGB', 'M.G.R Block', 'Mahatma Gandhi Block']],
    [/main (block|building)/i, 'Main Building', ['Main Block', 'MB']],
    [/periyar library/i, 'EV Periyar Library', ['Library', 'Periyar Library']],
  ]
  for (const [re, short, extra] of known) {
    if (re.test(name) && name.length > short.length) {
      if (!aliases.includes(name)) aliases.push(name)
      for (const a of extra) if (!aliases.includes(a)) aliases.push(a)
      if (display === name) display = short
    }
  }

  if (t.alt_name) aliases.push(t.alt_name)
  if (t.short_name) aliases.push(t.short_name)
  return { display, aliases: [...new Set(aliases.filter((a) => a && a !== display))] }
}

const readRaw = async (n) => JSON.parse(await readFile(join(RAW, `${n}.json`), 'utf8'))

/* ── main ───────────────────────────────────────────────────────────────── */

async function main() {
  for (const f of ['boundary', 'pois', 'buildings', 'highways', 'land']) {
    if (!existsSync(join(RAW, `${f}.json`))) {
      console.error(`missing data/raw/${f}.json — run \`npm run fetch\` first`)
      process.exit(1)
    }
  }

  const [boundary, pois, buildings, highways, land] = await Promise.all(
    ['boundary', 'pois', 'buildings', 'highways', 'land'].map(readRaw),
  )

  const bRel = boundary.elements.find((e) => e.type === 'relation' && e.members)
  const bWay = boundary.elements.find((e) => e.geometry)
  let rings = []
  if (bRel) rings = stitchOuterRings(bRel.members)
  else if (bWay) rings = [bWay.geometry.map((p) => [p.lon, p.lat])]
  if (!rings.length) {
    const b = bRel?.bounds
    if (b) {
      warn('campus relation has no member geometry — using Overpass bounding box as the clip ring')
      rings = [[
        [b.minlon, b.minlat],
        [b.maxlon, b.minlat],
        [b.maxlon, b.maxlat],
        [b.minlon, b.maxlat],
        [b.minlon, b.minlat],
      ]]
    }
  }
  if (!rings.length) throw new Error('boundary.json has no usable geometry')
  rings.sort((a, b) => ringArea(b) - ringArea(a))
  const inCampus = (lon, lat) => rings.some((ring) => pointInRing(lon, lat, ring))
  function distToRingMetres(lon, lat, ring) {
    let best = Infinity
    for (let i = 0; i < ring.length - 1; i++) {
      const ax = ring[i][0], ay = ring[i][1], bx = ring[i + 1][0], by = ring[i + 1][1]
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((lon - ax) * dx + (lat - ay) * dy) / len2))
      const px = ax + t * dx, py = ay + t * dy
      const m = haversine(lat, lon, py, px)
      if (m < best) best = m
    }
    return best
  }
  const inOrOnCampus = (lon, lat) =>
    inCampus(lon, lat) || rings.some((ring) => distToRingMetres(lon, lat, ring) < 50)

  const byId = new Map()
  const sources = [...pois.elements, ...buildings.elements, ...land.elements]

  for (const el of sources) {
    const t = el.tags || {}
    if (!t.name) continue

    let lon, lat
    if (el.type === 'node') { lon = el.lon; lat = el.lat }
    else if (el.center) { lon = el.center.lon; lat = el.center.lat }
    else if (el.geometry?.length) { [lon, lat] = centroid(el.geometry) }
    else continue
    if (!inCampus(lon, lat)) continue

    const cat = classify(t)
    if (!cat) continue

    const id = `${el.type[0]}${el.id}`
    if (byId.has(id)) continue

    const { display, aliases } = displayName(t)

    byId.set(id, {
      id,
      name: display,
      cat,
      lon: +lon.toFixed(6),
      lat: +lat.toFixed(6),
      src: 'osm',
      osm: `${el.type}/${el.id}`,
      ...(display !== t.name ? { alt: t.name }
          : t['name:en'] && t['name:en'] !== t.name ? { alt: t['name:en'] } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(t.opening_hours ? { hours: t.opening_hours } : {}),
      ...(t.wheelchair ? { wheelchair: t.wheelchair } : {}),
      ...(t.phone || t['contact:phone'] ? { phone: t.phone || t['contact:phone'] } : {}),
      ...(t.website || t['contact:website'] ? { url: t.website || t['contact:website'] } : {}),
      ...(t.cuisine ? { cuisine: t.cuisine } : {}),
      ...(t.capacity ? { capacity: t.capacity } : {}),
      ...(t.covered ? { covered: t.covered } : {}),
      ...(t.operator ? { operator: t.operator } : {}),
      ...(t.description ? { desc: t.description } : {}),
      ...(t.level ? { level: t.level } : {}),
      kind: t.amenity || t.shop || t.leisure || t.office || t.healthcare ||
            t.tourism || t.man_made || t.building || t.barrier || t.highway || undefined,
    })
  }

  const UNNAMED_OK = new Set(['bicycle_parking', 'drinking_water', 'atm', 'toilets',
                              'vending_machine', 'water_point', 'bicycle_repair_station', 'parking'])
  for (const el of pois.elements) {
    const t = el.tags || {}
    if (t.name) continue
    const isLamp = t.highway === 'street_lamp' || t.man_made === 'street_lamp'
    // Unnamed OSM gates are dropped — official numbers live in curated/places.json.
    if (!isLamp && !UNNAMED_OK.has(t.amenity) && t.man_made !== 'water_tap') continue
    const lon = el.type === 'node' ? el.lon : el.center?.lon
    const lat = el.type === 'node' ? el.lat : el.center?.lat
    if (lon == null || !inCampus(lon, lat)) continue
    const cat = classify(t)
    if (!cat) continue
    const id = `${el.type[0]}${el.id}`
    const label = { bicycle_parking: 'Bike parking', drinking_water: 'Drinking water',
      atm: 'ATM', toilets: 'Toilets', vending_machine: 'Vending machine',
      water_point: 'Water point', bicycle_repair_station: 'Bike repair',
      parking: 'Parking' }[t.amenity] ||
      (isLamp ? 'Street light' : isGate ? 'Gate' : t.man_made === 'water_tap' ? 'Water tap' : 'Facility')
    byId.set(id, {
      id, name: label, cat, unnamed: true,
      lon: +lon.toFixed(6), lat: +lat.toFixed(6),
      src: 'osm', osm: `${el.type}/${el.id}`,
      ...(t.opening_hours ? { hours: t.opening_hours } : {}),
      ...(t.wheelchair ? { wheelchair: t.wheelchair } : {}),
      ...(t.capacity ? { capacity: t.capacity } : {}),
      ...(t.covered ? { covered: t.covered } : {}),
      ...(t.drinking_water === 'no' ? { potable: 'no' } : {}),
      ...(t.lampType ? { lampType: t.lamp_type } : {}),
      ...(t.support ? { support: t.support } : {}),
      kind: t.amenity || t.man_made || t.highway || t.barrier,
    })
  }

  const curated = {}
  if (existsSync(CURATED)) {
    for (const f of (await readdir(CURATED)).filter((f) => f.endsWith('.json'))) {
      curated[f.replace(/\.json$/, '')] = JSON.parse(await readFile(join(CURATED, f), 'utf8'))
    }
  }

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const anchors = new Map()
  for (const p of byId.values()) {
    const k = norm(p.name)
    if (!anchors.has(k) || CATEGORIES[p.cat]?.pin) anchors.set(k, p)
    if (p.alt) {
      const ak = norm(p.alt)
      if (!anchors.has(ak) || CATEGORIES[p.cat]?.pin) anchors.set(ak, p)
    }
    for (const a of p.aliases ?? []) {
      const nk = norm(a)
      if (!anchors.has(nk)) anchors.set(nk, p)
    }
  }

  function resolveAnchor(anchor, who) {
    if (!anchor) return null
    const hit = anchors.get(norm(anchor))
    if (!hit) { warn(`unresolved anchor "${anchor}" (from ${who})`); return null }
    return hit
  }

  let curatedCount = 0
  for (const p of curated.places?.items ?? []) {
    if (anchors.has(norm(p.name))) {
      warn(`curated "${p.name}" now exists in OSM — delete it from places.json`)
      continue
    }
    if (p.lat != null && p.lon != null) {
      if (p.cat !== 'gate' && !inOrOnCampus(p.lon, p.lat)) { warn(`curated "${p.id}" is outside the campus boundary`); continue }
      const { anchor, ...rest } = p
      void anchor
      byId.set(p.id, { ...rest, lat: +(+p.lat).toFixed(6), lon: +(+p.lon).toFixed(6), src: 'seed' })
      curatedCount++
      continue
    }
    const a = resolveAnchor(p.anchor, `places/${p.id}`)
    if (!a) continue
    const seed = [...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
    const ang = (seed % 360) * (Math.PI / 180)
    const dist = 8 + (seed % 11)
    const dLat = (dist * Math.cos(ang)) / 111320
    const dLon = (dist * Math.sin(ang)) / (111320 * Math.cos(rad(a.lat)))
    byId.set(p.id, {
      ...p,
      lat: +(a.lat + dLat).toFixed(6),
      lon: +(a.lon + dLon).toFixed(6),
      src: 'seed',
      near: a.name,
    })
    curatedCount++
  }

  const prpF = []
  for (const b of curated.prp?.blocks ?? []) {
    const ring = b.ring
    if (!ring?.length) continue
    const closed = (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
      ? ring : [...ring, ring[0]]
    const [lon, lat] = centroid(closed.map(([x, y]) => ({ lon: x, lat: y })))
    const roomBits = (b.floors ?? []).flatMap((f) => f.rooms ? [f.rooms] : [])
    const aliases = ['PRP', 'Perl Research Park', `Block ${b.letter}`, `PRP ${b.letter}`]
    byId.set(b.id, {
      id: b.id,
      name: b.name,
      cat: 'prp',
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      src: 'seed',
      floors: b.floors ?? [],
      color: b.color,
      letter: b.letter,
      aliases,
      desc: roomBits.length ? `Classrooms ${roomBits.join(' · ')}` : undefined,
      kind: 'prp-block',
    })
    curatedCount++
    prpF.push({
      type: 'Feature',
      properties: { id: b.id, name: b.name, letter: b.letter, color: b.color, floors: (b.floors ?? []).length },
      geometry: { type: 'Polygon', coordinates: [closed] },
    })
  }

  for (const p of byId.values()) {
    const k = norm(p.name)
    if (!anchors.has(k) || CATEGORIES[p.cat]?.pin) anchors.set(k, p)
  }

  const BUILDING_ALIASES = {
    sjt: 'SJT', 'silver jubilee tower': 'SJT',
    tt: 'TT', 'technology tower': 'TT',
    cdmr: 'CDMM', cdmm: 'CDMM',
    smv: 'SMV', gdn: 'GDN', prp: 'PRP',
    mgb: 'MGB', mgr: 'MGB',
    'main block': 'Main Building', 'main building': 'Main Building',
    library: 'EV Periyar Library',
  }

  function locateFaculty(f) {
    if (f.office) {
      for (const [alias, real] of Object.entries(BUILDING_ALIASES)) {
        const re = new RegExp(`(^|[\\s,(])${alias.replace(/[-]/g, '[- ]?')}([\\s,)]|$)`, 'i')
        if (re.test(f.office) && anchors.has(norm(real))) return { at: real, via: 'office' }
      }
      for (const p of byId.values()) {
        if (p.unnamed || p.name.length < 3) continue
        if (norm(f.office).includes(norm(p.name))) return { at: p.name, via: 'office' }
      }
    }
    return null
  }

  const live = {}
  if (existsSync(LIVE)) {
    for (const f of (await readdir(LIVE)).filter((f) => f.endsWith('.json'))) {
      live[f.replace(/\.json$/, '')] = JSON.parse(await readFile(join(LIVE, f), 'utf8'))
    }
  }

  let located = 0
  for (const f of live.faculty?.items ?? []) {
    const hit = locateFaculty(f)
    if (hit) { f.at = hit.at; f.atVia = hit.via; located++ }
  }
  if (live.faculty) live.faculty._located = located

  const MESS_AT = {
    'MH Special Mess': ['MH Special Mess', 'Darling SPL Mess', 'Darling'],
    'MH Veg Mess': ['MH Veg Mess', 'PR Caterers'],
    'MH Non-Veg Mess': ['MH Non-Veg Mess', 'PR Caterers Special Mess', 'Street Bites'],
    'LH Special Mess': ['LH Special Mess', 'N Block'],
    'LH Veg Mess': ['LH Veg Mess'],
    'LH Non-Veg Mess': ['LH Non-Veg Mess'],
  }
  let messLocated = 0
  for (const h of live.mess?.halls ?? []) {
    const cand = [
      ...(MESS_AT[h.name] ?? []),
      h.name,
      `${h.name.replace(/ Mess$/, '')} Mess`,
    ]
    for (const c of cand) {
      if (anchors.has(norm(c))) { h.at = anchors.get(norm(c)).name; messLocated++; break }
    }
    if (!h.at) warn(`mess hall "${h.name}" has no matching OSM feature`)
  }

  const atPoint = new Map()
  for (const p of [...byId.values()]) {
    const k = `${norm(p.name)}@${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
    const hit = atPoint.get(k)
    if (!hit) { atPoint.set(k, p); continue }
    const score = (x) => Object.keys(x).length + (x.unnamed ? -5 : 0)
    if (score(p) > score(hit)) { byId.delete(hit.id); atPoint.set(k, p) } else { byId.delete(p.id) }
  }

  const poiList = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))

  const fc = (features) => ({ type: 'FeatureCollection', features })
  const lineOf = (el, props) => ({
    type: 'Feature',
    properties: props,
    geometry: { type: 'LineString', coordinates: el.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)]) },
  })
  const polyOf = (el, props) => {
    const c = el.geometry.map((p) => [+p.lon.toFixed(6), +p.lat.toFixed(6)])
    const first = c[0], last = c[c.length - 1]
    if (first[0] !== last[0] || first[1] !== last[1]) c.push(first)
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [c] } }
  }
  const touchesCampus = (el) => el.geometry?.some((p) => inCampus(p.lon, p.lat))

  const buildingF = []
  const buildingProps = (t) => ({
    name: t.name || '',
    cat: (t.name ? classify(t) : null) || '',
    levels: +(t['building:levels'] || 0) || 0,
    construction: t.building === 'construction',
  })
  // SJT, TT, SMV, GDN, Main Building and every hostel block are multipolygon
  // relations (courtyard buildings), not closed ways. Without these the map
  // was missing most of the campus it exists to show.
  const relMembers = new Set()
  for (const el of buildings.elements) {
    if (el.type !== 'relation' || !el.members) continue
    for (const m of el.members) if (m.type === 'way') relMembers.add(m.ref)
    const outers = stitchOuterRings(el.members)
    if (!outers.length || !outers.some((r) => r.some(([lon, lat]) => inCampus(lon, lat)))) continue
    const inners = stitchOuterRings(el.members
      .filter((m) => m.role === 'inner')
      .map((m) => ({ ...m, role: 'outer' })))
    const round = (r) => r.map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)])
    const polys = outers.map((o) => [
      round(o),
      ...inners.filter((h) => pointInRing(h[0][0], h[0][1], o)).map(round),
    ])
    buildingF.push({
      type: 'Feature',
      properties: buildingProps(el.tags || {}),
      geometry: polys.length === 1
        ? { type: 'Polygon', coordinates: polys[0] }
        : { type: 'MultiPolygon', coordinates: polys },
    })
  }
  for (const el of buildings.elements) {
    if (el.type !== 'way' || relMembers.has(el.id)) continue
    if (!el.geometry || el.geometry.length < 3 || !touchesCampus(el)) continue
    buildingF.push(polyOf(el, buildingProps(el.tags || {})))
  }

  const PATH_KINDS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'corridor'])
  const pathF = [], roadF = []
  for (const el of highways.elements) {
    if (!el.geometry || el.geometry.length < 2 || !touchesCampus(el)) continue
    const t = el.tags || {}
    const hw = t.highway
    const props = { name: t.name || '', hw, lit: t.lit || '', surface: t.surface || '', tunnel: t.tunnel || '' }
    if (PATH_KINDS.has(hw)) pathF.push(lineOf(el, props))
    else roadF.push(lineOf(el, props))
  }

  const greenF = [], waterF = [], waterLineF = [], wallF = [], railF = []
  for (const el of land.elements) {
    if (!el.geometry) continue
    const t = el.tags || {}
    // The Chennai–Bengaluru main line runs *between* the two campus plots, so
    // it never touches either one — but it is the landmark that splits the
    // map, so it is kept whole (the fetch bbox already bounds it).
    if (t.railway === 'rail') { railF.push(lineOf(el, { kind: t.railway, usage: t.usage || '' })); continue }
    if (!touchesCampus(el)) continue
    if (t.railway && t.railway !== 'station') { railF.push(lineOf(el, { kind: t.railway })); continue }
    if (t.waterway) { waterLineF.push(lineOf(el, { kind: t.waterway })); continue }
    if (t.barrier) { wallF.push(lineOf(el, { kind: t.barrier })); continue }
    if (el.geometry.length < 3) continue
    if (t.natural === 'water') { waterF.push(polyOf(el, { kind: 'water' })); continue }
    const g = t.landuse || t.natural
    if (['forest', 'wood', 'grass', 'grassland', 'recreation_ground', 'orchard',
         'plant_nursery', 'meadow', 'scrub', 'village_green'].includes(g)) {
      greenF.push(polyOf(el, { kind: g }))
    }
  }
  for (const el of pois.elements) {
    const t = el.tags || {}
    if (!['pitch', 'track', 'playground', 'garden', 'park'].includes(t.leisure)) continue
    if (!el.geometry || el.geometry.length < 3 || !touchesCampus(el)) continue
    greenF.push(polyOf(el, { kind: t.leisure }))
  }

  const overlayF = []
  for (const ov of curated.overlays?.items ?? []) {
    if (!ov.coordinates?.length) continue
    overlayF.push({
      type: 'Feature',
      properties: { name: ov.name || '', kind: ov.kind || 'path' },
      geometry: { type: 'LineString', coordinates: ov.coordinates },
    })
  }

  let minlon = 180, minlat = 90, maxlon = -180, maxlat = -90
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minlon) minlon = lon
      if (lat < minlat) minlat = lat
      if (lon > maxlon) maxlon = lon
      if (lat > maxlat) maxlat = lat
    }
  }
  const PAD = 0.0025
  const bounds = [[minlon - PAD, minlat - PAD], [maxlon + PAD, maxlat + PAD]]

  // Outer ring bigger than the pan limits, campus polygons as holes — paints
  // everything outside the wall black so the map is only readable on campus.
  const signedArea = (ring) => {
    let a = 0
    for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a
  }
  const OUTER = 0.08
  const outer = [
    [minlon - OUTER, minlat - OUTER],
    [maxlon + OUTER, minlat - OUTER],
    [maxlon + OUTER, maxlat + OUTER],
    [minlon - OUTER, maxlat + OUTER],
    [minlon - OUTER, minlat - OUTER],
  ]
  const holes = rings.map((ring) => {
    const closed = (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1])
      ? ring.slice() : [...ring, ring[0]]
    return signedArea(closed) > 0 ? closed.slice().reverse() : closed
  })
  const maskF = [{
    type: 'Feature',
    properties: { name: 'outside-campus' },
    geometry: { type: 'Polygon', coordinates: [outer, ...holes] },
  }]

  const geo = {
    boundary: fc(rings.map((ring) => ({
      type: 'Feature',
      properties: { name: bRel?.tags?.name || bWay?.tags?.name || 'VIT Vellore' },
      geometry: { type: 'Polygon', coordinates: [ring] },
    }))),
    mask: fc(maskF),
    green: fc(greenF),
    water: fc(waterF),
    waterway: fc(waterLineF),
    wall: fc(wallF),
    rail: fc(railF),
    roads: fc(roadF),
    paths: fc(pathF),
    buildings: fc(buildingF),
    overlays: fc(overlayF),
    prp: fc(prpF),
  }

  const key = (lat, lon) => `${lat.toFixed(7)},${lon.toFixed(7)}`
  const nodeIndex = new Map()
  const nodeLat = [], nodeLon = []
  const getNode = (lat, lon) => {
    const k = key(lat, lon)
    let i = nodeIndex.get(k)
    if (i === undefined) {
      i = nodeLat.length
      nodeIndex.set(k, i)
      nodeLat.push(+lat.toFixed(6))
      nodeLon.push(+lon.toFixed(6))
    }
    return i
  }

  const WALK = 1.35
  const BIKE = 4.2

  function speeds(t) {
    const hw = t.highway
    if (hw === 'steps') return { foot: WALK * 0.45, bike: 0.6, dismount: true }
    if (hw === 'corridor') return { foot: WALK * 0.85, bike: 0.9, indoor: true }
    if (hw === 'cycleway') return { foot: WALK, bike: BIKE }
    if (hw === 'footway' || hw === 'pedestrian' || hw === 'path') {
      const bikeOk = t.bicycle !== 'no'
      return { foot: WALK, bike: bikeOk ? BIKE * 0.72 : 0 }
    }
    if (hw === 'track') return { foot: WALK * 0.9, bike: BIKE * 0.6 }
    if (hw === 'service' || hw === 'living_street' || hw === 'residential' ||
        hw === 'unclassified') return { foot: WALK, bike: BIKE }
    if (hw === 'tertiary' || hw === 'secondary' || hw === 'tertiary_link') {
      return { foot: WALK * 0.95, bike: BIKE }
    }
    if (hw === 'trunk' || hw === 'primary' || hw === 'trunk_link' || hw === 'motorway') {
      if (t.foot === 'no') return { foot: 0, bike: BIKE }
      return { foot: WALK * 0.6, bike: BIKE * 0.9 }
    }
    return { foot: WALK, bike: BIKE * 0.8 }
  }

  const edges = []
  const FLAG_STEPS = 1, FLAG_INDOOR = 2, FLAG_LIT = 4, FLAG_SHORTCUT = 8

  for (const el of highways.elements) {
    if (!el.geometry || el.geometry.length < 2) continue
    const t = el.tags || {}
    if (t.access === 'private' || t.access === 'no') continue
    if (!el.geometry.some((p) => inCampus(p.lon, p.lat))) continue

    const sp = speeds(t)
    let flags = 0
    if (sp.dismount) flags |= FLAG_STEPS
    if (sp.indoor) flags |= FLAG_INDOOR
    if (t.lit === 'yes') flags |= FLAG_LIT
    if ((t.highway === 'path' || t.highway === 'track') &&
        !['paved', 'asphalt', 'concrete', 'paving_stones'].includes(t.surface)) {
      flags |= FLAG_SHORTCUT
    }

    for (let i = 0; i < el.geometry.length - 1; i++) {
      const p = el.geometry[i], q = el.geometry[i + 1]
      const a = getNode(p.lat, p.lon), b = getNode(q.lat, q.lon)
      if (a === b) continue
      const m = haversine(p.lat, p.lon, q.lat, q.lon)
      if (m < 0.05) continue
      const round2 = (x) => Math.round(x * 100) / 100
      const footSec = sp.foot > 0 ? round2(m / sp.foot) : -1
      const bikeSec = sp.bike > 0 ? round2(m / sp.bike) : -1
      edges.push([a, b, Math.round(m * 10) / 10, footSec, bikeSec, flags])
    }
  }

  const adj = Array.from({ length: nodeLat.length }, () => [])
  edges.forEach(([a, b], i) => { adj[a].push(i); adj[b].push(i) })
  const comp = new Int32Array(nodeLat.length).fill(-1)
  let best = -1, bestSize = 0
  for (let s = 0, c = 0; s < nodeLat.length; s++) {
    if (comp[s] !== -1) continue
    let size = 0
    const stack = [s]
    comp[s] = c
    while (stack.length) {
      const n = stack.pop(); size++
      for (const ei of adj[n]) {
        const e = edges[ei]
        const o = e[0] === n ? e[1] : e[0]
        if (comp[o] === -1) { comp[o] = c; stack.push(o) }
      }
    }
    if (size > bestSize) { bestSize = size; best = c }
    c++
  }

  const remap = new Int32Array(nodeLat.length).fill(-1)
  const gLat = [], gLon = []
  for (let i = 0; i < nodeLat.length; i++) {
    if (comp[i] !== best) continue
    remap[i] = gLat.length
    gLat.push(nodeLat[i]); gLon.push(nodeLon[i])
  }
  const gEdges = []
  for (const [a, b, m, f, k, fl] of edges) {
    if (comp[a] !== best) continue
    gEdges.push([remap[a], remap[b], m, f, k, fl])
  }

  const graph = {
    note: 'Costs are seconds; -1 = that profile cannot use the edge. flags: 1=steps 2=indoor 4=lit 8=unpaved-shortcut',
    lat: gLat, lon: gLon, edges: gEdges,
    dropped: nodeLat.length - gLat.length,
  }

  const counts = {}
  for (const p of poiList) counts[p.cat] = (counts[p.cat] || 0) + 1

  const campus = {
    meta: {
      name: 'VIT Vellore',
      built: new Date().toISOString().slice(0, 10),
      center: [79.16066, 12.96975],
      bounds,
      attribution: '© OpenStreetMap contributors (ODbL)',
      osm: 'relation/15931944',
      counts,
    },
    categories: CATEGORIES,
    pois: poiList,
    ...curated,
    ...live,
  }

  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, 'campus.json'), JSON.stringify(campus))
  await writeFile(join(OUT, 'geo.json'), JSON.stringify(geo))
  await writeFile(join(OUT, 'graph.json'), JSON.stringify(graph))

  const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0) + ' kB'
  console.log(`pois       ${poiList.length} (${poiList.length - curatedCount} osm + ${curatedCount} curated)`)
  console.log(`  ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`)
  console.log(`geo        ${buildingF.length} buildings, ${pathF.length} paths, ${roadF.length} roads, ${greenF.length} green, ${railF.length} rail`)
  console.log(`graph      ${gLat.length} nodes, ${gEdges.length} edges (${graph.dropped} off-network nodes dropped)`)
  for (const k of Object.keys(curated)) {
    console.log(`curated    ${k}: ${curated[k]?.items?.length ?? 0} items`)
  }
  for (const k of Object.keys(live)) {
    const v = live[k]
    const extra = k === 'faculty' ? ` (${v._located ?? 0} placed on map)`
      : k === 'mess' ? ` across ${v.halls?.length ?? 0} halls` : ''
    console.log(`live       ${k}: ${v.items?.length ?? 0} items${extra}  <- ${v._source}`)
  }
  console.log(`output     campus ${kb(campus)}, geo ${kb(geo)}, graph ${kb(graph)}`)
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`)
    for (const w of [...new Set(warnings)].slice(0, 25)) console.log(`  ! ${w}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
