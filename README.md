# Construction crew tracking app

A workforce tracking app for small-to-mid construction companies. Concept docs plus a
working MVP slice of the owner dashboard.

Core ideas: GPS crew tracking with geofenced automatic clock-in/out, timesheets built from
that location data, a document folder per job site (photos, plans, docs), per-site and
per-worker chat, and AI receipt capture that files invoices into a job site's expense ledger.

**[DESIGN-PROMPT.md](DESIGN-PROMPT.md)** — a ready-to-paste prompt for generating a clickable
visual prototype of the app, for showing the vision to a prospective owner.

**[STYLE-REFERENCE.md](STYLE-REFERENCE.md)** — analysis of Fieldwire (by Hilti), the visual
reference the design prompt's palette and chrome specs are drawn from.

**[COMPETITIVE-ANALYSIS.md](COMPETITIVE-ANALYSIS.md)** — feature parity across Jack,
Buildertrend, Workyard, busybusy and ClockShark, with the gaps worth attacking.

**[PRICING.md](PRICING.md)** — competitor list prices modeled at 20 users, and what
that implies for positioning.

**[MAPS.md](MAPS.md)** — why the prototype can't embed a live Google Map, how to get real
geography into it anyway, and the production Maps build with its cost exposure.

## Code

**[apps/dashboard](apps/dashboard)** — the owner dashboard. React + Vite + TypeScript.
Live Google Map with geofenced automatic clock-in, driven by a simulated crew so it runs
with no backend. The dwell-based geofence engine (`src/geofence/dwell.ts`) rejects drive-by
clock-ins and backdates clock-outs to the last confirmed ping on site.

```bash
cd apps/dashboard && npm install && npm run dev
```

**[DEPLOY.md](DEPLOY.md)** — Supabase schema, Google Maps setup, and Vercel
configuration. The dashboard and the worker app ship as one project.

**[supabase/](supabase)** — `schema.sql` (tables, RLS, realtime) and `seed.sql`.

