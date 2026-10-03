import type { Campus, Poi } from '../types'
import { metresBetween } from '../route/router'

/** Everyday utility stops: the categories worth surfacing next to *any* place. */
const AMENITY: ReadonlySet<string> = new Set(['cycle', 'atm', 'print', 'laundry', 'health', 'canteen', 'shop', 'water', 'toilet'])

/**
 * The closest amenity of each kind to a place, nearest first — "where's the
 * ATM / printer / canteen from here", one answer per kind rather than three
 * canteens in a row. Adapted from rugbedbugg/VIT-CampusMap.
 */
export function nearestAmenities(
  campus: Campus,
  from: { id?: string; lat: number; lon: number },
  limit = 4,
  maxMetres = 600,
): { poi: Poi; metres: number }[] {
  const best = new Map<string, { poi: Poi; metres: number }>()
  for (const p of campus.pois) {
    if (p.id === from.id || !AMENITY.has(p.cat)) continue
    const metres = metresBetween(from.lat, from.lon, p.lat, p.lon)
    if (metres > maxMetres) continue
    const cur = best.get(p.cat)
    if (!cur || metres < cur.metres) best.set(p.cat, { poi: p, metres })
  }
  return [...best.values()].sort((a, b) => a.metres - b.metres).slice(0, limit)
}
