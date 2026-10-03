import maplibregl from 'maplibre-gl'

/**
 * Radar ping on the place you just opened — three rings and a dot, so the
 * eye finds it among a hundred category dots. Adapted from
 * rugbedbugg/VIT-CampusMap. One at a time; opening another place moves it.
 */
let marker: maplibregl.Marker | null = null

function buildEl(colour: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ping-marker'
  el.style.setProperty('--ping', colour)
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = '<span class="ping-ring"></span><span class="ping-ring"></span><span class="ping-ring"></span><span class="ping-dot"></span>'
  return el
}

export function showPing(map: maplibregl.Map, lat: number, lon: number, colour = '#3d7aed') {
  hidePing()
  marker = new maplibregl.Marker({ element: buildEl(colour), anchor: 'center', pitchAlignment: 'map' })
    .setLngLat([lon, lat])
    .addTo(map)
}

export function hidePing() {
  marker?.remove()
  marker = null
}
