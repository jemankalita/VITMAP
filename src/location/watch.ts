export type Fix = {
  lat: number
  lon: number
  accuracy: number
  heading: number | null
  ts: number
}

export type GeoErr = { code: number; message: string }

export type Bounds = [[number, number], [number, number]]

export function fixFromPosition(pos: GeolocationPosition): Fix {
  const heading = pos.coords.heading
  return {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 0,
    heading: heading == null || Number.isNaN(heading) ? null : heading,
    ts: pos.timestamp,
  }
}

export function youCollection(fix: Fix | null): GeoJSON.FeatureCollection {
  if (!fix) return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        accuracy: fix.accuracy,
        heading: fix.heading ?? -1,
      },
      geometry: { type: 'Point', coordinates: [fix.lon, fix.lat] },
    }],
  }
}

/** Earth metres between two WGS84 points. */
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = ((b.lat - a.lat) * Math.PI) / 180
  const dl = ((b.lon - a.lon) * Math.PI) / 180
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function insideBounds(lat: number, lon: number, bounds: Bounds): boolean {
  const [[w, s], [e, n]] = bounds
  return lon >= w && lon <= e && lat >= s && lat <= n
}

export function padBounds(bounds: Bounds, deg: number): Bounds {
  const [[w, s], [e, n]] = bounds
  return [[w - deg, s - deg], [e + deg, n + deg]]
}

/**
 * Web Mercator metres-per-pixel at `lat` / `zoom`, then accuracy → circle
 * radius. Clamped so a 2 km urban fix does not paint a disc over the campus.
 */
export function accuracyRadiusPx(accuracyM: number, lat: number, zoom: number): number {
  const mPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
  if (!Number.isFinite(mPerPx) || mPerPx <= 0) return 16
  return Math.max(12, Math.min(140, accuracyM / mPerPx))
}

export function shouldNudgeCamera(follow: boolean, from: Fix | null, to: Fix, minMetres = 4): boolean {
  if (!follow) return false
  if (!from) return true
  return metresBetween(from, to) >= minMetres
}

type Geo = Pick<Geolocation, 'watchPosition' | 'clearWatch'>

export function startWatch(
  geo: Geo,
  handlers: { onFix: (fix: Fix) => void; onError: (err: GeoErr) => void },
  opts: PositionOptions = {},
): { stop: () => void } {
  const id = geo.watchPosition(
    (pos) => handlers.onFix(fixFromPosition(pos)),
    (err) => handlers.onError({ code: err.code, message: err.message }),
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 12_000,
      ...opts,
    },
  )
  let stopped = false
  return {
    stop: () => {
      if (stopped) return
      stopped = true
      geo.clearWatch(id)
    },
  }
}
