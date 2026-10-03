/**
 * Pearl Research Park as a 3D model, after the site sign at the Jimmy Carter
 * Road entrance: white eight-storey blocks banded with window rows, blue
 * corner piers, a coloured roof per block (A blue, B orange, C yellow,
 * D indigo, E green), the blue clock-tower entrance with its canopy, and the
 * courtyard of lawns and cypress rows opening north onto the road.
 *
 * Built from the block footprints in data/curated/prp.json, so the model sits
 * exactly where the clickable block outlines are. Everything is plain GeoJSON
 * for one fill-extrusion layer (`part` = solid) and one ground fill layer
 * (`part` = ground); each feature carries its own colour, base and top.
 */

import {
  type Model, type ModelFeature as Feature, type Ring,
  M_PER_DEG_LAT, mPerDegLon, close, centroid, corners, ground, radiusM, scaleRing, solid, squareAt,
} from './geom3d'

const FLOOR_M = 3.6
const SLAB_M = 1.15
const DEFAULT_FLOORS = 8

const WHITE = '#f3f4f0'
const GLASS = '#6f86b9'
const PIER = '#3c56b4'
const LAWN = '#9acd5c'
const HEDGE = '#4c8a3e'
const TREE = '#2f6a36'
const PAVING = '#d9d4ca'
const SHED_ROOF = '#e0582c'
const POST = '#e6e2da'

/** Roof colours read off the sign, by block letter. */
const ROOF: Record<string, string> = {
  A: '#2f9de4',
  B: '#e9672f',
  C: '#d6e33c',
  F: '#d6e33c',
  D: '#5a62d6',
  E: '#8cc77a',
  X: '#3f63c6',
  N: '#b9b4aa',
}

/** Courtyard origin and axis: the central drive, ~7° west of north. */
const ORIGIN: [number, number] = [79.16632, 12.9718]
const AXIS_DEG = 7
/** Jimmy Carter Road along the park frontage (OSM way 1543114451). */
const ROAD_A: [number, number] = [79.1656, 12.972183]
const ROAD_B: [number, number] = [79.166251, 12.972357]

/* ── geometry helpers ──────────────────────────────────────────────────── */

/** Point in the courtyard frame: x metres across, y metres toward the road. */
function local(x: number, y: number): [number, number] {
  const t = (AXIS_DEG * Math.PI) / 180
  const east = x * Math.cos(t) - y * Math.sin(t)
  const north = x * Math.sin(t) + y * Math.cos(t)
  return [ORIGIN[0] + east / mPerDegLon(ORIGIN[1]), ORIGIN[1] + north / M_PER_DEG_LAT]
}

function rectLocal(cx: number, cy: number, w: number, h: number): Ring {
  return close([
    local(cx - w / 2, cy - h / 2), local(cx + w / 2, cy - h / 2),
    local(cx + w / 2, cy + h / 2), local(cx - w / 2, cy + h / 2),
  ])
}

function polyLocal(cx: number, cy: number, r: number, sides: number, rot = Math.PI / sides): Ring {
  const pts: [number, number][] = []
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides
    pts.push(local(cx + r * Math.cos(a), cy + r * Math.sin(a)))
  }
  return close(pts)
}

/** Strip parallel to segment a→b, from `t0`..`t1` metres along, `near`..`far` metres to its south. */
function stripAlong(a: [number, number], b: [number, number], t0: number, t1: number, near: number, far: number): Ring {
  const kx = mPerDegLon(a[1])
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * M_PER_DEG_LAT
  const len = Math.hypot(dx, dy)
  const ux = dx / len, uy = dy / len
  const nx = uy, ny = -ux // right-hand normal: south of an eastbound road
  const at = (t: number, off: number): [number, number] => [
    a[0] + (ux * t + nx * off) / kx,
    a[1] + (uy * t + ny * off) / M_PER_DEG_LAT,
  ]
  return close([at(t0, near), at(t1, near), at(t1, far), at(t0, far)])
}

/* ── model ─────────────────────────────────────────────────────────────── */

interface BlockIn { id: string; letter: string; floors: number; ring: Ring }

function block(b: BlockIn): Feature[] {
  const out: Feature[] = []
  const roof = ROOF[b.letter] ?? '#c8c2b8'
  const isEntry = b.letter === 'X'
  const isAnnex = b.letter === 'N'
  const floors = isEntry ? b.floors + 1 : b.floors
  const h = floors * FLOOR_M
  const r = radiusM(b.ring)

  const glassBody = scaleRing(b.ring, Math.max(0.8, 1 - 0.9 / r))

  // Window rows: a recessed glass body, then a white slab at every floor line.
  out.push(solid(b.id, glassBody, isEntry ? '#4a6cc9' : GLASS, 0, h))
  out.push(solid(b.id, b.ring, isAnnex ? '#ddd9d0' : '#8ea0c8', 0, 0.9))
  for (let k = 1; k < floors; k++) {
    out.push(solid(b.id, b.ring, WHITE, k * FLOOR_M - SLAB_M / 2, k * FLOOR_M + SLAB_M / 2))
  }

  // Blue corner piers, the strongest vertical in the sign's facades.
  if (!isAnnex) {
    for (const c of corners(b.ring)) out.push(solid(b.id, squareAt(c, 2.2), PIER, 0, h + 0.5))
  }

  // White parapet with the block's sign colour inside it, then a penthouse.
  out.push(solid(b.id, b.ring, WHITE, h - 0.1, h + 0.5))
  out.push(solid(b.id, scaleRing(b.ring, Math.max(0.6, 1 - 1.4 / r)), roof, h + 0.5, h + 0.9))
  if (!isAnnex) {
    const pent = scaleRing(b.ring, 0.42)
    out.push(solid(b.id, pent, WHITE, h + 0.9, h + 4))
    out.push(solid(b.id, pent, roof, h + 4, h + 4.5))
  }

  // The clock tower: a slim white shaft over the entrance block.
  if (isEntry) {
    const shaft = scaleRing(b.ring, 0.3)
    out.push(solid(b.id, shaft, WHITE, h + 4.5, h + 10))
    out.push(solid(b.id, shaft, ROOF.X!, h + 10, h + 10.8))
  }
  return out
}

/** Canopy and columns in front of the entrance, facing the courtyard. */
function canopy(id: string, entry: Ring): Feature[] {
  const [cx, cy] = centroid(entry)
  const kx = mPerDegLon(cy)
  const dx = (ORIGIN[0] - cx) * kx, dy = (ORIGIN[1] - cy) * M_PER_DEG_LAT
  const len = Math.hypot(dx, dy)
  const ux = dx / len, uy = dy / len // toward the courtyard
  const vx = -uy, vy = ux // across
  const pt = (along: number, across: number): [number, number] => [
    cx + (ux * along + vx * across) / kx,
    cy + (uy * along + vy * across) / M_PER_DEG_LAT,
  ]
  const r = radiusM(entry)
  const a0 = r * 0.6, a1 = r + 9
  const out: Feature[] = [solid(id, close([pt(a0, -9), pt(a1, -9), pt(a1, 9), pt(a0, 9)]), WHITE, 5, 5.8)]
  for (const across of [-8, -2.7, 2.7, 8]) out.push(solid(id, squareAt(pt(a1 - 0.8, across), 0.7), POST, 0, 5))
  return out
}

function tree(id: string, x: number, y: number, k: number): Feature {
  return solid(id, polyLocal(x, y, 1.25, 8), TREE, 0, 6 + ((k * 37) % 5))
}

function hedged(id: string, ring: Ring): Feature[] {
  return [solid(id, scaleRing(ring, 1.08), HEDGE, 0, 0.8), solid(id, ring, LAWN, 0, 0.82)]
}

function courtyard(): Feature[] {
  const id = 'prp-courtyard'
  const out: Feature[] = [ground(id, rectLocal(0, 2, 62, 96), PAVING)]
  let k = 0

  // Back: the octagonal lawn ringed by cypress, with a square lawn either side.
  out.push(...hedged(id, polyLocal(0, -27, 8.5, 8, Math.PI / 8)))
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4
    out.push(tree(id, 11 * Math.cos(a), -27 + 11 * Math.sin(a), k++))
  }
  for (const sx of [-1, 1]) {
    out.push(...hedged(id, rectLocal(sx * 20, -25, 9, 12)))
    out.push(tree(id, sx * 20, -33, k++), tree(id, sx * 25.5, -25, k++))
  }

  // Middle: a square lawn with a tree at each corner.
  out.push(...hedged(id, rectLocal(0, -5, 13, 13)))
  for (const [x, y] of [[-8.5, -12], [8.5, -12], [-8.5, 2], [8.5, 2]] as const) out.push(tree(id, x, y, k++))

  // Front: the long lawn pointing at the road, flanked by cypress rows.
  out.push(...hedged(id, close([local(-7, 7), local(7, 7), local(7, 31), local(0, 38), local(-7, 31)])))
  for (let y = 8; y <= 34; y += 4.5) out.push(tree(id, -10.5, y, k++), tree(id, 10.5, y, k++))

  // Side groves.
  for (const [x, y] of [[-22, 12], [-25, 16], [-21, 19], [23, 6], [26, 10], [22, 13]] as const) {
    out.push(tree(id, x, y, k++))
  }
  return out
}

/** The orange-roofed shed between the park and Jimmy Carter Road. */
function shed(): Feature[] {
  const id = 'prp-shed'
  const out: Feature[] = [solid(id, stripAlong(ROAD_A, ROAD_B, 12, 48, 3, 9), SHED_ROOF, 3.2, 3.9)]
  for (let t = 13; t <= 47; t += 5.6) {
    for (const off of [3.3, 8.7]) {
      out.push(solid(id, stripAlong(ROAD_A, ROAD_B, t, t + 0.35, off - 0.17, off + 0.17), POST, 0, 3.2))
    }
  }
  return out
}

export function buildPrpModel(
  prp: GeoJSON.FeatureCollection,
  floorsById: ReadonlyMap<string, number> = new Map(),
): Model {
  const blocks: BlockIn[] = []
  for (const f of prp.features) {
    if (f.geometry.type !== 'Polygon') continue
    const id = String(f.properties?.id ?? '')
    blocks.push({
      id,
      letter: String(f.properties?.letter ?? ''),
      floors: floorsById.get(id) || DEFAULT_FLOORS,
      ring: f.geometry.coordinates[0] as Ring,
    })
  }
  const entry = blocks.find((b) => b.letter === 'X')
  return {
    type: 'FeatureCollection',
    features: [
      ...courtyard(),
      ...shed(),
      ...blocks.flatMap(block),
      ...(entry ? canopy(entry.id, entry.ring) : []),
    ],
  }
}
