# Crewline

The office website and the worker app. React + Vite + TypeScript, Supabase for data and
auth, MapLibre for maps, Vercel serverless functions for location ingest.

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
| `/` | Office (owners) | The website: sign in and company sign-up, jobs (new, edit, fence, crew, scope, drawings, waterproofing, safety), schedule, team, company |
| `/worker` | Field | The phone app in a browser; the iOS app is the same code (`VITE_SURFACE=worker`) |

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

## Maps

Both apps draw maps with MapLibre and OpenFreeMap tiles (`src/data/mapconfig.ts`): no key
and no per-load billing.

## Layout

```
api/         ping.ts (location ingest + engine), bootstrap.ts (first run + invites), ...
src/
  main.tsx   which surface: /privacy, /support, the phone app, or the website
  auth/      useSession.ts (shared by both surfaces)
  geofence/  dwell.ts (engine + tests), geo.ts (haversine, paths)
  data/      supabase.ts (client + row types), api.ts, storage.ts, mapconfig.ts, ...
  web/       the website (src/web/entry.tsx, reached only as '@web/entry')
  worker/    the phone app (WorkerApp.tsx, simple/ for its screens)
  ui/        Crash.tsx, kit.tsx (shared by both)
```
