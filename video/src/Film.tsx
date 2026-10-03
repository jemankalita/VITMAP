import '@fontsource-variable/overpass/wght.css'
import '@fontsource/overpass-mono/latin-400.css'
import '@fontsource/overpass-mono/latin-600.css'
import { useMemo } from 'react'
import { AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion'
import { nearestAmenities } from '../../src/search/nearest'
import { COLOR, DURATION, EASE, SCENES as S, VO } from './brand'
import { panelPad } from './camera'
import { PLACES, useFilmData, type FilmData } from './data'
import { MapStage, type Pin, type RouteDraw } from './MapStage'
import { Center, Line } from './Type'
import { Palette, Panel, Reveal, RouteBadge } from './UI'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const ramp = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: EASE.camera })

/** Mock record — the faculty feed does not carry cabins yet. */
const PROF = { name: 'Arivuselvan K', role: 'HOD (IT)', dept: 'Information Technology', cabin: 'SJT-210-A20', at: 'SJT' }
/** The menu shown is the real MessIT entry for this date. */
const MENU_DATE = '2026-10-03'
const MENU_LABEL = 'Today · Saturday 3 Oct'

/** Panels on screen, for the camera to frame places to their left. */
const PANELS = [[244, 444], [504, 718], [738, 842], [904, 966]] as const

/** Music under the narrator: full between lines, ducked while he speaks. */
function musicVolume(f: number): number {
  let duck = 0
  for (const v of VO) duck = Math.max(duck, interpolate(f, [v.at - 8, v.at, v.at + v.len, v.at + v.len + 10], [0, 1, 1, 0], clamp))
  const fadeIn = interpolate(f, [0, 12], [0, 1], clamp)
  const fadeOut = interpolate(f, [DURATION - 30, DURATION], [1, 0], clamp)
  return (0.42 - 0.27 * duck) * fadeIn * fadeOut
}

function routeAt(f: number, d: FilmData): RouteDraw | null {
  const draw = (leg: keyof FilmData['routes'], a: number, b: number): RouteDraw =>
    ({ coords: d.routes[leg].route.coords, progress: ramp(f, a, b) })
  if (f >= 255 && f < 450) return draw('prp', 262, 335)
  if (f >= 505 && f < 600) return draw('pharmacy', 512, 570)
  if (f >= 600 && f < 725) return draw('atm', 615, 672)
  return null
}

const Tour: React.FC<{ d: FilmData }> = ({ d }) => {
  const frame = useCurrentFrame()
  const color = (cat: string) => d.campus.categories[cat]?.color ?? '#8ab4f8'
  const prpE = d.poi(PLACES.prpE)
  const medical = d.poi(PLACES.medical)
  const mess = d.poi(PLACES.mess)
  const sjt = d.poi(PLACES.sjt)
  const floor = prpE.floors?.find((x) => x.level === '3')

  const near = useMemo(() => nearestAmenities(d.campus, medical), [d, medical])
  const meals = (d.campus.mess?.items ?? []).filter((m) => m.hall === mess.name && m.date === MENU_DATE)
  const lunch = meals.find((m) => m.meal === 'Lunch')
  const dinner = meals.find((m) => m.meal === 'Dinner')

  const pins: Pin[] = useMemo(() => [
    { key: 'prp', lon: prpE.lon, lat: prpE.lat, color: color('prp'), from: 244, to: 450 },
    { key: 'medical', lon: medical.lon, lat: medical.lat, color: color('health'), from: 504, to: 725 },
    { key: 'atm', lon: d.routes.atm.to.lon, lat: d.routes.atm.to.lat, color: color('atm'), from: 612, to: 725 },
    { key: 'mess', lon: mess.lon, lat: mess.lat, color: color('mess'), from: 735, to: 850 },
    { key: 'sjt', lon: sjt.lon, lat: sjt.lat, color: color('academic'), from: 900, to: 970 },
  ], [d]) // eslint-disable-line react-hooks/exhaustive-deps

  // Hook: a light scrim under the title so it reads over the moving campus.
  const hookDim = 0.38 * (1 - ramp(frame, 118, 150))
  // End card: pull focus off the map.
  const endFocus = ramp(frame, S.end.from, S.end.from + 27)
  const logoIn = interpolate(frame, [S.end.from + 9, S.end.from + 27], [0, 1], { ...clamp, easing: EASE.enter })
  const fadeOut = interpolate(frame, [DURATION - 18, DURATION], [0, 1], { ...clamp, easing: EASE.exit })
  const route = routeAt(frame, d)

  return (
    <AbsoluteFill style={{ background: COLOR.ink }}>
      <MapStage
        data={d}
        blur={endFocus * 7}
        dim={Math.max(hookDim, endFocus * 0.62)}
        padRight={panelPad(frame, PANELS)}
        route={route}
        pins={pins}
      />

      {/* Lens vignette — the only "effect" in the film. */}
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(10,8,6,0.6) 100%)' }} />

      {/* 1 · Hook — already moving on frame one. */}
      {frame < S.hook.to && (
        <Center>
          <Line text="VIT Vellore." at={4} out={S.hook.to - 6} size={150} />
          <Line text="EVERY BUILDING · IN 3D" at={40} out={S.hook.to - 6} mono size={24} weight={600}
            tracking="0.4em" color="rgba(243,236,227,0.75)" />
        </Center>
      )}

      {/* 2 · A room in PRP */}
      <Palette at={158} out={250} query="prp 327" typeAt={172} group="Places"
        title={`${prpE.name} · ${floor?.label ?? '3rd floor'}`} sub={floor?.rooms ?? ''} dot={color('prp')} />
      <Panel at={244} out={444} kind="PRP classrooms" title={prpE.name}>
        <p className="room-callout">Room <b>327</b> is on the <b>{(floor?.label ?? '3rd floor').toLowerCase()}</b></p>
        <div className="p-sec">Classrooms by floor</div>
        {(prpE.floors ?? []).filter((x) => ['2', '3', '4'].includes(x.level)).map((x) => (
          <div key={x.level} className={`floor${x.level === '3' ? ' here' : ''}`}><b>{x.label}</b><span>{x.rooms ?? '—'}</span></div>
        ))}
      </Panel>
      <RouteBadge at={270} out={444} eta={d.routes.prp.eta} dist={d.routes.prp.dist} via={`from SJT · to ${prpE.name}`} />

      {/* 3 · A pharmacy, then 4 · the nearest ATM from it */}
      <Palette at={452} out={508} query="pharmacy" typeAt={462} perChar={2} group="Places"
        title={medical.name} sub="Health · pharmacy" dot={color('health')} />
      <Panel at={504} out={718} kind="Health" title={medical.name}>
        <dl className="kv">
          <dt>Type</dt><dd>{medical.kind ?? 'pharmacy'}</dd>
          {medical.near && <><dt>Near</dt><dd>{medical.near}</dd></>}
        </dl>
        <Reveal at={596}>
          <div className="p-sec">Nearby</div>
          <div className="near-list">
            {near.map(({ poi, metres }) => {
              const isAtm = poi.cat === 'atm'
              return (
                <div key={poi.id} className="near" style={isAtm && frame >= 612
                  ? { background: 'color-mix(in srgb, var(--accent) 16%, transparent)', borderRadius: 6, margin: '0 -8px', padding: '8px 10px' }
                  : undefined}>
                  <span className="near-dot" style={{ background: color(poi.cat) }} />
                  <span className="near-main"><b>{poi.name}</b><span>{d.campus.categories[poi.cat]?.label}</span></span>
                  <span className="near-m">{metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`}</span>
                </div>
              )
            })}
          </div>
        </Reveal>
      </Panel>
      <RouteBadge at={515} out={598} eta={d.routes.pharmacy.eta} dist={d.routes.pharmacy.dist} via={`from ${prpE.name} · to ${medical.name}`} />
      <RouteBadge at={618} out={718} eta={d.routes.atm.eta} dist={d.routes.atm.dist} via={`from ${medical.name} · to ATM`} />

      {/* 5 · Tonight's dinner */}
      <Panel at={738} out={842} kind="Mess menu" title={mess.name}>
        <div className="p-sec">{MENU_LABEL}</div>
        {lunch && <div className="meal"><b>Lunch</b><span>{lunch.menu}</span></div>}
        {dinner && <div className="meal now"><b>Dinner</b><span>{dinner.menu}</span></div>}
      </Panel>

      {/* 6 · A professor's cabin */}
      <Palette at={856} out={908} query="arivuselvan" typeAt={864} perChar={2} group="Faculty"
        title={PROF.name} sub={`${PROF.role} · ${PROF.cabin}`} dot="#8ab4f8" />
      <Panel at={904} out={966} kind={PROF.role} title={PROF.name}>
        <dl className="kv">
          <dt>Dept</dt><dd>{PROF.dept}</dd>
          <dt>Cabin</dt><dd>{PROF.cabin}</dd>
          <dt>On map</dt><dd>{PROF.at}</dd>
        </dl>
      </Panel>

      {/* 8 · End card */}
      {frame >= S.end.from && (
        <Center y={-10}>
          <Img src={staticFile('logo.svg')} style={{
            width: 76, height: 76, borderRadius: 16, opacity: logoIn,
            transform: `translateY(${(1 - logoIn) * 18}px)`, filter: logoIn < 1 ? `blur(${(1 - logoIn) * 8}px)` : undefined,
          }} />
          <Line text="Find your way." at={S.end.from + 14} size={110} />
          <Line text="vit-map.vercel.app" at={S.end.from + 30} mono size={30} weight={600} color={COLOR.signal} />
        </Center>
      )}

      <AbsoluteFill style={{ background: COLOR.ink, opacity: fadeOut }} />
    </AbsoluteFill>
  )
}

/** VIT Map — feature tour, 38.5 s, narrated, over a 100 BPM bed. */
export const Film: React.FC = () => {
  const data = useFilmData()
  return (
    <AbsoluteFill style={{ background: COLOR.ink }}>
      <Audio src={staticFile('music.wav')} volume={musicVolume} />
      {VO.map((v) => (
        <Sequence key={v.src} from={v.at} durationInFrames={v.len + 6}>
          <Audio src={staticFile(v.src)} volume={1} />
        </Sequence>
      ))}
      {data && <Tour d={data} />}
    </AbsoluteFill>
  )
}
