import type { CSSProperties } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { COLOR, EASE, FONT } from './brand'

const STAGGER = 3 // frames between words
const IN = 22 // frames for a word to settle
const OUT = 14 // frames for the line to leave

/**
 * A line of type that enters word by word — rise, focus, fade — and leaves
 * as one soft blur. `at` and `out` are absolute frames, chosen on the beat.
 */
export const Line: React.FC<{
  text: string
  at: number
  out?: number
  size?: number
  weight?: number
  mono?: boolean
  color?: string
  tracking?: string
  style?: CSSProperties
}> = ({ text, at, out, size = 96, weight = 700, mono = false, color = COLOR.bone, tracking, style }) => {
  const frame = useCurrentFrame()
  const leave = out == null ? 0 : interpolate(frame, [out - OUT, out], [0, 1], {
    easing: EASE.exit, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  })
  const words = text.split(' ')

  return (
    <div
      style={{
        fontFamily: mono ? FONT.mono : FONT.display,
        fontSize: size,
        fontWeight: weight,
        letterSpacing: tracking ?? (mono ? '0.02em' : '-0.025em'),
        lineHeight: 1.05,
        color,
        textAlign: 'center',
        whiteSpace: 'pre',
        opacity: 1 - leave,
        filter: leave ? `blur(${leave * 10}px)` : undefined,
        transform: `translateY(${-leave * 0.12}em)`,
        ...style,
      }}
    >
      {words.map((w, i) => {
        const start = at + i * STAGGER
        const k = interpolate(frame, [start, start + IN], [0, 1], {
          easing: EASE.enter, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        })
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              opacity: k,
              transform: `translateY(${(1 - k) * 0.32}em)`,
              filter: k < 1 ? `blur(${(1 - k) * 12}px)` : undefined,
            }}
          >
            {w}{i < words.length - 1 ? ' ' : ''}
          </span>
        )
      })}
    </div>
  )
}

/** Centres its children on the frame, optionally nudged down from the middle. */
export const Center: React.FC<{ children: React.ReactNode; y?: number }> = ({ children, y = 0 }) => (
  <div
    style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 22, transform: `translateY(${y}px)`,
    }}
  >
    {children}
  </div>
)
