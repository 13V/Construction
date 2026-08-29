# Crewline Privacy Policy

**Last updated: 9 August 2026**

Crewline is a workforce tracking app used by construction and trade
businesses to run crews, timesheets and job sites. This policy explains what
Crewline collects about you, why, who can see it, how long it is kept, and
the choices you have — written for the person holding the phone, not for a
lawyer.

If you are a worker using the Crewline app, your employer (the business that
signed your company up to Crewline) is the one who decides to track hours
this way and who your office staff are. Crewline is the software that makes
it work, and stores the data on the business's behalf. Both are bound by
this policy.

---

## 1. The short version

- While location tracking is switched on in the app, your phone reports your
  precise GPS position roughly **every 20 seconds** — including while you're
  driving to a job, before you've clocked on, and on the drive home.
- Your office staff (the people who run your company's Crewline account) can
  see that location trail on a live map, for as long as it's kept.
- Location is what starts and stops your paid shift automatically: you don't
  clock yourself in or out, the app does it from where you are.
- You can turn tracking off at any time. Turning it off stops your hours
  from being recorded automatically — it does not clock you out or end a
  shift that's already open.
- Your minute-by-minute location trail is deleted automatically after 3 days.
  Your timesheets are not — they are a pay record, and your employer has to
  keep those, the same as your hours and pay.
- You can delete your account from inside the app. That removes your sign-in
  and your location history; it does not remove the timesheets your employer
  is required to keep.

The rest of this document sets out the detail behind each of those points.

## 2. Who this policy covers

Crewline has two kinds of user:

- **Field workers** — the people whose location is tracked to build
  timesheets.
- **Office staff** — the people at a construction business (owners, admins,
  and job-running "crew captains") who use the Crewline dashboard to run the
  crew, approve hours, and see where people are.

This policy is written primarily for field workers, because location
tracking of an employee is the part of Crewline with the most at stake. It
also covers what office staff can see and do with that data.

## 3. What Crewline collects

### 3.1 Precise location — the sensitive part

When you turn tracking on in the worker app, your phone sends your GPS
coordinates to Crewline's server about every 20 seconds, for as long as
tracking stays on. Each report ("ping") includes:

- latitude and longitude, to full GPS precision
- the GPS accuracy radius reported by your phone, in metres
- the time of the report

This happens on **every** ping, not just the ones near a job site — the
drive to work, a stop at the supplier, the trip home, and any time you're
not actually working but haven't turned tracking off, are all recorded the
same way as time on site. Turning tracking on does not require you to be
clocked in first: arriving inside a job site's boundary is what starts the
clock, so tracking has to be running before that happens for the automatic
clock-in to work at all.

If you use the installed app (not a browser), tracking keeps running with
your screen locked or the app in the background. Android and iOS both show
an ongoing notification while this is happening, so it's never invisible —
tapping it opens the app. In a browser, tracking stops the moment your
screen locks or you switch apps.

Each report is matched against your company's job site boundaries by the
server. If you stay inside a site's boundary for two minutes, you're clocked
in automatically; driving past one doesn't count. Leaving a site's boundary
starts a similar timer before you're clocked out, so a trip to the truck for
a tool doesn't end your shift. You can also tap "Clock in manually" while
you're standing inside a site — this sends the same kind of location report,
flagged as a deliberate request, and is still refused if you're not actually
inside the boundary.

### 3.2 What's built from that location

From the raw pings above, Crewline derives and stores:

- **Shifts** — a start and finish time for each work period, the job site
  it was recorded at, and whether it came from the automatic geofence or was
  entered or corrected by a person. This is your timesheet.
- **Geofence events** — a log entry each time you're detected arriving at
  or leaving a site, including a "drive-by" entry if you passed a site
  without staying the required two minutes. This is the audit trail behind
  your timesheet, kept so a disputed shift can be checked against what
  actually happened.
- **A short system message in the site's chat** each time you clock in or
  out, visible to everyone assigned to that site's channel (your workmates
  on that job) — for example "Sam clocked in at Lot 42 · 7:02am". This
  message states that you arrived or left; it does not show your GPS
  coordinates or the route you took.

### 3.3 Everything else

Crewline also holds the ordinary account and work information needed to run
a crew: your name, trade, which company you work for, the photos and
documents you upload against a job, chat messages you send, receipts you
photograph, and — for office staff only — pay rates and commercial figures.
This policy focuses on location because it's the most sensitive thing the
app collects; it applies to your account data generally.

## 4. Why we collect it

Location is collected for one reason: to produce an accurate timesheet
without you having to remember to tap a button. The geofence engine that
decides when you're clocked in and out runs on Crewline's server, not on
your phone, specifically so a manipulated or offline phone can't fabricate
hours — which is also why the raw pings behind that decision are kept, not
just the shift they produced.

Location is not used for advertising, sold to third parties, or used to
build a profile of you beyond your work movements.

## 5. Who can see it

Crewline data is scoped strictly to your employer's own account — nobody at
a different company using Crewline can see your data, and this is enforced
at the database level, not just by app screens.

Within your company:

- **You** can always see your own location, your own shifts, and your own
  event history.
- **Office staff** — the owners and admins who run your company's Crewline
  account — can see the live location and location trail of everyone in the
  company on a map, along with everyone's shifts and geofence event history.
  This is the access needed to run a crew and approve a timesheet, and it is
  the same access an office would have over paper timesheets or a swipe
  card, extended to cover how those timesheets are now built.
- **Crew captains**, where your company uses that role, can see and correct
  the start and finish times of people working on the specific jobs they
  run — the same as an office would for that job — but cannot see the live
  map trail or anyone's pay rate.
- **Workmates assigned to the same job site** see the short clock-in and
  clock-out chat messages described in 3.2, not your coordinates.

Crewline's own staff do not routinely look at customer location data. It's
accessed only to fix a fault reported by a customer, and only for as long as
that takes.

## 6. How long it's kept

Different things are kept for very different lengths of time, and the
difference matters most for the data that is most sensitive.

**Raw location pings are deleted after 3 days.** The twenty-second breadcrumb
trail — every coordinate, whether you were on a site or driving between them —
is automatically removed once it is three days old. It exists to draw the live
map and to work out when you arrived and left; once the shift it produced has
been written, the trail itself has done its job. Nobody has to ask for this and
nobody can switch it off.

**The shifts and geofence events it produced are kept.** The times you clocked
on and off are a pay record, and a business is required to keep those for seven
years under the Fair Work Act. So the *conclusion* — you were at Lot 42 from
7:04am to 3:12pm — outlives the minute-by-minute path that produced it.

If you stop working for a company that uses Crewline, your timesheets are
**not** deleted; they remain part of that company's employment records, the
same as they would if kept on paper. Your account is deactivated so you can no
longer sign in or be tracked.

### Deleting your account

You can delete your own account from inside the app, under Account. It takes
effect immediately and cannot be undone. It removes your ability to sign in and
deletes your remaining location data outright. It does not delete your
timesheets: those belong to your employer's records and, under the Fair Work
Act, have to be kept for seven years — so your name stays on the hours you
actually worked, and nothing else.

If you are the only owner of a company account, deletion is refused rather than
allowed to orphan the company and everyone's records with it. Make someone else
an owner first.

If you or your employer want data deleted or exported outside of that — for
example because you've left and want a copy of your own timesheets — contact
your employer's office first, since they hold the account; Crewline can also
be reached directly (see section 10) to action a request where the business
can't.

## 7. Your choices

- **Turning tracking off.** The worker app has a control to stop tracking at
  any time. This stops location reports immediately — it is honestly
  described in the app as "stop sharing my location," not "clock out."
  If you're still standing inside a site's boundary when you turn tracking
  off, any shift that's already open stays open until you turn tracking back
  on and the automatic clock-out logic can run, or until the office corrects
  it. Turning tracking off during work hours will affect your recorded
  hours — talk to your office if you're unsure how a gap will be treated.
- **Device permission.** Background tracking on your phone requires you to
  grant location permission, including "Allow all the time" on the
  installed app for tracking to survive the screen locking. You can change
  or withdraw this at any time in your phone's Settings; without it,
  Crewline cannot record your location at all, automatic clock-in stops
  working, and you'll need to tell your office to record your hours another
  way.
- **Manual correction.** If the geofence gets it wrong — a bad GPS fix, a
  missed clock-out — you can request a correction through the app, and your
  office (or, on their own jobs, a crew captain) can edit a shift. Edited
  shifts are marked as such, so the record shows a human changed it.

## 8. Where it's stored and how it's protected

Crewline's data is hosted with Supabase, on infrastructure in Australia
where the specific project region supports it. Every table holding location
or shift data has row-level security enforced by the database itself, so
even a bug in the app's own code cannot show one company's data to another,
or a field worker's colleague's raw location to someone who isn't office
staff. Location is only ever written for the account making the request —
a worker's phone can insert its own position and nothing else.

### 8.1 The outside services the app talks to

Three services outside Crewline receive something, and it is worth being
precise about what reaches each one.

**Map images come from OpenFreeMap.** When you open the map to place a job
site's boundary, your phone asks that service for the map tiles covering that
area. The request says which part of the world is on screen. It carries no
account, no name, and none of your recorded location history — the map you are
looking at is not the same thing as where you are.

**Address lookup uses OpenStreetMap's geocoder.** When you tap to find a job's
address on the map, the address you typed is sent to it to be turned into
coordinates. It is sent by Crewline's own server rather than by your phone, so
your device and your session are never exposed to it, and nothing travels with
the address but the address.

**Reading a receipt or a programme uses Anthropic's Claude API.** When you
photograph a receipt so the app can fill in the supplier and the amount, that
image is sent there to be read. The same applies to a builder's programme you
upload, and — when the app drafts a daily log for you — to the crew names,
hours and photo captions for that day. It is used to read the document and
nothing else: not to train a model, and not kept afterwards. Every one of those
features is optional; the same fields can be typed by hand.

## 9. Australian Privacy Principles

Crewline is designed to meet the Australian Privacy Principles under the
*Privacy Act 1988* (Cth). Employee records held by an employer for
employment purposes can, in some circumstances, sit outside the Act under
the employee records exemption — Crewline does not rely on that exemption
as a reason to say less here. Whether or not the exemption technically
applies to a given business, the workers whose location this app records
every 20 seconds are entitled to know exactly what is collected, who sees
it, and how long it's kept, and that is what this document sets out to do.

If you believe your location or personal information has been mishandled,
you can raise it with your employer's office first, and with Crewline
directly using the details below. If you remain unsatisfied, you can
complain to the Office of the Australian Information Commissioner
(oaic.gov.au).

## 10. Contact

Questions about this policy, or a request to access, correct or delete your
data: **privacy@crewline.app**

For anything about your specific pay, hours or employment, contact your
employer's office directly — they hold your employment records and are best
placed to act on them quickly.

## 11. Changes to this policy

If how Crewline collects or uses location data changes in a way that
matters — a new kind of data, a new party who can see it, a change to how
long it's kept — this document will be updated and the date at the top will
change. Continuing to use Crewline after an update means you've had the
chance to read it; a change that affects what's tracked or who can see it
will also be flagged in the app itself, not just here.
