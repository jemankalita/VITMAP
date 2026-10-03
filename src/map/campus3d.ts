/**
 * The rest of campus as a 3D model, in the same visual language as the PRP
 * model: every OSM building gets window bands, a parapet and a roof; woods,
 * scrub and lawns get trees; the campus wall gets a body. Bright on purpose —
 * the buildings are the subject, the dark map is the stage.
 *
 * Heights: OSM `building:levels` when someone has mapped it, otherwise a
 * guess from what is inside the footprint (a named academic block, a hostel,
 * a canteen) and finally from footprint area. Mapping `building:levels` in
 * OpenStreetMap replaces the guess on the next build.
 */

import type { Poi } from '../types'
import {
  type Model, type ModelFeature, type Pt, type Ring,
  areaM2, centroid, hash01, ngonAt, pointInRing, radiusM, scaleRing, segmentQuad, solid, squareAt,
} from './geom3d'

const FLOOR_M = 3.4
const SLAB_M = 1.0
const MAX_TREES = 1800

interface Skin { wall: string; glass: string; roof: string }
type Box = [number, number, number, number]

const SKINS: Record<'academic' | 'hostel' | 'food' | 'sports' | 'plain' | 'site', Skin> = {
  academic: { wall: '#f1efe9', glass: '#7d93c2', roof: '#c3cbd6' },
  hostel: { wall: '#f4e7d4', glass: '#8c9bb3', roof: '#d98b5f' },
  food: { wall: '#f2e0c6', glass: '#a08e78', roof: '#e0a458' },
  sports: { wall: '#e7ece4', glass: '#7fa08a', roof: '#9fc28f' },
  plain: { wall: '#ece6dc', glass: '#9aa3b0', roof: '#c8bfb2' },
  site: { wall: '#cfcac1', glass: '#b3ada3', roof: '#bdb7ad' },
}

const TREE_GREENS = ['#2f6a36', '#3a7a3c', '#467f3a', '#2c5f3a']
const TRUNK = '#6b4f36'
const WALL = '#cfc6b6'

function polygons(g: GeoJSON.Geometry): { ring: Ring; holes: Ring[] }[] {
  const one = (p: GeoJSON.Position[][]) => ({ ring: p[0] as Ring, holes: p.slice(1) as Ring[] })
  if (g.type === 'Polygon') return [one(g.coordinates)]
  if (g.type === 'MultiPolygon') return g.coordinates.map(one)
  return []
}

const outerRings = (g: GeoJSON.Geometry): Ring[] => polygons(g).map((p) => p.ring)

function bbox(r: Ring): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  return [x0, y0, x1, y1]
}

const inBox = ([x, y]: Pt, b: Box) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]

/* ── buildings ─────────────────────────────────────────────────────────── */

const TALL_ACADEMIC = /\b(SJT|Silver Jubilee|Technology Tower|TT|SMV|Visvesvaraya|GDN|Naidu|MGB|Mahatma Gandhi|CDMM)\b/i
const HOSTELISH = /\b[A-Z] Block\b|Hostel/i

export function guessFloors(name: string, levels: number, inside: readonly Poi[], area: number): number {
  if (levels > 0) return levels
  const cats = new Set(inside.map((p) => p.cat))
  const names = [name, ...inside.map((p) => p.name)].join(' ')
  // Named academic blocks first: "Silver Jubilee Tower" is not a hostel.
  if (TALL_ACADEMIC.test(names)) return 8
  if (cats.has('hostel') || HOSTELISH.test(name)) return area > 600 ? 10 : 6
  if (cats.has('academic') || cats.has('lecture')) return area > 1500 ? 6 : 4
  if (cats.has('canteen') || cats.has('shop') || cats.has('atm') || cats.has('laundry')) return area > 800 ? 2 : 1
  if (area > 3000) return 4
  if (area > 1200) return 3
  if (area > 300) return 2
  return 1
}

function skinFor(name: string, inside: readonly Poi[]): Skin {
  const cats = new Set(inside.map((p) => p.cat))
  if (TALL_ACADEMIC.test(name)) return SKINS.academic
  if (cats.has('hostel') || HOSTELISH.test(name)) return SKINS.hostel
  if (cats.has('canteen') || cats.has('shop') || /Food|Bakery|Plaza|Bites/i.test(name)) return SKINS.food
  if (cats.has('sports') || /Stadium|Sports/i.test(name)) return SKINS.sports
  if (cats.has('academic') || cats.has('lecture')) return SKINS.academic
  return SKINS.plain
}

/** Grow a courtyard outward by `m` metres, so glass sets back on that face too. */
const widen = (hole: Ring, m: number) => scaleRing(hole, 1 + m / Math.max(radiusM(hole), m * 2))

function building(id: string, ring: Ring, holes: Ring[], floors: number, skin: Skin): ModelFeature[] {
  const h = floors * FLOOR_M
  const r = radiusM(ring)
  // Sheds and kiosks: a plain box with a coloured lid reads better than bands.
  if (floors <= 1 || r < 6) {
    return [solid(id, ring, skin.wall, 0, h, holes), solid(id, ring, skin.roof, h, h + 0.35, holes)]
  }
  const slabs = Array.from({ length: floors - 1 }, (_, i) => {
    const at = (i + 1) * FLOOR_M
    return solid(id, ring, skin.wall, at - SLAB_M / 2, at + SLAB_M / 2, holes)
  })
  // A rooftop plant room scaled about the centroid would float in a
  // courtyard, so ring buildings go without one.
  const plant = scaleRing(ring, 0.3)
  const hasPlant = floors >= 5 && !holes.length
  return [
    solid(id, scaleRing(ring, Math.max(0.85, 1 - 0.8 / r)), skin.glass, 0, h, holes.map((x) => widen(x, 0.8))),
    solid(id, ring, skin.wall, 0, 0.8, holes),
    ...slabs,
    solid(id, ring, skin.wall, h - 0.2, h + 0.6, holes),
    solid(id, scaleRing(ring, Math.max(0.6, 1 - 1.2 / r)), skin.roof, h + 0.6, h + 0.85, holes.map((x) => widen(x, 1.2))),
    ...(hasPlant ? [solid(id, plant, skin.wall, h + 0.85, h + 3.6), solid(id, plant, skin.roof, h + 3.6, h + 3.9)] : []),
  ]
}

/* ── trees and walls ───────────────────────────────────────────────────── */

const SPACING: Record<string, number> = { wood: 9, scrub: 15, grass: 24 }

function treeAt(id: string, p: Pt, j: number, kind: string): ModelFeature[] {
  const crown = 1.8 + j * 1.6
  const top = (kind === 'scrub' ? 3.5 : 6) + j * 4
  return [
    solid(id, squareAt(p, 0.5), TRUNK, 0, top * 0.35),
    solid(id, ngonAt(p, crown, 7), TREE_GREENS[Math.floor(j * TREE_GREENS.length)]!, top * 0.3, top),
  ]
}

/** Trees on a jittered grid inside each green area, never inside a building. */
function trees(green: GeoJSON.FeatureCollection, blockers: readonly { ring: Ring; box: Box }[]): ModelFeature[] {
  const out: ModelFeature[] = []
  let count = 0
  for (const f of green.features) {
    const kind = String(f.properties?.kind ?? '')
    const step = SPACING[kind]
    if (!step) continue
    for (const ring of outerRings(f.geometry)) {
      const box = bbox(ring)
      const dLat = step / 110574
      const dLon = step / (111320 * Math.cos((((box[1] + box[3]) / 2) * Math.PI) / 180))
      for (let lat = box[1] + dLat / 2; lat < box[3]; lat += dLat) {
        for (let lon = box[0] + dLon / 2; lon < box[2]; lon += dLon) {
          if (count >= MAX_TREES) return out
          const j = hash01(`${lon.toFixed(6)},${lat.toFixed(6)}`)
          const p: Pt = [lon + (j - 0.5) * dLon * 0.8, lat + (hash01(`${j}`) - 0.5) * dLat * 0.8]
          if (!pointInRing(p, ring)) continue
          if (blockers.some((b) => inBox(p, b.box) && pointInRing(p, b.ring))) continue
          out.push(...treeAt(`tree-${count++}`, p, j, kind))
        }
      }
    }
  }
  return out
}

function walls(wall: GeoJSON.FeatureCollection): ModelFeature[] {
  return wall.features.flatMap((f) => {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates]
      : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : []
    return lines.flatMap((line) => line.slice(1).flatMap((b, i) => {
      const q = segmentQuad(line[i] as Pt, b as Pt, 0.35)
      return q ? [solid('campus-wall', q, WALL, 0, 2.4)] : []
    }))
  })
}

/* ── model ─────────────────────────────────────────────────────────────── */

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

export function buildCampusModel(
  geo: Record<string, GeoJSON.FeatureCollection | undefined>,
  pois: readonly Poi[],
): Model {
  const prpRings = (geo.prp?.features ?? []).flatMap((f) => outerRings(f.geometry))
  const features: ModelFeature[] = []
  const blockers: { ring: Ring; box: Box }[] = []

  for (const [i, f] of (geo.buildings?.features ?? []).entries()) {
    const name = String(f.properties?.name ?? '')
    if (name === 'Perl Research Park') continue // modelled in detail by prp3d
    for (const { ring, holes } of polygons(f.geometry)) {
      if (ring.length < 4 || prpRings.some((r) => pointInRing(centroid(ring), r))) continue
      const box = bbox(ring)
      blockers.push({ ring, box })
      const inside = pois.filter((p) => inBox([p.lon, p.lat], box) && pointInRing([p.lon, p.lat], ring))
      // A construction site is a low, plain slab until it is finished in OSM.
      const site = f.properties?.construction === true
      const floors = site ? 1 : guessFloors(name, Number(f.properties?.levels) || 0, inside, areaM2(ring))
      features.push(...building(`bldg-${i}`, ring, holes, floors, site ? SKINS.site : skinFor(name, inside)))
    }
  }

  return {
    type: 'FeatureCollection',
    features: [...features, ...trees(geo.green ?? EMPTY, blockers), ...walls(geo.wall ?? EMPTY)],
  }
}
