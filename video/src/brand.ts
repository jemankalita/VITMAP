import { Easing } from 'remotion'

/**
 * The film's rulebook. Three colours, one family of type, one tempo, and a
 * timeline set by the voiceover: every scene is as long as its line needs.
 */

export const FPS = 30
export const W = 1920
export const H = 1080

/** 100 BPM: smooth, effortless. One beat = 18 frames. */
export const BPM = 100
export const BEAT = Math.round((60 / BPM) * FPS) // 18
export const BAR = BEAT * 4 // 72

export const COLOR = {
  /** Warm black — the stage. Same as the site's dark ground. */
  ink: '#14110E',
  /** Bone — every word. */
  bone: '#F3ECE3',
  /** Signal blue — the one thing in a shot that matters most. */
  signal: '#3D7AED',
} as const

export const FONT = {
  display: '"Overpass Variable", "Overpass", system-ui, sans-serif',
  mono: '"Overpass Mono", ui-monospace, monospace',
} as const

/** Expensive motion is eased motion. Nothing in the film moves linearly. */
export const EASE = {
  /** Camera: long, patient in-out. */
  camera: Easing.bezier(0.65, 0, 0.35, 1),
  /** Already moving on frame one: starts fast, settles long. */
  launch: Easing.bezier(0.2, 0.6, 0.35, 1),
  /** Type and UI entering: fast start, long settle. */
  enter: Easing.bezier(0.16, 1, 0.3, 1),
  /** Leaving: gentle. */
  exit: Easing.bezier(0.7, 0, 0.84, 0),
} as const

/** Scene windows in frames [from, to). */
export const SCENES = {
  hook: { from: 0, to: 150 },
  prp: { from: 150, to: 450 },
  pharmacy: { from: 450, to: 585 },
  atm: { from: 585, to: 725 },
  dinner: { from: 725, to: 850 },
  prof: { from: 850, to: 970 },
  train: { from: 970, to: 1040 },
  end: { from: 1040, to: 1155 },
} as const

export const DURATION = 1155 // 38.5 s

/**
 * Voiceover, one file per line (public/vo/NN.mp3, en-US-AndrewMultilingualNeural).
 * `at` is the frame the line starts; `len` its measured length in frames.
 */
export const VO = [
  { src: 'vo/01.mp3', at: 6, len: 120, text: 'This is VIT Vellore. Every building, in 3D.' },
  { src: 'vo/02.mp3', at: 156, len: 86, text: 'Got a class in PRP? Just type the room.' },
  { src: 'vo/03.mp3', at: 252, len: 192, text: 'Room 327. Block E, third floor. Six minutes from SJT.' },
  { src: 'vo/04.mp3', at: 456, len: 112, text: 'Need a pharmacy? Saravana Medical. Seven minutes away.' },
  { src: 'vo/05.mp3', at: 591, len: 126, text: 'Need cash? The nearest ATM is three minutes from there.' },
  { src: 'vo/06.mp3', at: 731, len: 109, text: "Hungry? See tonight's dinner, in every mess." },
  { src: 'vo/07.mp3', at: 856, len: 102, text: "And find any professor's cabin, in seconds." },
  { src: 'vo/08.mp3', at: 974, len: 56, text: 'Even the trains run live.' },
  { src: 'vo/09.mp3', at: 1052, len: 69, text: 'VIT Map. Find your way.' },
] as const
