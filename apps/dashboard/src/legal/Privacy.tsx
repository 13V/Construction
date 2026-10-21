import type { CSSProperties, ReactNode } from 'react'
import { theme, font } from '../theme'
import { Panel, PanelHead, Note, LABEL } from '../ui/kit'

/**
 * Renders PRIVACY.md (repo root) for the app itself — Apple requires a
 * privacy policy URL for every listing, and this one covers an app that
 * records precise location roughly every 20 seconds while tracking is on and
 * the app is open. It has no background location access.
 *
 * The two files are meant to stay identical in substance. This is not a
 * markdown renderer pointed at that file — there is no fetch, no build step
 * that inlines it, and no dependency added to parse it — so a change to one
 * without the other is a silent drift. Whoever edits PRIVACY.md next must
 * edit this file in the same change, and vice versa. Nothing enforces that
 * automatically; this comment is the enforcement.
 *
 * Every claim in it is meant to be checkable against the code: the cadence
 * and what a report holds (worker/WorkerApp.tsx, api/ping.ts), the dwell
 * timings (geofence/dwell.ts), the chat lines (api/ping.ts), who can read
 * what (the RLS policies in supabase/), how long location is kept
 * (prune_positions, schema_v22.sql), account deletion (api/delete-account.ts,
 * delete_worker_account in schema_v39.sql) and the outside services. When one
 * of those changes, this changes with it.
 *
 * Deliberately has no dependency on auth, routing, or any data fetch — this
 * has to render as a plain, publicly reachable page with nothing signed in,
 * because that is what App Store review opens.
 */

const shell: CSSProperties = {
  minHeight: '100vh',
  background: theme.appBg,
  color: theme.ink,
  font: `14px ${font}`,
}

const inner: CSSProperties = {
  maxWidth: 640,
  margin: '0 auto',
  padding: '28px 18px 56px',
}

const h1Style: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: theme.ink,
  margin: '0 0 4px',
}

const updatedStyle: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: '.05em',
  textTransform: 'uppercase',
  color: LABEL,
  margin: '0 0 20px',
}

const introStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: theme.inkMid,
  margin: '0 0 24px',
}

const h2Style: CSSProperties = {
  fontSize: 15.5,
  fontWeight: 700,
  color: theme.ink,
  margin: '30px 0 10px',
}

const h3Style: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: theme.ink,
  margin: '18px 0 6px',
}

const pStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.65,
  color: theme.inkMid,
  margin: '0 0 12px',
  textWrap: 'pretty',
}

const ulStyle: CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const liStyle: CSSProperties = {
  fontSize: 13.5,
  lineHeight: 1.6,
  color: theme.inkMid,
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} style={h2Style}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p style={pStyle}>{children}</p>
}

function Ul({ children }: { children: ReactNode }) {
  return <ul style={ulStyle}>{children}</ul>
}

function Li({ children }: { children: ReactNode }) {
  return <li style={liStyle}>{children}</li>
}

function H3({ children }: { children: ReactNode }) {
  return <h3 style={h3Style}>{children}</h3>
}

export function Privacy() {
  return (
    <div style={shell}>
      <div style={inner}>
        <h1 style={h1Style}>Crewline Privacy Policy</h1>
        <p style={updatedStyle}>Last updated 21 October 2026</p>

        <p style={introStyle}>
          Crewline is the software behind Proven: the app on your phone (called Proven on the
          iPhone) and the website your office uses. Trade businesses use it to run their crews,
          hours and job sites. This policy explains what it collects about you, why, who can see
          it, how long it is kept, and the choices you have — written for the person holding the
          phone, not for a lawyer.
        </p>
        <p style={introStyle}>
          If you work for a business that uses it, your employer (the business that set up your
          company&rsquo;s account) is the one who decides to record hours this way and who your
          office staff are. Crewline is the software that makes it work, and stores the data on the
          business&rsquo;s behalf. Both are bound by this policy.
        </p>

        <Panel style={{ margin: '0 0 8px' }}>
          <PanelHead>The short version</PanelHead>
          <div style={{ padding: '13px 15px' }}>
            <Ul>
              <Li>
                While location tracking is switched on <strong>and the app is open</strong>, your
                phone reports your precise GPS position about every 20 seconds. Closing the app, or
                locking your phone, stops it — nothing is recorded while the app is in the background
                or shut, and on an iPhone it only ever asks for location &ldquo;While Using the
                App&rdquo;.
              </Li>
              <Li>
                There is no map: neither app shows your location reports to anyone else. The reports
                are used to work out when you arrived at a job and when you left, and they are
                deleted after 3 days.
              </Li>
              <Li>
                Your hours come from those reports: two minutes inside a job&rsquo;s boundary with the
                app open clocks you on, or you tap &ldquo;Clock in manually&rdquo; once you are there.
                Leaving clocks you off, or you tap &ldquo;END MY SHIFT NOW&rdquo;.
              </Li>
              <Li>
                Clocking on or off at a job, and passing through its boundary without stopping, each
                put a short line in that job&rsquo;s chat, which everyone in your company can read.
              </Li>
              <Li>
                Your timesheets are kept: they are a pay record your employer has to keep. You can
                delete your account from inside the app, which removes your login and your location
                history but not your timesheets.
              </Li>
            </Ul>
          </div>
        </Panel>
        <P>The rest of this document sets out the detail behind each of those points.</P>

        <Section id="who" title="1. Who this policy covers">
          <P>Crewline has two kinds of user:</P>
          <Ul>
            <Li>
              <strong>Field workers</strong> — the crew who use the app to record their hours on the
              job.
            </Li>
            <Li>
              <strong>Office staff</strong> — the people at the business with an Office login (the
              owner, and anyone they make Office), who use the website and the app to set up jobs,
              book the crew and look after the business&rsquo;s records. Some businesses also have
              &ldquo;crew captains&rdquo;, who run particular jobs from the app.
            </Li>
          </Ul>
          <P>
            This policy is written primarily for field workers, because recording an
            employee&rsquo;s location is the part of Crewline with the most at stake. It also
            covers what office staff can see and do with that data.
          </P>
        </Section>

        <Section id="collect" title="2. What Crewline collects">
          <H3>2.1 Precise location — the sensitive part</H3>
          <P>
            Location is only read while you have tracking switched on (&ldquo;START TRACKING&rdquo;
            on the clock screen) and the app is open on your screen. Then your phone sends its GPS
            position to Crewline&rsquo;s server about every 20 seconds. The app has no background
            location access: on an iPhone it asks for location &ldquo;While Using the App&rdquo;
            only, never &ldquo;Always&rdquo;, so the moment you close the app or lock the phone, the
            reports stop. The same is true of the crew app in a web browser. Each report
            (&ldquo;ping&rdquo;) includes:
          </P>
          <Ul>
            <Li>latitude and longitude, to full GPS precision</Li>
            <Li>the GPS accuracy radius reported by your phone, in metres</Li>
            <Li>the time of the report</Li>
          </Ul>
          <P>
            This happens on <strong>every</strong> report while tracking is on, not just the ones
            near a job site: if the app is open with tracking on during the drive to work or a stop
            at the supplier, those positions are recorded the same way as time on site. Tracking
            has to be on when you arrive for the app to clock you on by itself.
          </P>
          <P>
            Each report is checked against your company&rsquo;s job site boundaries by the server.
            Staying inside a boundary for two minutes with the app open clocks you on. After you
            leave, three minutes outside it clocks you off, timed from the last report that had you
            inside, so a trip to the ute for a tool doesn&rsquo;t end your shift and the drive home
            isn&rsquo;t counted. You can also tap &ldquo;Clock in manually&rdquo; when you arrive —
            the server still checks your position and refuses it if you are not inside the boundary
            — and &ldquo;CLOCK OUT&rdquo;, then &ldquo;END MY SHIFT NOW&rdquo;, when you leave, which
            works wherever you are and records where you were when you tapped it. If you close the
            app on site, your shift stays open until the app next reports from somewhere else, when
            it is closed at the last time the app saw you on site, or until you tap &ldquo;END MY
            SHIFT NOW&rdquo;.
          </P>

          <H3>2.2 What&rsquo;s built from that location</H3>
          <P>From the reports above, Crewline works out and stores:</P>
          <Ul>
            <Li>
              <strong>Shifts</strong> — a start and finish time for each work period, the job it was
              at, and whether it started by itself or with &ldquo;Clock in manually&rdquo;. This is
              your timesheet.
            </Li>
            <Li>
              <strong>Arrive and leave records</strong> — an entry each time you are clocked on or
              off at a job, and a &ldquo;passed&rdquo; entry when you went inside a job&rsquo;s
              boundary but left within the two minutes, with how many seconds you were inside. This
              is the record behind your timesheet, kept so a disputed shift can be checked against
              what actually happened.
            </Li>
            <Li>
              <strong>A short line in the job&rsquo;s chat</strong> each time you clock on or off
              there — for example &ldquo;Sam Smith clocked in at Lot 42 · 7:02 am&rdquo; — and each
              time you pass through a job&rsquo;s boundary without staying: &ldquo;Sam Smith passed
              Lot 42 7:05 am — not clocked in (40s on site)&rdquo;. Everyone in your company can read
              a job&rsquo;s chat (section 4). The line says you were there and when; it does not
              show your coordinates or the route you took.
            </Li>
          </Ul>

          <H3>2.3 Site photos</H3>
          <P>
            A site photo you take in the app is stamped with the time and, if tracking is on and
            your phone has a GPS fix, with where you were standing. Everyone in your company can see
            a job&rsquo;s photos; the app shows whether each one was taken on site, and the website
            also how far it was from the job&rsquo;s pin. That location stays with the photo for as
            long as the photo is kept; it is not deleted after 3 days like the location reports.
            Photos added on the website carry no location.
          </P>

          <H3>2.4 Everything else</H3>
          <P>
            Crewline also holds the ordinary account and work information needed to run a crew:
            your name, email address, trade and role, a phone number and profile photo if you add
            them, the licences and tickets you add (with photos of the cards), the jobs you are
            booked on, the chat messages you send, the photos and documents you add to a job, the
            receipts and costs you enter, the safety documents you sign on to, and — for office staff
            only — pay rates and the business&rsquo;s money. This policy focuses on location because
            it&rsquo;s the most sensitive thing the app collects; it applies to your account data
            generally.
          </P>
        </Section>

        <Section id="why" title="3. Why we collect it">
          <P>
            Location is collected for one reason: to record your hours at the right job without
            anyone having to write them down. The engine that decides when you are clocked on and
            off runs on Crewline&rsquo;s server, not on your phone, so a phone that has been tampered
            with or is offline can&rsquo;t make up hours — which is also why the reports behind
            that decision are kept for 3 days, not just the shift they produced.
          </P>
          <P>
            Location is not used for advertising, sold to third parties, or used to build a profile
            of you beyond your work movements.
          </P>
        </Section>

        <Section id="who-sees" title="4. Who can see it">
          <P>
            Crewline data is scoped strictly to your employer&rsquo;s own account — nobody at a
            different company using Crewline can see your data, and this is enforced at the
            database level, not just by app screens.
          </P>
          <P>Within your company:</P>
          <Ul>
            <Li>
              <strong>You</strong> can see your own hours in the app, under Me &rsaquo; My hours.
            </Li>
            <Li>
              <strong>Office staff</strong> (Office logins) can see everyone&rsquo;s shifts and
              hours, on the website and in the app: who is on the clock at each job, and the hours
              behind each job&rsquo;s labour costs. Their logins can also read the location reports,
              for the 3 days they are kept, and the arrive, leave and passed records, although no
              screen in either app shows those, and there is no map. Only office staff see pay
              rates.
            </Li>
            <Li>
              <strong>Crew captains</strong>, where your company uses that role, can see the shifts
              recorded at the jobs they run, so they know who is on the clock there, but not your
              location reports or anyone&rsquo;s pay rate.
            </Li>
            <Li>
              <strong>Workmates booked on the same job that day</strong> can see that you are on the
              clock there.
            </Li>
            <Li>
              <strong>Everyone in your company</strong> can read every job&rsquo;s chat, including
              the clock-on, clock-off and &ldquo;passed&rdquo; lines described in 2.2, and can see
              each job&rsquo;s photos — not your location reports.
            </Li>
            <Li>
              <strong>A direct message</strong> is between two people: it shows only in their two
              Chat lists, and no screen in either app shows it to anyone else, office staff
              included.
            </Li>
          </Ul>
          <P>
            Crewline&rsquo;s own staff do not routinely look at customer location data. It&rsquo;s
            accessed only to fix a fault reported by a customer, and only for as long as that takes.
          </P>
        </Section>

        <Section id="retention" title="5. How long it’s kept">
          <P>
            Different things are kept for very different lengths of time, and the difference
            matters most for the data that is most sensitive.
          </P>
          <P>
            <strong>Location reports are deleted after 3 days.</strong> Every position reported
            while tracking was on, on a site or between them, is removed automatically once it is
            three days old, by a job that runs every night. The reports exist to work out when you
            arrived and left; once the shift they produced has been written, they have done their
            job. Nobody has to ask for this, and nobody can switch it off from the apps.
          </P>
          <P>
            <strong>Shifts, arrive and leave records, and chat are kept.</strong> The times you
            clocked on and off are a pay record, and a business is required to keep those for seven
            years under the Fair Work Act. So the <em>conclusion</em> — you were at Lot 42 from
            7:04am to 3:12pm — outlives the reports that produced it. Chat messages, the clock-on
            and &ldquo;passed&rdquo; lines included, stay in the job&rsquo;s chat as part of its
            record, and a photo keeps its time and place for as long as it is kept.
          </P>
          <P>
            If you stop working for a company that uses Crewline, your timesheets are{' '}
            <strong>not</strong> deleted; they remain part of that company&rsquo;s employment
            records, the same as they would if kept on paper. The office can take you off the crew
            list, which stops you being booked onto jobs; to remove your login as well, delete your
            account.
          </P>
          <P>
            <strong>Deleting your account.</strong> You can delete your own account from inside the
            app, under Me &rsaquo; Account &amp; privacy &rsaquo; Delete my account. It takes effect
            immediately and cannot be undone. It removes your login, deletes your remaining location
            reports, and removes your profile photo and phone number. It does not delete your
            timesheets: those belong to your employer&rsquo;s records and, under the Fair Work Act,
            have to be kept for seven years — so your name stays on the hours you actually worked,
            and on the job records and messages you added.
          </P>
          <P>
            If you are the only person with an Office login at your company, there is nobody to hand
            the company to, so deleting your account deletes the company as well: every job,
            timesheet, record and message in it, for everyone in it. The app asks you to type the
            company&rsquo;s name before it does. To keep the company running, add someone as Office
            first (Me &rsaquo; Your crew &rsaquo; Add someone), then delete your account.
          </P>
          <P>
            If you or your employer want data deleted or exported outside of that — for example
            because you&rsquo;ve left and want a copy of your own timesheets — contact your
            employer&rsquo;s office first, since they hold the account; Crewline can also be
            reached directly (see section 9) to action a request where the business can&rsquo;t.
          </P>
        </Section>

        <Section id="choices" title="6. Your choices">
          <Ul>
            <Li>
              <strong>Stopping the location reports.</strong> Location is only recorded while
              tracking is on and the app is open, so closing the app or locking your phone stops it
              straight away. While you are on the clock, &ldquo;CLOCK OUT&rdquo; also offers
              &ldquo;Just stop sending my location&rdquo;, which stops the reports without ending
              your shift. Stopping the reports does not clock you out: a shift that is already open
              stays open until the app reports again from somewhere else, or you tap &ldquo;END MY
              SHIFT NOW&rdquo;. Stopping during work hours will affect your recorded hours — talk to
              your office if you&rsquo;re unsure how a gap will be treated.
            </Li>
            <Li>
              <strong>Device permission.</strong> On an iPhone the app asks for location
              &ldquo;While Using the App&rdquo; only. You can change or withdraw it at any time in
              Settings &rsaquo; Proven &rsaquo; Location; leave Precise Location on, because an
              approximate location can&rsquo;t tell whether you are inside a job&rsquo;s boundary.
              Without the permission the app cannot check you are at a job, so it cannot clock you
              on, and you&rsquo;ll need to tell your office to record your hours another way.
            </Li>
            <Li>
              <strong>A shift that&rsquo;s wrong.</strong> If the record gets it wrong — a bad GPS
              fix, a missed clock-off — tell your office. Neither app can change a recorded shift
              yet, so the office contacts Crewline (section 9) to correct it.
            </Li>
          </Ul>
        </Section>

        <Section id="security" title="7. Where it’s stored and how it’s protected">
          <P>
            Crewline&rsquo;s database, sign-in and file storage are run by Supabase, which also
            sends the sign-up and password reset emails. The server functions that receive every
            location report, check it against the job boundaries and write your shifts run on
            Vercel, in Sydney; Vercel also serves the website. Every table holding location or
            shift data has row-level security enforced by the database itself, so even a bug in the
            app&rsquo;s own code cannot show one company&rsquo;s data to another, or a worker&rsquo;s
            location reports to anyone but them and their office staff. Location is only ever
            written for the account making the request — a worker&rsquo;s phone can report its own
            position and nothing else.
          </P>

          <H3>7.1 The outside services the app talks to</H3>
          <P>
            Besides Supabase and Vercel, which hold and process the data for Crewline as above, a
            few services outside Crewline receive something, and it is worth being precise about
            what reaches each one.
          </P>
          <Ul>
            <Li>
              <strong>Map images</strong> come from OpenFreeMap. When a map opens to place a
              job&rsquo;s boundary (on the website, or when the office adds a job in the app), your
              device asks that service for the map tiles covering that area. The request says which
              part of the world is on screen. It carries no account, no name, and none of your
              location reports.
            </Li>
            <Li>
              <strong>Address lookup</strong> uses OpenStreetMap&rsquo;s geocoder. When someone
              searches for a job&rsquo;s address, the address typed is sent to it to be turned into
              coordinates. It is sent by Crewline&rsquo;s own server rather than by the device, so
              nothing travels with the address but the address.
            </Li>
            <Li>
              <strong>Apple.</strong> On an iPhone your position comes from Apple&rsquo;s Location
              Services, and the app is installed from the App Store; Apple&rsquo;s own privacy policy
              covers both.
            </Li>
            <Li>
              <strong>Directions.</strong> Tapping a job&rsquo;s address in the app opens it in Apple
              Maps, and the website&rsquo;s Map link opens the job&rsquo;s spot in Google Maps. Each
              is sent that address or spot, and nothing else.
            </Li>
            <Li>
              <strong>Reading receipts.</strong> The app can read a photographed receipt (and draft
              a daily log) with Anthropic&rsquo;s Claude API, but that is switched off at the
              moment: nothing is sent to Anthropic, and those forms are filled in by hand. If it is
              ever switched on, this policy will say first exactly what is sent.
            </Li>
          </Ul>
          <P>
            None of these outside services is sent your location reports, your shifts or your chat
            messages. None is used for advertising, and none is given anything to build a profile
            from.
          </P>
        </Section>

        <Section id="appl" title="8. Australian Privacy Principles">
          <P>
            Crewline is designed to meet the Australian Privacy Principles under the{' '}
            <em>Privacy Act 1988</em> (Cth). Employee records held by an employer for employment
            purposes can, in some circumstances, sit outside the Act under the employee records
            exemption — Crewline does not rely on that exemption as a reason to say less here.
            Whether or not the exemption technically applies to a given business, the workers whose
            location this app records while it is open are entitled to know exactly what is
            collected, who sees it, and how long it&rsquo;s kept, and that is what this document
            sets out to do.
          </P>
          <P>
            If you believe your location or personal information has been mishandled, you can raise
            it with your employer&rsquo;s office first, and with Crewline directly using the
            details below. If you remain unsatisfied, you can complain to the Office of the
            Australian Information Commissioner (oaic.gov.au).
          </P>
        </Section>

        <Note>
          <strong style={{ color: theme.ink }}>Contact — section 9.</strong> Questions about this
          policy, or a request to access, correct or delete your data:{' '}
          <a href="mailto:privacy@crewline.app" style={{ color: theme.accent }}>
            privacy@crewline.app
          </a>
          . For anything about your specific pay, hours or employment, contact your
          employer&rsquo;s office directly — they hold your employment records and are best placed
          to act on them quickly.
        </Note>

        <Section id="changes" title="10. Changes to this policy">
          <P>
            If how Crewline collects or uses location data changes in a way that matters — a new
            kind of data, a new party who can see it, a change to how long it&rsquo;s kept — this
            document will be updated and the date at the top will change. Continuing to use
            Crewline after an update means you&rsquo;ve had the chance to read it; a change that
            affects what&rsquo;s tracked or who can see it will also be flagged in the app itself,
            not just here.
          </P>
        </Section>
      </div>
    </div>
  )
}
