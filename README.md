# 52 With a View

A friendly, printable guide to the New Hampshire **52 With a View** peak list — fifty-two
mountains under 4,000 feet that are worth the climb, kept by the
[Over the Hill Hikers](https://overthehillhikers.blogspot.com/p/official-52-with-view-list.html)
since 1990.

**[Open the live site &rarr; petrofang.github.io/52wav](https://petrofang.github.io/52wav/)**

Browse as cards or as a sortable table, filter by range, county, effort or landowner, get
driving directions to the trailhead, and print a one-page checklist to fill in by hand.

No build step, no framework, no backend — three static files and a JSON document.

---

## What's here

| Path | Purpose |
| --- | --- |
| `index.html` | Page structure, Tailwind via CDN, print stylesheet |
| `app.js` | Filtering, sorting, progress links, print sheet generation |
| `config.js` | Which URL the peak data is loaded from |
| `data/peaks.json` | **The dataset — the source of truth** |
| `.github/workflows/validate-data.yml` | Checks the dataset for duplicate ids, a stale `next_id` and missing coordinates |

The dataset is a single file, and the copy in this repository is the only one:
<https://github.com/petrofang/52wav/blob/main/data/peaks.json>

To use it elsewhere, read the raw file directly:
<https://raw.githubusercontent.com/petrofang/52wav/main/data/peaks.json>

For multi-route peaks, the preferred route is the one with `preferred: true`. If a single route
still exists, the legacy `route` object remains supported for backward compatibility, but the app
prefers the explicit route list when present.

---

## The dataset

61 peaks: the current 52 plus the 9 that have been retired over the years. Retired peaks are
kept because any 52 peaks, current or retired, count toward the Over the Hill Hikers patch.

```jsonc
{
  "id": 13,                    // permanent key — see the warning below
  "name": "Mt. Chocorua",
  "elevation_ft": 3490,        // 2019 NH statewide LIDAR
  "status": "current",         // or "delisted"
  "added_year": 1990,
  "delisted_year": null,
  "town": "Albany",
  "county": "Carroll",
  "land": { "manager": "White Mountain National Forest", "owner_type": "Federal" },
  "range": "Sandwich",
  "prominence_ft": 1280,
  "isolation_mi": 5.2,
  "route": {
    "name": "Champney Falls Trail",
    "round_trip_mi": 8.3,
    "gain_ft": 2250,
    "difficulty": "Harder",    // "derived": true means measured, not published
    "preferred": true,
    "trailhead": {
      "name": "Champney Falls Trailhead",
      "lat": 43.9478,
      "lon": -71.2874,
      "address": "Champney Falls Trailhead, Albany, NH",
      "verified": true
    }
  },
  "routes": [
    {
      "name": "Champney Falls Trail",
      "round_trip_mi": 8.3,
      "gain_ft": 2250,
      "difficulty": "Harder",
      "preferred": true,
      "trailhead": {
        "name": "Champney Falls Trailhead",
        "lat": 43.9478,
        "lon": -71.2874,
        "address": "Champney Falls Trailhead, Albany, NH",
        "verified": true
      }
    },
    {
      "name": "Mt. Chocorua via Piper Trail",
      "round_trip_mi": 10.1,
      "gain_ft": 2900,
      "difficulty": "Harder",
      "trailhead": {
        "name": "Piper Trail parking",
        "lat": 43.9592,
        "lon": -71.2716,
        "address": "Piper Trail parking, Albany, NH",
        "verified": false
      }
    }
  ],
  "view_rating": 10,           // "view_rating_imputed": true means it's the list median
  "summit": { "lat": 43.954276, "lon": -71.273296 },
  "trailhead": { "name": "...", "lat": 0, "lon": 0, "address": null },
  "notes": "Iconic rocky cone. Several waterfalls. Open in all directions."
}
```

### Do not renumber the ids

`id` is a permanent surrogate key, **not** a position on the list. Ids are ordered by the year
a peak joined: 1–51 are the original 1990 list, 52 joined in 2001, 53 in 2010, 54–58 in 2020,
59–61 in 2025. New peaks take `next_id`; retired peaks keep their id forever, which is how
Iron Mountain (id 60) could be dropped in 2020 and restored in 2025 without changing identity.

Saved progress links encode these ids, so renumbering would silently corrupt every hiker's
saved list. The file is sorted by `added_year` precisely so that new peaks append at the end
and nobody is tempted to tidy it into alphabetical order.

Progress links carry a short fingerprint of the id-to-name mapping. If the ids ever do change,
old links warn the reader instead of quietly restoring the wrong mountains.

### Updating it

Edit `data/peaks.json`, commit, push. That's it — Pages redeploys the site. A workflow checks
the file for duplicate ids, an inconsistent `next_id`, and missing coordinates, and fails the
build if it finds any.

---

## Progress tracking

There is no account, no database, and no analytics. Ticks live in `localStorage`, and
**Save my progress** packs them into the URL — 61 peaks fit in about eleven characters, e.g.
`#p=11yyt-ABAAAAAAEBA`. Bookmark that link or email it to yourself and it restores on any
device. Nothing is transmitted anywhere.

Since the list takes years to finish, the printed sheet is the durable artefact; it's also
what you send to the Over the Hill Hikers to claim the patch.

---

## Where the data comes from

The guidebook for this list is **New Hampshire's 52 With A View: A Hiker's Guide** by
[Ken MacGray](https://www.kenmacgray.org/52/), now in its 3rd edition (2025). It is the
reference for the list itself. It is a print book, so its contents are not reproduced here;
where this dataset disagrees with the book, the book is right.

| Field | Source |
| --- | --- |
| The list, elevations, revision history | [Over the Hill Hikers](https://overthehillhikers.blogspot.com/p/official-52-with-view-list.html) (June 2025 revision; 2019 NH statewide LIDAR), cross-checked against [Ken MacGray's peak list](https://www.kenmacgray.org/52/peaks.shtml) |
| Distance, gain, difficulty, view rating | [NH Family Hikes](http://www.nhfamilyhikes.com/52WAV.php) — a secondary source, used because it has a page per peak, not because it is authoritative |
| Trail reports and route stats | [NH Mountain Hiking](https://www.nhmountainhiking.com/hike/lists/52view.html) — linked from every card; detailed per-peak reports with measured route figures |
| Summit and trailhead coordinates | [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Town and county | US Census Bureau geocoder |
| Landowner and manager | [NH GRANIT](https://www.granit.unh.edu/) Conservation & Public Lands |
| Official place names | [USGS GNIS](https://www.usgs.gov/tools/geographic-names-information-system-gnis), U.S. Board on Geographic Names |
| Alternate-route reference | [New England Waterfalls](https://www.newenglandwaterfalls.com/52withaview.php) |
| Derived distances and elevation profiles | OpenStreetMap trail geometry + USGS 3DEP/NED |

Links to third-party writeups are offered for convenience and are not endorsements. Peaks
whose route data is known to need checking carry a `review` block in `data/peaks.json`.

### Live sources used by the summit view

These are fetched in the browser when a peak card is expanded. Nothing is stored, and none of
them needs an API key.

| Layer | Source |
| --- | --- |
| Satellite imagery | [Esri World Imagery](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) |
| Terrain elevation | [Terrain Tiles on AWS Open Data](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium encoding) |
| Precipitation radar | [RainViewer](https://www.rainviewer.com/api.html) |
| Temperature and cloud cover | [Open-Meteo](https://open-meteo.com/) |
| 3D rendering | [MapLibre GL JS](https://maplibre.org/) (loaded on demand from unpkg) |

The elevation tiles contain occasional corrupt pixels that decode as spikes of over a
kilometre, so each tile is passed through a median filter in the browser before it reaches the
terrain mesh. The filter's threshold scales with the tile's ground resolution, which keeps
genuine relief intact at low zoom.

Two peaks added in 2025 (Bald Peak, Iron Mountain) had no published route statistics, so
distance and gain were measured by routing the trail geometry and sampling USGS elevations.
Those are flagged `"derived": true` and shown as *est.* in the interface. Their view scores
are the median of the rated current-list peaks, flagged `view_rating_imputed` and shown with
an asterisk. Nothing invented is presented as sourced.

The most active community for the list is the
[NH 52WAV Facebook group](https://www.facebook.com/groups/nh52wav/).

---

## Licence

**Code** — `index.html`, `app.js`, `config.js` and the workflow — is [MIT](LICENSE).

The summit view loads [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause) from a CDN on
demand. It is not bundled here, and the page works without it: the satellite still image
remains in place if the script or WebGL is unavailable.

**Data** (`data/peaks.json`) is a compilation of third-party sources and is *not* covered by
the MIT licence. Coordinates are derived from OpenStreetMap, so the dataset is offered under
the [Open Database Licence](https://opendatacommons.org/licenses/odbl/) — use it freely with
attribution and share derived databases alike. The 52 With a View list itself is the work of
the Over the Hill Hikers, and the route statistics and view ratings are NH Family Hikes'.
Please credit them rather than this repository.

---

## Who made this

Put together by **Giles Cooper** — [github.com/petrofang](https://github.com/petrofang).

The list belongs to the Over the Hill Hikers, the mountains belong to everyone, and most of
the numbers here were published freely by people who walked them first. This repository is
mainly a careful assembly of other people's generosity, kept accurate and easy to use.

Corrections are the most useful thing you can send — the
[issue forms](https://github.com/petrofang/52wav/issues/new/choose) take about a minute, and
reports from people who have actually stood at the trailhead have already fixed several
entries here.

---

## Android and Google Play (simple path)

This repository now includes the baseline PWA files needed for Android packaging with
**Trusted Web Activity (TWA)**, which is usually simpler than maintaining a full native wrapper.

Added in this repo:

- `manifest.webmanifest`
- `sw.js`
- `offline.html`
- `assets/icons/icon-192.png` and `assets/icons/icon-512.png`
- `docs/play-store-release-checklist.md`
- `docs/privacy-policy.md`
- `.well-known/assetlinks.json.template`

To create a Play upload package (AAB), use [PWABuilder](https://www.pwabuilder.com/) with the
live site URL:

- <https://petrofang.github.io/52wav/>

Then follow `docs/play-store-release-checklist.md` before publishing.
