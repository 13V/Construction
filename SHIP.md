# Going live

What has to be true before a real crew's hours depend on this, in the order it
matters. [DEPLOY.md](DEPLOY.md) covers how to stand the thing up; this covers
whether you should.

Everything here was checked against the live project on 7 August 2026. Where a
step is a judgement call rather than a switch, the reasoning is included —
skipping one knowingly is fine, skipping one because it looked optional is not.

---

## 1. Blockers

Do not put real crew on it until every one of these is done.

### Rotate the credentials

A Vercel deploy token and a Supabase personal access token were pasted in
plaintext during development, and the Supabase PAT was subsequently used to read
the project's `service_role` key. Treat all three as compromised:

| What | Where | Why |
|---|---|---|
| Supabase PAT | Account → Access Tokens → revoke, issue a new one | Was used to read `service_role` |
| `service_role` key | Project → Settings → API → **Rotate** | Bypasses every RLS policy in the database |
| Vercel token | Account → Settings → Tokens → revoke | Can deploy arbitrary code to your domain |

Rotating `service_role` means updating `SUPABASE_SERVICE_ROLE_KEY` in Vercel and
redeploying, or `/api/ping` stops recording hours. Do it in that order and check
a clock-in still lands before you walk away.

The `anon` key does not need rotating — it is public by design and does nothing
without a valid user session behind it.

### Turn demo mode off — done

`VITE_DEMO_EMAIL` and `VITE_DEMO_PASSWORD` have been removed from the Vercel
project and production rebuilt. `demo@crewline.app` is no longer compiled into
the bundle, and the site asks for a login instead of signing visitors in as Ray
Whitcomb. Confirmed against the live URL.

To put it back — for a demo on a **separate** project — set both variables again
and redeploy. They are build-time variables, so a plain redeploy of the existing
build will not pick them up; it has to rebuild.

Never run a demo against the same Supabase project as real jobs. Sharing a
database means the demo account is one RLS mistake away from your books.

### Retire the old demo account

Turning off auto-sign-in does not invalidate anything. `demo@crewline.app` is
still a real, confirmed account, and its password shipped inside a public
JavaScript bundle for as long as demo mode was on — anyone who saved that file
can still sign in as Ray Whitcomb.

Either delete the demo company (everything cascades) or change that account's
password. Doing neither leaves a working login with a published credential.

### Configure SMTP

Email confirmation is on and must stay on: `/api/bootstrap` hands an invited
worker's row — their pay rate, their timesheets, the ability to file corrections
in their name — to whoever signs up with that address. The endpoint refuses
unless Supabase reports the address confirmed.

The consequence is that signup depends on email actually arriving, and
Supabase's built-in sender is limited to a handful an hour on a shared sender
reputation. Onboarding six people will hit the limit and the sixth will think
the app is broken.

Set your own SMTP under Authentication → Emails → SMTP Settings before you
invite anyone. Any transactional provider works.

### Decide what you are telling the crew about background tracking

The product promise is that nobody taps anything. On mobile web that promise is
false: `watchPosition` stops when the phone locks, which is most of the working
day. The native shell that fixes it is scaffolded in `apps/mobile` and **has
never been compiled** — there was no Android SDK and no Xcode in the environment
it was written in.

Two honest options:

- **Ship office-first.** Crew keep the worker page open, or the office enters
  hours from the timesheet screen. The geofence still works whenever the page is
  foregrounded, and the app already tells the worker in plain words when
  tracking is degraded (`backendNote()` in `src/worker/location.ts`).
- **Build the native app first.** Needs Android Studio, or a Mac with Xcode, and
  a real phone in a real ute with the screen off. Read
  `apps/mobile/README.md` before trusting any of it.

What you must not do is tell a crew they are tracked in the background on the
web build. They will lose hours and it will be your fault.

### Get written tracking consent

Australian workplace surveillance law is state-based and the notice
requirements differ. Get a signed tracking policy from every employee before the
first ping is recorded. This is not a formality — location data about an
identified worker is personal information, and consent obtained after the fact
is not consent.

---

## 2. Worth doing before you rely on it

- **`ANTHROPIC_API_KEY`** — without it, receipt extraction and daily-log
  drafting return 501 and the UI falls back to manual entry. Nothing breaks; you
  just type it in yourself. Set it if you want the extraction.
- **Clear the demo data.** The production database still holds Whitcomb
  Builders with its sites, crew, invoices and photos, and its six accounts are
  the only users in the project. RLS keeps a real company from seeing it, but it
  inflates your row counts and it is one bad query from being confusing. Delete
  the company row — everything cascades. See the note above about the published
  password if you keep it.
- **Error monitoring.** There is none. An unhandled render error now shows a
  recovery screen instead of a white page (`src/ui/Crash.tsx`), and it logs the
  component stack to the console — but nobody is reading that console. Sentry or
  equivalent is an afternoon.
- **A second office user.** Right now, losing one account can mean losing
  administrative access to the company. Add someone with `is_office` set.

---

## 3. Checking it before you hand it over

```bash
SUPABASE_ANON_KEY=... SUPABASE_PAT=sbp_... node scripts/smoke.mjs
```

Creates a throwaway company against the live database and the deployed
functions, asserts 28 things a unit test cannot — RLS policies, database
constraints, trigger-driven notices, the payment ledger — and deletes it.

Then, by hand, in a private window:

1. Sign up as a new company. You should land on the setup screen, not an empty
   dashboard.
2. Add a job site with a geofence. Drop the pin, set the radius.
3. Add a crew member with an email you control. Confirm the invite email
   actually arrives — this is the step SMTP exists for.
4. Sign in as them at `/worker`, tap **Start tracking**, and watch a shift open
   on the dashboard.
5. Raise a progress claim, issue it, record a part payment. The invoice should
   stay open at the right balance and the client portal should show the payment.

---

## What has been verified, and how

Not by reading the code — by running it against the live database.

| Area | Evidence |
|---|---|
| RLS across tenants | A signed-up stranger reads nothing from the tables **or** the views. Verified after a real leak was found and closed in `schema_v5.sql` |
| Geofence engine | Simulated GPS driven through the deployed `/api/ping`, including a drive-by correctly refused: "passed Harbour View 3B — not clocked in (2s on site)" |
| Photo pipeline | 9/9 — private bucket, signed URLs return exact bytes, field worker can upload, stranger blocked from read, sign and upload |
| Invoices | 15/15 on the lifecycle, plus browser-driven: part payment recorded, invoice left open at the right balance, ledger and retention rendering |
| Overlapping shifts | Database-level exclusion constraint; a worker cannot hold two shifts at once by any path |
| Error boundary | Verified by injecting a deliberate throw — recovery screen, not a white page |

## Known gaps, stated plainly

A missing feature you know about is cheaper than one that looks present.

- **Background location needs the native app.** The single biggest gap. See above.
- **Notifications are in-app only.** A roster published, leave decided or a punch
  correction ruled on all raise a notice, and it shows on the bell and in the
  worker app. There is no email, SMS or push transport, so someone who never
  opens the app never finds out. The `notifications` table is the seam.
- **Invoices cannot be sent as documents.** There is no PDF and no print
  stylesheet, so a progress claim cannot be handed to a client on letterhead.
  "Send reminders" composes the overdue list into your own mail client.
- **The geofence does not consult the roster.** A worker is clocked in wherever
  they dwell inside a fence, scheduled there or not. Deliberate — crew get moved
  at short notice — but it means a schedule is a plan, not a gate.
- **A shift cannot be split across two cost codes.** Moving someone mid-day
  means the office edits the timesheet.
- **One test file.** `dwell.test.ts` covers the geofence maths. The smoke suites
  cover RLS, constraints and triggers against the real database. The UI has no
  automated coverage.
