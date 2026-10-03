import '../../src/styles.css'
import type { ReactNode } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { EASE } from './brand'

/**
 * The app's own UI — its markup classes and its stylesheet — scaled for a
 * 1080p frame. Nothing here is a mock-up of the interface; only the motion
 * is added.
 */

const SCALE = 1.35
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const ramp = (f: number, a: number, b: number, e = EASE.enter) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e })

/** 0..1 visibility: eases in over 16 frames at `at`, out over 12 before `out`. */
function presence(frame: number, at: number, out: number) {
  const i = ramp(frame, at, at + 16)
  const o = ramp(frame, out - 12, out, EASE.exit)
  return { i, o, v: i * (1 - o) }
}

/** The search palette: types a query, then one result row settles in. */
export const Palette: React.FC<{
  at: number; out: number; query: string; typeAt: number; perChar?: number
  group: string; title: string; sub: string; dot: string
}> = ({ at, out, query, typeAt, perChar = 3, group, title, sub, dot }) => {
  const frame = useCurrentFrame()
  if (frame < at || frame >= out) return null
  const { i, o, v } = presence(frame, at, out)
  const n = Math.max(0, Math.min(query.length, Math.floor((frame - typeAt) / perChar) + 1))
  const typed = frame < typeAt ? '' : query.slice(0, n)
  const doneAt = typeAt + query.length * perChar
  const row = ramp(frame, doneAt + 2, doneAt + 14)
  const caret = typed.length < query.length || Math.floor((frame - doneAt) / 12) % 2 === 0

  return (
    <div style={{
      position: 'absolute', left: '50%', top: '36%', width: 640,
      opacity: v, filter: o ? `blur(${o * 8}px)` : undefined,
      transform: `translate(-50%, -50%) scale(${SCALE * (0.96 + 0.04 * i) * (1 - 0.03 * o)})`,
    }}>
      <div id="palette-box" style={{ width: 640, maxHeight: 'none' }}>
        <div id="palette-input-row">
          <span id="palette-glyph">›</span>
          <div id="palette-input" style={{ display: 'flex', alignItems: 'center' }}>
            <span>{typed}</span>
            <span style={{ width: 2, height: 20, marginLeft: 2, background: 'var(--accent)', opacity: caret ? 1 : 0 }} />
          </div>
          <span id="palette-timing">{row > 0 ? '0.4ms' : ''}</span>
        </div>
        <div id="palette-results" style={{ minHeight: 82 }}>
          <div style={{ opacity: row, transform: `translateY(${(1 - row) * 8}px)` }}>
            <div className="grp">{group}</div>
            <div className="row" aria-selected="true">
              <span className="row-dot" style={{ background: dot }} />
              <span className="row-main">
                <span className="row-title">{title}</span>
                <span className="row-sub">{sub}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The place panel, docked right as on desktop. */
export const Panel: React.FC<{ at: number; out: number; kind: string; title: string; children: ReactNode }> = ({
  at, out, kind, title, children,
}) => {
  const frame = useCurrentFrame()
  if (frame < at || frame >= out) return null
  const { i, o, v } = presence(frame, at, out)
  return (
    <div style={{
      position: 'absolute', right: 64, top: '50%', width: 400,
      opacity: v, filter: o ? `blur(${o * 10}px)` : undefined,
      transformOrigin: 'right center',
      transform: `translateY(-50%) translateX(${(1 - i) * 40}px) scale(${SCALE})`,
    }}>
      <section id="panel" style={{ position: 'relative', inset: 'auto', width: 400, height: 'auto' }}>
        <header className="p-head">
          <div className="p-head-copy">
            <div className="p-kind">{kind}</div>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="p-body" style={{ overflow: 'visible' }}>{children}</div>
      </section>
    </div>
  )
}

/** Fades a part of a panel in at `at` (for content revealed mid-scene). */
export const Reveal: React.FC<{ at: number; children: ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame()
  const k = ramp(frame, at, at + 14)
  if (k <= 0) return null
  return <div style={{ opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>{children}</div>
}

/** The route badge: walking time, distance and where from — the app's own. */
export const RouteBadge: React.FC<{ at: number; out: number; eta: string; dist: string; via: string }> = ({
  at, out, eta, dist, via,
}) => {
  const frame = useCurrentFrame()
  if (frame < at || frame >= out) return null
  const { i, o, v } = presence(frame, at, out)
  return (
    <div style={{
      position: 'absolute', left: (1920 - 600) / 2, bottom: 92,
      opacity: v, filter: o ? `blur(${o * 8}px)` : undefined,
      transform: `translateX(-50%) translateY(${(1 - i) * 18}px) scale(${SCALE})`,
    }}>
      <div id="route-badge" style={{ position: 'relative', inset: 'auto', transform: 'none', margin: 0 }}>
        <span className="eta">{eta}</span>
        <span>{dist}</span>
        <span className="mode">
          <button className="on" type="button">walk</button>
          <button type="button">cycle</button>
        </span>
        <span className="via" style={{ maxWidth: 'none' }}>{via}</span>
      </div>
    </div>
  )
}
