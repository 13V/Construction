# Maps — mockup vs production

Google Maps is the right call for the shipped product. It is **not** something you can drop
into the prototype, and the reason matters.

## Why the prototype can't load a live Google Map

- Claude Design components and published Artifacts run under a **strict CSP that blocks all
  external requests**. `maps.googleapis.com` will not load. The current Crewline file has zero
  external URLs, which is why it renders reliably.
- You'd have to **embed an API key** in a file you share by link.
- Worst of all: without billing enabled, Google renders a **darkened map plastered with "For
  development purposes only"** watermarks. In front of a client that looks far worse than a
  clean drawn map.

## What to do instead — real geography, no runtime calls

Use the **Static Maps API** to generate a PNG of the actual area, then embed it as a base64
`data:` URI and keep the existing SVG overlay — geofence circles, worker pins, breadcrumb
trail — drawn on top of it.

```
https://maps.googleapis.com/maps/api/staticmap
  ?center=<site address>
  &zoom=15
  &size=1280x800
  &scale=2
  &maptype=roadmap
  &style=feature:poi|visibility:off
  &style=feature:all|element:labels|saturation:-80
  &key=YOUR_KEY
```

Download it, base64 it, inline it. One call, effectively free, no key in the shipped file, no
CSP problem — and the demo shows **his actual suburb with real street names**, which lands
harder than an abstraction. Desaturate the basemap so it doesn't fight the UI palette.

Keep the markers as SVG overlay rather than Static Maps `markers=` parameters — you need the
avatar-with-status-ring treatment, which the static API can't draw.

*Terms note: overlaying your own markers on Static Maps imagery is ordinary permitted use.
Don't crop out the Google attribution.*

## Production build

**Web dashboard** — Maps JavaScript API with **Advanced Markers**
(`google.maps.marker.AdvancedMarkerElement`). The old `google.maps.Marker` has been deprecated
since Feb 2024 (v3.56). Advanced Markers accept **custom HTML and CSS**, which is exactly what
this design needs: circular avatars with colored status rings. Requires a `mapId`.

- **Cloud-based map styling** on that `mapId` — desaturate the basemap to match the palette.
- `google.maps.Circle` for geofences, `Polyline` for breadcrumb trails.
- `@googlemaps/markerclusterer` when a site has a lot of crew on it.
- Geocode each job site address **once at creation and cache the coordinates** — don't geocode
  on render.

**Mobile** — Maps SDK for Android / iOS. On iOS, MapKit is free and worth considering for the
worker app, where the map is decorative; save Google for the dashboard where it isn't.

## Cost — read this before pricing the product

**Google retired the universal $200/month credit in March 2025.** It's now per-SKU monthly free
tiers: **Essentials 10,000** billable events, Pro 5,000, Enterprise 1,000. Past that, roughly
**$2–$7 per 1,000**.

Subscription plans: Starter $100/mo (50k calls), Essentials $275/mo (100k), Pro $1,200/mo (250k).

**Dynamic Maps loads are the exposure.** Every dashboard open or reload is one map load. An
office manager with the live map up all day, plus the owner checking his phone, burns through
10,000 loads/month across surprisingly few customers — then it's $7/1,000.

At A$450–600/mo per customer, uncontrolled map spend is a real margin line. Mitigations:

- Initialize **one** map instance and keep it alive; never re-init on navigation.
- Poll worker positions from your own API and **move existing markers** — that costs nothing.
  Only the initial map load bills.
- Use **Static Maps** for thumbnails in cards and list views; they're far cheaper than dynamic.
- Cache geocodes permanently.

**Alternatives:** Mapbox and MapLibre are materially cheaper at scale with better styling
control. Google still wins on Australian address geocoding and Places autocomplete, which
matters when the owner is typing in job site addresses. A common split is Google for
geocoding/autocomplete, a cheaper provider for tile rendering.
