/**
 * Starred and recently opened places, kept in this browser only. A nicety,
 * not core: if storage is blocked or full everything still works, the lists
 * just stay empty. Adapted from rugbedbugg/VIT-CampusMap.
 */

const RECENT_KEY = 'campusmap.recent'
const STAR_KEY = 'campusmap.starred'
const MAX_RECENT = 6

function readIds(key: string): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

function writeIds(key: string, ids: readonly string[]) {
  try { localStorage.setItem(key, JSON.stringify(ids)) } catch { /* storage disabled or full */ }
}

export function getRecent(): string[] { return readIds(RECENT_KEY) }

export function pushRecent(id: string) {
  writeIds(RECENT_KEY, [id, ...readIds(RECENT_KEY).filter((x) => x !== id)].slice(0, MAX_RECENT))
}

export function getStarred(): string[] { return readIds(STAR_KEY) }

export function isStarred(id: string): boolean { return getStarred().includes(id) }

/** Returns the new starred state. */
export function toggleStar(id: string): boolean {
  const ids = readIds(STAR_KEY)
  const on = !ids.includes(id)
  writeIds(STAR_KEY, on ? [id, ...ids] : ids.filter((x) => x !== id))
  return on
}
