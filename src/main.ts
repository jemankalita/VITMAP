import '@fontsource-variable/overpass/wght.css'
import '@fontsource/overpass-mono/latin-400.css'
import '@fontsource/overpass-mono/latin-600.css'
import './styles.css'
import maplibregl from 'maplibre-gl'
import type { Campus, Graph, MessMenu, Poi, Profile } from './types'
import { buildStyle, maskOpacity } from './map/style'
import { Router, humanEta, humanDistance, metresBetween } from './route/router'
import { SearchIndex, type Hit } from './search/engine'
import { initPalette, openPalette } from './ui/palette'
import { initPanel, showAbout, showMess, showMessIndex, showPerson, showPoi, hidePanel, type RoomFind } from './ui/panel'
import { hidePing, showPing } from './ui/ping'
import { pushRecent } from './ui/recents'
import {
  accuracyRadiusPx,
  insideBounds,
  padBounds,
  shouldNudgeCamera,
  startWatch,
  youCollection,
  type Fix,
} from './location/watch'
import { inject } from '@vercel/analytics'

// Vercel Web Analytics, only in builds made on Vercel (see vite.config.ts).
if (__ON_VERCEL__) inject()

const boot = document.getElementById('boot')!
const base = import.meta.env.BASE_URL

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${base}data/${path}`)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res.json() as Promise<T>
}

async function start() {
  const [campus, geo, graphData] = await Promise.all([
    json<Campus>('campus.json'),
    json<Record<string, GeoJSON.FeatureCollection>>('geo.json'),
    json<Graph>('graph.json'),
  ])

  const router = new Router(graphData)
  const byId = new Map(campus.pois.map((p) => [p.id, p]))
  const byName = new Map(campus.pois.map((p) => [p.name, p]))

  // OSM mess feature name -> that hall's week of menus, so clicking a mess on
  // the map answers "what's for dinner" instead of just naming the building.
  const menusAt = new Map<string, MessMenu[]>()
  for (const hall of campus.mess?.halls ?? []) {
    const rows = (campus.mess?.items ?? []).filter((m) => m.hall === hall.name)
    if (!rows.length) continue
    menusAt.set(hall.name, rows)
    if (hall.at) menusAt.set(hall.at, rows)
  }

  function catColour(cat: string): string {
    return campus.categories[cat]?.color ?? '#8b949e'
  }

  /* ── map ──────────────────────────────────────────────────────────────── */

  const flatBounds = padBounds(campus.meta.bounds ?? [[79.148, 12.963], [79.172, 12.980]], 0.01)
  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(geo, campus, base, readSatellite(), readView3d()),
    center: campus.meta.center,
    // Close enough on first load that the campus reads as a 3D model, not a smudge.
    zoom: window.matchMedia('(max-width: 760px)').matches ? 14.9 : 15.7,
    minZoom: 13,
    maxZoom: 20,
    maxBounds: readView3d() ? undefined : flatBounds,
    renderWorldCopies: false,
    // Attribution lives in the page footer instead — same ODbL credit, one place.
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: true,
    maxPitch: 65,
  })
  map.touchZoomRotate.disableRotation()
  // Handle for scripts/verify-browser.mjs and for poking at the map in devtools.
  ;(window as unknown as { __map: maplibregl.Map }).__map = map
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

  let satellite = readSatellite()
  const satBtn = document.getElementById('sat-btn')!
  const mapBtn = document.getElementById('map-btn')!
  function paintSatBtn() {
    satBtn.setAttribute('aria-pressed', String(satellite))
    mapBtn.setAttribute('aria-pressed', String(!satellite))
  }
  paintSatBtn()
  let styleGen = 0
  function applyStyle() {
    const gen = ++styleGen
    // No diffing: a diffed setStyle never fires `style.load`, so the POIs,
    // route and location dot (filled in below) silently went blank.
    map.setStyle(buildStyle(geo, campus, base, satellite, view3d), { diff: false })
    map.once('style.load', () => {
      if (gen !== styleGen) return
      refreshPois()
      paintYou()
      if (target) drawRoute(false)
      if (pulseCat && !pulseRaf) pulseRaf = requestAnimationFrame(tickPulse)
    })
  }
  function setSatellite(on: boolean) {
    if (satellite === on) return
    satellite = on
    try { localStorage.setItem('campusmap.satellite', on ? '1' : '0') } catch { /* ignore */ }
    paintSatBtn()
    applyStyle()
  }
  satBtn.addEventListener('click', () => setSatellite(true))

  /* ── 3D view ──────────────────────────────────────────────────────────── */

  // The campus is a 3D model by default; the toggle (remembered) flattens it
  // for anyone who would rather glance at a plan. PRP's detailed model stays
  // either way and simply reads as coloured roofs when flat.
  // A tall portrait screen spends its top third on horizon at a steep tilt.
  const tilt = () => (window.matchMedia('(max-width: 760px)').matches ? 40 : 55)
  let view3d = readView3d()
  const view3dBtn = document.getElementById('view3d-btn')!
  function applyView3d(animate: boolean) {
    view3dBtn.setAttribute('aria-pressed', String(view3d))
    for (const id of ['campus3d', 'building-shadow']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', view3d ? 'visible' : 'none')
    }
    if (map.getLayer('outside')) map.setPaintProperty('outside', 'fill-opacity', maskOpacity(view3d))
    // maxBounds clamps the whole tilted view frustum, which drags a pitched
    // camera off its target, so the fence only applies to the flat map.
    map.setMaxBounds(view3d ? null : flatBounds)
    if (view3d) {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
    } else {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
    }
    if (animate) map.easeTo({ pitch: view3d ? tilt() : 0, bearing: view3d ? map.getBearing() : 0, duration: 650 })
  }
  /** `animate: false` when the caller is about to move the camera itself. */
  function setView3d(on: boolean, animate = true) {
    if (view3d === on) return
    view3d = on
    try { localStorage.setItem('campusmap.3d', on ? '1' : '0') } catch { /* ignore */ }
    applyView3d(animate)
  }
  applyView3d(false)
  if (view3d) map.once('load', () => map.easeTo({ pitch: tilt(), duration: 0 }))
  view3dBtn.addEventListener('click', () => setView3d(!view3d))
  mapBtn.addEventListener('click', () => setSatellite(false))

  /* ── layer state ──────────────────────────────────────────────────────── */

  // Everything on by default — a student looking for a water cooler should not
  // have to discover a layer toggle first. Street lights are the exception:
  // they are ambience, not a destination, and the glow competes with the pins.
  const DEFAULT_OFF = new Set(['light'])
  const active = new Set(
    Object.keys(campus.categories).filter((c) => campus.meta.counts[c] && !DEFAULT_OFF.has(c)),
  )
  let focusId: string | null = null
  let pulseCat: string | null = null
  let pulseRaf = 0

  function poiFeatures(): GeoJSON.FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: campus.pois
        .filter((p) => active.has(p.cat) || p.id === focusId)
        .map((p) => ({
          type: 'Feature' as const,
          id: p.id,
          properties: {
            id: p.id,
            name: p.name,
            cat: p.cat,
            color: catColour(p.cat),
            // `pin` = important enough to label from low zoom. `named` lets
            // everything else pick up a label once you are zoomed right in.
            pin: !!campus.categories[p.cat]?.pin && !p.unnamed,
            named: !p.unnamed,
            focus: p.id === focusId,
            pulse: p.cat === pulseCat,
          },
          geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        })),
    }
  }

  function tickPulse(t: number) {
    if (!pulseCat) { pulseRaf = 0; return }
    if (map.getLayer('poi-pulse')) {
      const k = 0.5 + 0.5 * Math.sin(t / 260)
      map.setPaintProperty('poi-pulse', 'circle-opacity', 0.16 + 0.5 * k)
      map.setPaintProperty('poi-pulse', 'circle-radius',
        ['interpolate', ['linear'], ['zoom'], 13, 7 + 8 * k, 19, 16 + 14 * k])
    }
    pulseRaf = requestAnimationFrame(tickPulse)
  }

  function setPulse(cat: string | null) {
    pulseCat = cat
    if (cat && !pulseRaf) pulseRaf = requestAnimationFrame(tickPulse)
    if (!cat && map.getLayer('poi-pulse')) {
      map.setPaintProperty('poi-pulse', 'circle-opacity', 0)
    }
  }

  function refreshPois() {
    ;(map.getSource('pois') as maplibregl.GeoJSONSource | undefined)?.setData(poiFeatures())
    // Tint building footprints belonging to visible categories.
    if (map.getLayer('building-cat')) {
      map.setFilter('building-cat', ['all',
        ['!=', ['get', 'cat'], ''],
        ['in', ['get', 'cat'], ['literal', [...active]]],
      ])
    }
    paintChips()
  }

  /* ── layer chips ──────────────────────────────────────────────────────── */

  const rail = document.getElementById('layers')!
  const cats = Object.entries(campus.categories)
    .filter(([c]) => campus.meta.counts[c])
    .sort((a, b) => (campus.meta.counts[b[0]] ?? 0) - (campus.meta.counts[a[0]] ?? 0))

  const chipBox = document.getElementById('layer-chips')!
  const layersBtn = document.getElementById('layers-btn')!

  function paintRail() {
    chipBox.innerHTML = cats.map(([c, meta]) =>
      `<button class="chip" data-cat="${c}" aria-pressed="false" style="color:${catColour(c)}"
         title="${meta.label} · ${campus.meta.counts[c]}">
         <span class="dot"></span>${meta.label}<span class="n">${campus.meta.counts[c]}</span>
       </button>`).join('')
    paintChips()
  }
  paintRail()

  function paintChips() {
    chipBox.querySelectorAll<HTMLElement>('.chip').forEach((c) => {
      const cat = c.dataset.cat!
      c.setAttribute('aria-pressed', String(active.has(cat)))
      c.classList.toggle('pulsing', pulseCat === cat)
    })
    layersBtn.querySelector('.n')!.textContent = `${active.size}`
    layersBtn.setAttribute('aria-label', `Layers — ${active.size} of ${cats.length} shown`)
  }

  rail.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('.layers-close')) { closeLayers(); return }
    if (t.closest('[data-all]')) {
      cats.forEach(([c]) => active.add(c))
      setPulse(null)
      refreshPois()
      return
    }
    if (t.closest('[data-none]')) {
      active.clear()
      setPulse(null)
      refreshPois()
      return
    }
    const chip = t.closest('.chip') as HTMLElement | null
    if (!chip) return
    const c = chip.dataset.cat!
    if (pulseCat === c && active.has(c)) {
      active.delete(c)
      setPulse(null)
    } else {
      active.add(c)
      setPulse(c)
    }
    refreshPois()
  })

  // A click anywhere outside the popover (desktop) or sheet (phone) closes it.
  const scrim = document.createElement('div')
  scrim.id = 'layers-scrim'
  scrim.hidden = true
  document.body.append(scrim)

  function openLayers() {
    rail.classList.add('open')
    scrim.hidden = false
    layersBtn.setAttribute('aria-expanded', 'true')
  }
  function closeLayers() {
    rail.classList.remove('open')
    scrim.hidden = true
    layersBtn.setAttribute('aria-expanded', 'false')
  }
  layersBtn.addEventListener('click', () =>
    rail.classList.contains('open') ? closeLayers() : openLayers())
  scrim.addEventListener('click', closeLayers)

  /* ── routing ──────────────────────────────────────────────────────────── */

  let profile: Profile = 'foot'
  let origin: { lat: number; lon: number; label: string } | null = null
  let target: { lat: number; lon: number; label: string } | null = null
  /** Metrics of the last successful route, so the panel button can show the ETA. */
  let lastRoute: { seconds: number; metres: number } | null = null
  let locating = false
  let follow = false
  let lastFix: Fix | null = null
  let watch: { stop: () => void } | null = null

  const badge = document.createElement('div')
  badge.id = 'route-badge'
  badge.hidden = true
  document.body.append(badge)

  const gpsNote = document.createElement('div')
  gpsNote.id = 'gps-note'
  gpsNote.hidden = true
  document.body.append(gpsNote)

  const campusBounds: [[number, number], [number, number]] =
    campus.meta.bounds ?? [[79.148, 12.963], [79.172, 12.980]]

  function clearRoute() {
    target = null
    lastRoute = null
    badge.hidden = true
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)
      ?.setData({ type: 'FeatureCollection', features: [] })
  }

  function paintYou() {
    const src = map.getSource('you') as maplibregl.GeoJSONSource | undefined
    const fix = lastFix ?? (origin
      ? { lat: origin.lat, lon: origin.lon, accuracy: 0, heading: null, ts: 0 }
      : null)
    src?.setData(youCollection(fix))
    if (fix && map.getLayer('you-acc')) {
      map.setPaintProperty('you-acc', 'circle-radius',
        accuracyRadiusPx(fix.accuracy || 16, fix.lat, map.getZoom()))
    }
  }

  function routePadding() {
    const phone = window.matchMedia('(max-width: 760px)').matches
    return phone
      ? { top: 72, bottom: 168, left: 28, right: 28 }
      : { top: 80, bottom: 110, left: 60, right: 380 }
  }

  function drawRoute(fit = true) {
    if (!target) return
    paintYou()
    const from = origin ?? campusCentreNode()
    const r = router.route(from, target, profile)
    const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined

    if (!r) {
      lastRoute = null
      badge.hidden = false
      badge.innerHTML = `<span>No path found on the mapped network</span>
        <button class="x" data-clear aria-label="Clear route">&times;</button>`
      src?.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    lastRoute = { seconds: r.seconds, metres: r.metres }

    let coords = r.coords
    if (origin && coords[0]) {
      const gap = metresBetween(origin.lat, origin.lon, coords[0][1], coords[0][0])
      if (gap > 40) coords = [[origin.lon, origin.lat], ...coords]
    }

    src?.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }],
    })

    const notes = [
      r.steps ? 'steps' : '',
      r.unpaved ? 'unpaved shortcut' : '',
      r.indoor ? 'indoor corridor' : '',
    ].filter(Boolean).join(' · ')

    const fromLabel = origin
      ? 'from your location · '
      : locating
        ? 'finding GPS · '
        : 'from campus centre · '

    badge.hidden = false
    badge.innerHTML = `
      <span class="eta">${humanEta(r.seconds)}</span>
      <span>${humanDistance(r.metres)}</span>
      <span class="mode">
        <button data-mode="foot" class="${profile === 'foot' ? 'on' : ''}">walk</button>
        <button data-mode="bike" class="${profile === 'bike' ? 'on' : ''}">cycle</button>
      </span>
      <span class="via">${fromLabel}to ${escapeHtml(target.label)}${notes ? ` · ${notes}` : ''}</span>
      <button class="x" data-clear aria-label="Clear route">&times;</button>`

    if (fit) {
      map.fitBounds(bounds(coords), { padding: routePadding(), maxZoom: 17.5 })
    }
  }

  badge.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset.clear !== undefined) { clearRoute(); return }
    if (t.dataset.mode) { profile = t.dataset.mode as Profile; drawRoute(false) }
  })

  function campusCentreNode() {
    return { lat: campus.meta.center[1], lon: campus.meta.center[0], label: 'campus centre' }
  }

  function setGpsNote(text: string | null) {
    if (!text) { gpsNote.hidden = true; gpsNote.textContent = ''; return }
    gpsNote.hidden = false
    gpsNote.textContent = text
  }

  function paintLocateBtn() {
    const btn = document.getElementById('locate-btn')!
    btn.setAttribute('aria-pressed', String(follow))
    btn.classList.toggle('following', follow)
    btn.classList.toggle('locating', locating && !lastFix)
    btn.title = follow ? 'Stop following' : lastFix ? 'Follow my location' : 'Show my location'
    btn.setAttribute('aria-label', btn.title)
    if (lastFix?.heading != null) {
      btn.style.setProperty('--hdg', `${lastFix.heading}deg`)
    }
  }

  function applyOrigin(fix: Fix, fromWatch = false) {
    const prev = lastFix
    lastFix = fix
    origin = { lat: fix.lat, lon: fix.lon, label: 'you' }
    locating = false
    paintYou()
    if (target) drawRoute(false)
    if (!insideBounds(fix.lat, fix.lon, campusBounds)) {
      setGpsNote('You are outside the mapped campus — the blue dot is still live.')
    } else {
      setGpsNote(null)
    }
    if (shouldNudgeCamera(follow, fromWatch ? prev : null, fix)) {
      map.easeTo({
        center: [fix.lon, fix.lat],
        duration: prev ? 420 : 700,
        offset: panelOffset(),
        zoom: Math.max(map.getZoom(), 16.6),
      })
    }
    paintLocateBtn()
  }

  function beginWatch(andFollow: boolean) {
    if (!navigator.geolocation) {
      locating = false
      setGpsNote('This browser cannot share a location.')
      if (target) drawRoute(false)
      paintLocateBtn()
      return
    }
    if (andFollow) follow = true
    if (watch) {
      if (lastFix && andFollow) {
        map.easeTo({
          center: [lastFix.lon, lastFix.lat],
          duration: 520,
          offset: panelOffset(),
          zoom: Math.max(map.getZoom(), 16.6),
        })
      }
      paintLocateBtn()
      return
    }
    locating = !lastFix
    paintLocateBtn()
    watch = startWatch(navigator.geolocation, {
      onFix: (fix) => applyOrigin(fix, true),
      onError: (err) => {
        locating = false
        follow = false
        paintLocateBtn()
        if (err.code === 1) setGpsNote('Location is blocked for this site. Allow it in the browser, then tap the crosshair.')
        else if (err.code === 2) setGpsNote('No GPS fix yet — try near a window, then tap the crosshair again.')
        else setGpsNote('Could not get a GPS fix. Tap the crosshair to try again.')
        if (target) drawRoute(false)
      },
    })
  }

  function routeTo(lat: number, lon: number, label: string) {
    target = { lat, lon, label }
    if (origin) drawRoute(true)
    else {
      locating = true
      badge.hidden = false
      badge.innerHTML = `<span>Getting your location…</span>
        <button class="x" data-clear aria-label="Clear route">&times;</button>`
    }
    beginWatch(false)
  }

  const locateBtn = document.getElementById('locate-btn')!
  locateBtn.addEventListener('click', () => {
    if (follow) { follow = false; paintLocateBtn(); return }
    beginWatch(true)
  })
  paintLocateBtn()

  map.on('dragstart', () => {
    if (!follow) return
    follow = false
    paintLocateBtn()
  })
  map.on('zoom', () => { if (lastFix) paintYou() })

  map.on('load', () => {
    try {
      void navigator.permissions?.query({ name: 'geolocation' }).then((p) => {
        if (p.state === 'granted') beginWatch(false)
      })
    } catch { /* Safari, or Permissions API missing */ }
    if (pulseCat && !pulseRaf) pulseRaf = requestAnimationFrame(tickPulse)
  })

  /* ── report a missing place ───────────────────────────────────────────── */

  // Half the campus is in OSM as unnamed footprints — the geometry is there,
  // nobody has typed the name on it. Someone standing next to MH K can fix
  // that in seconds, so make the coordinates one tap away.
  let picking = false

  const pickBar = document.createElement('div')
  pickBar.id = 'pick-bar'
  pickBar.hidden = true
  document.body.append(pickBar)

  function startPicking() {
    picking = true
    map.getCanvas().style.cursor = 'crosshair'
    pickBar.hidden = false
    pickBar.innerHTML = `<span>Tap the map where the place is</span>
      <button class="x" data-cancel>cancel</button>`
  }

  function stopPicking() {
    picking = false
    map.getCanvas().style.cursor = ''
    pickBar.hidden = true
  }

  pickBar.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.cancel !== undefined) stopPicking()
  })

  function reportAt(lat: number, lon: number) {
    stopPicking()
    window.open(
      `https://www.openstreetmap.org/edit#map=19/${lat.toFixed(5)}/${lon.toFixed(5)}`,
      '_blank', 'noopener',
    )
  }

  // Desktop: right-click. Phones have no right-click and iOS Safari does not
  // reliably fire contextmenu on a canvas, so long-press is wired by hand.
  map.on('contextmenu', (e) => { reportAt(e.lngLat.lat, e.lngLat.lng) })

  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let holdFrom: { x: number; y: number } | null = null
  const cancelHold = () => { clearTimeout(holdTimer); holdFrom = null }

  map.on('touchstart', (e) => {
    // One finger only — two is a pinch, and panning must not trigger it.
    if (e.points.length !== 1) { cancelHold(); return }
    holdFrom = { x: e.point.x, y: e.point.y }
    const { lat, lng } = e.lngLat
    holdTimer = setTimeout(() => {
      if (!holdFrom) return
      cancelHold()
      if (navigator.vibrate) navigator.vibrate(12)
      reportAt(lat, lng)
    }, 550)
  })
  map.on('touchmove', (e) => {
    if (!holdFrom) return
    // A few pixels of drift is a held finger; more than that is a pan.
    if (Math.hypot(e.point.x - holdFrom.x, e.point.y - holdFrom.y) > 10) cancelHold()
  })
  map.on('touchend', cancelHold)
  map.on('touchcancel', cancelHold)
  map.on('movestart', cancelHold)

  /* ── selection ────────────────────────────────────────────────────────── */

  /** Nudge the map so the focused point is not hidden by the panel or sheet. */
  function panelOffset(): [number, number] {
    return window.matchMedia('(max-width: 760px)').matches ? [0, -110] : [-140, 0]
  }

  function focusPoi(p: Poi, zoom = 17.4, find?: RoomFind) {
    focusId = p.id
    refreshPois()
    if (p.cat === 'prp') zoom = 18
    map.easeTo({
      center: [p.lon, p.lat],
      zoom: Math.max(map.getZoom(), zoom),
      duration: 520,
      offset: panelOffset(),
    })
    showPoi(p, menusAt.get(p.name), find)
    showPing(map, p.lat, p.lon, campus.categories[p.cat]?.color)
    pushRecent(p.id)
  }

  map.on('click', (e) => {
    if (!picking) return
    e.preventDefault()
    reportAt(e.lngLat.lat, e.lngLat.lng)
  })

  // Lamps are drawn as a glow instead of a dot, so they need their own hit
  // targets — `lamp-hit` is a transparent circle sized for a fingertip.
  const CLICKABLE = ['poi-dot', 'lamp-hit', 'poi-label', 'poi-label-minor', 'poi-label-generic', 'prp-fill', 'prp-line', 'prp-label', 'prp3d']

  for (const layer of CLICKABLE) {
    map.on('click', layer, (e) => {
      if (picking) return
      const id = e.features?.[0]?.properties?.id as string | undefined
      const p = id ? byId.get(id) : undefined
      if (p) focusPoi(p)
    })
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }

  /* ── search ───────────────────────────────────────────────────────────── */

  const index = new SearchIndex(campus, {
    onLayer: (cat) => {
      if (pulseCat === cat && active.has(cat) && active.size === 1) {
        active.clear()
        setPulse(null)
      } else {
        active.add(cat)
        setPulse(cat)
      }
      refreshPois()
    },
    onAction: (id) => {
      if (id === 'layers-all') { cats.forEach(([c]) => active.add(c)); setPulse(null); refreshPois() }
      if (id === 'layers-none') { active.clear(); setPulse(null); refreshPois() }
      if (id === 'clear-route') clearRoute()
      if (id === 'about') showAbout(campus)
      if (id === 'report') startPicking()
      if (id === 'satellite') setSatellite(!satellite)
      if (id === 'prp') jumpPrp()
      if (id === 'locate') beginWatch(true)
    },
  })

  function openHit(hit: Hit) {
    if (hit.run) { hit.run(); return }
    if (hit.kind === 'place' && hit.poi) {
      focusPoi(hit.poi, undefined, hit.floor && hit.room ? { floor: hit.floor, room: hit.room } : undefined)
      return
    }
    if (hit.kind === 'person' && hit.person) {
      const at = hit.person.at ? byName.get(hit.person.at) : undefined
      if (at) {
        focusId = at.id
        refreshPois()
        map.easeTo({ center: [at.lon, at.lat], zoom: 17, duration: 520, offset: panelOffset() })
        showPing(map, at.lat, at.lon)
      } else hidePing()
      showPerson(hit.person, at)
      return
    }
    if (hit.kind === 'mess') {
      if (hit.lat != null && hit.lon != null) {
        map.easeTo({ center: [hit.lon, hit.lat], zoom: 17, duration: 520, offset: panelOffset() })
        showPing(map, hit.lat, hit.lon, campus.categories.mess?.color)
      } else hidePing()
      showMess(hit)
    }
  }

  function jumpPrp() {
    active.add('prp')
    setPulse('prp')
    refreshPois()
    // The sign's view: from Jimmy Carter Road, looking south into the courtyard.
    setView3d(true, false)
    map.easeTo({
      center: [79.16632, 12.97168], zoom: 17.75, bearing: 164, pitch: 58,
      duration: 1100, offset: panelOffset(),
    })
  }

  function jumpMess() {
    active.add('mess')
    setPulse('mess')
    refreshPois()
    const pts = campus.pois.filter((p) => p.cat === 'mess')
    if (pts.length) {
      map.fitBounds(bounds(pts.map((p) => [p.lon, p.lat] as [number, number])), {
        padding: routePadding(),
        maxZoom: 17,
        duration: 700,
      })
    }
    showMessIndex(campus)
  }

  function openHall(name: string) {
    const p = campus.pois.find((x) => x.name === name)
      ?? campus.pois.find((x) => x.name === campus.mess?.halls.find((h) => h.name === name)?.at)
    if (p) focusPoi(p)
    else {
      const hit = index.search(name)[0]
      if (hit?.kind === 'mess') openHit(hit)
    }
  }

  initPanel({
    campus,
    routeTo,
    routeState: () => ({
      active: !!target,
      eta: lastRoute?.seconds,
      metres: lastRoute?.metres,
      locating,
    }),
    close: () => { focusId = null; hidePing(); refreshPois() },
    openHall,
    openPoi: (id) => { const p = byId.get(id); if (p) focusPoi(p) },
  })

  initPalette({
    index,
    campus,
    open: openHit,
    routeTo: (hit) => { if (hit.lat != null) routeTo(hit.lat, hit.lon!, hit.title) },
  })

  /* ── chrome ───────────────────────────────────────────────────────────── */

  document.getElementById('brand-btn')!.addEventListener('click', () => showAbout(campus))
  document.getElementById('go-mess')!.addEventListener('click', jumpMess)
  document.getElementById('go-prp')!.addEventListener('click', jumpPrp)

  // What is loaded is stated in the About panel; the counts used to live under
  // the wordmark but that element is gone.
  document.getElementById('brand-btn')!.title =
    `${campus.pois.length} places · ${campus.faculty?.items.length ?? 0} faculty · ` +
    `${campus.mess?.items.length ?? 0} menus — click for sources`

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !document.getElementById('palette')!.hidden) return
    if (rail.classList.contains('open')) { closeLayers(); return }
    hidePanel(); focusId = null; refreshPois()
  })

  // A style or asset failure otherwise leaves the boot overlay up forever, which
  // reads as "the site never loads" with nothing on screen to explain it.
  const bootTimer = setTimeout(() => {
    if (boot.classList.contains('gone')) return
    boot.className = 'err'
    boot.textContent = 'The map did not finish loading. Check the browser console.'
  }, 12_000)

  map.on('error', (e) => {
    // Missing glyphs and the odd tile error are survivable; a style error is not.
    console.error('[map]', e.error?.message ?? e)
  })

  map.on('load', () => {
    clearTimeout(bootTimer)
    refreshPois()
    boot.classList.add('gone')
    // Deep link: ?q=… opens the palette pre-filled, ?id=… focuses a place.
    const params = new URLSearchParams(location.search)
    const id = params.get('id')
    const q = params.get('q')
    if (id && byId.has(id)) focusPoi(byId.get(id)!)
    else if (q) openPalette(q)
  })
}

function bounds(coords: [number, number][]): [[number, number], [number, number]] {
  let w = 180, s = 90, e = -180, n = -90
  for (const [lon, lat] of coords) {
    w = Math.min(w, lon); e = Math.max(e, lon)
    s = Math.min(s, lat); n = Math.max(n, lat)
  }
  return [[w, s], [e, n]]
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function readView3d(): boolean {
  try { return localStorage.getItem('campusmap.3d') !== '0' } catch { return true }
}

function readSatellite(): boolean {
  try {
    const v = localStorage.getItem('campusmap.satellite')
    if (v === '0') return false
    if (v === '1') return true
  } catch { /* ignore */ }
  return true
}

start().catch((err) => {
  console.error(err)
  boot.className = 'err'
  boot.textContent = `Could not load campus data — ${err.message}. Run \`npm run build:data\` and reload.`
})
