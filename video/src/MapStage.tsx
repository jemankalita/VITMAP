import 'maplibre-gl/dist/maplibre-gl.css'
import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion'
import { buildStyle } from '../../src/map/style'
import { trainFeatures } from '../../src/map/train'
import { cameraAt, trainHeadAt } from './camera'
import type { FilmData } from './data'

export interface Pin { key: string; lon: number; lat: number; color: string; from: number; to: number }
export interface RouteDraw { coords: [number, number][]; progress: number }

/** The first `k` (0..1) of a polyline by length, ending on an interpolated point. */
function partial(coords: [number, number][], k: number): [number, number][] {
  if (k >= 1) return coords
  const seg = coords.slice(1).map((b, i) => Math.hypot(b[0] - coords[i]![0], b[1] - coords[i]![1]))
  let left = seg.reduce((a, b) => a + b, 0) * Math.max(0, k)
  const out: [number, number][] = [coords[0]!]
  for (let i = 0; i < seg.length; i++) {
    const a = coords[i]!, b = coords[i + 1]!
    if (left >= seg[i]!) { out.push(b); left -= seg[i]!; continue }
    const f = seg[i] ? left / seg[i]! : 0
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
    break
  }
  return out
}

function pinElement(color: string): HTMLElement {
  const el = document.createElement('div')
  el.style.cssText = 'position:relative;width:96px;height:96px;pointer-events:none'
  el.innerHTML = [0, 1, 2].map(() =>
    `<span data-ring style="position:absolute;left:50%;top:50%;border-radius:50%;border:2.5px solid ${color};transform:translate(-50%,-50%)"></span>`,
  ).join('') +
    `<span style="position:absolute;left:50%;top:50%;width:20px;height:20px;border-radius:50%;background:${color};` +
    `border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25),0 3px 10px rgba(0,0,0,.45);transform:translate(-50%,-50%)"></span>`
  return el
}

/**
 * The real map — the app's own style, 3D models, router output and data —
 * driven frame by frame. Each frame is held until MapLibre has finished
 * drawing it, and refused if the GPU context was lost.
 */
export const MapStage: React.FC<{
  data: FilmData
  blur?: number
  dim?: number
  padRight?: number
  route?: RouteDraw | null
  pins?: Pin[]
}> = ({ data, blur = 0, dim = 0, padRight = 0, route = null, pins = [] }) => {
  const frame = useCurrentFrame()
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLElement }>())
  const [ready, setReady] = useState(false)
  const [boot] = useState(() => delayRender('map boot'))

  useEffect(() => {
    if (!host.current) return
    const base = new URL(staticFile('logo.svg').replace('logo.svg', ''), window.location.href).href
    const start = cameraAt(0, data.track)
    const map = new maplibregl.Map({
      container: host.current,
      style: buildStyle(data.geo, data.campus, base, false, true),
      center: start.center, zoom: start.zoom, pitch: start.pitch, bearing: start.bearing,
      maxPitch: 75,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      // The renderer screenshots the canvas; keep its last frame readable.
      preserveDrawingBuffer: true,
      antialias: true,
    })
    mapRef.current = map
    map.once('idle', () => { setReady(true); continueRender(boot) })
    map.on('error', (e) => console.error(e.error))
    return () => map.remove()
  }, [data, boot])

  // Every frame: camera, train, route, pins — then wait for the draw.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const handle = delayRender(`map frame ${frame}`)
    const pose = cameraAt(frame, data.track)
    map.jumpTo({ ...pose, padding: { top: 0, bottom: 0, left: 0, right: padRight } })

    const head = trainHeadAt(frame)
    ;(map.getSource('train') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: head == null ? [] : trainFeatures(data.track, head),
    })
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: route && route.progress > 0
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: partial(route.coords, route.progress) } }]
        : [],
    })

    // Pins: frame-locked pulse rings (CSS animations would not be frame-exact).
    const live = new Set<string>()
    for (const p of pins) {
      if (frame < p.from || frame >= p.to) continue
      live.add(p.key)
      let m = markers.current.get(p.key)
      if (!m) {
        const el = pinElement(p.color)
        m = { el, marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map) }
        markers.current.set(p.key, m)
      }
      const age = frame - p.from
      const appear = Math.min(1, age / 10)
      m.el.style.opacity = String(appear * Math.min(1, (p.to - frame) / 10))
      m.el.querySelectorAll<HTMLElement>('[data-ring]').forEach((ring, i) => {
        const ph = ((age + i * 15) % 45) / 45
        const size = 20 + ph * 76
        ring.style.width = ring.style.height = `${size}px`
        ring.style.opacity = String((1 - ph) * 0.9)
      })
    }
    for (const [key, m] of markers.current) {
      if (!live.has(key)) { m.marker.remove(); markers.current.delete(key) }
    }

    let done = false
    const gl = (map.getCanvas().getContext('webgl2') ?? map.getCanvas().getContext('webgl')) as WebGLRenderingContext | null
    const finish = () => {
      if (done) return
      // A lost GPU context draws nothing; capturing now would bake a black
      // frame into the film. Wait for the restore, redraw, then capture.
      if (gl?.isContextLost()) {
        console.warn(`frame ${frame}: WebGL context lost — waiting for restore`)
        map.once('webglcontextrestored', () => { map.once('idle', finish); map.triggerRepaint() })
        return
      }
      done = true
      continueRender(handle)
    }
    map.once('idle', finish)
    map.triggerRepaint()
    const safety = setTimeout(() => {
      console.warn(`frame ${frame}: map never went idle — capturing anyway`)
      finish()
    }, 20_000)
    return () => clearTimeout(safety)
  }, [frame, ready, data, padRight, route, pins])

  return (
    <AbsoluteFill style={{ background: '#14110E' }}>
      <div
        ref={host}
        style={{
          position: 'absolute', inset: 0,
          filter: blur ? `blur(${blur}px)` : undefined,
          transform: blur ? 'scale(1.03)' : undefined,
        }}
      />
      {dim > 0 && <AbsoluteFill style={{ background: `rgba(20,17,14,${dim})` }} />}
    </AbsoluteFill>
  )
}
