import type { StyleSpecification } from 'maplibre-gl'
import type { Campus } from '../types'

/**
 * The whole basemap is drawn from our own GeoJSON — no tile server, no API key
 * and no external request. The campus is small enough that the entire extract
 * fits in a few hundred kB, so the map renders from one static fetch.
 *
 * Label glyphs are served from public/font too. Pointing them at a demo CDN
 * cost us every label on the map when that host 404'd the fontstack.
 */
const PALETTE = {
  dark: {
    bg: '#06101c',
    campus: '#0a1c33',
    green: '#0d2a22',
    water: '#124a6e',
    building: '#143047',
    buildingEdge: '#1e4a68',
    named: '#1a3d5c',
    road: '#2c5a82',
    roadCase: '#0b2238',
    path: '#2a5070',
    steps: '#3d6a8c',
    wall: '#1a3550',
    boundary: '#2a5a80',
    label: '#d5e6f7',
    labelHalo: '#06101c',
    dotStroke: '#06101c',
    routeHalo: '#06101c',
    route: '#f0c14b',
    focus: '#4da3ff',
    glow: '#ffcf6b',
    glowCore: '#fff3cf',
    mask: '#000000',
  },
  // Deliberately not a white map. The campus is a warm paper tone, buildings a
  // half-step darker, and roads the only near-white — so the built area reads
  // without any large field of pure white to stare into.
  light: {
    // Built as a lightness ladder so the map reads as figure and ground:
    // roads are the lightest thing, campus ground sits a step below, buildings
    // a clear step below that, and everything outside the wall darker still.
    // The previous palette put all three within ~5% of each other and the
    // whole map dissolved into one pale wash.
    bg: '#c5d4e4',
    campus: '#eef3f8',
    green: '#cfe8d4',
    water: '#8ec4e6',
    building: '#d4e0ec',
    buildingEdge: '#9bb0c4',
    named: '#c5d6e8',
    road: '#ffffff',
    roadCase: '#9aafc2',
    path: '#ffffff',
    steps: '#7e93a8',
    wall: '#b3c4d4',
    boundary: '#6f8aa3',
    label: '#12324d',
    labelHalo: '#ffffff',
    dotStroke: '#ffffff',
    routeHalo: '#ffffff',
    route: '#0b5cab',
    focus: '#0b5cab',
    glow: '#d9930d',
    glowCore: '#7a5608',
    mask: '#000000',
  },
} as const

/** Must match a directory under public/font. */
export const FONT = 'Noto Sans Regular'

export function buildStyle(
  geo: Record<string, GeoJSON.FeatureCollection>,
  campus: Campus,
  theme: 'light' | 'dark' = 'dark',
  base = '/',
  satellite = false,
): StyleSpecification {
  const C = {
    ...PALETTE[theme],
    ...(satellite ? { label: '#ffffff', labelHalo: '#000000' } as const : {}),
  }

  const src = (data: GeoJSON.FeatureCollection) => ({ type: 'geojson' as const, data })

  return {
    version: 8,
    glyphs: `${base}font/{fontstack}/{range}.pbf`,
    sources: {
      ...(satellite ? {
        satellite: {
          type: 'raster' as const,
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Tiles © Esri',
          maxzoom: 19,
        },
      } : {}),
      boundary: src(geo.boundary!),
      mask: src(geo.mask ?? { type: 'FeatureCollection', features: [] }),
      green: src(geo.green!),
      water: src(geo.water!),
      waterway: src(geo.waterway!),
      wall: src(geo.wall!),
      rail: src(geo.rail ?? { type: 'FeatureCollection', features: [] }),
      roads: src(geo.roads!),
      paths: src(geo.paths!),
      buildings: src(geo.buildings!),
      overlays: src(geo.overlays ?? { type: 'FeatureCollection', features: [] }),
      prp: src(geo.prp ?? { type: 'FeatureCollection', features: [] }),
      pois: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      route: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      you: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
      ...(satellite ? [{
        id: 'satellite', type: 'raster' as const, source: 'satellite',
        paint: { 'raster-opacity': 1 },
      }] : []),

      { id: 'campus', type: 'fill', source: 'boundary', paint: { 'fill-color': C.campus, 'fill-opacity': satellite ? 0 : 1 } },

      { id: 'green', type: 'fill', source: 'green', paint: { 'fill-color': C.green, 'fill-opacity': satellite ? 0 : 1 } },
      { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': C.water, 'fill-opacity': satellite ? 0.2 : 1 } },
      {
        id: 'waterway', type: 'line', source: 'waterway',
        paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 5] },
      },

      {
        id: 'campus-edge', type: 'line', source: 'boundary',
        paint: { 'line-color': C.boundary, 'line-width': 1.2, 'line-dasharray': [3, 2] },
      },
      {
        id: 'wall', type: 'line', source: 'wall',
        minzoom: 15,
        paint: { 'line-color': C.wall, 'line-width': 1 },
      },
      {
        id: 'rail', type: 'line', source: 'rail',
        paint: {
          'line-color': theme === 'dark' ? '#3a4452' : '#8b8490',
          'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.2, 17, 3],
          'line-dasharray': [4, 2],
        },
      },

      // Roads get a casing so junctions read cleanly at low zoom.
      {
        id: 'road-case', type: 'line', source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.roadCase,
          'line-opacity': satellite ? 0.25 : 1,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 2, 16, 7, 19, 22],
        },
      },
      {
        id: 'road', type: 'line', source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.road,
          'line-opacity': satellite ? 0.35 : 1,
          'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13, 1, 16, 4.5, 19, 16],
        },
      },
      // Two layers rather than one: `line-dasharray` rejects data expressions,
      // so steps cannot be dashed by a `case` on the feature.
      {
        id: 'path', type: 'line', source: 'paths',
        minzoom: 14,
        filter: ['!=', ['get', 'hw'], 'steps'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': C.path,
          'line-opacity': satellite ? 0.3 : 1,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 14, 0.6, 17, 2, 19, 5],
        },
      },
      {
        id: 'path-steps', type: 'line', source: 'paths',
        minzoom: 15,
        filter: ['==', ['get', 'hw'], 'steps'],
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': C.steps,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 15, 1.5, 19, 6],
          'line-dasharray': [1, 1],
        },
      },

      {
        id: 'building', type: 'fill', source: 'buildings',
        paint: {
          'fill-color': ['case', ['!=', ['get', 'name'], ''], C.named, C.building],
          'fill-outline-color': C.buildingEdge,
          'fill-opacity': satellite ? 0.08 : 1,
        },
      },
      {
        id: 'building-top', type: 'line', source: 'buildings',
        minzoom: 16,
        paint: { 'line-color': C.buildingEdge, 'line-width': 0.7 },
      },
      // Category tint for buildings that are themselves a POI.
      {
        id: 'building-cat', type: 'fill', source: 'buildings',
        filter: ['all', ['!=', ['get', 'cat'], ''], ['in', ['get', 'cat'], ['literal', []]]],
        paint: { 'fill-color': catColour(campus), 'fill-opacity': satellite ? 0 : theme === 'dark' ? 0.16 : 0.28 },
      },

      {
        id: 'prp-fill', type: 'fill', source: 'prp',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': satellite ? 0.55 : 0.38,
        },
      },
      {
        id: 'prp-line', type: 'line', source: 'prp',
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.95 },
      },
      {
        id: 'prp-label', type: 'symbol', source: 'prp',
        minzoom: 16.8,
        layout: {
          'text-field': ['match', ['get', 'letter'], 'X', 'In', 'N', 'Ax', ['get', 'letter']],
          'text-font': [FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16.8, 12, 19, 18],
          'text-anchor': 'center',
          'text-optional': true,
          'text-padding': 2,
        },
        paint: {
          'text-color': C.label,
          'text-halo-color': C.labelHalo,
          'text-halo-width': 1.6,
        },
      },

      {
        id: 'outside', type: 'fill', source: 'mask',
        paint: { 'fill-color': C.mask, 'fill-opacity': 1, 'fill-antialias': true },
      },
      {
        id: 'campus-rim', type: 'line', source: 'boundary',
        paint: {
          'line-color': theme === 'dark' ? '#4da3ff' : '#0b5cab',
          'line-width': 1.8,
          'line-opacity': 0.85,
        },
      },

      {
        id: 'overlay-lh', type: 'line', source: 'overlays',
        filter: ['==', ['get', 'kind'], 'lh'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#c084fc', 'line-width': 3.5, 'line-opacity': 0.85 },
      },
      {
        id: 'overlay-mh', type: 'line', source: 'overlays',
        filter: ['==', ['get', 'kind'], 'mh'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#5b8def', 'line-width': 3.5, 'line-opacity': 0.85 },
      },

      {
        id: 'route-halo', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.routeHalo, 'line-width': 9, 'line-opacity': 0.9 },
      },
      {
        id: 'route-line', type: 'line', source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': C.route, 'line-width': 4 },
      },

      // Street lamps read as a pool of light on the ground rather than a pin.
      // Three stacked blurred circles: a wide falloff, a tighter halo, and a
      // small bright core. Drawn under everything else so it lights the map
      // instead of washing out the markers.
      {
        id: 'lamp-glow-far', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'cat'], 'light'],
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, 8, 17, 34, 19.5, 90],
          'circle-color': C.glow,
          'circle-blur': 1,
          'circle-opacity': theme === 'dark' ? 0.20 : 0.13,
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'lamp-glow-near', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'cat'], 'light'],
        paint: {
          'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, 3, 17, 14, 19.5, 38],
          'circle-color': C.glow,
          'circle-blur': 0.9,
          'circle-opacity': theme === 'dark' ? 0.32 : 0.18,
          'circle-pitch-alignment': 'map',
        },
      },
      // Invisible but hit-testable: a glow is not a tap target, and the bright
      // core is only a few pixels across. Kept above the glow so clicks land.
      {
        id: 'lamp-hit', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'cat'], 'light'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 8, 17, 13, 19.5, 18],
          'circle-color': C.glow,
          'circle-opacity': 0.01,
        },
      },
      {
        id: 'lamp-core', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'cat'], 'light'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 1.2, 17, 2.4, 19.5, 4],
          'circle-color': C.glowCore,
          'circle-blur': 0.3,
          'circle-opacity': 0.95,
        },
      },
      {
        id: 'poi-pulse', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'pulse'], true],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 10, 19, 22],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.4,
          'circle-blur': 0.15,
        },
      },
      {
        id: 'poi-dot', type: 'circle', source: 'pois',
        filter: ['!=', ['get', 'cat'], 'light'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 16, 4.5, 19, 7],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': C.dotStroke,
          'circle-stroke-width': 1.4,
          'circle-opacity': ['case', ['boolean', ['feature-state', 'dim'], false], 0.25, 1],
        },
      },
      {
        id: 'you-halo', type: 'circle', source: 'you',
        paint: {
          'circle-radius': 14,
          'circle-color': C.focus,
          'circle-opacity': 0.22,
        },
      },
      {
        id: 'you-dot', type: 'circle', source: 'you',
        paint: {
          'circle-radius': 7,
          'circle-color': C.focus,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.2,
        },
      },
      {
        id: 'poi-label', type: 'symbol', source: 'pois',
        // The default view sits at z15.1, so a higher floor here meant the map
        // opened with no labels at all.
        minzoom: 14.5,
        filter: ['==', ['get', 'pin'], true],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': [FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 14.5, 10, 19, 13.5],
          'text-offset': [0, 1.05],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-optional': true,
          'text-padding': 4,
          // Drop the least useful labels first when they collide.
          'symbol-sort-key': ['case', ['==', ['get', 'cat'], 'lecture'], 0,
                                      ['==', ['get', 'cat'], 'mess'], 1, 2],
        },
        paint: {
          'text-color': C.label,
          'text-halo-color': C.labelHalo,
          'text-halo-width': 1.4,
        },
      },
      // Everything that is not a headline category still deserves a name once
      // you are close enough to read it — shops, ATMs, laundry, printing. They
      // were filtered out at every zoom, so 87 named places were anonymous dots.
      {
        id: 'poi-label-minor', type: 'symbol', source: 'pois',
        minzoom: 16.5,
        filter: ['all', ['!=', ['get', 'pin'], true], ['==', ['get', 'named'], true]],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': [FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 16.5, 9.5, 19.5, 12],
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-optional': true,
          'text-padding': 3,
          'symbol-sort-key': 3,
        },
        paint: {
          'text-color': C.label,
          'text-halo-color': C.labelHalo,
          'text-halo-width': 1.3,
        },
      },
      // Generic unnamed facilities last of all: "Toilets", "Cycle parking".
      // Street lights are excluded — 23 identical labels is just noise.
      {
        id: 'poi-label-generic', type: 'symbol', source: 'pois',
        minzoom: 18,
        filter: ['all', ['!=', ['get', 'named'], true], ['!=', ['get', 'cat'], 'light']],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': [FONT],
          'text-size': 10,
          'text-offset': [0, 1],
          'text-anchor': 'top',
          'text-max-width': 8,
          'text-optional': true,
          'text-padding': 3,
          'symbol-sort-key': 4,
        },
        paint: {
          'text-color': C.label,
          'text-halo-color': C.labelHalo,
          'text-halo-width': 1.3,
          'text-opacity': 0.75,
        },
      },
      {
        id: 'poi-focus', type: 'circle', source: 'pois',
        filter: ['==', ['get', 'focus'], true],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 9, 19, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': C.focus,
          'circle-stroke-width': 1.6,
        },
      },
    ],
  }
}

/** `match` expression mapping a category key to its colour. */
function catColour(campus: Campus): maplibregl.ExpressionSpecification {
  const pairs: (string | string[])[] = []
  for (const [k, v] of Object.entries(campus.categories)) pairs.push(k, v.color)
  return ['match', ['get', 'cat'], ...pairs, '#8b949e'] as unknown as maplibregl.ExpressionSpecification
}
