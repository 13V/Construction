# Crewline Privacy Policy

**Last updated: 21 October 2026**

Crewline is the software behind Proven: the app on your phone (called Proven
on the iPhone) and the website your office uses. Trade businesses use it to
run their crews, hours and job sites. This policy explains what it collects
about you, why, who can see it, how long it is kept, and the choices you
have — written for the person holding the phone, not for a lawyer.

If you work for a business that uses it, your employer (the business that
set up your company's account) is the one who decides to record hours this
way and who your office staff are. Crewline is the software that makes it
work, and stores the data on the business's behalf. Both are bound by this
policy.

---

## 1. The short version

- While location tracking is switched on **and the app is open**, your phone
  reports your precise GPS position about every 20 seconds. Closing the app,
  or locking your phone, stops it — nothing is recorded while the app is in
  the background or shut, and on an iPhone it only ever asks for location
  "While Using the App".
- There is no map: neither app shows your location reports to anyone else.
  The reports are used to work out when you arrived at a job and when you
  left, and they are deleted after 3 days.
- Your hours come from those reports: two minutes inside a job's boundary
  with the app open clocks you on, or you tap "Clock in manually" once you
  are there. Leaving clocks you off, or you tap "END MY SHIFT NOW".
- Clocking on or off at a job, and passing through its boundary without
  stopping, each put a short line in that job's chat, which everyone in your
  company can read.
- Your timesheets are kept: they are a pay record your employer has to keep.
  You can delete your account from inside the app, which removes your login
  and your location history but not your timesheets.

The rest of this document sets out the detail behind each of those points.

## 2. Who this policy covers

Crewline has two kinds of user:

- **Field workers** — the crew who use the app to record their hours on the
  job.
- **Office staff** — the people at the business with an Office login (the
  owner, and anyone they make Office), who use the website and the app to
  set up jobs, book the crew and look after the business's records. Some
  businesses also have "crew captains", who run particular jobs from the
  app.

This policy is written primarily for field workers, because recording an
employee's location is the part of Crewline with the most at stake. It also
covers what office staff can see and do with that data.

## 3. What Crewline collects

### 3.1 Precise location — the sensitive part

Location is only read while you have tracking switched on ("START TRACKING"
on the clock screen) and the app is open on your screen. Then your phone
sends its GPS position to Crewline's server about every 20 seconds. The app
has no background location access: on an iPhone it asks for location "While
Using the App" only, never "Always", so the moment you close the app or lock
the phone, the reports stop. The same is true of the crew app in a web
browser. Each report ("ping") includes:

- latitude and longitude, to full GPS precision
- the GPS accuracy radius reported by your phone, in metres
- the time of the report

This happens on **every** report while tracking is on, not just the ones
near a job site: if the app is open with tracking on during the drive to
work or a stop at the supplier, those positions are recorded the same way as
time on site. Tracking has to be on when you arrive for the app to clock you
on by itself.

Each report is checked against your company's job site boundaries by the
server. Staying inside a boundary for two minutes with the app open clocks
you on. After you leave, three minutes outside it clocks you off, timed from
the last report that had you inside, so a trip to the ute for a tool doesn't
end your shift and the drive home isn't counted. You can also tap "Clock in
manually" when you arrive — the server still checks your position and
refuses it if you are not inside the boundary — and "CLOCK OUT", then "END
MY SHIFT NOW", when you leave, which works wherever you are and records
where you were when you tapped it. If you close the app on site, your shift
stays open until the app next reports from somewhere else, when it is closed
at the last time the app saw you on site, or until you tap "END MY SHIFT
NOW".

### 3.2 What's built from that location

From the reports above, Crewline works out and stores:

- **Shifts** — a start and finish time for each work period, the job it was
  at, and whether it started by itself or with "Clock in manually". This is
  your timesheet.
- **Arrive and leave records** — an entry each time you are clocked on or
  off at a job, and a "passed" entry when you went inside a job's boundary
  but left within the two minutes, with how many seconds you were inside.
  This is the record behind your timesheet, kept so a disputed shift can be
  checked against what actually happened.
- **A short line in the job's chat** each time you clock on or off there —
  for example "Sam Smith clocked in at Lot 42 · 7:02 am" — and each time you
  pass through a job's boundary without staying: "Sam Smith passed Lot 42
  7:05 am — not clocked in (40s on site)". Everyone in your company can read
  a job's chat (section 5). The line says you were there and when; it does
  not show your coordinates or the route you took.

### 3.3 Site photos

A site photo you take in the app is stamped with the time and, if tracking
is on and your phone has a GPS fix, with where you were standing. Everyone
in your company can see a job's photos; the app shows whether each one was
taken on site, and the website also how far it was from the job's pin. That
location stays with the photo for as long as the photo is kept; it is not
deleted after 3 days like the location reports. Photos added on the website
carry no location.

### 3.4 Everything else

Crewline also holds the ordinary account and work information needed to run
a crew: your name, email address, trade and role, a phone number and profile
photo if you add them, the licences and tickets you add (with photos of the
cards), the jobs you are booked on, the chat messages you send, the photos
and documents you add to a job, the receipts and costs you enter, the safety
documents you sign on to, and — for office staff only — pay rates and the
business's money. This policy focuses on location because it's the most
sensitive thing the app collects; it applies to your account data generally.

## 4. Why we collect it

Location is collected for one reason: to record your hours at the right job
without anyone having to write them down. The engine that decides when
you're clocked on and off runs on Crewline's server, not on your phone, so a
phone that has been tampered with or is offline can't make up hours — which
is also why the reports behind that decision are kept for 3 days, not just
the shift they produced.

Location is not used for advertising, sold to third parties, or used to
build a profile of you beyond your work movements.

## 5. Who can see it

Crewline data is scoped strictly to your employer's own account — nobody at
a different company using Crewline can see your data, and this is enforced
at the database level, not just by app screens.

Within your company:

- **You** can see your own hours in the app, under Me › My hours.
- **Office staff** (Office logins) can see everyone's shifts and hours, on
  the website and in the app: who is on the clock at each job, and the hours
  behind each job's labour costs. Their logins can also read the location
  reports, for the 3 days they are kept, and the arrive, leave and passed
  records, although no screen in either app shows those, and there is no
  map. Only office staff see pay rates.
- **Crew captains**, where your company uses that role, can see the shifts
  recorded at the jobs they run, so they know who is on the clock there, but
  not your location reports or anyone's pay rate.
- **Workmates booked on the same job that day** can see that you are on the
  clock there.
- **Everyone in your company** can read every job's chat, including the
  clock-on, clock-off and "passed" lines described in 3.2, and can see each
  job's photos — not your location reports.
- **A direct message** is between two people: it shows only in their two
  Chat lists, and no screen in either app shows it to anyone else, office
  staff included.

Crewline's own staff do not routinely look at customer location data. It's
accessed only to fix a fault reported by a customer, and only for as long as
that takes.

## 6. How long it's kept

Different things are kept for very different lengths of time, and the
difference matters most for the data that is most sensitive.

**Location reports are deleted after 3 days.** Every position reported while
tracking was on, on a site or between them, is removed automatically once it
is three days old, by a job that runs every night. The reports exist to work
out when you arrived and left; once the shift they produced has been
written, they have done their job. Nobody has to ask for this, and nobody
can switch it off from the apps.

**Shifts, arrive and leave records, and chat are kept.** The times you
clocked on and off are a pay record, and a business is required to keep
those for seven years under the Fair Work Act. So the *conclusion* — you
were at Lot 42 from 7:04am to 3:12pm — outlives the reports that produced
it. Chat messages, the clock-on and "passed" lines included, stay in the
job's chat as part of its record, and a photo keeps its time and place for
as long as it is kept.

If you stop working for a company that uses Crewline, your timesheets are
**not** deleted; they remain part of that company's employment records, the
same as they would if kept on paper. The office can take you off the crew
list, which stops you being booked onto jobs; to remove your login as well,
delete your account.

### Deleting your account

You can delete your own account from inside the app, under Me › Account &
privacy › Delete my account. It takes effect immediately and cannot be
undone. It removes your login, deletes your remaining location reports, and
removes your profile photo and phone number. It does not delete your
timesheets: those belong to your employer's records and, under the Fair Work
Act, have to be kept for seven years — so your name stays on the hours you
actually worked, and on the job records and messages you added.

If you are the only person with an Office login at your company, there is
nobody to hand the company to, so deleting your account deletes the company
as well: every job, timesheet, record and message in it, for everyone in it.
The app asks you to type the company's name before it does. To keep the
company running, add someone as Office first (Me › Your crew › Add someone),
then delete your account.

If you or your employer want data deleted or exported outside of that — for
example because you've left and want a copy of your own timesheets — contact
your employer's office first, since they hold the account; Crewline can also
be reached directly (see section 10) to action a request where the business
can't.

## 7. Your choices

- **Stopping the location reports.** Location is only recorded while
  tracking is on and the app is open, so closing the app or locking your
  phone stops it straight away. While you are on the clock, "CLOCK OUT" also
  offers "Just stop sending my location", which stops the reports without
  ending your shift. Stopping the reports does not clock you out: a shift
  that is already open stays open until the app reports again from somewhere
  else, or you tap "END MY SHIFT NOW". Stopping during work hours will
  affect your recorded hours — talk to your office if you're unsure how a
  gap will be treated.
- **Device permission.** On an iPhone the app asks for location "While Using
  the App" only. You can change or withdraw it at any time in Settings ›
  Proven › Location; leave Precise Location on, because an approximate
  location can't tell whether you are inside a job's boundary. Without the
  permission the app cannot check you are at a job, so it cannot clock you
  on, and you'll need to tell your office to record your hours another way.
- **A shift that's wrong.** If the record gets it wrong — a bad GPS fix, a
  missed clock-off — tell your office. Neither app can change a recorded
  shift yet, so the office contacts Crewline (section 10) to correct it.

## 8. Where it's stored and how it's protected

Crewline's database, sign-in and file storage are run by Supabase, which
also sends the sign-up and password reset emails. The server functions that
receive every location report, check it against the job boundaries and write
your shifts run on Vercel, in Sydney; Vercel also serves the website. Every
table holding location or shift data has row-level security enforced by the
database itself, so even a bug in the app's own code cannot show one
company's data to another, or a worker's location reports to anyone but
them and their office staff. Location is only ever written for the account
making the request — a worker's phone can report its own position and
nothing else.

### 8.1 The outside services the app talks to

Besides Supabase and Vercel, which hold and process the data for Crewline as
above, a few services outside Crewline receive something, and it is worth
being precise about what reaches each one.

**Map images come from OpenFreeMap.** When a map opens to place a job's
boundary (on the website, or when the office adds a job in the app), your
device asks that service for the map tiles covering that area. The request
says which part of the world is on screen. It carries no account, no name,
and none of your location reports.

**Address lookup uses OpenStreetMap's geocoder.** When someone searches for a
job's address, the address typed is sent to it to be turned into
coordinates. It is sent by Crewline's own server rather than by the device,
so nothing travels with the address but the address.

**Apple.** On an iPhone your position comes from Apple's Location Services,
and the app is installed from the App Store; Apple's own privacy policy
covers both.

**Directions.** Tapping a job's address in the app opens it in Apple Maps,
and the website's Map link opens the job's spot in Google Maps. Each is sent
that address or spot, and nothing else.

**Reading receipts.** The app can read a photographed receipt (and draft a
daily log) with Anthropic's Claude API, but that is switched off at the
moment: nothing is sent to Anthropic, and those forms are filled in by hand.
If it is ever switched on, this policy will say first exactly what is sent.

None of these outside services is sent your location reports, your shifts or
your chat messages. None is used for advertising, and none is given anything
to build a profile from.

## 9. Australian Privacy Principles

Crewline is designed to meet the Australian Privacy Principles under the
*Privacy Act 1988* (Cth). Employee records held by an employer for
employment purposes can, in some circumstances, sit outside the Act under
the employee records exemption — Crewline does not rely on that exemption
as a reason to say less here. Whether or not the exemption technically
applies to a given business, the workers whose location this app records
while it is open are entitled to know exactly what is collected, who sees
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
