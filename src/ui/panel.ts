import type { Campus, Faculty, MessMenu, Poi } from '../types'
import { openNow } from '../search/hours'
import { humanDistance, humanEta } from '../route/router'
import type { Hit } from '../search/engine'

const el = document.getElementById('panel') as HTMLElement

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MEAL_ORDER = ['Breakfast', 'Lunch', 'Snacks', 'Dinner']

function istISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)
}

function dateLabel(iso: string) {
  const dt = new Date(`${iso}T12:00:00+05:30`)
  if (Number.isNaN(dt.getTime())) return iso
  const day = DAY_NAMES[dt.getDay()] ?? ''
  const mon = dt.toLocaleString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })
  const n = dt.getDate()
  return `${day} ${n} ${mon}`
}

export interface PanelHost {
  campus: Campus
  routeTo(lat: number, lon: number, label: string): void
  routeState(): { active: boolean; eta?: number; metres?: number; locating?: boolean }
  close(): void
  openHall(name: string): void
}

let host: PanelHost

export function initPanel(h: PanelHost) {
  host = h
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.closest('.p-close')) { hidePanel(); host.close() }
    const hall = t.closest('[data-hall]') as HTMLElement | null
    if (hall?.dataset.hall) { host.openHall(hall.dataset.hall); return }
    const r = t.closest('[data-route]') as HTMLElement | null
    if (r) host.routeTo(+r.dataset.lat!, +r.dataset.lon!, r.dataset.label!)
  })
}

export function hidePanel() { el.hidden = true }

function shell(title: string, kind: string, body: string) {
  el.hidden = false
  el.innerHTML = `
    <div class="p-grip" aria-hidden="true"></div>
    <header class="p-head">
      <div class="p-head-copy">
        <div class="p-kind">${esc(kind)}</div>
        <h2>${esc(title)}</h2>
      </div>
      <button class="p-close" type="button" aria-label="Close">&times;</button>
    </header>
    <div class="p-body">${body}</div>`
  el.querySelector('.p-body')!.scrollTop = 0
}

function kv(rows: [string, string | undefined][]) {
  const live = rows.filter(([, v]) => v)
  if (!live.length) return ''
  return `<dl class="kv">${live.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`
}

function hoursRow(spec?: string): string | undefined {
  if (!spec) return undefined
  const st = openNow(spec)
  const badge = st === null ? ''
    : st.open ? ` <span style="color:#7ee787">· open${st.until ? ` till ${st.until}` : ''}</span>`
    : ` <span style="color:#ff7b72">· closed${st.next ? ` · opens ${st.next}` : ''}</span>`
  return `${esc(spec)}${badge}`
}

function floorTable(floors: { level: string; label: string; rooms: string | null }[]): string {
  const rows = floors.map((f) =>
    `<div class="floor"><b>${esc(f.label)}</b><span>${f.rooms ? esc(f.rooms) : '—'}</span></div>`).join('')
  return `<div class="p-sec">Classrooms by floor</div>
    <p class="p-note">Tap a block on the map. Room ranges are from the public PRP annotated map — not indoor GPS.</p>
    ${rows}`
}

function routeButtons(lat: number, lon: number, label: string) {
  const s = host.routeState()
  const labelText = s.locating
    ? 'Finding your location…'
    : s.active && s.eta != null
      ? `${humanEta(s.eta)} · ${humanDistance(s.metres!)}`
      : 'Route from my location'
  return `<div class="p-actions">
    <button type="button" data-route data-lat="${lat}" data-lon="${lon}" data-label="${esc(label)}"
      class="p-cta${s.active ? ' on' : ''}${s.locating ? ' locating' : ''}">${labelText}</button>
  </div>`
}

/* ── places ──────────────────────────────────────────────────────────────── */

/** Renders today's meals, then the rest of the week. Shared by the mess result
 *  and by any mess POI opened from the map. */
function menuSections(menus: MessMenu[]): string {
  const today = istISO()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()))
  const nowMeal = hour < 10 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 17 ? 'Snacks' : hour < 22 ? 'Dinner' : null

  const one = (m: MessMenu, markNow: boolean) => `
    <div class="meal${markNow && m.meal === nowMeal ? ' now' : ''}">
      <b>${esc(m.meal)}</b>
      <span>${esc(m.menu)}</span>
      ${m.extras ? `<em>extras: ${esc(m.extras)}</em>` : ''}
    </div>`

  const dates = [...new Set(menus.map((m) => m.date).filter(Boolean))] as string[]
  dates.sort()
  const showDate = dates.includes(today)
    ? today
    : (dates.filter((d) => d <= today).pop() ?? dates[0] ?? '')

  const forDate = (iso: string) =>
    MEAL_ORDER.map((meal) => menus.find((m) => m.date === iso && m.meal === meal)).filter(Boolean) as MessMenu[]

  const todays = showDate ? forDate(showDate) : []
  const rest = dates.filter((d) => d !== showDate)
    .map((d) => ({ date: d, meals: forDate(d) }))
    .filter((x) => x.meals.length)

  const heading = showDate === today ? `Today · ${dateLabel(showDate)}` : `Latest menu · ${showDate ? dateLabel(showDate) : ''}`

  return [
    todays.length
      ? `<div class="p-sec">${esc(heading)}</div>${todays.map((m) => one(m, showDate === today)).join('')}`
      : `<p class="p-note">No menu listed for today (${esc(today)}). MessIT may not have published this date yet.</p>`,
    rest.length
      ? `<details class="week"><summary>Other dates in this snapshot</summary>${rest.map((x) =>
          `<div class="p-sec" style="margin:12px 0 2px">${esc(dateLabel(x.date))}</div>${x.meals.map((m) => one(m, false)).join('')}`,
        ).join('')}</details>`
      : '',
    `<p class="src">Menus from <a href="https://messit.vinnovateit.com" target="_blank" rel="noopener">MessIT</a> (VinnovateIT) · dated, not weekday-repeating</p>`,
  ].join('')
}

export function showPoi(p: Poi, menus?: MessMenu[]) {
  const cat = host.campus.categories[p.cat]
  const wheel = p.wheelchair === 'yes' ? 'step-free'
    : p.wheelchair === 'limited' ? 'limited'
    : p.wheelchair === 'no' ? 'not step-free' : undefined

  const body = [
    routeButtons(p.lat, p.lon, p.name),
    kv([
      ['Hours', hoursRow(p.hours)],
      ['Access', wheel ? esc(wheel) : undefined],
      ['Type', p.kind ? esc(p.kind.replace(/_/g, ' ')) : undefined],
      ['Floor', p.level ? esc(p.level) : undefined],
      ['Cuisine', p.cuisine ? esc(p.cuisine.replace(/;/g, ', ')) : undefined],
      ['Capacity', p.capacity ? esc(p.capacity) : undefined],
      ['Covered', p.covered ? esc(p.covered) : undefined],
      ['Operator', p.operator ? esc(p.operator) : undefined],
      ['Price', p.price ? esc(p.price) : undefined],
      ['Potable', p.potable === 'no' ? 'no — not drinking water' : undefined],
      ['Lamp', p.lampType ? esc(p.lampType.toUpperCase()) : undefined],
      ['Mounted', p.support ? esc(p.support) : undefined],
      ['Phone', p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : undefined],
      ['Website', p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, '').slice(0, 34))}</a>` : undefined],
      ['Near', p.near ? esc(p.near) : undefined],
    ]),
    p.floors?.length ? floorTable(p.floors) : '',
    p.desc && !p.floors?.length ? `<p class="p-note">${esc(p.desc)}</p>` : '',
    // A mess opened from the map should answer the actual question: what's for dinner.
    menus?.length ? menuSections(menus) : '',
    `<p class="src">${p.cat === 'prp'
      ? `Classroom ranges from the <a href="https://www.google.com/maps/d/viewer?mid=1MqfJ8nGclE3KUacxTGu7yDAiTsGWP98" target="_blank" rel="noopener">PRP annotated map</a>`
      : p.src === 'osm'
      ? `OpenStreetMap · <a href="https://www.openstreetmap.org/${esc(p.osm)}" target="_blank" rel="noopener">${esc(p.osm)}</a>`
      : p.osm
      ? `OSM ${esc(p.osm)} · named from the VIT OSW campus map`
      : 'Hand-surveyed — verify before relying on it'}</p>`,
  ].join('')

  shell(p.name, cat?.label ?? p.cat, body)
}

/* ── people ──────────────────────────────────────────────────────────────── */

export function showPerson(f: Faculty, at?: Poi) {
  const body = [
    at ? routeButtons(at.lat, at.lon, at.name) : '',
    kv([
      ['Dept', esc(f.dept)],
      ['Office', f.office ? esc(f.office) : undefined],
      ['On map', at ? `${esc(at.name)}${f.atVia === 'dept' ? ' <span style="color:#6b7482">(department building)</span>' : ''}` : undefined],
      ['Email', f.email ? `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : undefined],
      ['Phone', f.phone ? `<a href="tel:${esc(f.phone)}">${esc(f.phone)}</a>` : undefined],
      ['Web', f.web ? `<a href="${esc(f.web)}" target="_blank" rel="noopener">${esc(f.web.replace(/^https?:\/\//, '').slice(0, 32))}</a>` : undefined],
      ['Degree', f.qualification ? esc(f.qualification) : undefined],
    ]),
    f.research ? `<div class="p-sec">Research</div><p class="p-note">${esc(f.research)}</p>` : '',
    `<p class="src"><a href="${esc(f.url)}" target="_blank" rel="noopener">Profile on vit.ac.in →</a></p>`,
  ].join('')

  shell(f.name, f.title || 'Faculty', body)
}

/* ── mess ────────────────────────────────────────────────────────────────── */

export function showMess(hit: Hit) {
  const at = hit.lat != null && hit.lon != null
  shell(hit.title, 'Mess menu', [
    at ? routeButtons(hit.lat!, hit.lon!, hit.title) : '',
    menuSections(hit.menus ?? []),
  ].join(''))
}

export function showMessIndex(campus: Campus) {
  const today = istISO()
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()))
  const nowMeal = hour < 10 ? 'Breakfast' : hour < 15 ? 'Lunch' : hour < 17 ? 'Snacks' : hour < 22 ? 'Dinner' : 'Dinner'
  const halls = campus.mess?.halls ?? []
  const items = campus.mess?.items ?? []

  const cards = halls.map((h) => {
    const at = campus.pois.find((p) => p.name === h.at || p.name === h.name)
    const meal = items.find((m) => m.hall === h.name && m.date === today && m.meal === nowMeal)
      ?? items.find((m) => m.hall === h.name && m.date === today)
    const tags = [...(h.tags ?? []), h.type].filter(Boolean).join(' · ')
    const preview = meal ? `${meal.meal} · ${meal.menu}` : 'Menu not listed for today'
    return `<button type="button" class="mess-card" data-hall="${esc(h.name)}">
      <b>${esc(h.name)}</b>
      <span class="mess-tags">${esc(tags)}${at ? '' : ' · not on map'}</span>
      <span class="mess-now">${esc(preview)}</span>
    </button>`
  }).join('')

  shell('Campus messes', 'MH & LH · Special · Veg · Non-veg', [
    `<p class="p-note">Men's and ladies' hostels each have three messes. Today's ${esc(nowMeal.toLowerCase())} is previewed below — tap a hall for the full menu and a GPS route.</p>`,
    `<div class="mess-grid">${cards || '<p class="p-note">No MessIT halls in this snapshot.</p>'}</div>`,
    `<p class="src">Menus from <a href="https://messit.vinnovateit.com" target="_blank" rel="noopener">MessIT</a> (VinnovateIT) · ${esc(dateLabel(today))}</p>`,
  ].join(''))
}

/* ── about ───────────────────────────────────────────────────────────────── */

export function showAbout(campus: Campus) {
  const f = campus.faculty
  const m = campus.mess
  const total = Object.values(campus.meta.counts).reduce((a, b) => a + b, 0)

  const body = `
    <p class="p-note">Everything here comes from a public source. Nothing on this
    map is invented — where there is no source, the feature is simply absent.</p>

    <div class="p-sec">Map & places</div>
    <p class="p-note"><b>${total}</b> places, <b>${campus.meta.counts.academic ?? 0}</b> academic/admin blocks.
    Geometry, opening hours and wheelchair tags from
    <a href="https://www.openstreetmap.org/relation/15931944" target="_blank" rel="noopener">OpenStreetMap</a>,
    ODbL. Walking and cycling times are computed over the OSM path network.</p>

    ${f ? `<div class="p-sec">Faculty</div>
    <p class="p-note"><b>${f.items.length}</b> people from
    <a href="${esc(f._source)}" target="_blank" rel="noopener">vit.ac.in/faculty</a>,
    fetched ${esc(f._fetched.slice(0, 10))}. ${f._located ?? 0} are placed on the map from their
    listed office.
    ${f._incomplete_departments?.length
      ? `<br><br><b>${f._incomplete_departments.length} departments came back short</b> on the
         last fetch: ${f._incomplete_departments.map((d) => `${esc(d.dept)} ${d.got}/${d.expected}`).join(', ')}.`
      : ''}</p>` : ''}

    <div class="p-sec">PRP maze</div>
    <p class="p-note">Block outlines and classroom ranges from the public
    <a href="https://www.google.com/maps/d/viewer?mid=1MqfJ8nGclE3KUacxTGu7yDAiTsGWP98" target="_blank" rel="noopener">PRP annotated map</a>.
    Search a room number (<code>327</code>, <code>g29</code>) or tap a block. Satellite view helps on the ground.</p>

    ${m ? `<div class="p-sec">Mess menus</div>
    <p class="p-note"><b>${m.items.length}</b> menus across <b>${m.halls.length}</b> mess types from
    <a href="https://messit.vinnovateit.com" target="_blank" rel="noopener">MessIT</a>
    (VinnovateIT), fetched ${esc(m._fetched.slice(0, 10))}. Community-maintained, so treat it as a strong hint.</p>` : ''}

    <div class="p-sec">Not here yet</div>
    <p class="p-note">Named hostel blocks, gates and shuttle stops that OSM does not carry yet,
    course timetables (VTOP is login-walled), club rosters, notices, and shuttle timings.
    Each one is waiting on a real source — see TODO.md in the repo.</p>

    <div class="p-sec">Contribute</div>
    <p class="p-note">Something wrong or missing? Most of it — hostel names, gates, ATMs,
    opening hours — belongs in
    <a href="https://www.openstreetmap.org/relation/15931944" target="_blank" rel="noopener">OpenStreetMap</a>;
    map it once there and this picks it up on the next build. Architecture modeled on
    <a href="https://github.com/ni5arga/iitk" target="_blank" rel="noopener">iitk.nis.pet</a>.</p>

    <p class="src">Built ${esc(campus.meta.built)} · ${esc(campus.meta.attribution)}</p>`

  shell('VIT Vellore map', 'About & sources', body)
}
