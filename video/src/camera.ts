import { interpolate } from 'remotion'
import { sample, type Track } from '../../src/map/train'
import { EASE, SCENES as S } from './brand'

/**
 * One continuous camera for the whole film. Poses are keyframes; between
 * them the camera eases. The hook uses a launch curve so frame one is already
 * moving. During the train shot the camera is slaved to the track.
 */

export interface Pose { center: [number, number]; zoom: number; pitch: number; bearing: number }
type Ease = (t: number) => number

const P = {
  campus: [79.1606, 12.9712] as [number, number],
  sjt: [79.163926, 12.970953] as [number, number],
  prpE: [79.165811, 12.97187] as [number, number],
  medical: [79.160892, 12.971264] as [number, number],
  atm: [79.162656, 12.971475] as [number, number],
  mess: [79.1642, 12.9745] as [number, number],
}
const mid = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

/** The train shot: where the camera and the train's head are along the track (m). */
const TRAIN = { from: S.train.from, to: S.train.to, cam: [2150, 2245] as const, headAt0: 2270, speed: 45 }

export function trainHeadAt(frame: number): number | null {
  if (frame < TRAIN.from - 20) return null
  return TRAIN.headAt0 + (TRAIN.speed * (frame - TRAIN.from)) / 30
}

function trackBearing(t: Track, d: number): number {
  const { ux, uy } = sample(t, d)
  return (Math.atan2(ux, uy) * 180) / Math.PI
}

function trainPose(t: Track, frame: number): Pose {
  const k = Math.min(1, Math.max(0, (frame - TRAIN.from) / (TRAIN.to - TRAIN.from)))
  const d = TRAIN.cam[0] + (TRAIN.cam[1] - TRAIN.cam[0]) * k
  return { center: sample(t, d).p, zoom: 18.2, pitch: 68, bearing: trackBearing(t, d) - 58 }
}

function lerpBearing(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return a + d * k
}

function blend(a: Pose, b: Pose, k: number): Pose {
  return {
    center: [a.center[0] + (b.center[0] - a.center[0]) * k, a.center[1] + (b.center[1] - a.center[1]) * k],
    zoom: a.zoom + (b.zoom - a.zoom) * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
    bearing: lerpBearing(a.bearing, b.bearing, k),
  }
}

const pose = (center: [number, number], zoom: number, pitch: number, bearing: number): Pose => ({ center, zoom, pitch, bearing })

/** [frame, pose, easing into this key]. */
function keys(track: Track): [number, Pose, Ease][] {
  return [
    [S.hook.from, pose(P.campus, 15.15, 50, -52), EASE.launch],
    [S.hook.to, pose([79.1615, 12.9712], 15.9, 57, -16), EASE.launch],
    // PRP: frame the SJT → PRP walk while the search plays, then push in.
    [240, pose(mid(P.sjt, P.prpE), 17.05, 52, 8), EASE.camera],
    [330, pose(mid(P.sjt, P.prpE), 17.15, 54, 16), EASE.camera],
    [440, pose(P.prpE, 17.75, 60, 38), EASE.camera],
    // Pharmacy: pull back over PRP → Saravana Medical, then settle on it.
    [478, pose(mid(P.prpE, P.medical), 16.55, 50, 4), EASE.camera],
    [575, pose(P.medical, 17.35, 56, -12), EASE.camera],
    // ATM: the short hop east.
    [612, pose(mid(P.medical, P.atm), 17.55, 55, -6), EASE.camera],
    [715, pose(P.atm, 17.85, 58, 6), EASE.camera],
    // Dinner: north to the MH Veg Mess.
    [760, pose(P.mess, 17.3, 55, 18), EASE.camera],
    [840, pose(P.mess, 17.6, 57, 30), EASE.camera],
    // Professor: back to SJT.
    [880, pose(P.sjt, 17.2, 55, 36), EASE.camera],
    [958, pose(P.sjt, 17.6, 57, 50), EASE.camera],
    // Hand over to the tracking shot.
    [S.train.from + 10, trainPose(track, S.train.from + 10), EASE.camera],
  ]
}

export function cameraAt(frame: number, track: Track): Pose {
  if (frame >= S.train.from + 10 && frame <= S.train.to) return trainPose(track, frame)
  if (frame > S.train.to) {
    const k = interpolate(frame, [S.train.to, S.train.to + 75], [0, 1], {
      easing: EASE.camera, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
    return blend(trainPose(track, S.train.to), pose([79.1612, 12.9713], 15.35, 50, -16), k)
  }
  const ks = keys(track)
  for (let i = 0; i < ks.length - 1; i++) {
    const [fa, a] = ks[i]!
    const [fb, b, ease] = ks[i + 1]!
    if (frame >= fa && frame <= fb) {
      return blend(a, b, interpolate(frame, [fa, fb], [0, 1], { easing: ease }))
    }
  }
  return ks[ks.length - 1]![1]
}

/** Right-hand map padding (px) while a panel is open, so places sit left of it. */
export function panelPad(frame: number, windows: readonly (readonly [number, number])[]): number {
  let pad = 0
  for (const [a, b] of windows) {
    const k = interpolate(frame, [a - 12, a + 12, b - 12, b + 12], [0, 1, 1, 0], {
      easing: EASE.camera, extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    })
    pad = Math.max(pad, k * 560)
  }
  return pad
}
