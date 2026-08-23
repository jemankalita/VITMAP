// Pulls the live, public campus sources into data/live/*.json.
//
//   node scripts/fetch-web.mjs              # faculty + mess
//   node scripts/fetch-web.mjs --only=mess  # just one source
//
// Sources, all public and unauthenticated:
//   faculty  vit.ac.in school faculty listing pages
//   mess     messit.vinnovateit.com/menu-data/*.json  (VinnovateIT MessIT)

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = join(ROOT, 'data/live')
const UA = 'vit-vellore-map/0.1 (campus map; modeled on iitk.nis.pet)'

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}`))
const only = arg('only=')?.split('=')[1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function get(url, { json = false, tries = 3 } = {}) {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: json ? 'application/json, text/html;q=0.9' : 'text/html,application/xhtml+xml',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return json ? await res.json() : await res.text()
    } catch (e) {
      last = e
      await sleep(800 * (i + 1))
    }
  }
  throw new Error(`${url}: ${last?.message}`)
}

async function pool(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { out[i] = await fn(items[i], i) } catch { out[i] = null }
    }
  }))
  return out
}

const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ').trim()

/* ── faculty ─────────────────────────────────────────────────────────────── */

// School/department listing pages published at vit.ac.in. The index page at
// /faculty links to these; we also keep a seed list so a markup change on the
// index cannot silently drop whole schools.
const SEED_DEPTS = [
  'https://vit.ac.in/school/allfaculty/sas/physics',
  'https://vit.ac.in/school/allfaculty/sas/mathematics',
  'https://vit.ac.in/school/allfaculty/sas/chemistry',
  'https://vit.ac.in/school/allfaculty/sbst/biotechnology',
  'https://vit.ac.in/school/allfaculty/sbst/bio-sciences',
  'https://vit.ac.in/school/allfaculty/sce/civil-engineering',
  'https://vit.ac.in/school/allfaculty/scheme/chemical-engineering',
  'https://vit.ac.in/school/allfaculty/scope/computer-science-engineering',
  'https://vit.ac.in/school/allfaculty/scope/computational-intelligence',
  'https://vit.ac.in/school/allfaculty/scope/information-security',
  'https://vit.ac.in/school/allfaculty/scope/iot',
  'https://vit.ac.in/school/allfaculty/score/information-technology',
  'https://vit.ac.in/school/allfaculty/select/electrical-engineering',
  'https://vit.ac.in/school/allfaculty/sense/electronics',
  'https://vit.ac.in/school/allfaculty/smec/mechanical-engineering',
  'https://vit.ac.in/school/allfaculty/ssl/english',
  'https://vit.ac.in/school/allfaculty/vitsol/law',
  'https://vit.ac.in/school/allfaculty/vitbs/business',
]

function deptFromUrl(url) {
  const m = /\/allfaculty\/([^/]+)\/([^/?#]+)/i.exec(url)
  if (!m) return { school: '', dept: url }
  return { school: m[1].toUpperCase(), dept: strip(m[2].replace(/-/g, ' ')) }
}

function parseFacultyCards(html, fallbackDept, fallbackUrl) {
  const out = []
  const seen = new Set()

  const push = (name, title, url, dept) => {
    const n = strip(name)
    if (!n || n.length < 4 || n.length > 80) return
    if (!/^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)/i.test(n) && !/[A-Z]/.test(n)) return
    if (/^(Read More|Faculty|Professor|School|Department)$/i.test(n)) return
    const key = n.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      name: n,
      title: strip(title || '') || 'Faculty',
      dept: dept || fallbackDept,
      url: url || fallbackUrl,
    })
  }

  // Profile links wrapping a name heading — the most common Drupal/WP card.
  const cardRe = /<a[^>]+href="([^"]+faculty[^"]*)"[^>]*>[\s\S]{0,400}?<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi
  let m
  while ((m = cardRe.exec(html))) {
    const href = m[1].startsWith('http') ? m[1] : `https://vit.ac.in${m[1].startsWith('/') ? '' : '/'}${m[1]}`
    push(m[2], '', href, fallbackDept)
  }

  // "Dr. Name" as a heading, with the next <p> as designation.
  const headRe = /<h[1-6][^>]*>\s*((?:Dr|Prof|Mr|Ms|Mrs)\.?[\s.][^<]{2,80})<\/h[1-6]>\s*(?:<p[^>]*>([^<]{0,80})<\/p>)?/gi
  while ((m = headRe.exec(html))) push(m[1], m[2], fallbackUrl, fallbackDept)

  // Plain-text "Dr. Name" lines inside faculty listing markup.
  const nameRe = />\s*((?:Dr|Prof)\.?\s+[A-Z][A-Za-z .'-]{2,60})\s*</g
  while ((m = nameRe.exec(html))) push(m[1], '', fallbackUrl, fallbackDept)

  return out
}

async function fetchFaculty() {
  const pages = new Set(SEED_DEPTS)
  try {
    const index = await get('https://vit.ac.in/faculty')
    const re = /href="(https?:\/\/vit\.ac\.in\/school\/allfaculty\/[^"]+|\/school\/allfaculty\/[^"]+)"/gi
    let m
    while ((m = re.exec(index))) {
      const href = m[1].startsWith('http') ? m[1] : `https://vit.ac.in${m[1]}`
      pages.add(href.split('?')[0].replace(/\/$/, ''))
    }
    console.log(`faculty: index listed ${pages.size} department pages`)
  } catch (e) {
    console.warn(`faculty: index page failed (${e.message}); using seed department list`)
  }

  const urls = [...pages]
  const chunks = await pool(urls, 4, async (url) => {
    const html = await get(url)
    const { school, dept } = deptFromUrl(url)
    const label = school ? `${school} · ${dept}` : dept
    const cards = parseFacultyCards(html, label, url)
    return { url, label, cards, bytes: html.length }
  })

  const list = []
  const byPerson = new Map()
  let empty = 0
  for (const chunk of chunks) {
    if (!chunk) continue
    if (!chunk.cards.length) {
      empty++
      continue
    }
    for (const f of chunk.cards) {
      const key = f.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const hit = byPerson.get(key)
      if (hit) {
        if (!hit.depts.includes(f.dept)) hit.depts.push(f.dept)
        continue
      }
      const rec = { ...f, depts: [f.dept] }
      byPerson.set(key, rec)
      list.push(rec)
    }
  }

  console.log(`faculty: ${list.length} people from ${urls.length - empty}/${urls.length} department pages`)
  if (!list.length) {
    throw new Error('faculty: parsed 0 people — the listing is JS-rendered or the markup changed. See TODO.md.')
  }

  return {
    _source: 'https://vit.ac.in/faculty',
    _fetched: new Date().toISOString(),
    _note: 'Public faculty listings on vit.ac.in school pages. One record per person; joint appointments keep every department. Completeness is whatever those pages publish, not a payroll count.',
    _incomplete_departments: [],
    items: list,
  }
}

/* ── mess (MessIT) ───────────────────────────────────────────────────────── */

const MESSIT = 'https://messit.vinnovateit.com/menu-data'
const MEAL_TYPE = { 1: 'Breakfast', 2: 'Lunch', 3: 'Snacks', 4: 'Dinner' }
const HOSTEL_LABEL = { 1: 'MH', 2: 'LH' }
const MESS_LABEL = { 1: 'Special', 2: 'Veg', 3: 'Non-Veg' }
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

async function fetchMess() {
  const halls = []
  const items = []

  for (const hostel of [1, 2]) {
    for (const mess of [1, 2, 3]) {
      const url = `${MESSIT}/hostel-${hostel}-mess-${mess}.json`
      const data = await get(url, { json: true })
      const hallName = `${HOSTEL_LABEL[hostel]} ${MESS_LABEL[mess]} Mess`
      halls.push({
        name: hallName,
        type: MESS_LABEL[mess].toLowerCase(),
        tags: [HOSTEL_LABEL[hostel] === 'MH' ? 'mens' : 'ladies'],
      })
      for (const day of data.menu ?? []) {
        if (!day?.date || !Array.isArray(day.menu)) continue
        const d = new Date(`${day.date}T12:00:00+05:30`)
        const weekday = Number.isNaN(d.getTime()) ? '' : DAY_NAMES[d.getDay()]
        for (const meal of day.menu) {
          const label = MEAL_TYPE[meal.type]
          const text = (meal.menu ?? '').trim()
          if (!label || !text) continue
          items.push({
            hall: hallName,
            day: weekday,
            date: day.date,
            meal: label,
            menu: text,
          })
        }
      }
    }
  }

  if (!items.length) throw new Error('mess: empty response from MessIT')
  console.log(`mess: ${items.length} menus across ${halls.length} MessIT halls`)
  return {
    _source: 'https://messit.vinnovateit.com/menu-data',
    _fetched: new Date().toISOString(),
    _note: 'Public static snapshots published by MessIT (VinnovateIT). Halls are mess-type buckets (MH/LH × Special/Veg/Non-Veg), not individual hostel blocks. Community-maintained; treat as a strong hint.',
    halls,
    items,
  }
}

/* ── main ────────────────────────────────────────────────────────────────── */

const TASKS = {
  faculty: fetchFaculty,
  mess: fetchMess,
}

async function main() {
  await mkdir(LIVE, { recursive: true })
  const names = only ? [only] : Object.keys(TASKS)
  let failed = 0
  for (const name of names) {
    const task = TASKS[name]
    if (!task) {
      console.error(`unknown source "${name}" — have: ${Object.keys(TASKS).join(', ')}`)
      process.exit(1)
    }
    try {
      const data = await task()
      await writeFile(join(LIVE, `${name}.json`), JSON.stringify(data, null, 1))
      console.log(`  -> data/live/${name}.json\n`)
    } catch (e) {
      failed++
      console.error(`! ${name} failed: ${e.message}`)
      console.error(`  keeping any existing data/live/${name}.json\n`)
    }
  }
  process.exit(failed && failed === names.length ? 1 : 0)
}

main()
