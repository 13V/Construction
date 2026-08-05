# Crewline — owner dashboard (MVP slice)

The live map and the geofence engine behind it. React + Vite + TypeScript, Google Maps
via `@vis.gl/react-google-maps`, driven by a simulated crew so it runs with no backend.

## Run it

```bash
npm install
cp .env.example .env.local     # add your Google Maps key
npm run dev
```

Without a key the app shows setup instructions instead of a broken map — an unbilled key
renders Google's "For development purposes only" watermark, which looks worse than nothing
in front of a client.

```bash
npm test        # geofence engine
npm run build   # typecheck + production build
```

## What it does

Opens on a simulated work day at 6:20 AM running at 90× (switch to 30× or 240× bottom-left).
The day is scripted to exercise every case the engine has to handle:

| Worker | What happens |
|---|---|
| Miguel, Danny, Tre | Arrive at Maple Ridge, dwell, clock in 6:43 / 6:51 / 6:44 |
| Rosa | Arrives Harbor View 3B, clocks in 7:04 |
| Sam | On site at Northgate from 6:22, leaves 9:12 → clocked out 9:13, **drives straight through City Line's geofence at 9:31 → rejected**, arrives Maple Ridge 9:51 |
| Alicia | Parks 120 m outside Maple Ridge all day → flagged *Needs review*, never clocked in |
| Bobby | No shift, reports nothing |

Click a worker to draw their GPS breadcrumb trail.

## The geofence engine

`src/geofence/dwell.ts` is a pure, time-injected state machine:

```
offsite → arriving → onsite → departing → offsite
```

- **Entering doesn't clock you in.** You must stay inside for `DWELL_IN_MS` (2 min). Leaving
  early emits `drive_by_rejected` instead. This is the fix for the most common complaint about
  every competitor — geofences that clock people in as they drive past.
- **Leaving doesn't clock you out.** You must be gone for `DWELL_OUT_MS` (3 min), so walking to
  the truck for a tool doesn't end the shift.
- **Clock-outs are backdated** to the last ping confirmed inside the fence, not to when the
  engine noticed — nobody gets paid for the drive home.
- Exits use a 25 m buffer past the radius so GPS jitter at the boundary can't make the clock flap.

Because every transition is driven by the timestamp on the ping rather than the wall clock, the
same code runs against the accelerated simulation and against live phones.

## Swapping in real data

`src/data/feed.ts` defines the only interface the dashboard knows about. `simulatedFeed.ts`
drives the demo; `supabaseFeed.ts` is the production implementation (table DDL is in its
docstring). To switch, change one line in `App.tsx`:

```ts
const feed = useMemo(() => createSupabaseFeed(), [])
```

## Maps cost — read before scaling

Google retired the universal $200/month credit in March 2025. The free tier is now **10,000
Dynamic Maps loads per month**, then $7 per 1,000. A map load is billed **per mount**, not per
user, so:

- `<Map>` is mounted **once** and never unmounted. Navigating to another section renders a panel
  *over* it rather than tearing it down.
- Worker positions move existing markers. Marker updates cost nothing.

Full breakdown in [`MAPS.md`](../../MAPS.md) at the repo root.

## Layout

```
src/
  geofence/    dwell.ts (engine + tests), geo.ts (haversine, paths)
  data/        seed.ts, feed.ts (interface), simulatedFeed.ts, supabaseFeed.ts
  state/       useCrew.ts — applies pings, tracks hours, raises exceptions
  map/         LiveMap.tsx, markers.tsx, mapStyle.json (paste into Cloud Console)
  ui/          Chrome.tsx, Overlays.tsx, SetupNotice.tsx
```

`mapStyle.json` has to be applied to a Map ID in the Cloud Console rather than passed in code —
once a `mapId` is set (required by Advanced Markers), the JS `styles` option is ignored.
