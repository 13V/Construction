# Deploying to Vercel

The dashboard and the worker app ship as one Vercel project. `apps/dashboard/api/*`
becomes serverless functions automatically. The app runs on real data or it shows you
what's missing — nothing on any screen is simulated.

## 1. Supabase

Create a project, then run these in the SQL editor, in order:

1. `supabase/schema.sql` — core tables, RLS, realtime
2. `supabase/schema_v2.sql` — scheduling, files, expenses, daily logs, chat, safety
3. `supabase/schema_v3.sql` — materials and per-site budgets (replaces equipment)
4. `supabase/schema_v4.sql` — estimates, purchase orders, invoices, change orders,
   milestones, selections, and the client / subcontractor portals
5. `supabase/schema_v5.sql` — RLS corrections. Run this one; it closes a
   cross-tenant leak in `invoice_status_v`, where a Postgres view read as its
   owner and handed every company's invoices to any signed-in user.
6. `supabase/schema_v6.sql` — time off, punch corrections, plan pins, contract
   value, invoice retention, and the expense↔purchase-order link
7. `supabase/schema_v7.sql` — in-app notifications, raised by trigger
8. `supabase/schema_v8.sql` — stops one worker holding two overlapping shifts
9. `supabase/schema_v9.sql` — the invoice payment ledger. `paid_amount` and
   `status` become derived from it by trigger, so a client paying part of a
   claim is finally expressible. It backfills an opening balance for anything
   already part paid — run it before recording any payment by hand
10. `supabase/storage.sql` — the `site-files` and `receipts` buckets and their policies

Grab three values from Settings → API: the project URL, the `anon` key, and the
`service_role` key.

> The `service_role` key bypasses RLS. Set it as a server variable only — never with a
> `VITE_` prefix, or Vite will bundle it into the browser.

**Email confirmation must stay ON, and that means you need SMTP.**

`/api/bootstrap` hands an invited worker row to whoever signs up with that email
address — that is how crew join without invite tokens. If the address is not verified,
anyone who knows a crew member's email can sign up as them and take the record: their
pay rate, their timesheets, the ability to file corrections in their name. The endpoint
refuses to do it unless Supabase reports the address confirmed, and confirmation is on.

The consequence is that **signup depends on email actually being delivered**, and
Supabase's built-in sender is rate limited to a handful an hour and shares a sender
reputation you do not control. Onboarding a crew of six will hit that limit.

Before you add real people, set your own SMTP under Authentication → Emails → SMTP
Settings. Any transactional provider works. Until you do, expect
`over_email_send_rate_limit` on signup.

After confirming, the account lands on a short "one more step" screen that finishes the
setup — signup itself cannot, because it has no session until the link is clicked, and
the click often opens in a different browser.

## 2. Maps — nothing to do

The map runs on MapLibre GL against OpenFreeMap tiles, and address lookup uses Photon.
Neither needs an API key, a billing account or a usage cap. See [MAPS.md](MAPS.md) for why
Google was dropped and how to self-host tiles later.

## 3. Vercel

Import the repo, then set **Root Directory** to `apps/dashboard`. The Vite preset and
`vercel.json` handle the rest.

Two things in `vercel.json` are load-bearing, and JSON has nowhere to say so — Vercel
rejects the file outright if you add a `comment` key, so the reasoning lives here:

- **`/assets/(.*)` is `immutable` for a year.** Vite puts a content hash in every
  filename under `assets/`, so a changed file is a different URL and these can never
  go stale. Vercel's default of `max-age=0, must-revalidate` cost a blocking
  conditional request for the entry bundle, the 468 kB MapLibre worker, the
  stylesheet and every lazy chunk on *each* page load before any of it could run. The
  bytes come back 304, so it is invisible in transfer size while still putting
  several round trips in front of the map on every refresh.
- **`/` keeps `must-revalidate`.** `index.html` is the one URL that never changes.
  Cache it and nobody ever sees a new deploy.

| Name | Scope | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | build | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | build | `anon` key |
| `SUPABASE_URL` | server | same project URL |
| `SUPABASE_ANON_KEY` | server | `anon` key — used to verify caller tokens |
| `SUPABASE_SERVICE_ROLE_KEY` | server | **secret**, server only |
| `ANTHROPIC_API_KEY` | server | **optional** — enables receipt extraction and daily-log drafting |
| `VITE_MAP_STYLE_URL` | build | **optional** — override the tile style / self-hosted tiles |
| `VITE_CURRENCY` | build | **optional** — defaults to `AUD`; formatting is `en-AU` |
| `VITE_DEMO_EMAIL` | build | **optional** — see below |
| `VITE_DEMO_PASSWORD` | build | **optional** — see below |

### Demo mode

Setting `VITE_DEMO_EMAIL` and `VITE_DEMO_PASSWORD` makes the app sign that account
in automatically instead of showing the login screen, and puts a banner at the top
saying so. It exists so the app can be handed to someone as a link.

Both values ship inside the browser bundle — that is unavoidable for a link anyone
can open, and it is why the demo account must hold nothing real. RLS is not weakened
for it: the demo signs in as an ordinary worker row and sees exactly what that row is
allowed to see. Clear both variables to restore the normal login screen.

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

## Checking a deploy

```bash
SUPABASE_ANON_KEY=... SUPABASE_PAT=sbp_... node scripts/smoke.mjs
```

Creates a throwaway company against the live database and the deployed
functions, asserts, and deletes it. It covers the things a unit test cannot:
RLS policies, database constraints, and the trigger-driven notices. The PAT is
needed to read the `service_role` key (for minting confirmed test users, since
signup now needs a real email) and to clean up afterwards.

## Keeping the surfaces working with each other

There are four apps over one database: the office dashboard, the worker app on
the web, the same worker app inside the native shell, and the client and
subcontractor portals. They never call each other. Everything they share goes
through one of five seams:

| Seam | Who writes | Who reads | Breaks silently if |
|---|---|---|---|
| Postgres + RLS | everyone | everyone | a policy is added without `security_invoker` on a view over it |
| Supabase realtime | the database | dashboard, worker | a table is dropped from the `supabase_realtime` publication |
| `/api/ping` | the phone | the geofence engine | the request or response shape changes on one side only |
| Storage buckets | phone, office | everyone with a signed URL | a bucket policy narrows |
| `notifications` + triggers | the database | dashboard, worker | a trigger stops firing after a table is recreated |

None of those failures throws. The dashboard just stops updating, or a notice
never arrives, and nobody finds out until a worker's hours are wrong. So there
is a test that walks the whole path:

```bash
SUPABASE_ANON_KEY=... SUPABASE_PAT=sbp_... node scripts/integration.mjs
```

It drives simulated GPS through the deployed `/api/ping`, watches the shift
appear on a realtime subscription the way the dashboard would, sends chat both
directions, publishes a roster and checks the phone is told, uploads a photo
from the phone and reads it back as the office, and confirms a client portal
sees the job and none of the crew's hours. Eleven assertions, a throwaway
company, deleted after.

**Run it after any schema change, any change to `api/ping.ts`, and before a
release.** `scripts/smoke.mjs` proves each surface obeys RLS on its own, which
is a different question — it will pass happily while the surfaces have stopped
reaching each other.

### The one that will bite: the native app is a different version

The web surfaces update the moment you deploy. **The native app does not.** It
bundles its own copy of the web assets — deliberately, because a job site is
where signal drops and the clock has to open with no network — so an installed
phone keeps running whatever build was in the APK.

That is fine until a schema change lands. A column the new server writes and the
old phone does not know about is harmless; a column the *phone* writes that the
server has renamed is a worker's hours going missing. The rules that follow from
it:

- **Add columns, don't rename or drop them.** If the phone writes it, it is a
  public API with an install base you cannot force to upgrade.
- **`/api/ping` accepts old request shapes forever.** It is the one endpoint an
  out-of-date phone cannot avoid calling.
- **Ship a phone build whenever the worker app changes.** `npm run sync` in
  `apps/mobile`, then a new APK. A web deploy alone does not reach them.

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

Verified against the live database (Postgres 17.6) by signing real accounts in and
trying it, not by reading the policies:

- A field worker **cannot** read another worker's positions.
- A field worker **cannot** insert a position attributed to someone else.
- A field worker **cannot** edit job sites or geofence radii.
- Office users see their own company's crew and nothing beyond it.
- `dwell_state` has no policies at all — only the service role touches it.
- A signed-up stranger with no company, no worker row and no portal contact reads
  nothing — from the tables **or** the views.
- A portal client sees their one job, its milestones, selections, photos and
  **sent** invoices. They cannot read materials, the crew list, timesheets,
  estimates, purchase orders, or `job_sites.budget`. They can answer a selection
  but cannot reword one.
- A subcontractor sees the job and its documents, but not invoices or change
  orders — cost impact is between the builder and the client.

Two things worth knowing if you add to this schema:

- **A view does not inherit RLS.** Postgres runs a view as its owner unless it is
  declared `security_invoker`, so a view over a protected table silently hands out
  every row. That is exactly how `invoice_status_v` leaked; `schema_v5.sql` fixes
  it. Any new view over an RLS table needs `security_invoker = on`.
- **`invoices.paid_amount` and `invoices.status` are derived.** A trigger
  recomputes both from `invoice_payments` whenever a payment row moves, so
  writing either by hand looks like it worked and is then silently overwritten.
  Record a payment; don't patch the balance.
- **A policy that looks the caller up must use a `security definer` function.** A
  bare subquery against another protected table is filtered by that table's own
  RLS, and the predicate quietly collapses to null — which is how portal clients
  ended up locked out of their own invoices.

## The AI features are optional

Receipt extraction and daily-log drafting call the Anthropic API. Without
`ANTHROPIC_API_KEY` set, both endpoints return 501 and the UI falls back to manual entry —
you can still type an expense and write a daily log by hand, you just don't get the
extraction. Nothing else in the app depends on it.

## Still to do before this is a real product

- **Background location.** Mobile web only reports while the page is open. The native
  shell that fixes this is scaffolded in `apps/mobile` — the app already picks a
  location backend at run time and tells the worker when tracking is degraded — but
  neither platform has been compiled: this was built in a container with no Android SDK
  and no Xcode. Read `apps/mobile/README.md` before trusting it, and test on a real
  phone with the screen off. This is still the last thing between the app and a paying
  crew.
- **Payroll export** produces Xero and MYOB timesheet CSVs plus a detailed audit
  trail, ordinary/overtime split at 38 hours. The earnings-rate names
  ("Ordinary Hours", "Overtime Hours") must match what is set up in your payroll
  package or the import will reject the rows.
- **Employee consent.** Get a written tracking policy signed before any real crew is
  tracked. Notice requirements vary by state.

## What is deliberately not built

Being explicit, because a missing feature that looks present is worse than a
gap you know about.

- **Notifications are in-app only.** Publishing a roster, deciding leave and
  ruling on a punch correction all raise a notice (`notifications`, written by
  trigger so it happens whatever the client), and it shows on the bell in the
  dashboard and as a banner in the worker app. There is still no email, SMS or
  push transport, so someone who never opens the app never finds out. Wiring a
  provider means reading `notifications` and sending — the table is the seam.
  "Send reminders" on Invoices composes the overdue list into your own mail
  client.
- **The geofence does not consult the roster.** `api/ping.ts` clocks a worker
  in wherever they dwell inside a fence, scheduled there or not. That is
  deliberate for now — crew get moved at short notice — but it means a
  schedule is a plan, not a gate.
- **A shift cannot be split across two cost codes.** A worker sets one code on
  their open shift; moving them mid-day means the office edits the timesheet.
- **Background location needs a native app.** Mobile web only reports while
  the page is open. This is still the single biggest gap before a paying crew
  relies on it.
