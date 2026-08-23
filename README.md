# VIT Vellore campus map

A map of **VIT Vellore** with the things students actually look for — lecture
halls (SJT, TT, CDMR, SMV, GDN…), hostel blocks, mess menus, ATMs, parking,
gates — and one fast search over all of it.

Hit `⌘K` / `Ctrl+K` (or `/`) and type `sjt`, `mess dinner`, `mh k`, `gate 3`,
a professor's surname.

This is a VIT Vellore data-and-branding port, not a pixel-for-pixel fork of the extras
(the IITK pixel canvas is deliberately out of scope).

## The one rule

**Real data or no data.** Every fact in this repo traces to a public source.
Where no source exists the feature is simply absent, and the palette says so
instead of guessing. There is no placeholder timetable, no invented professor,
no guessed opening hours, and no coordinates traced off the official campus-map
scan. See [TODO.md](TODO.md) for what is missing and what each gap needs.

## What's populated vs missing

| What | Where from | Status |
|---|---|---|
| Campus boundary, buildings, paths, water, greens | [OpenStreetMap relation 15931944](https://www.openstreetmap.org/relation/15931944) (ODbL) | ~140 named places, 214 building footprints |
| Walking & cycling network | OSM highways; A\* over the largest connected component | ~890 nodes / ~1000 edges |
| Mess menus | [MessIT](https://messit.vinnovateit.com) public `/menu-data/*.json` (VinnovateIT) | 744 menus, 6 mess types (MH/LH × Special/Veg/Non-Veg) |
| Faculty directory | [vit.ac.in/faculty](https://vit.ac.in/faculty) school listing pages | 1145 people from 43 department pages |
| Named hostel blocks (MH A–T, LH A–C), numbered gates, shuttle stops S1–S8 | OSM name tags, or a surveyed curated row | **Only if OSM/survey has them.** The official campus map is a *layout reference*, not a coordinate source. |
| Hostel-path overlays ("way toward girls'/boys' hostel") | Surveyed GeoJSON in `data/curated/overlays.json` | Empty until someone surveys the paths (or OSM gains them) |
| Opening hours | OSM `opening_hours`, parsed by a deliberately partial reader that returns `null` rather than guess | Only where OSM has a parseable tag |

VIT's campus is much less mapped than IIT Kanpur's. The honest move is to
**contribute missing buildings to OpenStreetMap** rather than invent them here.
Naming conventions (SJT, TT, MH K, Gate 11A) follow student usage and the
Office of Students' Welfare campus map; coordinates do not.

[VIT NAV](https://play.google.com/store/apps/details?id=com.dscvitvellore.vitnav) is
prior art for those naming conventions. This project does not scrape it.

## Running it

```bash
npm install
npm run fetch              # OpenStreetMap via Overpass — cached, use --force to refetch
node scripts/fetch-web.mjs # faculty + MessIT menus
npm run dev
```

`data/raw` and `data/live` are committed, so `npm run dev` works straight after
`npm install` without touching the network (once those files exist).

```bash
npm test           # typecheck + rebuild data + smoke test
npm run verify     # load it in a real headless Chrome and assert it works
```

## How it works

**No tile server, no external request.** The basemap is drawn from our own
GeoJSON extract — buildings, paths, greens, water, railway — so there is no API
key and no tile budget. Label glyphs are served from `public/font` (Noto Sans).

**Routing.** A\* over the OSM path network. Edge costs are baked per profile at
build time in *seconds*, so the ETA is the final g-score. Steps and indoor
corridors are passable by bike at pushing speed. Only the largest connected
component ships.

**Search.** Everything is indexed into one flat document list at load — places,
people, mess menus, layers, commands. Ranking is exact-key, then prefix, then a
subsequence match with contiguity and word-boundary bonuses, then
all-words-present, then substring. `mess dinner` is intercepted before generic
ranking.

## Layout

```
data/raw/        OpenStreetMap dumps (committed)
data/live/       faculty + mess snapshots (committed, refreshed weekly by CI)
data/curated/    hand-surveyed places — empty by default
scripts/
  fetch-osm.mjs    Overpass, retries across mirrors
  fetch-web.mjs    faculty directory + MessIT
  build-data.mjs   normalise -> public/data/{campus,geo,graph}.json
  smoke.mjs        search, routing and map-style assertions
src/
  map/style.ts     MapLibre style built from our GeoJSON
  route/router.ts  A* with a CSR adjacency and a binary heap
  search/engine.ts index, scoring, intents
  ui/              palette + detail panel
```

## Contributing

Most of the physical world — hostel names on footprints, gates, ATMs, shuttle
stops, opening hours — belongs in **OpenStreetMap** rather than here. Map it
once there and this picks it up on the next `npm run fetch`. Start at
[OpenStreetMap — VIT Vellore](https://www.openstreetmap.org/relation/15931944).

For anything OSM will not take, add it to `data/curated/places.json` with
surveyed `lat`/`lon` or an `anchor` naming a real OSM feature. Coordinates must
come from an actual survey; nothing invented, and nothing traced off the
official map image.

## Deploying

Cloudflare Pages, building from the Git integration:

- Build command `npm run build`
- Output directory `dist`
- Node version from `.nvmrc` (22)

`.github/workflows/ci.yml` typechecks, smoke-tests and builds every push and PR.
`.github/workflows/refresh-data.yml` re-pulls all sources weekly and opens a PR
if anything changed.

## Licence

Code [MIT](LICENSE). Map data © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright). Faculty and mess snapshots
belong to their publishers (VIT / VinnovateIT MessIT) and are mirrored here for
a student tool, not relicensed. Label glyphs derive from Noto Sans (OFL 1.1).

Modeled on [iitk.nis.pet](https://github.com/ni5arga/iitk) (MIT).
