# VIT Map — demo film

A 38.5-second narrated feature tour, rendered with [Remotion](https://remotion.dev)
from the app's **real** map engine, style, 3D models, router and data — not a
screen recording. Every frame is held until MapLibre has finished drawing it,
so camera moves are exact. The search box and panels are the app's own markup
and stylesheet.

Output: `out/vit-map-tour.mp4` — 1920×1080, 30 fps, H.264 + AAC stereo.

## What it shows

| Time | Feature | On screen |
|---|---|---|
| 0–5 s | Hook | The 3D campus, already moving — "VIT Vellore. Every building, in 3D." |
| 5–15 s | A PRP room | Search `prp 327` → Block E, 3rd floor highlighted → route from SJT (6 min · 500 m) |
| 15–19.5 s | A pharmacy | Search `pharmacy` → Saravana Medical → route (7 min · 580 m) |
| 19.5–24 s | Nearest ATM | The Nearby list → ATM → route (3 min · 210 m) |
| 24–28 s | Tonight's dinner | MH Veg Mess — the real MessIT lunch and dinner for 3 Oct 2026 |
| 28–32 s | A professor's cabin | Search `arivuselvan` → card → pinned on SJT |
| 32–34.5 s | The railway | Tracking shot alongside a moving train |
| 34.5–38.5 s | End card | "Find your way." · vit-map.vercel.app |

Routes, walking times, floors, menus and the Nearby list are real app data.
**The professor card is mock data** (Arivuselvan K · HOD (IT) · Cabin
SJT-210-A20): the faculty feed has no cabin numbers yet. It lives only in
`src/Film.tsx` (`PROF`) and never reaches the app.

## Sound

- **Voice** — Microsoft Edge neural text-to-speech, voice
  **`en-US-AndrewMultilingualNeural`** ("warm, confident") at +4% rate, via the
  open-source [`edge-tts`](https://github.com/rany2/edge-tts) Python package.
  Free, no API key. The nine clips are committed in `public/vo/` so a render
  never depends on the service. Change voice in one command:
  `node make-voice.mjs en-IN-PrabhatNeural` (list: `python -m edge_tts --list-voices`).
- **Music** — synthesised in code by `make-music.mjs` (no samples, no
  licence): warm pad chords, a soft heartbeat kick and quiet hats at 100 BPM.
  It ducks under every voice line and swells back between them.

## Render

```bash
cd ..                    # the app
npm run build:data
cd video
npm install
node prepare.mjs         # copies app data, routing graph and map glyphs into public/
node make-music.mjs 38.5 # → public/music.wav
node render-stills.mjs   # one still per scene → out/stills/ (check before rendering)
npm run render           # → out/vit-map-tour.mp4
npm run studio           # scrub and tweak in the browser
```

Render **sequentially** (`--concurrency=1`): parallel tabs each hold the whole
3D campus on the GPU and can lose their WebGL context, which bakes black
frames into the film. `MapStage` refuses to capture a frame with a lost
context, so if that happens it shows up in the render log instead of the film.

Prerequisites: Node 22+, Python 3 with `pip install edge-tts` (only to re-voice).

## Rules (src/brand.ts)

- **Colour:** warm black `#14110E`, bone `#F3ECE3`, signal blue `#3D7AED`.
  PRP's sign colours appear only inside the product.
- **Type:** Overpass Bold for lines, Overpass Mono for numbers and kickers.
- **Motion:** eased only. One continuous camera; dissolves and focus pulls,
  never hard cuts.
- **Timing:** each scene is as long as its voice line needs.

## Changing it

| Change | File |
|---|---|
| Words the narrator says | `make-voice.mjs` (re-voice) **and** `VO` in `src/brand.ts` |
| Scene timing | `SCENES` and `VO` in `src/brand.ts` |
| Camera moves | keyframes in `src/camera.ts` |
| What appears on screen, and when | `src/Film.tsx` |
| Search box, panels, route badge | `src/UI.tsx` (uses the app's `styles.css`) |
| Places and routes in the tour | `PLACES` in `src/data.ts`; check ETAs with `node plan-routes.mjs` |
