/**
 * Small planar-geometry kit for the 3D models (PRP and the rest of campus).
 * Rings are [lon, lat] pairs; distances are metres via a local equirectangular
 * projection, which is well inside a centimetre over a campus this size.
 */

export type Ring = [number, number][]
export type Pt = [number, number]

export interface ModelProps {
  id: string
  /** `solid` → fill-extrusion layer, `ground` → flat fill layer. */
  part: 'solid' | 'ground'
  color: string
  base: number
  top: number
}

export type ModelFeature = GeoJSON.Feature<GeoJSON.Polygon, ModelProps>
export type Model = GeoJSON.FeatureCollection<GeoJSON.Polygon, ModelProps>

export const M_PER_DEG_LAT = 110574
export const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180)

export function close(r: Ring): Ring {
  const a = r[0]!, b = r[r.length - 1]!
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a]
}

export function open(r: Ring): Ring {
  return close(r).slice(0, -1)
}

export function centroid(r: Ring): Pt {
  const pts = open(r)
  const n = pts.length
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]
}

/** Scale a ring about its vertex centroid — a cheap inset for compact footprints. */
export function scaleRing(r: Ring, k: number): Ring {
  const [cx, cy] = centroid(r)
  return close(open(r).map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt))
}

/** Mean centroid-to-vertex distance, in metres. */
export function radiusM(r: Ring): number {
  const [cx, cy] = centroid(r)
  const kx = mPerDegLon(cy)
  const pts = open(r)
  return pts.reduce((s, [x, y]) => s + Math.hypot((x - cx) * kx, (y - cy) * M_PER_DEG_LAT), 0) / pts.length
}

/** Unsigned ring area in square metres (shoelace). */
export function areaM2(r: Ring): number {
  const pts = close(r)
  const kx = mPerDegLon(pts[0]![1])
  let a = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]!, q = pts[i + 1]!
    a += p[0] * kx * q[1] * M_PER_DEG_LAT - q[0] * kx * p[1] * M_PER_DEG_LAT
  }
  return Math.abs(a / 2)
}

export function pointInRing([lon, lat]: Pt, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Square of side `s` metres centred on a lon/lat point. */
export function squareAt([lon, lat]: Pt, s: number): Ring {
  const dx = s / 2 / mPerDegLon(lat)
  const dy = s / 2 / M_PER_DEG_LAT
  return close([[lon - dx, lat - dy], [lon + dx, lat - dy], [lon + dx, lat + dy], [lon - dx, lat + dy]])
}

/** Regular polygon of radius `r` metres around a lon/lat point. */
export function ngonAt([lon, lat]: Pt, r: number, sides = 8): Ring {
  const kx = mPerDegLon(lat)
  const pts: Pt[] = []
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / sides + (i * 2 * Math.PI) / sides
    pts.push([lon + (r * Math.cos(a)) / kx, lat + (r * Math.sin(a)) / M_PER_DEG_LAT])
  }
  return close(pts)
}

/** Thin quad of `width` metres along segment a→b — how a wall line gets a body. */
export function segmentQuad(a: Pt, b: Pt, width: number): Ring | null {
  const kx = mPerDegLon(a[1])
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * M_PER_DEG_LAT
  const len = Math.hypot(dx, dy)
  if (len < 0.2) return null
  const nx = (-dy / len) * (width / 2), ny = (dx / len) * (width / 2)
  const off = (p: Pt, s: number): Pt => [p[0] + (s * nx) / kx, p[1] + (s * ny) / M_PER_DEG_LAT]
  return close([off(a, 1), off(b, 1), off(b, -1), off(a, -1)])
}

/** Vertices where the outline turns by more than ~35°. */
export function corners(r: Ring): Pt[] {
  const pts = open(r)
  const n = pts.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n]!, q = pts[i]!, s = pts[(i + 1) % n]!
    const a1 = Math.atan2(q[1] - p[1], q[0] - p[0])
    const a2 = Math.atan2(s[1] - q[1], s[0] - q[0])
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    if (d > 0.6) out.push(q)
  }
  return out
}

/** `holes` keeps a courtyard open — SJT, TT and the hostel blocks are rings. */
export function solid(id: string, ring: Ring, color: string, base: number, top: number, holes: readonly Ring[] = []): ModelFeature {
  return {
    type: 'Feature',
    properties: { id, part: 'solid', color, base: +base.toFixed(2), top: +top.toFixed(2) },
    geometry: { type: 'Polygon', coordinates: [close(ring), ...holes.map(close)] },
  }
}

export function ground(id: string, ring: Ring, color: string): ModelFeature {
  return {
    type: 'Feature',
    properties: { id, part: 'ground', color, base: 0, top: 0 },
    geometry: { type: 'Polygon', coordinates: [close(ring)] },
  }
}

/** Deterministic 0..1 from a string — stable variety without Math.random. */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}
