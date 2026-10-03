import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import type { Campus } from '../types'
import { buildCampusModel } from './campus3d'
import { buildPrpModel } from './prp3d'

/**
 * The whole basemap is drawn from our own GeoJSON — no tile server, no API key
 * and no external request. The campus is small enough that the entire extract
 * fits in a few hundred kB, so the map renders from one static fetch.
 *
 * Label glyphs are served from public/font too. Pointing them at a demo CDN
 * cost us every label on the map when that host 404'd the fontstack.
 */
/** The site is dark-only: one palette, no theme switch. */
const PALETTE = {
  bg: '#14110e',
  campus: '#1c1914',
  green: '#1a2620',
  water: '#1a3a4a',
  building: '#2a241e',
  buildingEdge: '#3d342b',
  named: '#322b24',
  road: '#5a4d40',
  roadCase: '#14110e',
  path: '#4a4036',
  steps: '#6a5a48',
  wall: '#3a322a',
  boundary: '#5a4d40',
  label: '#f3ece3',
  labelHalo: '#14110e',
  dotStroke: '#14110e',
  routeHalo: '#14110e',
  route: '#e25d33',
  focus: '#3d7aed',
  glow: '#e8b86d',
  glowCore: '#fff1d0',
  mask: '#000000',
} as const

/** Must match a directory under public/font. */
export const FONT = 'Noto Sans Regular'

export function buildStyle(
  geo: Record<string, GeoJSON.FeatureCollection>,
  campus: Campus,
  base = '/',
  satellite = false,
  view3d = false,
): StyleSpecification {
  const C = {
    ...PALETTE,
    ...(satellite ? { label: '#ffffff', labelHalo: '#000000' } as const : {}),
  }

  const src = (data: GeoJSON.FeatureCollection) => ({ type: 'geojson' as const, data })
  const prpGeo = geo.prp ?? { type: 'FeatureCollection', features: [] }
  const prpFloors = new Map(prpGeo.features.map((f) => [String(f.properties?.id), Number(f.properties?.floors) || 0]))

  return {
    version: 8,
    // Warm key light from the north-west, low enough that walls facing it and
    // walls facing away separate into clear light and shade.
    light: { anchor: 'map', position: [1.4, 300, 50], color: '#ffffff', intensity: 0.32 },
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
      prp: src(prpGeo),
      prp3d: src(buildPrpModel(prpGeo, prpFloors)),
      campus3d: src(buildCampusModel(geo, campus.pois)),
      train: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
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
        paint: { 'fill-color': catColour(campus), 'fill-opacity': satellite ? 0 : 0.16 },
      },

      {
        id: 'prp-fill', type: 'fill', source: 'prp',
        paint: {
          'fill-color': ['get', 'color'],
          // Fades out as the 3D model rises over the same footprints.
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, satellite ? 0.55 : 0.38, 15.8, 0],
        },
      },
      {
        id: 'prp-line', type: 'line', source: 'prp',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.2, 0.95, 15.8, 0],
        },
      },
      {
        id: 'prp3d-ground', type: 'fill', source: 'prp3d',
        minzoom: 15.5,
        filter: ['==', ['get', 'part'], 'ground'],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16.2, satellite ? 0.75 : 0.9],
        },
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
        paint: { 'fill-color': C.mask, 'fill-opacity': maskOpacity(view3d), 'fill-antialias': true },
      },
      {
        id: 'campus-rim', type: 'line', source: 'boundary',
        paint: {
          'line-color': '#3d7aed',
          'line-width': 1.8,
          'line-opacity': 0.85,
        },
      },

      // 3D models sit above the outside mask: a flat fill drawn after an
      // extrusion paints straight over it, which cut PRP's annex in half.
      // The main line between the two plots, drawn above the outside shade:
      // ballast bed, sleepers, then a pair of steel rails per track.
      {
        id: 'rail-bed', type: 'line', source: 'rail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3a332c',
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 13, 2, 16, 9, 19, 44],
        },
      },
      {
        id: 'rail-ties', type: 'line', source: 'rail',
        minzoom: 15,
        paint: {
          'line-color': '#6e5c49',
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 15, 4, 16, 7, 19, 30],
          'line-dasharray': [0.16, 0.5],
        },
      },
      {
        id: 'rail-line', type: 'line', source: 'rail',
        maxzoom: 15,
        paint: { 'line-color': '#9aa1aa', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 15, 1.2] },
      },
      ...([1, -1] as const).map((side) => ({
        id: `rail-steel-${side > 0 ? 'l' : 'r'}`, type: 'line' as const, source: 'rail',
        minzoom: 15,
        layout: { 'line-join': 'round' as const },
        paint: {
          'line-color': '#b4bbc4',
          'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.6, 19, 2],
          'line-offset': ['interpolate', ['exponential', 2], ['zoom'], 15, side * 1, 19, side * 9],
        },
      } as LayerSpecification)),

      // A soft contact shadow, cast away from the key light, grounds each block.
      {
        id: 'building-shadow', type: 'fill', source: 'buildings',
        minzoom: 15,
        layout: { visibility: view3d ? 'visible' : 'none' },
        paint: {
          'fill-color': '#000000',
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, satellite ? 0.4 : 0.32],
          'fill-translate': ['interpolate', ['exponential', 2], ['zoom'], 15, ['literal', [1, 1.5]], 19, ['literal', [14, 20]]],
          'fill-translate-anchor': 'map',
        },
      },
      ...extrusion('campus3d', 'campus3d', 15, view3d, 1),
      ...extrusion('prp3d', 'prp3d', 15.3, true, 1),
      // Moved by src/map/train.ts; parts carry their own heights, so no grow-in.
      {
        id: 'train', type: 'fill-extrusion', source: 'train',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-vertical-gradient': true,
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
          'circle-opacity': 0.20,
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
          'circle-opacity': 0.32,
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
        id: 'you-acc', type: 'circle', source: 'you',
        paint: {
          'circle-radius': 18,
          'circle-color': C.focus,
          'circle-opacity': 0.16,
          'circle-pitch-alignment': 'map',
        },
      },
      {
        id: 'you-halo', type: 'circle', source: 'you',
        paint: {
          'circle-radius': 11,
          'circle-color': C.focus,
          'circle-opacity': 0.35,
        },
      },
      {
        id: 'you-dot', type: 'circle', source: 'you',
        paint: {
          'circle-radius': 6,
          'circle-color': C.focus,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
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

/** Outside the campus is blacked out flat; tilted, it is shaded instead so the horizon is not a void. */
export function maskOpacity(view3d: boolean): number {
  return view3d ? 0.5 : 1
}

/**
 * One fill-extrusion layer over a model source. Parts grow out of the ground
 * between z15 and z16 so zooming in reads as the campus rising.
 */
function extrusion(id: string, source: string, minzoom: number, visible: boolean, opacity: number): LayerSpecification[] {
  const grow = (prop: string): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], minzoom, 0, minzoom + 0.7, ['get', prop]]
  return [{
    id, type: 'fill-extrusion' as const, source, minzoom,
    filter: ['==', ['get', 'part'], 'solid'],
    layout: { visibility: visible ? 'visible' as const : 'none' as const },
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-base': grow('base'),
      'fill-extrusion-height': grow('top'),
      'fill-extrusion-opacity': opacity,
      'fill-extrusion-vertical-gradient': true,
    },
  }]
}
