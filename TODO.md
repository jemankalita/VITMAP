# TODO — datasets with no public source yet

Ground rule for this repo: **ship real data or ship nothing.** Every dataset below
was deliberately left out rather than filled with plausible-looking invented rows.
Each one has a place to plug into once a real source exists.

The Office of Students' Welfare campus map is a **layout reference** for what
exists (MH A–T, LH A–C, Gate 1/2A/3/3A/5/11/11A, shuttle stops S1–S8, SJT Ground,
etc.). It is not a coordinate source. Tracing pixel positions off that scan would
violate the rule.

## Blocked on OSM coverage / a survey

| Dataset | Wanted for | Why it's not here |
|---|---|---|
| **MH A–T as official names** | `mh k` | OSM names the men's blocks **A Block … T Block** (plus B/D Annexe). Search aliases `MH K` → `K Block` are naming-convention only; the pin is the OSM feature. Rename the OSM objects to `MH K` upstream if that's the on-the-ground name. |
| **LH A, B, C** | `lh a` | OSM has ladies' hostels under personal names (Ida Scudder, Jhansi Rani, Mother Teresa, Suu Kyi), not `LH A/B/C`. Do not guess which letter is which. |
| **Shuttle stops S1–S8** | `s3`, `shuttle` | Not in OSM as named stops at last fetch. |
| **Shuttle stops S1–S8** | `s3`, `shuttle` | Not in OSM as named stops at last fetch. Need OSM `highway=bus_stop` + `name=S1` (etc.) or a survey. |
| **Hostel path overlays** | Colour-coded "way toward girls' hostel" / "way toward boys' hostel" | Distinct from A\* output. Empty `data/curated/overlays.json` until someone surveys those polylines (or OSM gains them as named routes). |
| **SJT Ground / induction venue, VIT Fields, named food courts** | Layer + search | Only if OSM names them or a survey lands them in `places.json`. |

Contribute these to [OpenStreetMap — VIT Vellore](https://www.openstreetmap.org/relation/15931944)
rather than inventing coordinates here.

## Blocked on a source

| Dataset | Wanted for | Why it's not here |
|---|---|---|
| **Faculty offices / emails / titles** | Place a professor on the map | The listing pages publish names. They do not publish office rooms or emails in scrapeable HTML, so people are searchable but not pinned. Need profile pages or a directory JSON that includes office buildings. |
| **Per-block mess halls** | `mh k mess` | MessIT publishes **mess-type** buckets (MH/LH × Special/Veg/Non-Veg), not per-block menus. That is what we snapshot. A per-block mapping would need MessIT or the hostel office to publish one. |
| **Courses & timetable** | `CSE1001`, `SJT 101 now` | VTOP is login-walled and has no public API. |
| **Clubs & chapters** | `club ctf` | No public machine-readable roster found. |
| **Notices / deadlines** | `notices` | No public feed found on vit.ac.in. |
| **Shuttle timings** | `shuttle time` | Circulated as notices/PDFs; nothing machine-readable found. A hand-typed table is fine **as long as it is transcribed from a real circular** and cites it. |
| **Lost & found** | `lost airpods` | Inherently a live board, not a checked-in file. |

## How to add one

1. Add a fetcher to `scripts/fetch-web.mjs` under `TASKS`, writing to `data/live/<name>.json`.
   Include `_source` (the URL) and `_fetched` (ISO date) in the output.
2. Merge it into the payload in `scripts/build-data.mjs`.
3. Register it as a search domain in `src/search/engine.ts`.

For anything hand-typed, put it in `data/curated/` with surveyed coordinates or an
`anchor` naming a real OSM feature, and cite where the numbers came from.

## Better than any of the above

Most of the physical stuff — hostel names, gates, shuttle stops, ATMs, opening
hours — belongs in **OpenStreetMap** itself. Map it once there and this app
picks it up on the next `npm run fetch`, along with every other OSM consumer.
`data/curated/places.json` is only for things OSM will not accept.
