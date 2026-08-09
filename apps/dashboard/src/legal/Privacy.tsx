import type { CSSProperties, ReactNode } from 'react'
import { theme, font } from '../theme'
import { Panel, PanelHead, Note, LABEL } from '../ui/kit'

/**
 * Renders PRIVACY.md (repo root) for the app itself — Apple requires a
 * privacy policy URL for every listing, and this one covers an app that
 * records precise location roughly every 20 seconds while tracking is on.
 *
 * The two files are meant to stay identical in substance. This is not a
 * markdown renderer pointed at that file — there is no fetch, no build step
 * that inlines it, and no dependency added to parse it — so a change to one
 * without the other is a silent drift. Whoever edits PRIVACY.md next must
 * edit this file in the same change, and vice versa. Nothing enforces that
 * automatically; this comment is the enforcement.
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
        <p style={updatedStyle}>Last updated 9 August 2026</p>

        <p style={introStyle}>
          Crewline is a workforce tracking app used by construction and trade businesses to run
          crews, timesheets and job sites. This policy explains what Crewline collects about you,
          why, who can see it, how long it is kept, and the choices you have — written for the
          person holding the phone, not for a lawyer.
        </p>
        <p style={introStyle}>
          If you are a worker using the Crewline app, your employer (the business that signed your
          company up to Crewline) is the one who decides to track hours this way and who your
          office staff are. Crewline is the software that makes it work, and stores the data on the
          business&rsquo;s behalf. Both are bound by this policy.
        </p>

        <Panel style={{ margin: '0 0 8px' }}>
          <PanelHead>The short version</PanelHead>
          <div style={{ padding: '13px 15px' }}>
            <Ul>
              <Li>
                While location tracking is switched on in the app, your phone reports your precise
                GPS position roughly <strong>every 20 seconds</strong> — including while
                you&rsquo;re driving to a job, before you&rsquo;ve clocked on, and on the drive
                home.
              </Li>
              <Li>
                Your office staff (the people who run your company&rsquo;s Crewline account) can
                see that location trail on a live map, for as long as it&rsquo;s kept.
              </Li>
              <Li>
                Location is what starts and stops your paid shift automatically: you don&rsquo;t
                clock yourself in or out, the app does it from where you are.
              </Li>
              <Li>
                You can turn tracking off at any time. Turning it off stops your hours from being
                recorded automatically — it does not clock you out or end a shift that&rsquo;s
                already open.
              </Li>
              <Li>
                Your location history isn&rsquo;t deleted when you leave the company. It&rsquo;s
                kept as part of your timesheet and employment record, the same as your hours and
                pay would be.
              </Li>
            </Ul>
          </div>
        </Panel>
        <P>The rest of this document sets out the detail behind each of those points.</P>

        <Section id="who" title="1. Who this policy covers">
          <P>Crewline has two kinds of user:</P>
          <Ul>
            <Li>
              <strong>Field workers</strong> — the people whose location is tracked to build
              timesheets.
            </Li>
            <Li>
              <strong>Office staff</strong> — the people at a construction business (owners,
              admins, and job-running &ldquo;crew captains&rdquo;) who use the Crewline dashboard
              to run the crew, approve hours, and see where people are.
            </Li>
          </Ul>
          <P>
            This policy is written primarily for field workers, because location tracking of an
            employee is the part of Crewline with the most at stake. It also covers what office
            staff can see and do with that data.
          </P>
        </Section>

        <Section id="collect" title="2. What Crewline collects">
          <H3>2.1 Precise location — the sensitive part</H3>
          <P>
            When you turn tracking on in the worker app, your phone sends your GPS coordinates to
            Crewline&rsquo;s server about every 20 seconds, for as long as tracking stays on. Each
            report (&ldquo;ping&rdquo;) includes:
          </P>
          <Ul>
            <Li>latitude and longitude, to full GPS precision</Li>
            <Li>the GPS accuracy radius reported by your phone, in metres</Li>
            <Li>the time of the report</Li>
          </Ul>
          <P>
            This happens on <strong>every</strong> ping, not just the ones near a job site — the
            drive to work, a stop at the supplier, the trip home, and any time you&rsquo;re not
            actually working but haven&rsquo;t turned tracking off, are all recorded the same way
            as time on site. Turning tracking on does not require you to be clocked in first:
            arriving inside a job site&rsquo;s boundary is what starts the clock, so tracking has
            to be running before that happens for the automatic clock-in to work at all.
          </P>
          <P>
            If you use the installed app (not a browser), tracking keeps running with your screen
            locked or the app in the background. Android and iOS both show an ongoing notification
            while this is happening, so it&rsquo;s never invisible — tapping it opens the app. In a
            browser, tracking stops the moment your screen locks or you switch apps.
          </P>
          <P>
            Each report is matched against your company&rsquo;s job site boundaries by the server.
            If you stay inside a site&rsquo;s boundary for two minutes, you&rsquo;re clocked in
            automatically; driving past one doesn&rsquo;t count. Leaving a site&rsquo;s boundary
            starts a similar timer before you&rsquo;re clocked out, so a trip to the truck for a
            tool doesn&rsquo;t end your shift. You can also tap &ldquo;Clock in manually&rdquo;
            while you&rsquo;re standing inside a site — this sends the same kind of location
            report, flagged as a deliberate request, and is still refused if you&rsquo;re not
            actually inside the boundary.
          </P>

          <H3>2.2 What&rsquo;s built from that location</H3>
          <P>From the raw pings above, Crewline derives and stores:</P>
          <Ul>
            <Li>
              <strong>Shifts</strong> — a start and finish time for each work period, the job site
              it was recorded at, and whether it came from the automatic geofence or was entered or
              corrected by a person. This is your timesheet.
            </Li>
            <Li>
              <strong>Geofence events</strong> — a log entry each time you&rsquo;re detected
              arriving at or leaving a site, including a &ldquo;drive-by&rdquo; entry if you passed
              a site without staying the required two minutes. This is the audit trail behind your
              timesheet, kept so a disputed shift can be checked against what actually happened.
            </Li>
            <Li>
              <strong>A short system message in the site&rsquo;s chat</strong> each time you clock
              in or out, visible to everyone assigned to that site&rsquo;s channel (your workmates
              on that job) — for example &ldquo;Sam clocked in at Lot 42 · 7:02am&rdquo;. This
              message states that you arrived or left; it does not show your GPS coordinates or the
              route you took.
            </Li>
          </Ul>

          <H3>2.3 Everything else</H3>
          <P>
            Crewline also holds the ordinary account and work information needed to run a crew:
            your name, trade, which company you work for, the photos and documents you upload
            against a job, chat messages you send, receipts you photograph, and — for office staff
            only — pay rates and commercial figures. This policy focuses on location because
            it&rsquo;s the most sensitive thing the app collects; it applies to your account data
            generally.
          </P>
        </Section>

        <Section id="why" title="3. Why we collect it">
          <P>
            Location is collected for one reason: to produce an accurate timesheet without you
            having to remember to tap a button. The geofence engine that decides when you&rsquo;re
            clocked in and out runs on Crewline&rsquo;s server, not on your phone, specifically so a
            manipulated or offline phone can&rsquo;t fabricate hours — which is also why the raw
            pings behind that decision are kept, not just the shift they produced.
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
              <strong>You</strong> can always see your own location, your own shifts, and your own
              event history.
            </Li>
            <Li>
              <strong>Office staff</strong> — the owners and admins who run your company&rsquo;s
              Crewline account — can see the live location and location trail of everyone in the
              company on a map, along with everyone&rsquo;s shifts and geofence event history. This
              is the access needed to run a crew and approve a timesheet, and it is the same access
              an office would have over paper timesheets or a swipe card, extended to cover how
              those timesheets are now built.
            </Li>
            <Li>
              <strong>Crew captains</strong>, where your company uses that role, can see and
              correct the start and finish times of people working on the specific jobs they run —
              the same as an office would for that job — but cannot see the live map trail or
              anyone&rsquo;s pay rate.
            </Li>
            <Li>
              <strong>Workmates assigned to the same job site</strong> see the short clock-in and
              clock-out chat messages described in 2.2, not your coordinates.
            </Li>
          </Ul>
          <P>
            Crewline&rsquo;s own staff do not routinely look at customer location data. It&rsquo;s
            accessed only to fix a fault reported by a customer, and only for as long as that
            takes.
          </P>
        </Section>

        <Section id="retention" title="5. How long it’s kept">
          <P>
            Different things are kept for very different lengths of time, and the difference
            matters most for the data that is most sensitive.
          </P>
          <P>
            <strong>Raw location pings are deleted after 3 days.</strong> The twenty-second
            breadcrumb trail — every coordinate, whether you were on a site or driving between
            them — is automatically removed once it is three days old. It exists to draw the live
            map and to work out when you arrived and left; once the shift it produced has been
            written, the trail itself has done its job. Nobody has to ask for this and nobody can
            switch it off.
          </P>
          <P>
            <strong>The shifts and geofence events it produced are kept.</strong> The times you
            clocked on and off are a pay record, and a business is required to keep those for
            seven years under the Fair Work Act. So the <em>conclusion</em> — you were at Lot 42
            from 7:04am to 3:12pm — outlives the minute-by-minute path that produced it.
          </P>
          <P>
            If you stop working for a company that uses Crewline, your timesheets are{' '}
            <strong>not</strong> deleted; they remain part of that company&rsquo;s employment
            records, the same as they would if kept on paper. Your account is deactivated so you
            can no longer sign in or be tracked.
          </P>
          <P>
            <strong>Deleting your account.</strong> You can delete your own account from inside
            the app, under Account. It takes effect immediately and cannot be undone. It removes
            your ability to sign in and deletes your remaining location data outright. It does not
            delete your timesheets: those belong to your employer&rsquo;s records and, under the
            Fair Work Act, have to be kept for seven years — so your name stays on the hours you
            actually worked, and nothing else. If you are the only owner of a company account,
            deletion is refused rather than allowed to orphan the company and everyone&rsquo;s
            records with it; make someone else an owner first.
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
              <strong>Turning tracking off.</strong> The worker app has a control to stop tracking
              at any time. This stops location reports immediately — it is honestly described in
              the app as &ldquo;stop sharing my location,&rdquo; not &ldquo;clock out.&rdquo; If
              you&rsquo;re still standing inside a site&rsquo;s boundary when you turn tracking
              off, any shift that&rsquo;s already open stays open until you turn tracking back on
              and the automatic clock-out logic can run, or until the office corrects it. Turning
              tracking off during work hours will affect your recorded hours — talk to your office
              if you&rsquo;re unsure how a gap will be treated.
            </Li>
            <Li>
              <strong>Device permission.</strong> Background tracking on your phone requires you to
              grant location permission, including &ldquo;Allow all the time&rdquo; on the
              installed app for tracking to survive the screen locking. You can change or withdraw
              this at any time in your phone&rsquo;s Settings; without it, Crewline cannot record
              your location at all, automatic clock-in stops working, and you&rsquo;ll need to tell
              your office to record your hours another way.
            </Li>
            <Li>
              <strong>Manual correction.</strong> If the geofence gets it wrong — a bad GPS fix, a
              missed clock-out — you can request a correction through the app, and your office (or,
              on their own jobs, a crew captain) can edit a shift. Edited shifts are marked as
              such, so the record shows a human changed it.
            </Li>
          </Ul>
        </Section>

        <Section id="security" title="7. Where it’s stored and how it’s protected">
          <P>
            Crewline&rsquo;s data is hosted with Supabase, on infrastructure in Australia where the
            specific project region supports it. Every table holding location or shift data has
            row-level security enforced by the database itself, so even a bug in the app&rsquo;s
            own code cannot show one company&rsquo;s data to another, or a field worker&rsquo;s
            colleague&rsquo;s raw location to someone who isn&rsquo;t office staff. Location is only
            ever written for the account making the request — a worker&rsquo;s phone can insert its
            own position and nothing else.
          </P>
        </Section>

        <Section id="appl" title="8. Australian Privacy Principles">
          <P>
            Crewline is designed to meet the Australian Privacy Principles under the{' '}
            <em>Privacy Act 1988</em> (Cth). Employee records held by an employer for employment
            purposes can, in some circumstances, sit outside the Act under the employee records
            exemption — Crewline does not rely on that exemption as a reason to say less here.
            Whether or not the exemption technically applies to a given business, the workers whose
            location this app records every 20 seconds are entitled to know exactly what is
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
