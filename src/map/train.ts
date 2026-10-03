import type maplibregl from 'maplibre-gl'
import { type ModelFeature, type Pt, M_PER_DEG_LAT, mPerDegLon, solid } from './geom3d'

/**
 * Trains run the Chennai–Bengaluru main line between the two campus plots in
 * a near-continuous loop: a red electric loco and blue coaches, alternating
 * direction on the two tracks, with only a 2–3 s pause between them.
 *
 * Always on for visitors. Skipped only in automated browsers (CI), where a
 * software renderer cannot keep up, and paused while the tab is hidden.
 */

const SPEED_MPS = 28 // ~100 km/h, the line's real pace
const GAP_S: [number, number] = [2, 3] // brief pause, then the next train
const CAR_M = 21
const COUPLING_M = 1.2
const WIDTH_M = 3.6 // a touch wider than life so it reads at campus zoom
const COACHES = 18 // a full-length express, ~400 m
const FRAME_MS = 33 // ~30 fps is plenty for something this size

const LOCO = { body: '#e0452f', roof: '#fff4e0' }
// Bright sides and near-white roofs: from above, the roof is what you see.
const COACH = { body: '#3f86e8', roof: '#eef3fa' }

interface Track { pts: Pt[]; cum: number[]; length: number }

/** A polyline with cumulative distances in metres, for sampling by distance. */
function toTrack(coords: GeoJSON.Position[]): Track {
  const pts = coords.map(([lon, lat]) => [lon!, lat!] as Pt)
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!, [bx, by] = pts[i]!
    const kx = mPerDegLon((ay + by) / 2)
    cum.push(cum[i - 1]! + Math.hypot((bx - ax) * kx, (by - ay) * M_PER_DEG_LAT))
  }
  return { pts, cum, length: cum[cum.length - 1]! }
}

/** Position and unit direction (in metres) at distance `d` along the track. */
function sample(t: Track, d: number): { p: Pt; ux: number; uy: number } {
  let i = 1
  while (i < t.cum.length - 1 && t.cum[i]! < d) i++
  const a = t.pts[i - 1]!, b = t.pts[i]!
  const seg = t.cum[i]! - t.cum[i - 1]! || 1
  const f = Math.min(1, Math.max(0, (d - t.cum[i - 1]!) / seg))
  const kx = mPerDegLon(a[1])
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * M_PER_DEG_LAT
  const len = Math.hypot(dx, dy) || 1
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], ux: dx / len, uy: dy / len }
}

/** A car as a rectangle centred at distance `d`, aligned to the track. */
function carRing(t: Track, d: number, length: number, width: number): Pt[] {
  const { p, ux, uy } = sample(t, d)
  const kx = mPerDegLon(p[1])
  const hx = (ux * length) / 2, hy = (uy * length) / 2
  const wx = (-uy * width) / 2, wy = (ux * width) / 2
  const at = (sx: number, sy: number): Pt => [p[0] + sx / kx, p[1] + sy / M_PER_DEG_LAT]
  return [at(hx + wx, hy + wy), at(hx - wx, hy - wy), at(-hx - wx, -hy - wy), at(-hx + wx, -hy + wy)]
}

function trainFeatures(t: Track, head: number): ModelFeature[] {
  const out: ModelFeature[] = []
  for (let i = 0; i <= COACHES; i++) {
    const centre = head - CAR_M / 2 - i * (CAR_M + COUPLING_M)
    if (centre < CAR_M / 2 || centre > t.length - CAR_M / 2) continue
    const skin = i === 0 ? LOCO : COACH
    const body = carRing(t, centre, CAR_M, WIDTH_M)
    const roof = carRing(t, centre, CAR_M - 0.6, WIDTH_M - 0.3)
    out.push(solid(`train-${i}`, body, skin.body, 0.9, 4.6), solid(`train-${i}`, roof, skin.roof, 4.6, 5.1))
  }
  return out
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Starts the service; returns a stop function. */
export function startTrains(map: maplibregl.Map, rail: GeoJSON.FeatureCollection | undefined): () => void {
  const tracks = (rail?.features ?? [])
    .filter((f) => f.geometry.type === 'LineString' && f.properties?.kind === 'rail')
    .map((f) => toTrack((f.geometry as GeoJSON.LineString).coordinates))
    .filter((t) => t.length > 200)
  // Automated browsers (CI, crawlers) gain nothing from it, and on a
  // software renderer the redraws starve the page's main thread.
  if (!tracks.length || navigator.webdriver) return () => {}

  const trainLength = (COACHES + 1) * (CAR_M + COUPLING_M)
  let which = 0
  let head = 0
  let waitUntil = performance.now() + 1000
  let last = performance.now()
  let lastDraw = 0
  let shown = false
  let raf = 0

  const source = () => map.getSource('train') as maplibregl.GeoJSONSource | undefined
  const clear = () => { if (shown) { source()?.setData(EMPTY); shown = false } }

  function tick(now: number) {
    raf = requestAnimationFrame(tick)
    const dt = Math.min(0.25, (now - last) / 1000) // no leaps after a hidden tab
    last = now
    if (now < waitUntil) { clear(); return }

    const track = tracks[which]!
    head += SPEED_MPS * dt
    if (head > track.length + trainLength) {
      // Next train runs the other track, after a breather.
      which = (which + 1) % tracks.length
      head = 0
      waitUntil = now + (GAP_S[0] + Math.random() * (GAP_S[1] - GAP_S[0])) * 1000
      clear()
      return
    }
    if (now - lastDraw < FRAME_MS) return
    lastDraw = now
    source()?.setData({ type: 'FeatureCollection', features: trainFeatures(track, head) })
    shown = true
  }

  const onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0 }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick) }
  }
  document.addEventListener('visibilitychange', onVisibility)
  raf = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(raf)
    document.removeEventListener('visibilitychange', onVisibility)
    clear()
  }
}
