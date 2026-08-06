# Crewline

Owner dashboard and worker app. React + Vite + TypeScript, Supabase for data and auth,
Google Maps for the map, Vercel serverless functions for location ingest.

**There is no demo or simulated mode.** The app runs on real crew, real job sites and real
GPS, or it tells you what's missing.

## Run it

```bash
npm install
cp .env.example .env.local     # Supabase + Google Maps credentials
npm run dev
```

Setup steps — Supabase schema, Maps keys, first company — are in
[DEPLOY.md](../../DEPLOY.md).

```bash
npm test        # geofence engine
npm run build   # typechecks src and api, then builds
```

## Two surfaces

| Route | Who | What |
|---|---|---|
| `/` | Office | Live map, job sites and geofences, crew, timesheets |
| `/worker` | Field | Start tracking, live clock-in state |

Both gate on Supabase auth. A login with no `workers` row can see nothing — every RLS
policy keys off it — so the app says so rather than rendering an empty dashboard.

## The geofence engine

`src/geofence/dwell.ts` is a pure, time-injected state machine:

```
offsite → arriving → onsite → departing → offsite
```

- **Entering doesn't clock you in.** You must stay inside for `DWELL_IN_MS` (2 min).
  Leaving early emits `drive_by_rejected` instead. This is the fix for the most common
  complaint about every competitor — geofences that clock people in as they drive past.
- **Leaving doesn't clock you out.** You must be gone for `DWELL_OUT_MS` (3 min), so
  walking to the truck for a tool doesn't end the shift.
- **Clock-outs are backdated** to the last ping confirmed inside the fence, not to when the
  engine noticed — nobody gets paid for the drive home.
- Exits carry a 25 m buffer past the radius so GPS jitter at the boundary can't make the
  clock flap.

It runs **server-side** in `api/ping.ts` and that is the system of record. A browser clock
is something a worker could tamper with, and timesheets have to be produced whether or not
anyone has the dashboard open. The phone renders the phase the server returns rather than
running a second, drifting copy.

## Maps cost

Google retired the universal $200/month credit in March 2025. The free tier is **10,000
Dynamic Maps loads per month**, then $7 per 1,000, billed **per mount** — not per user.

- `<Map>` is mounted once and never unmounted. Other sections render over or beside it.
- Placing a job site reuses that same map rather than opening a second one.
- Worker positions move existing markers, which costs nothing.

Full breakdown in [MAPS.md](../../MAPS.md).

## Layout

```
api/         ping.ts (location ingest + engine), bootstrap.ts (first run + invites)
src/
  auth/      useSession.ts, AuthScreen.tsx
  geofence/  dwell.ts (engine + tests), geo.ts (haversine, paths)
  data/      supabase.ts (client + row types), useLive.ts (realtime), seed.ts (cost codes)
  map/       LiveMap.tsx, markers.tsx, mapStyle.json (paste into Cloud Console)
  ui/        Chrome, Overlays, Timesheets, JobSites, Crew, SetupNotice
  worker/    WorkerApp.tsx
```

`mapStyle.json` has to be applied to a Map ID in the Cloud Console rather than passed in
code — once a `mapId` is set (required by Advanced Markers), the JS `styles` option is
ignored.
