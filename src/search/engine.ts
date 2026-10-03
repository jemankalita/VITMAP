import type { Campus, Faculty, MessMenu, Poi } from '../types'
import { openNow } from './hours'

/* ── documents ───────────────────────────────────────────────────────────── */

export type Kind = 'place' | 'person' | 'mess' | 'layer' | 'action' | 'hint'

export interface Doc {
  kind: Kind
  id: string
  title: string
  sub: string
  /** Everything matchable, lowercase, space-joined. Built once. */
  hay: string
  /** Tokens given prefix-match priority — the name words, codes, aliases. */
  keys: string[]
  cat?: string
  lat?: number
  lon?: number
  poi?: Poi
  person?: Faculty
  menus?: MessMenu[]
  hours?: string
  /** PRP room searches: the floor level and room that matched, for the panel to point at. */
  floor?: string
  room?: string
  /** Nudges ties: higher wins. */
  boost: number
  run?: () => void
}

export interface Hit extends Doc {
  score: number
  /** Character indices in `title` that matched, for highlighting. */
  marks: number[]
}

const lower = (s: string) => s.toLowerCase()
const words = (s: string) => lower(s).split(/[^a-z0-9]+/).filter(Boolean)

/* ── scoring ─────────────────────────────────────────────────────────────── */

/**
 * Subsequence match with contiguity and word-boundary bonuses, in the spirit of
 * fzf but far simpler. Returns -1 for no match. Left-anchored matches and
 * matches that start a word score much higher, which is what makes "L20",
 * "kd", "cycl" and "hall 5" all land where you expect.
 */
function fuzzy(needle: string, hay: string): { score: number; at: number[] } | null {
  if (!needle) return { score: 0, at: [] }
  const n = needle.length, h = hay.length
  if (n > h) return null

  const at: number[] = []
  let score = 0
  let hi = 0
  let streak = 0

  for (let ni = 0; ni < n; ni++) {
    const c = needle[ni]!
    let found = -1
    while (hi < h) {
      if (hay[hi] === c) { found = hi; break }
      hi++
    }
    if (found === -1) return null

    let bonus = 1
    const prev = found > 0 ? hay[found - 1]! : ' '
    if (found === 0) bonus += 8
    else if (prev === ' ' || prev === '-' || prev === '/') bonus += 6
    else if (prev >= '0' && prev <= '9' && !(c >= '0' && c <= '9')) bonus += 2

    streak = at.length && at[at.length - 1] === found - 1 ? streak + 1 : 0
    bonus += Math.min(streak * 3, 12)

    score += bonus
    at.push(found)
    hi = found + 1
  }

  // Prefer shorter haystacks and matches that start early.
  score -= Math.min(at[0]! * 0.4, 12)
  score -= Math.min(h * 0.02, 6)
  return { score, at }
}

function scoreDoc(doc: Doc, q: string, qWords: string[]): Hit | null {
  // 1. Exact / prefix on a key token — the strongest signal by far.
  let best = -1
  let marks: number[] = []

  for (const k of doc.keys) {
    if (k === q) { best = Math.max(best, 1000); break }
    if (k.startsWith(q)) best = Math.max(best, 700 - (k.length - q.length))
  }

  // 2. Title fuzzy.
  const t = fuzzy(q, lower(doc.title))
  if (t) {
    const s = 300 + t.score
    if (s > best) { best = s; marks = t.at }
  }

  // 3. Every query word must appear somewhere. Handles "mess dinner",
  //    "hall 5 canteen", "cse professor" — order-independent.
  if (best < 0 && qWords.length > 1) {
    let all = true
    let sum = 0
    for (const w of qWords) {
      const i = doc.hay.indexOf(w)
      if (i === -1) { all = false; break }
      sum += 40 - Math.min(i * 0.05, 20)
    }
    if (all) best = sum
  }

  // 4. Last resort: substring anywhere in the haystack.
  if (best < 0) {
    const i = doc.hay.indexOf(q)
    if (i === -1) return null
    best = 30 - Math.min(i * 0.05, 20)
  }

  return { ...doc, score: best + doc.boost, marks }
}

/* ── index ───────────────────────────────────────────────────────────────── */

/** Meal keyword -> the MessIT `meal` value. */
const MEALS: Record<string, string> = {
  breakfast: 'Breakfast', bfast: 'Breakfast', morning: 'Breakfast',
  lunch: 'Lunch', afternoon: 'Lunch',
  snacks: 'Snacks', snack: 'Snacks', tea: 'Snacks',
  dinner: 'Dinner', supper: 'Dinner', night: 'Dinner', evening: 'Dinner',
}

export class SearchIndex {
  readonly docs: Doc[] = []
  private readonly campus: Campus

  constructor(campus: Campus, hooks: {
    onLayer: (cat: string) => void
    onAction: (id: string) => void
  }) {
    this.campus = campus

    for (const p of campus.pois) {
      // 23 identical "Street light" rows would drown the results. The layer
      // entry below still makes them reachable by name.
      if (p.cat === 'light') continue
      const alias = ALIASES[p.cat] ?? []
      // "Lecture Hall 20" should be reachable as L20, LH20, l 20.
      const short = /^Lecture Hall (\d+)$/.exec(p.name)
      const keys = [
        lower(p.name), ...words(p.name), ...alias,
        ...(p.aliases ?? []).flatMap((x) => [lower(x), ...words(x)]),
      ]
      if (short) keys.push(`l${short[1]}`, `lh${short[1]}`, short[1]!)
      const mh = /^(MH|LH)\s+([A-Z])(?:\s+(Annexe))?$/i.exec(p.name)
      if (mh) {
        const kind = mh[1]!.toLowerCase()
        const letter = mh[2]!.toLowerCase()
        const code = `${kind}${letter}`
        keys.push(code, `${kind} ${letter}`, `${kind}-${letter}`)
        if (mh[3]) keys.push(`${code}annexe`, `${kind} ${letter} annexe`)
      }
      const gate = /^Gate\s*(.+)$/i.exec(p.name)
      if (gate) {
        const g = gate[1]!.replace(/\s+/g, '').toLowerCase()
        keys.push(`gate${g}`, `g${g}`)
      }
      const shuttle = /^S(\d+)$/i.exec(p.name)
      if (shuttle) keys.push(`s${shuttle[1]!}`, `stop ${shuttle[1]!}`, `shuttle ${shuttle[1]!}`)
      if (p.cat === 'prp') {
        keys.push('prp', 'perl', 'classroom', 'classrooms', 'maze')
        for (const f of p.floors ?? []) {
          if (f.rooms) keys.push(lower(f.rooms).replace(/[–—]/g, '-'))
        }
      }

      this.docs.push({
        kind: 'place',
        id: p.id,
        title: p.name,
        sub: [campus.categories[p.cat]?.label, p.near ? `near ${p.near}` : '', p.operator ?? '']
          .filter(Boolean).join(' · '),
        hay: lower([p.name, p.alt, ...(p.aliases ?? []), p.cat, campus.categories[p.cat]?.label,
                    p.kind, p.operator, p.cuisine, p.desc, p.near,
                    ...(p.floors ?? []).map((f) => `${f.label} ${f.rooms ?? ''}`),
                    ...alias].filter(Boolean).join(' ')),
        keys,
        cat: p.cat,
        lat: p.lat, lon: p.lon,
        poi: p,
        hours: p.hours,
        boost: (p.unnamed ? -30 : 0) + (campus.categories[p.cat]?.pin ? 12 : 0),
      })
    }

    for (const f of campus.faculty?.items ?? []) {
      const surname = f.name.split(/\s+/).pop() ?? f.name
      this.docs.push({
        kind: 'person',
        id: `fac:${f.url}`,
        title: f.name,
        sub: f.title || f.dept,
        hay: lower([f.name, f.title, ...(f.depts ?? [f.dept]), f.research, f.office, f.email,
                    'professor prof faculty'].filter(Boolean).join(' ')),
        keys: [...words(f.name), lower(surname), ...(f.depts ?? [f.dept]).flatMap(words)],
        person: f,
        boost: 4,
      })
    }

    // One doc per hall, holding that hall's whole week.
    const byHall = new Map<string, MessMenu[]>()
    for (const m of campus.mess?.items ?? []) {
      const arr = byHall.get(m.hall)
      if (arr) arr.push(m); else byHall.set(m.hall, [m])
    }
    for (const [hall, menus] of byHall) {
      const meta = campus.mess?.halls.find((h) => h.name === hall)
      const at = meta?.at ? campus.pois.find((p) => p.name === meta.at) : undefined
      this.docs.push({
        kind: 'mess',
        id: `mess:${hall}`,
        title: /mess$/i.test(hall) ? hall : `${hall} Mess`,
        sub: [`${menus.length} menus`, meta?.type, ...(meta?.tags ?? [])].filter(Boolean).join(' · '),
        hay: lower([hall, 'mess food menu meal breakfast lunch dinner snacks khana',
                    meta?.type, ...(meta?.tags ?? []),
                    ...menus.map((m) => `${m.day} ${m.date ?? ''} ${m.meal} ${m.menu} ${m.extras ?? ''}`)].join(' ')),
        keys: [...words(hall), `${words(hall).join('')}mess`, 'mess'],
        menus,
        lat: at?.lat, lon: at?.lon,
        cat: 'mess',
        boost: 10,
      })
    }

    for (const [cat, meta] of Object.entries(campus.categories)) {
      const n = campus.meta.counts[cat] ?? 0
      if (!n) continue
      this.docs.push({
        kind: 'layer',
        id: `layer:${cat}`,
        title: meta.label,
        sub: `Show all ${n} on the map`,
        hay: lower([cat, meta.label, ...(ALIASES[cat] ?? [])].join(' ')),
        keys: [cat, ...words(meta.label), ...(ALIASES[cat] ?? [])],
        cat,
        boost: 8,
        run: () => hooks.onLayer(cat),
      })
    }

    for (const a of ACTIONS) {
      this.docs.push({
        kind: 'action',
        id: `do:${a.id}`,
        title: a.title,
        sub: a.sub,
        hay: lower([a.title, a.sub, a.words].join(' ')),
        keys: words(a.title + ' ' + a.words),
        boost: 2,
        run: () => hooks.onAction(a.id),
      })
    }
  }

  /**
   * Intent pass. Recognises a few shapes before generic ranking so that
   * "mess dinner" answers with tonight's food rather than a list of halls.
   */
  private intent(qWords: string[]): Hit[] | null {
    const roomTok = qWords.find((w) => /^g?\d{2,3}$/i.test(w))
    if (roomTok && (qWords.includes('prp') || qWords.length === 1)) {
      const out: Hit[] = []
      for (const doc of this.docs) {
        if (doc.kind !== 'place' || doc.cat !== 'prp' || !doc.poi?.floors) continue
        const floor = doc.poi.floors.find((f) => f.rooms && roomInSpec(f.rooms, roomTok))
        if (!floor) continue
        out.push({
          ...doc,
          title: `${doc.title} · ${floor.label}`,
          sub: floor.rooms ?? '',
          floor: floor.level,
          room: roomTok.toUpperCase(),
          score: 920,
          marks: [],
        })
      }
      if (out.length) return out.sort((a, b) => a.title.localeCompare(b.title))
    }

    const meal = qWords.map((w) => MEALS[w]).find(Boolean)
    if (meal && (qWords.includes('mess') || qWords.some((w) => MEALS[w]))) {
      const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
      const rest = qWords.filter((w) => !MEALS[w] && w !== 'mess' && w !== 'today')
      const out: Hit[] = []
      for (const doc of this.docs) {
        if (doc.kind !== 'mess' || !doc.menus) continue
        if (rest.length && !rest.every((w) => doc.hay.includes(w))) continue
        const m = doc.menus.find((x) => x.meal === meal && x.date === iso)
        if (!m) continue
        out.push({
          ...doc,
          title: `${doc.title} — ${meal.toLowerCase()}`,
          sub: m.menu,
          score: 900,
          marks: [],
        })
      }
      if (out.length) return out.sort((a, b) => a.title.localeCompare(b.title))
    }
    return null
  }

  search(raw: string, limit = 40): Hit[] {
    const q = lower(raw.trim())
    if (!q) return []
    const qWords = words(q)

    const forced = this.intent(qWords)
    if (forced) return forced.slice(0, limit)

    const out: Hit[] = []
    for (const doc of this.docs) {
      const hit = scoreDoc(doc, q, qWords)
      if (hit) out.push(hit)
    }
    out.sort((a, b) => b.score - a.score || a.title.length - b.title.length)

    // "open now" nudge: among close scores, prefer somewhere you can actually go.
    const top = out.slice(0, limit)
    for (const h of top) {
      const st = openNow(h.hours)
      if (st?.open) h.score += 3
    }
    top.sort((a, b) => b.score - a.score)
    return top
  }

  /** Suggestions for the empty state — real things that exist in this data. */
  examples(): string[] {
    const out = ['prp', 'gate 11', 'sjt', 'mh k', 'mess dinner', '327']
    if (this.campus.faculty?.items.length) out.push('scope professor')
    return out
  }
}

/* ── vocabulary ──────────────────────────────────────────────────────────── */

/** Words a student would actually type for each category. */
const ALIASES: Record<string, string[]> = {
  lecture: ['lecture', 'class', 'hall', 'room', 'tut', 'tutorial', 'induction'],
  academic: ['dept', 'department', 'lab', 'building', 'office', 'academic'],
  hostel: ['hostel', 'hall', 'room', 'wing', 'block', 'mh', 'lh', 'mens', 'ladies'],
  mess: ['mess', 'food', 'khana', 'meal', 'breakfast', 'lunch', 'dinner', 'snacks'],
  canteen: ['canteen', 'cafe', 'coffee', 'food', 'eat', 'restaurant', 'snack', 'chai', 'tea', 'juice', 'foodcourt'],
  shop: ['shop', 'store', 'buy', 'grocery', 'market', 'stationery'],
  print: ['print', 'printer', 'printout', 'xerox', 'photocopy', 'copy', 'scan', 'binding'],
  water: ['water', 'cooler', 'drinking', 'ro', 'bottle', 'thanda', 'pani', 'lake'],
  atm: ['atm', 'cash', 'money', 'bank', 'withdraw'],
  cycle: ['cycle', 'cycles', 'bike', 'bicycle', 'parking', 'stand', 'two wheeler'],
  parking: ['parking', 'car', 'four wheeler', 'vehicle'],
  laundry: ['laundry', 'wash', 'washing', 'dhobi', 'clothes', 'iron', 'dryclean'],
  health: ['health', 'doctor', 'hospital', 'clinic', 'medical', 'pharmacy', 'medicine', 'emergency'],
  sports: ['sports', 'gym', 'ground', 'court', 'field', 'pool', 'swim', 'run', 'track', 'play', 'stadium', 'basketball', 'tennis'],
  toilet: ['toilet', 'washroom', 'restroom', 'bathroom', 'loo'],
  vending: ['vending', 'machine', 'snack', 'chips'],
  worship: ['temple', 'mosque', 'church', 'prayer', 'worship'],
  transport: ['bus', 'shuttle', 'auto', 'taxi', 'stop'],
  gate: ['gate', 'gates', 'main gate', 'entrance', 'exit'],
  prp: ['prp', 'perl', 'classroom', 'classrooms', 'block', 'maze', 'lecture'],
  admin: ['office', 'admin', 'security', 'police', 'library', 'post', 'help', 'sw', 'welfare'],
  green: ['park', 'garden', 'green', 'lawn', 'fields', 'lake'],
  light: ['light', 'lights', 'lamp', 'lamps', 'street light', 'streetlight', 'lit', 'dark', 'night'],
}

function roomInSpec(spec: string, token: string): boolean {
  const wantG = /^g/i.test(token)
  const num = +(token.replace(/^[gG]/, ''))
  if (!num) return false
  const nums = spec.match(/\d+/g)
  if (!nums) return false
  const ground = /^g/i.test(spec.trim())
  if (wantG && !ground) return false
  if (nums.length === 1) return +nums[0]! === num
  return num >= +nums[0]! && num <= +nums[1]!
}

const ACTIONS = [
  { id: 'prp', title: 'PRP maze', sub: 'Classroom map of Perl Research Park', words: 'prp maze classroom indoor blocks' },
  { id: 'satellite', title: 'Toggle satellite', sub: 'Aerial photo of campus', words: 'satellite aerial photo imagery google' },
  { id: 'locate', title: 'Find my location', sub: 'Follow you live on the map', words: 'gps where am i me here live follow' },
  { id: 'layers-all', title: 'Show every layer', sub: 'Turn all categories on', words: 'all layers everything show' },
  { id: 'layers-none', title: 'Hide every layer', sub: 'Clear the map', words: 'none clear hide reset layers' },
  { id: 'clear-route', title: 'Clear route', sub: 'Remove the drawn path', words: 'route clear cancel remove path' },
  { id: 'about', title: 'About & data sources', sub: 'Where every number comes from', words: 'about data source credit osm attribution help' },
  { id: 'report', title: 'Report a missing place', sub: 'Drop a pin and open an issue', words: 'missing add report wrong hall lecture hostel contribute fix pin' },
]
