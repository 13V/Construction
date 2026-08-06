# Deploying to Vercel

The dashboard and the worker app ship as one Vercel project. `apps/dashboard/api/*`
becomes serverless functions automatically. There is no demo mode — the app runs on real
data or it shows you what's missing.

## 1. Supabase

Create a project, then run `supabase/schema.sql` in the SQL editor. That's the whole
database: tables, RLS policies, and the realtime publication.

Grab three values from Settings → API: the project URL, the `anon` key, and the
`service_role` key.

> The `service_role` key bypasses RLS. Set it as a server variable only — never with a
> `VITE_` prefix, or Vite will bundle it into the browser.

**Email confirmation.** Supabase requires it by default, which means signup can't finish
setting up the account in one step. For a first run, turn it off under
Authentication → Providers → Email so the flow completes immediately. Turn it back on
before you have real users.

## 2. Google Maps

In Google Cloud Console:

1. Enable **Maps JavaScript API** and **Geocoding API** (the latter powers address lookup
   when adding a job site).
2. **Turn on billing.** Without it the map renders darkened and watermarked
   "For development purposes only".
3. Create an API key and restrict it to your Vercel domain (`https://your-app.vercel.app/*`)
   plus `http://localhost:5173/*` for development.
4. Create a **Map ID** (Advanced Markers require one) and apply
   `apps/dashboard/src/map/mapStyle.json` to it. Once a Map ID is set the JS `styles`
   option is ignored, so basemap styling has to live in the console.

Read [MAPS.md](MAPS.md) before you scale — the free tier is 10,000 map loads a month
and Google retired the universal $200 credit in March 2025.

## 3. Vercel

Import the repo, then set **Root Directory** to `apps/dashboard`. The Vite preset and
`vercel.json` handle the rest.

| Name | Scope | Value |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | build | Maps key |
| `VITE_GOOGLE_MAPS_MAP_ID` | build | Map ID (or `DEMO_MAP_ID`) |
| `VITE_SUPABASE_URL` | build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | build | `anon` key |
| `SUPABASE_URL` | server | same project URL |
| `SUPABASE_ANON_KEY` | server | `anon` key — used to verify caller tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **secret**, server only |

## 4. First run

1. Open `/` and choose **Set up a new company**. Signup calls `/api/bootstrap`, which
   creates the company and links you as an office user. Every RLS policy keys off that
   worker row, so this step is what makes the app visible at all.
2. Go to **Job Sites → New site**. Type the address and hit Find, or click the map to drop
   the pin. Set the geofence radius with the slider — the yellow circle is what crew have
   to stand inside.
3. Go to **Crew → Add someone**. Name, trade, hourly rate, and the email they'll sign up
   with. Tick *Office access* for anyone who should see the whole crew.
4. Send them to `/worker`. They sign up with that same email, tick *My office already
   added me to a crew*, and their login claims the record you created. No invite tokens.
5. They tap **Start tracking**. Nothing is recorded until they do.

Timesheets fill in on their own as people arrive and leave.

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
something a worker could tamper with. The dashboard only reads what the server decided,
so what the office sees is exactly what payroll will bill.

## What the RLS actually enforces

Verified against Postgres 16 with the policies in `schema.sql`:

- A field worker **cannot** read another worker's positions.
- A field worker **cannot** insert a position attributed to someone else.
- A field worker **cannot** edit job sites or geofence radii.
- Office users see their own company's crew and nothing beyond it.
- `dwell_state` has no policies at all — only the service role touches it.

## Still to do before this is a real product

- **Background location.** Mobile web only reports while the page is open. Reliable
  background tracking needs a native app — see the SDK recommendations in MAPS.md. This is
  the single biggest remaining piece, and the one to fix before a paying crew relies on it.
- **Payroll export.** The button exists; Xero and MYOB are the ones that matter for
  Australia.
- **Shift editing.** Timesheet approval is local to the browser session — approvals aren't
  written back to `shifts.approved_at` yet, and there's no manual-entry path for a missed
  clock-in.
- **Employee consent.** Get a written tracking policy signed before any real crew is
  tracked. Notice requirements vary by state.
