# Deploying to Vercel

The dashboard and the worker app ship as one Vercel project. `apps/dashboard/api/*`
becomes serverless functions automatically.

## 1. Supabase

Create a project, then in the SQL editor run, in order:

1. `supabase/schema.sql` — tables, RLS policies, realtime publication
2. `supabase/seed.sql` — the demo company, four job sites, seven crew

Then link your login to a worker row so RLS can resolve your company. Sign up through
the app (or Supabase Auth → Users), grab the user's UUID, and run:

```sql
update workers
   set auth_user_id = '<uuid from auth.users>', is_office = true
 where id = '00000000-0000-4000-8000-000000000101';
```

Grab three values from Settings → API: the project URL, the `anon` key, and the
`service_role` key.

> The `service_role` key bypasses RLS. It must only ever be set as a server variable —
> never with a `VITE_` prefix, or Vite will bundle it into the browser.

## 2. Google Maps

In Google Cloud Console:

1. Enable **Maps JavaScript API**.
2. **Turn on billing.** Without it the map renders darkened and watermarked
   "For development purposes only".
3. Create an API key and restrict it to your Vercel domain (`https://your-app.vercel.app/*`)
   plus `http://localhost:5173/*` for development.
4. Create a **Map ID** (Advanced Markers require one) and apply
   `apps/dashboard/src/map/mapStyle.json` to it. Once a Map ID is set the JS `styles`
   option is ignored, so the basemap styling has to live in the console.

Read [MAPS.md](MAPS.md) before you scale — the free tier is 10,000 map loads a month
and Google retired the universal $200 credit in March 2025.

## 3. Vercel

Import the repo, then set **Root Directory** to `apps/dashboard`. The Vite preset and
`vercel.json` handle the rest.

Environment variables:

| Name | Scope | Value |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | build | Maps key |
| `VITE_GOOGLE_MAPS_MAP_ID` | build | Map ID (or `DEMO_MAP_ID`) |
| `VITE_SUPABASE_URL` | build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | build | `anon` key |
| `SUPABASE_URL` | server | same project URL |
| `SUPABASE_ANON_KEY` | server | `anon` key — used to verify caller tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **secret**, server only |

Deploy. The dashboard is at `/`, the worker app at `/worker`.

## 4. Check it

- `/` — live map, geofence circles, crew markers. Timesheets fills as the day runs.
- `/worker` — grant location permission. Tap a site under "Pin my location to a site"
  and watch the dwell countdown, then the clock-in.
- `POST /api/ping` with a bearer token should return `{ ok: true, phase: "..." }`.

## How the pieces fit

```
worker phone  ──POST /api/ping──▶  serverless function
                                     │  runs src/geofence/dwell.ts
                                     ├─▶ positions      (raw GPS)
                                     ├─▶ shifts         (the timesheet)
                                     ├─▶ geofence_events(the audit trail)
                                     └─▶ dwell_state    (machine state)
                                              │
office dashboard  ◀──Supabase realtime────────┘
```

The geofence engine runs **server-side** as the system of record. Timesheets have to be
produced whether or not anyone has the dashboard open, and a client-side clock is
something a worker could tamper with. The same pure module also runs in the browser for
instant feedback on both surfaces.

## Still to do before this is a real product

- **Background location.** Mobile web only tracks while the app is open. Reliable
  background tracking needs a native app — see the SDK recommendations in the feasibility
  notes. This is the single biggest remaining piece.
- **Auth UI.** There's no login screen yet; the MVP runs on the simulated feed until
  Supabase env vars are present.
- **Payroll export.** The button is there; Xero and MYOB are the ones that matter for
  Australia.
- **Employee consent.** Get a written tracking policy signed before any real crew is
  tracked. Notice requirements vary by state.
