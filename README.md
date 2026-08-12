# OS-52: Open-Source New Hampshire 52 With a View Data API

An open-source, programmatic guide to the New Hampshire **52 With a View** peak list — fifty-two
mountains under 4,000 feet that are worth the climb, curated by the
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
| `.github/workflows/sync-gist.yml` | Validates the dataset and mirrors it to the public Gist |

The dataset is also published as a Gist so other people can use it:
<https://gist.github.com/petrofang/46213d7d93292f14ffd54d955b7f3f67>

That Gist is **generated**. Edit `data/peaks.json` here; anything typed directly into the
Gist gets overwritten on the next data change.

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
    "difficulty": "Harder"     // "derived": true means measured, not published
  },
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

Edit `data/peaks.json`, commit, push. That's it — Pages redeploys the site and the workflow
mirrors the file to the Gist. Before publishing, the workflow checks for duplicate ids, an
inconsistent `next_id`, and missing coordinates, and refuses to publish if it finds any.

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

| Field | Source |
| --- | --- |
| Peak list, elevations, revision history | [Over the Hill Hikers](https://overthehillhikers.blogspot.com/p/official-52-with-view-list.html) (June 2025 revision; 2019 NH statewide LIDAR) |
| Distance, gain, difficulty, view rating | [NH Family Hikes](http://www.nhfamilyhikes.com/52WAV.php) |
| Summit and trailhead coordinates | [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors |
| Town and county | US Census Bureau geocoder |
| Landowner and manager | [NH GRANIT](https://www.granit.unh.edu/) Conservation & Public Lands |
| Official place names | [USGS GNIS](https://www.usgs.gov/tools/geographic-names-information-system-gnis), U.S. Board on Geographic Names |
| Standard-route cross-check | [New England Waterfalls](https://www.newenglandwaterfalls.com/52withaview.php) |
| Derived distances and elevation profiles | OpenStreetMap trail geometry + USGS 3DEP/NED |

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
