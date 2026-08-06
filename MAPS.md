# Maps

The app renders its live map with **MapLibre GL** against **OpenFreeMap** tiles.
No API key, no billing account, no request cap, and commercial use is explicitly
allowed.

## Why not Google Maps

The app originally used Google Maps. It worked, but it came with a meter attached:

- Google **retired the universal $200/month credit in March 2025**. The free tier is now
  10,000 Dynamic Maps loads per month, then roughly **$7 per 1,000**.
- Loads are billed **per map mount**, not per user. An office manager with the dashboard
  open all day plus an owner checking his phone burns through 10,000 across surprisingly
  few customers.
- It needs a billing account, a key to restrict and rotate, and a Cloud Console Map ID
  before Advanced Markers will even render. Without billing it serves a darkened map
  stamped "For development purposes only".

At A$450–600/mo per customer that was a real margin line and an onboarding obstacle. It
is gone.

## What replaced it

| | |
|---|---|
| Renderer | MapLibre GL JS — open source, no key |
| Tiles | OpenFreeMap `positron` (light, desaturated — closest to the app palette) |
| Style URL | `https://tiles.openfreemap.org/styles/positron` |
| Geocoding | Photon (OpenStreetMap) — keyless, biased toward existing job sites |
| Cost | $0 |

Override the style with `VITE_MAP_STYLE_URL` if you want a different look or your own
tile server.

## Implementation notes

- **Geofences are polygons, not circle markers.** A MapLibre `circle` layer sizes in
  pixels, which would make a 150 m fence shrink as you zoom out. `circlePolygon()` in
  `LiveMap.tsx` generates a 64-point ring in real metres so the fence stays true to the
  ground.
- **The worker URL is pinned.** MapLibre derives it from `import.meta.url`, which after
  bundling points at a file that was never emitted — the map then fails to render tiles
  with only a console 404 to show for it. `LiveMap.tsx` imports the worker through
  Vite's `?worker&url` and calls `setWorkerUrl()`, so the asset is emitted and hashed
  like any other.
- **Markers are mutated, not rebuilt.** Position updates move existing `Marker`
  instances and swap their child nodes; nothing is torn down between renders.
- The map instance is created once for the life of the dashboard. That mattered for
  billing under Google and still matters for performance.

## Caveats worth knowing

- **No satellite imagery.** OpenFreeMap is vector street data only. For construction that
  is a genuine loss — aerial views help when checking site boundaries. Esri's World
  Imagery tiles can be added as an optional raster layer with attribution if it matters.
- **No SLA.** OpenFreeMap is donation-funded. It is explicitly built to be self-hosted —
  full planet extracts are published weekly — so the escape hatch is to run your own and
  change one environment variable. Worth doing before this is business-critical.
- **Geocoding quality.** Photon is good but Google is better at Australian addresses.
  Clicking the map to place a pin is always available and is the more precise method
  anyway, since a geofence should sit on the work area, not the postal address.
