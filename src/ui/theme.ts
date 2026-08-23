export type Resolved = 'light' | 'dark'

const KEY = 'campusmap.theme'

/**
 * Follows the system preference until the user picks a side. After that,
 * localStorage remembers, on this browser, until they change it back.
 */
function systemPref(): Resolved {
  try {
    if (matchMedia('(prefers-color-scheme: light)').matches) return 'light'
  } catch {
    // matchMedia unavailable — fall through.
  }
  return 'dark'
}

let choice: Resolved = read()
const listeners = new Set<(t: Resolved) => void>()

function read(): Resolved {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // Private mode or storage disabled — fall through to the system.
  }
  return systemPref()
}

export function resolved(): Resolved {
  return choice
}

function apply() {
  document.documentElement.setAttribute('data-theme', choice)
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', choice === 'light' ? '#e7eef6' : '#071428')
  for (const fn of listeners) fn(choice)
}

/** Straight flip. One press, one visible change. */
export function toggle(): Resolved {
  choice = choice === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem(KEY, choice) } catch { /* nothing we can do */ }
  apply()
  return choice
}

export function onThemeChange(fn: (t: Resolved) => void) {
  listeners.add(fn)
}

// The inline script in index.html sets the attribute before first paint; this
// syncs the meta colour and notifies subscribers once the module loads.
apply()
