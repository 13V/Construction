# Crewline

A workforce tracking app for small-to-mid construction companies.

GPS crew tracking with geofenced automatic clock-in, timesheets built from that location
data rather than typed in, weekly scheduling, per-site photo and document folders, per-site
and direct chat, equipment and safety tracking, AI receipt capture, and daily logs that
draft themselves from the day's activity.

It runs on real data or tells you what's missing — there is no demo mode.

## Code

**[apps/dashboard](apps/dashboard)** — the whole product. React + Vite + TypeScript,
Supabase for data, auth, realtime and storage, MapLibre GL + OpenFreeMap for the map, and
Vercel serverless functions for location ingest and the AI endpoints. Office dashboard at
`/`, worker app at `/worker`.

```bash
cd apps/dashboard && npm install && npm run dev
```

**[supabase/](supabase)** — `schema.sql`, `schema_v2.sql` and `storage.sql`: 17 tables,
row-level security throughout, realtime publication, and two private storage buckets.

**[DEPLOY.md](DEPLOY.md)** — Supabase setup, Vercel configuration, environment variables,
and the first-run walkthrough.

## The part that matters

`apps/dashboard/src/geofence/dwell.ts` is the geofence engine, and it runs **server-side**
as the system of record — timesheets have to be produced whether or not anyone has the
dashboard open, and a browser clock is something a worker could tamper with.

Entering a geofence does not clock you in: you have to stay for two minutes, so driving past
a site is rejected rather than paid. Leaving does not clock you out either, so a trip to the
truck for a tool doesn't end the shift. Clock-outs are backdated to the last ping confirmed
inside the fence, so nobody is paid for the drive home.

Drive-by clock-ins are the single most common complaint about every competitor in this
category. That's the wedge.

## Background reading

**[COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md)** — feature parity across Jack,
Buildertrend, Workyard, busybusy and ClockShark, and the gaps worth attacking.

**[PRICING.md](PRICING.md)** — competitor list prices modeled at 20 users in both AUD and
USD, and what that implies for positioning.

**[MAPS.md](MAPS.md)** — why Google Maps was dropped for MapLibre + OpenFreeMap, and how to
self-host tiles later.

**[STYLE-REFERENCE.md](STYLE-REFERENCE.md)** — analysis of Fieldwire (by Hilti), the source
of the palette and chrome conventions.

**[DESIGN-PROMPT.md](DESIGN-PROMPT.md)** — the original prompt used to generate the visual
prototype the build was based on.
