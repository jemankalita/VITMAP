import { useEffect, useState } from 'react'
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion'
import { Router, humanDistance, humanEta } from '../../src/route/router'
import { toTrack, type Track } from '../../src/map/train'
import type { Campus, Graph, Poi, Route } from '../../src/types'

/** Everything the film needs, from the app's own built data. */
export interface FilmData {
  geo: Record<string, GeoJSON.FeatureCollection>
  campus: Campus
  track: Track
  poi: (id: string) => Poi
  /** Real walking routes from the app's router, keyed by scene. */
  routes: Record<'prp' | 'pharmacy' | 'atm', LegRoute>
}

export interface LegRoute { route: Route; eta: string; dist: string; from: Poi; to: Poi }

/** Places the tour visits, by campus.json id. */
export const PLACES = {
  sjt: 'r20995799',
  prpE: 'prp-e',
  medical: 'n14070559047',
  atm: 'n14070559046',
  mess: 'mh-veg-mess',
} as const

function eastbound(rail: GeoJSON.FeatureCollection | undefined): Track {
  const lines = (rail?.features ?? [])
    .filter((f) => f.geometry.type === 'LineString')
    .map((f) => (f.geometry as GeoJSON.LineString).coordinates)
  const east = lines.find((c) => c[0]![0]! < c[c.length - 1]![0]!) ?? lines[0]
  if (!east) throw new Error('no railway in geo.json — rebuild the app data')
  return toTrack(east)
}

async function load(): Promise<FilmData> {
  const [geo, campus, graph] = await Promise.all([
    fetch(staticFile('data/geo.json')).then((r) => r.json()),
    fetch(staticFile('data/campus.json')).then((r) => r.json()) as Promise<Campus>,
    fetch(staticFile('data/graph.json')).then((r) => r.json()) as Promise<Graph>,
  ])
  const byId = new Map(campus.pois.map((p) => [p.id, p]))
  const poi = (id: string) => {
    const p = byId.get(id)
    if (!p) throw new Error(`${id} missing from campus.json`)
    return p
  }
  const router = new Router(graph)
  const leg = (a: string, b: string): LegRoute => {
    const from = poi(a), to = poi(b)
    const route = router.route(from, to, 'foot')
    if (!route) throw new Error(`no route ${a} → ${b}`)
    return { route, eta: humanEta(route.seconds), dist: humanDistance(route.metres), from, to }
  }
  return {
    geo,
    campus,
    track: eastbound(geo.rail),
    poi,
    routes: {
      prp: leg(PLACES.sjt, PLACES.prpE),
      pharmacy: leg(PLACES.prpE, PLACES.medical),
      atm: leg(PLACES.medical, PLACES.atm),
    },
  }
}

/** Loads once; holds the render until the data is in. */
export function useFilmData(): FilmData | null {
  const [data, setData] = useState<FilmData | null>(null)
  const [handle] = useState(() => delayRender('film data'))
  useEffect(() => {
    load()
      .then((d) => { setData(d); continueRender(handle) })
      .catch((err) => cancelRender(err))
  }, [handle])
  return data
}
