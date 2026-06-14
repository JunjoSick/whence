# Whence

A geography-history guessing game. You're shown a **birth** (★) and **death** (✦)
location pinned on a borderless, label-free world map — each with its year — and you
have to name the historical figure who lived that life.

- **Type-to-guess** with fuzzy autocomplete over ~950 genuinely notable people.
- Each wrong guess tells you how far off you were: **direction & distance** to the real
  birthplace, the **year gap**, and any **shared profession** — Wordle-meets-Worldle deduction.
- **Daily** challenge (five lives, same for everyone, shareable result) + **Endless** practice.
- 100% static. No backend, no API keys, no build step. Deploys to GitHub Pages as-is.

## Run locally

ES modules need to be served over HTTP (not opened as a `file://`), so start any static
server from the project root:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Project layout

```
index.html          # markup + screen containers
styles.css          # the whole visual system
src/
  main.js           # bootstrap, home screen, mode launch
  game.js           # round lifecycle, scoring, both modes, reveal + results UI
  map.js            # borderless Leaflet map (no tiles), glowing pins, graticule
  search.js         # fuzzy type-to-guess autocomplete
  util.js           # year/BCE formatting, haversine, bearing, seeded RNG
  storage.js        # localStorage stats, streaks, daily history
  share.js          # Wordle-style shareable result
data/
  figures.json      # ~950 people (generated — see below)
  land.geojson      # Natural Earth 50m land, merged + simplified (borderless)
vendor/             # Leaflet 1.9.4 (vendored, no CDN)
scripts/
  build_dataset.py  # regenerates data/figures.json from Wikidata
```

## Regenerating the dataset

`data/figures.json` is built from Wikidata with the standard library only (no pip):

```bash
python scripts/build_dataset.py --verify        # sanity-check the occupation list
python scripts/build_dataset.py --top 40 --floor 28
```

It anchors each query on an **occupation** (a selective property) and takes the top-N
people in each domain ranked by `sitelinks` (number of Wikipedia language editions — a
strong fame proxy), then requires a geocoded birthplace + birth date. Tune coverage with:

- `--top N` — people per occupation bucket (more = larger, less famous tail)
- `--floor N` — minimum sitelinks to keep (higher = stricter "no filler")

Edit the `OCCUPATIONS` dict at the top of the script to add/remove domains.

## Deploying to GitHub Pages

1. Create a repo and push these files to the default branch.
2. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   pick your branch and `/ (root)`.
3. Your site goes live at `https://<user>.github.io/<repo>/`.

> **Before deploying:** set the real URL in [`src/share.js`](src/share.js) (`SITE` constant)
> so shared results link back to your site.

## Notes / ideas for later

- Occupation tags come from the curated domain buckets, so an extremely famous person can
  occasionally miss a domain they're known for (e.g. only one of several occupations). It's
  flavor on the reveal card, not part of the puzzle.
- Possible additions: difficulty tiers (filter by `fame`), a "hard mode" with birth-only
  pins, hint-to-reveal occupation, a world-region leaderboard, sound/haptics.

Data © Wikidata contributors (CC0). Basemap derived from Natural Earth (public domain).
