import './styles.css'
import maplibregl from 'maplibre-gl'
import type { Campus, Graph, MessMenu, Poi, Profile } from './types'
import { buildStyle } from './map/style'
import { Router, humanEta, humanDistance, metresBetween } from './route/router'
import { SearchIndex, type Hit } from './search/engine'
import { initPalette, openPalette } from './ui/palette'
import { initPanel, showAbout, showMess, showMessIndex, showPerson, showPoi, hidePanel } from './ui/panel'
import { toggle as toggleTheme, onThemeChange, resolved } from './ui/theme'
import { inject } from '@vercel/analytics'

// Initialize Vercel Web Analytics
inject({
  mode: import.meta.env.DEV ? 'development' : 'production',
})

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

  // The category palette is tuned for a dark ground and washes out on a pale
  // one. Darken in HSL, holding hue and saturation and moving only lightness —
  // scaling the RGB channels instead (the previous approach) drains the colour
  // and turns every marker into the same sludge brown.
  const shadeCache = new Map<string, string>()
  function catColour(cat: string): string {
    const base = campus.categories[cat]?.color ?? '#8b949e'
    if (resolved() === 'dark') return base
    const hit = shadeCache.get(base)
    if (hit) return hit

    const n = parseInt(base.slice(1), 16)
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl)
    const l = (max + min) / 2
    const d = max - min
    let h = 0
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    if (d !== 0) {
      h = max === r ? ((g - bl) / d) % 6 : max === g ? (bl - r) / d + 2 : (r - g) / d + 4
      h *= 60
      if (h < 0) h += 360
    }
    // Target ~38% lightness: dark enough to read on near-white, light enough
    // to stay recognisably the same hue as the dark theme.
    const L = Math.min(l, 0.38)
    const S = Math.min(1, sat * 1.05)
    const c = (1 - Math.abs(2 * L - 1)) * S
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
    const m = L - c / 2
    const seg: [number, number, number] =
      h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    const out = '#' + seg
      .map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
    shadeCache.set(base, out)
    return out
  }

  /* ── map ──────────────────────────────────────────────────────────────── */

  const map = new maplibregl.Map({
    container: 'map',
    style: buildStyle(geo, campus, resolved(), base, readSatellite()),
    center: campus.meta.center,
    zoom: 15.2,
    minZoom: 13,
    maxZoom: 20,
    maxBounds: campus.meta.bounds ?? [[79.148, 12.963], [79.172, 12.980]],
    renderWorldCopies: false,
    // Attribution lives in the page footer instead — same ODbL credit, one place.
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  })
  map.touchZoomRotate.disableRotation()
  // Handle for scripts/verify-browser.mjs and for poking at the map in devtools.
  ;(window as unknown as { __map: maplibregl.Map }).__map = map
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
  const geolocate = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
  })
  map.addControl(geolocate, 'bottom-right')

  let satellite = readSatellite()
  const satBtn = document.getElementById('sat-btn')!
  const mapBtn = document.getElementById('map-btn')!
  function paintSatBtn() {
    satBtn.setAttribute('aria-pressed', String(satellite))
    mapBtn.setAttribute('aria-pressed', String(!satellite))
  }
  paintSatBtn()
  function applyStyle() {
    map.setStyle(buildStyle(geo, campus, resolved(), base, satellite))
    map.once('styledata', () => {
      refreshPois()
      paintYou()
      if (target) drawRoute()
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

  // The sheet only exists on narrow screens; on desktop the chips are always
  // laid out in the dock and the button is hidden.
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

  const badge = document.createElement('div')
  badge.id = 'route-badge'
  badge.hidden = true
  document.body.append(badge)

  function clearRoute() {
    target = null
    lastRoute = null
    badge.hidden = true
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)
      ?.setData({ type: 'FeatureCollection', features: [] })
  }

  function paintYou() {
    const src = map.getSource('you') as maplibregl.GeoJSONSource | undefined
    if (!origin) {
      src?.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    src?.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [origin.lon, origin.lat] },
      }],
    })
  }

  function drawRoute() {
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

    map.fitBounds(bounds(coords), { padding: { top: 80, bottom: 110, left: 60, right: 380 }, maxZoom: 17.5 })
  }

  badge.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset.clear !== undefined) { clearRoute(); return }
    if (t.dataset.mode) { profile = t.dataset.mode as Profile; drawRoute() }
  })

  function campusCentreNode() {
    return { lat: campus.meta.center[1], lon: campus.meta.center[0], label: 'campus centre' }
  }

  function applyOrigin(lat: number, lon: number) {
    origin = { lat, lon, label: 'you' }
    locating = false
    paintYou()
    if (target) drawRoute()
    if (focusId) {
      const p = byId.get(focusId)
      if (p) showPoi(p, menusAt.get(p.name))
    }
  }

  function requestGps(force = false) {
    if (!navigator.geolocation) {
      locating = false
      if (target) drawRoute()
      return
    }
    locating = !origin
    navigator.geolocation.getCurrentPosition(
      (pos) => applyOrigin(pos.coords.latitude, pos.coords.longitude),
      () => {
        locating = false
        if (target) drawRoute()
      },
      { enableHighAccuracy: true, timeout: force ? 10_000 : 8000, maximumAge: force ? 0 : 15_000 },
    )
  }

  function routeTo(lat: number, lon: number, label: string) {
    target = { lat, lon, label }
    if (origin) drawRoute()
    else {
      locating = true
      badge.hidden = false
      badge.innerHTML = `<span>Getting your location…</span>
        <button class="x" data-clear aria-label="Clear route">&times;</button>`
    }
    requestGps(true)
  }

  geolocate.on('geolocate', (e) => {
    applyOrigin(e.coords.latitude, e.coords.longitude)
  })

  map.on('load', () => {
    requestGps(false)
    if (pulseCat && !pulseRaf) pulseRaf = requestAnimationFrame(tickPulse)
  })

  /* ── report a missing place ─────���─────────────────────────────────────── */

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

  function focusPoi(p: Poi, zoom = 17.4) {
    focusId = p.id
    refreshPois()
    if (p.cat === 'prp') {
      setSatellite(true)
      zoom = 18.2
    }
    map.easeTo({
      center: [p.lon, p.lat],
      zoom: Math.max(map.getZoom(), zoom),
      duration: 520,
      offset: panelOffset(),
    })
    showPoi(p, menusAt.get(p.name))
  }

  map.on('click', (e) => {
    if (!picking) return
    e.preventDefault()
    reportAt(e.lngLat.lat, e.lngLat.lng)
  })

  // Lamps are drawn as a glow instead of a dot, so they need their own hit
  // targets — `lamp-hit` is a transparent circle sized for a fingertip.
  const CLICKABLE = ['poi-dot', 'lamp-hit', 'poi-label', 'poi-label-minor', 'poi-label-generic', 'prp-fill', 'prp-line', 'prp-label']

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
      if (id === 'locate') {
        navigator.geolocation?.getCurrentPosition((pos) => {
          applyOrigin(pos.coords.latitude, pos.coords.longitude)
          map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 })
        })
      }
    },
  })

  function openHit(hit: Hit) {
    if (hit.run) { hit.run(); return }
    if (hit.kind === 'place' && hit.poi) { focusPoi(hit.poi); return }
    if (hit.kind === 'person' && hit.person) {
      const at = hit.person.at ? byName.get(hit.person.at) : undefined
      if (at) { focusId = at.id; refreshPois(); map.easeTo({ center: [at.lon, at.lat], zoom: 17, duration: 520, offset: panelOffset() }) }
      showPerson(hit.person, at)
      return
    }
    if (hit.kind === 'mess') {
      if (hit.lat != null && hit.lon != null) {
        map.easeTo({ center: [hit.lon, hit.lat], zoom: 17, duration: 520, offset: panelOffset() })
      }
      showMess(hit)
    }
  }

  function jumpPrp() {
    active.add('prp')
    setPulse('prp')
    refreshPois()
    setSatellite(true)
    map.easeTo({ center: [79.16628, 12.97127], zoom: 18.1, duration: 700, offset: panelOffset() })
  }

  function jumpMess() {
    active.add('mess')
    setPulse('mess')
    refreshPois()
    const pts = campus.pois.filter((p) => p.cat === 'mess')
    if (pts.length) {
      map.fitBounds(bounds(pts.map((p) => [p.lon, p.lat] as [number, number])), {
        padding: { top: 90, bottom: 140, left: 50, right: 380 },
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
    close: () => { focusId = null; refreshPois() },
    openHall,
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

  /* ── theme ────────────────────────────────────────────────────────────── */

  const themeBtn = document.getElementById('theme-btn')!
  const paintThemeBtn = () => {
    const dark = resolved() === 'dark'
    themeBtn.textContent = dark ? '☾' : '☀'
    themeBtn.title = dark ? 'Switch to light' : 'Switch to dark'
  }
  paintThemeBtn()
  themeBtn.addEventListener('click', () => { toggleTheme(); paintThemeBtn() })

  onThemeChange(() => {
    shadeCache.clear()
    paintRail()
    applyStyle()
  })

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
