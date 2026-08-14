# Route validation checklist

This is the working standard for alternate routes and driving directions.

## 1. Route model

Each peak can expose one or more route objects.

```json
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
}
```

Rules:
- use `preferred: true` on the route that should appear as the main route in the UI
- keep `route` for backward compatibility when a single route is all that exists
- keep `routes` as the canonical list when multiple options are known
- do not assume the first item in the array is preferred unless it is explicitly marked

## 2. Validation pass

For every route, verify all of the following before trusting the drive link:

### Trailhead and parking
- the start point exists in Google Maps
- the parking lot is public or otherwise legal to use
- the road is drivable in a typical passenger vehicle
- the directions lead to a practical hiker access point, not a random pull-off or scenic overlook

### Location accuracy
- coordinates match the actual trailhead or parking area
- the trailhead is consistent with the route name and access description
- route start and parking are not mismatched across sources

### Data cross-checking
- compare to published route descriptions and writeups
- compare with land manager or trail maps when available
- check the route against GRANIT and USGS context where the access point or ownership is uncertain

## 3. Verification states

Use one of these statuses:

- `verified`: cross-checked and accepted
- `needs-review`: plausible but not fully validated
- `unverified`: not enough evidence to trust the access point

If a route is `needs-review` or `unverified`, do not present the drive link as the main navigation option unless the UI clearly labels it as provisional.

## 4. Route selection rules for the app

When building cards:
- choose `routes.find(r => r.preferred)` when available
- otherwise fall back to `route`
- otherwise use the first route in the array

When building the details panel:
- show all routes in the route list
- clearly label the preferred route in the UI
- keep the non-preferred options as alternate route variants

## 5. Practical audit workflow

1. Gather route variants from source material.
2. Write them into the peak's `routes` array.
3. Mark one route as `preferred`.
4. Verify the trailhead and parking for each route.
5. Set `verified` or `needs-review` on each route.
6. Only then publish the dataset change.

This keeps the route list useful without pretending every alternate path is equally validated.
