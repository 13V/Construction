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
10. `supabase/schema_v10.sql` — SWMS and site inductions with per-worker
    signatures, a worker's own ordinary hours, what an expired ticket stops you
    doing, and a lifecycle for plan pins
11. `supabase/schema_v11.sql` — products, their technical and safety data
    sheets, and the hazardous chemical register
12. `supabase/schema_v12.sql` — **run this one.** The geofence engine could
    open a shift and was then refused permission to close it, so shifts never
    ended and the next day's clock-in collided with yesterday's
13. `supabase/schema_v13.sql` — lets a worker flag a photo and resolve a plan
    pin, both of which silently did nothing
14. `supabase/schema_v14.sql` — **run this one.** `is_office` gated every write
    and not one read, so any field worker could select colleagues' pay rates,
    invoices and expenses
15. `supabase/schema_v15.sql` — builders as a real counterparty, GST and ABN on
    invoices, and subcontract labour. Entirely additive
16. `supabase/schema_v16.sql` — closes a read leak v15 reopened, makes the
    company's own ABN and bank details writable, and rebuilds
    `invoice_status_v` with an explicit column list
17. `supabase/schema_v17.sql` — **run this one.** The contract. Every
    commercial number in the app was measured against `job_sites.contract_value`,
    a column no form could write and that an approved variation changed not at
    all. This adds `contracts` (one per job), links variations and invoices to
    it, stamps the approval date by trigger, and derives `job_value_v` —
    contract sum + approved variations, against what has been claimed and paid.
    **This one has to land before the app deploy**, not after: the claim form
    now writes `tax_amount`, `contract_id` and `variation_id`, and against a
    database without them every invoice save fails with `PGRST204`
18. `supabase/schema_v18.sql` — **run this one.** The third role. There were two
    tiers expressed as one boolean, so the only way to let a leading hand run a
    job was to make them office — which handed them every pay rate and contract
    sum in the business. Adds `crews` with it
19. `supabase/schema_v19.sql` — site instructions, defects, progress and
    waterproofing (AS 3740, with the sign-off stamped from identity rather than
    taken from the form)
20. `supabase/schema_v20.sql` — job cost and profitability. Cost moves out of
    TypeScript, where it existed in two copies, and picks up sublet labour,
    which no roll-up had ever counted
21. `supabase/schema_v21.sql` — the builder's programme, its revisions, and
    whether a job is actually ready for us
22. `supabase/schema_v22.sql` — deletes raw location pings after 3 days. The
    breadcrumb trail existed forever; nothing in this repo had ever removed one.
    Scheduled with pg_cron where it is available — read the file header for the
    fallback, and check `select * from cron.job` after running it
23. `supabase/schema_v23.sql` — in-app account deletion (App Store 5.1.1(v)).
    Severs the login and removes location data while preserving the timesheets
    the Fair Work Act requires an employer to keep for seven years
24. `supabase/schema_v24.sql` — closes two column-level leaks. Pay rates move
    off `workers` into `worker_pay`, because `workers` is readable by the whole
    company by design and RLS is row-level — it cannot return a row with one
    column withheld, so anyone holding their own token could read every wage in
    the business. Variations narrow to the office and captains get
    `site_variations_v`, the same register with no money on it. **This file
    drops `workers.rate`, so `schema.sql` has to be re-run before
    `schema_v20.sql` in the same pass** — `worker_pay` is declared there and
    `job_cost_v` reads it. `scripts/migrate.mjs` already does this
25. `supabase/storage.sql` — the `site-files` and `receipts` buckets and their policies

> **Run them in order, and never re-run one on its own.** Later files
> deliberately tighten what earlier files created — `schema_v14` narrows read
> policies that `schema_v4` first defined permissively, for instance. Running
> the whole list start to finish always ends in the right state. Re-running a
> single early file *after* the others silently reverts every later change to
> the same object, with no error. That is not hypothetical: re-running
> `schema_v4.sql` alone reopened the money-read leak on the live database
> during testing, and only the smoke suite caught it.

Before running any of it against a real database, prove the whole list still
applies — twice:

```bash
scripts/schema-check.sh        # needs postgresql-16+, no credentials
```

It spins up a throwaway local Postgres, applies all 24 files three times over,
and runs the behaviour tests in `supabase/tests/`. Three passes rather than one
because "safe to re-run" has been false twice: `create or replace view` cannot
rename a column (`schema_v4`, 42P16) and a bare `alter publication … add table`
raises 42710 on the second run (`schema.sql`). Both aborted the run part-way, so
every migration after the failure silently never ran. A single pass on a fresh
database catches neither.

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
