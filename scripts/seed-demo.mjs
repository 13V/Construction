#!/usr/bin/env node
/**
 * Demo account for App Review — seeded with the Simple design's own world.
 *
 *   node scripts/seed-demo.mjs        # keys from apps/dashboard/.env.local
 *
 * Apple's Guideline 2.1 requires working credentials for an app gated behind
 * a login, and a reviewer cannot make their own: signup needs a confirmed
 * email (DEPLOY.md explains why that has to stay on) and, even confirmed, a
 * brand new account lands in an empty tenant with nothing to look at. This
 * script builds one company that already has everything — and since the app
 * is a transcription of design/mobile/simple/Crewline-Simple.dc.html, the
 * world it seeds is the one that drawing draws: the same five jobs, the same
 * ten crew, the same claims, defects, flood-test hold and wage totals. Open
 * the app beside the drawing and they should tell the same story.
 *
 * The earlier demo world (Lot 22 Golden Grove / Semaphore Beach House) is
 * retired by this script, not deleted: sites archived, defects resolved,
 * crew deactivated, open shifts closed. Retired data stays queryable and
 * nothing on the Simple screens counts it.
 *
 * The one deliberate lie: "Regency Park Storage" — the drawn job that has
 * not started — sits at Apple Park, Cupertino, with an 800 m fence. The whole
 * app hangs off being INSIDE a geofence and every real site is in Adelaide,
 * 13,000 km from App Review. A reviewer standing in Cupertino is standing on
 * the one drawn job where "nobody is on site yet", so they can clock in and
 * watch the tracker work without bending any other number in the demo.
 *
 * The retired demo account demo@crewline.app is NOT resurrected here — its
 * password shipped inside a public JS bundle once (SHIP.md) and stays dead.
 *
 * Idempotent: everything is ensure-style. Day-anchored rows (today's open
 * shifts, today's bookings) are keyed to TODAY in Adelaide, so re-running on
 * a later day re-seeds that day's liveness — by design, a reviewer opening
 * the app weeks after this ran should still see a working day in motion.
 *
 * Users are minted through the admin API with the address pre-confirmed. The
 * PAT is needed to read the service_role key; neither is ever printed. The
 * demo PASSWORD is the one exception — it is meant to be handed to Apple.
 */

import { readFileSync, existsSync } from 'node:fs'

function fromEnvFile(key) {
  try {
    const url = new URL('../apps/dashboard/.env.local', import.meta.url)
    return readFileSync(url, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

/**
 * An unset secret in GitHub Actions arrives as an empty string, not as an
 * absent variable — and `??` passes an empty string straight through. Falling
 * back on falsy rather than nullish is what makes `env: SUPABASE_URL:
 * ${{ secrets.SUPABASE_URL }}` with no such secret harmless instead of
 * silently pointing the whole run at "".
 */
const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim() !== '')?.trim() ?? ''

const SB = pick(process.env.SUPABASE_URL, fromEnvFile('VITE_SUPABASE_URL'), 'https://vkpdlsxiporsmqlfjvjw.supabase.co')
const ANON = pick(process.env.SUPABASE_ANON_KEY, fromEnvFile('VITE_SUPABASE_ANON_KEY'))
const APP = pick(process.env.APP_URL, 'https://construction-opal-three.vercel.app')
const PAT = pick(process.env.SUPABASE_PAT, fromEnvFile('SUPABASE_PAT'))
const PROJECT = SB.replace(/^https:\/\//, '').split('.')[0]

if (!ANON || !PAT) {
  console.error('Need SUPABASE_ANON_KEY and SUPABASE_PAT — in the environment, or in apps/dashboard/.env.local.')
  process.exit(2)
}

/**
 * Hold the reseed while the app is in front of App Review.
 *
 * This script is not read-only. It closes every open shift on a site
 * (`ended_at=is.null` -> now) and re-anchors the whole world onto today, so a
 * reviewer signed into the demo account sees jobs, dates and open shifts
 * change between one session and the next, with nobody touching the phone.
 *
 * That is indistinguishable, from Apple's side of the glass, from a developer
 * altering what the reviewer can see — which is what guideline 5.6 is about.
 * Version 1.0 was rejected under 5.6 the day after this ran against the very
 * account named in the review notes.
 *
 * Delete scripts/.review-hold to resume. Do that only once the app is
 * approved, or once review is using an account this script does not touch.
 */
if (existsSync(new URL('./.review-hold', import.meta.url)) && !process.env.SEED_NEW_TENANT) {
  console.log('Reseed held: scripts/.review-hold exists (app is in App Review).')
  console.log('The demo world is deliberately frozen. Delete that file to resume.')
  console.log('To build a brand new tenant instead, set SEED_NEW_TENANT=1 with')
  console.log('DEMO_EMAIL, DEMO_PASSWORD and COMPANY_NAME — that writes somewhere else.')
  process.exit(0)
}

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'appreview@crewline.app'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Crewline-Review-2026!'
const COMPANY_NAME = process.env.COMPANY_NAME ?? 'Semaphore Tiling & Waterproofing'
const OWNER_NAME = process.env.OWNER_NAME ?? 'Marnie Sutcliffe'
const LEGAL_NAME = process.env.LEGAL_NAME ?? 'Semaphore Trades Pty. Ltd.'

const body = async (r) => {
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    return t.slice(0, 300)
  }
}

let serviceKey = null
async function service() {
  if (serviceKey) return serviceKey
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  })
  const keys = await r.json()
  serviceKey = (Array.isArray(keys) ? keys : []).find((k) => k.name === 'service_role')?.api_key
  if (!serviceKey) throw new Error('could not read the service_role key')
  return serviceKey
}

async function ensureUser(email, password) {
  const key = await service()
  const made = await fetch(`${SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  if (!made.ok) {
    const detail = await made.json().catch(() => ({}))
    const already = made.status === 422 || /already.*registered|already.*exists/i.test(detail?.msg ?? detail?.error_description ?? '')
    if (!already) throw new Error(`admin create failed: ${JSON.stringify(detail).slice(0, 200)}`)
  }
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const d = await r.json()
  if (!d.access_token) throw new Error(`sign-in failed: ${JSON.stringify(d).slice(0, 200)}`)
  const H = { Authorization: `Bearer ${d.access_token}`, apikey: ANON, 'Content-Type': 'application/json' }
  return {
    id: d.user.id,
    H,
    get: (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H }).then(body),
    post: (t, b) => fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }),
    patch: (t, q, b) => fetch(`${SB}/rest/v1/${t}?${q}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }),
  }
}

/** Look for a row matching filterQS first; only insert if nothing came back. */
async function ensureRow(client, table, filterQS, insertBody, label) {
  const existing = await client.get(table, filterQS)
  if (Array.isArray(existing) && existing.length > 0) return existing[0]
  const created = await body(await client.post(table, insertBody))
  const row = Array.isArray(created) ? created[0] : null
  if (!row) throw new Error(`could not create ${label}: ${JSON.stringify(created).slice(0, 300)}`)
  return row
}

// ---------------------------------------------------------- Adelaide clock

// The crew lives in Adelaide, so "today" and "7:00 am" mean Adelaide's, not
// the machine's. The offset is read from Intl so a re-run after the October
// DST switch still lands on the right wall-clock times.
const AD_TZ = 'Australia/Adelaide'
const adOffset = (() => {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: AD_TZ, timeZoneName: 'longOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value
  return part?.replace('GMT', '') || '+09:30'
})()
/** Adelaide's calendar date, offset by n days, as YYYY-MM-DD. */
const adDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toLocaleDateString('en-CA', { timeZone: AD_TZ })
}
/** An instant at Adelaide wall-clock time on today+offsetDays. */
const adAt = (offsetDays, hm) => `${adDay(offsetDays)}T${hm}${hm.length === 5 ? ':00' : ''}${adOffset}`

/** The next Monday on Adelaide's calendar, as YYYY-MM-DD. */
const nextMonday = () => {
  for (let i = 1; i <= 7; i++) {
    const probe = new Date(Date.now() + i * 86_400_000)
    if (probe.toLocaleDateString('en-AU', { timeZone: AD_TZ, weekday: 'short' }) === 'Mon') return adDay(i)
  }
  return adDay(7)
}
const fmtDay = (ymd) =>
  new Date(`${ymd}T12:00:00${adOffset}`).toLocaleDateString('en-AU', { timeZone: AD_TZ, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '')

/** End-of-month date for `monthsAgo` months back, as YYYY-MM-DD. */
const endOfMonthsAgo = (monthsAgo) => {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 0))
  return d.toISOString().slice(0, 10)
}

try {
  const boss = await ensureUser(DEMO_EMAIL, DEMO_PASSWORD)

  const bootRes = await fetch(`${APP}/api/bootstrap`, {
    method: 'POST',
    headers: boss.H,
    body: JSON.stringify({ companyName: COMPANY_NAME, name: OWNER_NAME }),
  })
  if (!bootRes.ok && bootRes.status !== 200) throw new Error(`bootstrap failed: HTTP ${bootRes.status} ${await bootRes.text()}`)

  const me = (await boss.get('workers', `select=id,company_id&auth_user_id=eq.${boss.id}`))[0]
  if (!me) throw new Error('bootstrap ran but the owner has no worker row — cannot continue')
  const companyId = me.company_id
  console.log(`company ${COMPANY_NAME} — ${companyId}`)

  // ------------------------------------------------- who we are on paper
  // A Certificate of Compliance names the entity that gave the warranty and
  // the licensed contractor who signed it, so this tenant needs both or the
  // document has a hole in its identity line.
  //
  // These are the DEMO company's, invented to match the demo company's name.
  // The real ABN and builders licence belong on the real tenant and are set
  // there — printing a live licence number on a made-up business's compliance
  // certificate would be a false record, whoever is reading it.
  const identity = {
    legal_name: LEGAL_NAME,
    // 51 824 753 556 passes the ATO's checksum, which the Business details
    // screen now checks — the old placeholder did not, so the demo showed
    // itself an invalid-ABN warning. This is the ATO's own documentation
    // example, not a real business.
    abn: '51824753556',
    licence_no: 'BLD 214477',
    certifier_name: OWNER_NAME,
  }
  const coUpd = await boss.patch('companies', `id=eq.${companyId}`, identity)
  if (!coUpd.ok) throw new Error(`company identity patch failed: HTTP ${coUpd.status} ${await coUpd.text()}`)

  // ------------------------------------- retire the pre-design demo world
  for (const oldName of ['Lot 22, Golden Grove', 'Semaphore Beach House Reno']) {
    const rows = await boss.get('job_sites', `select=id,status&company_id=eq.${companyId}&name=eq.${encodeURIComponent(oldName)}`)
    const site = Array.isArray(rows) ? rows[0] : null
    if (!site) continue
    if (site.status !== 'archived') await boss.patch('job_sites', `id=eq.${site.id}`, { status: 'archived' })
    await boss.patch('defects', `site_id=eq.${site.id}&status=in.(open,in_progress)`, { status: 'resolved' })
    await boss.patch('shifts', `site_id=eq.${site.id}&ended_at=is.null`, { ended_at: new Date().toISOString() })
  }
  for (const oldCrew of ['Jayden Hoad', 'Priya Nathan', 'Coby Anderson']) {
    await boss.patch('workers', `company_id=eq.${companyId}&name=eq.${encodeURIComponent(oldCrew)}`, { active: false })
  }

  // ------------------------------------------------------------- the crew
  // The drawing's ten people. Rates are chosen so hours × rate lands exactly
  // on the drawn wage totals (e.g. Sam: 300 h × $62 = $18,600).
  const CREW = [
    ['sam',    'Sam Bardsley', 'SB', 'Tiler',        'captain',  62],
    ['kyle',   'Kyle Petrov',  'KP', 'Tiler',        'employee', 58],
    ['tania',  'Tania Huynh',  'TH', 'Tiler',        'employee', 50],
    ['dev',    'Dev Mistry',   'DM', 'Apprentice',   'employee', 25],
    ['ben',    'Ben Oakes',    'BO', 'Waterproofer', 'employee', 49],
    ['nadia',  'Nadia Roche',  'NR', 'Tiler',        'employee', 50],
    ['joel',   'Joel Kearney', 'JK', 'Tiler',        'employee', 50],
    ['rob',    'Rob Tancred',  'RT', 'Tiler',        'captain',  54.5],
    ['priya',  'Priya Nandu',  'PN', 'Tiler',        'employee', 46],
    ['callum', 'Callum Fry',   'CF', 'Tiler',        'employee', 55],
  ]
  const crew = {}
  for (const [key, name, initials, trade, role, rate] of CREW) {
    crew[key] = await ensureRow(boss, 'workers', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent(name)}`, {
      company_id: companyId, name, initials, trade, role, is_office: false, active: true,
    }, `crew member (${name})`)
    // ensureRow matches on the name alone, so somebody already on the books
    // is left exactly as they were found — including deactivated. The demo is
    // a live tenant that App Review signs into and pokes, and "Your crew" now
    // has a Remove button on it; without this, one reviewer tapping Remove
    // would shrink the demo roster for every reviewer after them, and the
    // nightly refresh would faithfully preserve the damage. The seeded crew
    // are restored to what they are meant to be, every night.
    const restored = await boss.patch('workers', `id=eq.${crew[key].id}`, { active: true, role, trade, initials })
    if (!restored.ok) throw new Error(`crew restore (${name}): HTTP ${restored.status} ${await restored.text()}`)
    // PATCH, not ensure: schema_v24's backfill trigger creates an empty
    // worker_pay row the moment the worker lands, so "a row exists" proves
    // nothing about the rate being set.
    const paid = await boss.patch('worker_pay', `worker_id=eq.${crew[key].id}`, { rate })
    if (!paid.ok) throw new Error(`pay rate (${name}): HTTP ${paid.status} ${await paid.text()}`)
  }
  console.log(`crew: ${OWNER_NAME} (office) + ${CREW.length} on the tools`)

  // A second owner, so the demo cannot delete itself out of existence.
  //
  // App Review checks Guideline 5.1.1(v) by deleting the account they were
  // given, and a sole owner now takes the whole company with them — correct
  // behaviour for a one-person business, and a live self-destruct on the one
  // tenant every reviewer signs into. With somebody else holding the company,
  // the reviewer's deletion does exactly what it says on the tin and removes
  // their account alone; the jobs, certificates and crew survive for whoever
  // looks next, and the seed puts the login back.
  //
  // A bookkeeper is who a tiling business actually gives the second set of
  // office keys to, so that is who this is.
  const secondOwner = await ensureRow(boss, 'workers',
    `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Deb Ashworth')}`,
    { company_id: companyId, name: 'Deb Ashworth', initials: 'DA', trade: 'Bookkeeper', role: 'owner', active: true },
    'second owner (Deb Ashworth)')
  const ownerFixed = await boss.patch('workers', `id=eq.${secondOwner.id}`, { role: 'owner', active: true })
  if (!ownerFixed.ok) throw new Error(`second owner: HTTP ${ownerFixed.status} ${await ownerFixed.text()}`)

  // ------------------------------------------------------------- tickets
  // What each of them is licensed to do, shown on a job's Crew tab. Dates
  // are anchored to today so the demo always carries the same shape: mostly
  // current, Ben's EWP lapsed (he is the one on the Glenelg balcony), and
  // Kyle's white card a fortnight from expiry.
  const TICKETS = [
    ['sam',    'White Card',            null],
    ['sam',    'Working at Heights',    adDay(420)],
    ['sam',    'Confined Space',        adDay(96)],
    ['kyle',   'White Card',            adDay(14)],
    ['kyle',   'Working at Heights',    adDay(300)],
    ['tania',  'White Card',            null],
    ['tania',  'Silica Awareness',      adDay(540)],
    ['dev',    'White Card',            null],
    ['ben',    'White Card',            null],
    ['ben',    'Waterproofing Licence', adDay(610)],
    ['ben',    'EWP — under 11 m',      adDay(-38)],
    ['nadia',  'White Card',            null],
    ['nadia',  'First Aid',             adDay(210)],
    ['joel',   'White Card',            null],
    ['rob',    'White Card',            null],
    ['rob',    'Working at Heights',    adDay(180)],
    ['rob',    'Forklift (LF)',         adDay(880)],
    ['priya',  'White Card',            null],
    ['priya',  'Silica Awareness',      adDay(430)],
    ['callum', 'White Card',            null],
    ['callum', 'Working at Heights',    adDay(25)],
  ]
  for (const [key, name, expires] of TICKETS) {
    await ensureRow(boss, 'certifications',
      `select=id&worker_id=eq.${crew[key].id}&name=eq.${encodeURIComponent(name)}`,
      {
        company_id: companyId, worker_id: crew[key].id, name, expires_on: expires,
        restriction: name.startsWith('EWP')
          ? 'You cannot operate the scissor lift or work off the EWP until this is renewed.'
          : null,
      }, `ticket (${key}: ${name})`)
  }
  console.log(`tickets: ${TICKETS.length} across the crew`)

  // The captains carry a mobile, because a job's details are only useful if
  // the number is there. worker_profiles is self-write, plus office — which
  // this seed is, signed in as the owner.
  for (const [key, phone] of [['sam', '0421 776 305'], ['rob', '0438 902 114']]) {
    await ensureRow(boss, 'worker_profiles', `select=worker_id&worker_id=eq.${crew[key].id}`, {
      worker_id: crew[key].id, company_id: companyId, phone,
    }, `captain phone (${key})`)
  }

  // ------------------------------------------------------------ job sites
  // Addresses are written so the app's locale rule reproduces the drawing's
  // sub-lines verbatim: a suburb when it says something ("Prospect"), the
  // street when the job is named after its suburb ("18 Sandison Rd"), and
  // nothing when the address is just the job ("Glenelg Marina 3B").
  const startMon = nextMonday()
  // Colours are the drawing's own RAIL map — chosen, not hashed.
  const SITES = {
    lot42: {
      name: 'Lot 42, Kentish Ave', address: '42 Kentish Ave, Prospect SA 5082',
      job_type: 'Tiling', client_name: 'Kesselman Homes', status: 'active',
      lat: -34.8843, lng: 138.5946, radius_m: 150, colour: '#4C7FB8',
    },
    hallett: {
      name: 'Hallett Cove', address: '18 Sandison Rd, Hallett Cove SA 5158',
      job_type: 'Bathroom refit × 6', client_name: '', status: 'active',
      lat: -35.0777, lng: 138.5083, radius_m: 120, colour: '#5C8A63',
    },
    northgate: {
      name: 'Northgate Plaza', address: 'Food court, Northgate Plaza SA 5085',
      job_type: 'Floor tiling · Night works', client_name: '', status: 'active',
      lat: -34.8551, lng: 138.6253, radius_m: 200, colour: '#A5714A',
    },
    glenelg: {
      name: 'Glenelg Marina 3B', address: '12 Holdfast Promenade, Glenelg SA 5045',
      job_type: 'Balcony waterproofing · Level 3', client_name: '', status: 'active',
      lat: -34.9698, lng: 138.5090, radius_m: 120, colour: '#8B8375',
    },
  }
  const site = {}
  for (const [key, def] of Object.entries(SITES)) {
    site[key] = await ensureRow(boss, 'job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent(def.name)}`, {
      company_id: companyId, ...def,
    }, `job site (${def.name})`)
    // ensureRow never updates an existing row; the colour must land either way.
    await boss.patch('job_sites', `id=eq.${site[key].id}`, { colour: def.colour })
  }
  await boss.patch('job_sites', `id=eq.${site.lot42.id}`, { captain_id: crew.sam.id })
  await boss.patch('job_sites', `id=eq.${site.northgate.id}`, { captain_id: crew.rob.id })

  // Regency Park Storage — the drawn job that starts Monday, and the review
  // fence. If the old "App Review demo site" exists it is renamed in place so
  // its id (and any shifts a past reviewer left on it) survive; the Cupertino
  // coordinates are the point, so they are kept, not corrected.
  {
    const regencyDef = {
      name: 'Regency Park Storage', address: '9 Bellchambers Rd, Regency Park SA 5010',
      job_type: 'Epoxy & sealing', client_name: '', status: 'starting_soon',
      schedule_note: `Starts ${fmtDay(startMon)}`, colour: '#6E7B86',
    }
    const existing = await boss.get('job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Regency Park Storage')}`)
    if (Array.isArray(existing) && existing.length > 0) {
      site.regency = existing[0]
      await boss.patch('job_sites', `id=eq.${site.regency.id}`, { schedule_note: regencyDef.schedule_note, status: 'starting_soon', colour: regencyDef.colour })
    } else {
      const old = await boss.get('job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('App Review demo site')}`)
      if (Array.isArray(old) && old.length > 0) {
        await boss.patch('job_sites', `id=eq.${old[0].id}`, regencyDef)
        site.regency = old[0]
      } else {
        site.regency = await ensureRow(boss, 'job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent(regencyDef.name)}`, {
          company_id: companyId, ...regencyDef,
          lat: 37.3349, lng: -122.0090, radius_m: 800,
        }, 'job site (Regency Park Storage / review fence)')
      }
    }
  }

  // Every job reads as address + builder in the app, so every job has both.
  // Addresses are set at creation; these bring the builders up to date on a
  // world that was seeded before the app asked for them.
  for (const [key, builder, address] of [
    ['hallett',   'Ventura Group',              null],
    ['northgate', 'Northgate Retail Trust',     null],
    ['glenelg',   'Marina Living Developments', '12 Holdfast Promenade, Glenelg SA 5045'],
    ['regency',   'SA Storage Co',              '9 Bellchambers Rd, Regency Park SA 5010'],
  ]) {
    const patch = address ? { client_name: builder, address } : { client_name: builder }
    const r = await boss.patch('job_sites', `id=eq.${site[key].id}`, patch)
    if (!r.ok) throw new Error(`builder (${key}): HTTP ${r.status} ${await r.text()}`)
  }

  // -------------------------------------------------- builders + contracts
  const kesselman = await ensureRow(boss, 'builders', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Kesselman Homes')}`, {
    company_id: companyId, name: 'Kesselman Homes',
    abn: '81433201776', accounts_email: 'accounts@kesselmanhomes.example',
    phone: '08 8344 9010', address: '96 Churchill Rd, Prospect SA 5082',
    payment_terms_days: 30, default_retention_pct: 5,
  }, 'builder (Kesselman Homes)')

  // The builder's own person on the ground — the Scope tab's project details
  // read this, and it is who a tiler rings when the screed is not down.
  const marco = await ensureRow(boss, 'builder_contacts',
    `select=id&builder_id=eq.${kesselman.id}&name=eq.${encodeURIComponent('Marco Ferraro')}`,
    {
      company_id: companyId, builder_id: kesselman.id, name: 'Marco Ferraro',
      role: 'supervisor', mobile: '0412 345 678', email: 'marco@kesselmanhomes.example',
    }, 'builder contact (Marco)')
  await boss.patch('job_sites', `id=eq.${site.lot42.id}`, { supervisor_contact_id: marco.id, builder_id: kesselman.id })

  // The other two the client's project details screen names. A tiler rings
  // the supervisor about the slab and the contract administrator about the
  // variation, and they are rarely the same person.
  // Glenelg's builder, and its one person — the job details screen is where a
  // tiler finds out who to ring, so a job with a builder and no contact is a
  // screen with a hole in it.
  const marina = await ensureRow(boss, 'builders',
    `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Marina Living Developments')}`,
    { company_id: companyId, name: 'Marina Living Developments', payment_terms_days: 30 },
    'builder (Marina Living Developments)')
  await boss.patch('job_sites', `id=eq.${site.glenelg.id}`, { builder_id: marina.id })
  const elena = await ensureRow(boss, 'builder_contacts',
    `select=id&builder_id=eq.${marina.id}&name=eq.${encodeURIComponent('Elena Marsh')}`,
    {
      company_id: companyId, builder_id: marina.id, name: 'Elena Marsh',
      role: 'supervisor', mobile: '0433 908 771', email: 'elena@marinaliving.example',
    }, 'builder contact (Elena)')
  await boss.patch('job_sites', `id=eq.${site.glenelg.id}`, { supervisor_contact_id: elena.id })

  const KESSELMAN_PEOPLE = [
    ['Dana Whitlock', 'project_manager', '0407 118 224', 'dana@kesselmanhomes.example'],
    ['Priya Raman', 'contract_admin', '0428 663 190', 'priya@kesselmanhomes.example'],
  ]
  for (const [name, role, mobile, email] of KESSELMAN_PEOPLE) {
    await ensureRow(boss, 'builder_contacts',
      `select=id&builder_id=eq.${kesselman.id}&name=eq.${encodeURIComponent(name)}`,
      { company_id: companyId, builder_id: kesselman.id, name, role, mobile, email },
      `builder contact (${name})`)
  }

  // ------------------------------------------------------------- the scope
  // The tiling scope, as the client wants it read: tile selections settled,
  // everything downstream of them still waiting on a decision. Only the
  // settled line is written — an untouched line has no row and the app draws
  // it Required from its own template.
  await ensureRow(boss, 'selections',
    `select=id&site_id=eq.${site.lot42.id}&scope_key=eq.tiles`,
    {
      company_id: companyId, site_id: site.lot42.id, scope_key: 'tiles', sort: 0,
      name: 'Tile selections + Data', detail: 'Confirm tile selections and provide all relevant product data.',
      status: 'chosen', chosen: 'Sicily Grey 600×600 matt · Ensuites & Bath 2', chosen_at: adAt(-6, '09:20'),
    }, 'scope line (lot42 tiles)')

  // A note the next person on the job actually needs. Authored by the office,
  // because that is who this seed is signed in as — site_notes only lets you
  // write your own, which is the point of the policy.
  const ownerRow = await boss.get('workers', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent(OWNER_NAME)}`)
  const ownerId = Array.isArray(ownerRow) ? ownerRow[0]?.id : null
  await ensureRow(boss, 'site_notes',
    `select=id&site_id=eq.${site.lot42.id}&body=ilike.*strip drain*`,
    {
      company_id: companyId, site_id: site.lot42.id, author_id: ownerId,
      body: 'Marco says the strip drain in Ensuite 2 sits 8mm low against the screed. Check the fall before setting out the next row.',
    }, 'site note (lot42)')

  const CONTRACTS = [
    ['lot42',     176_400, kesselman.id, 'Lot 42 Kentish Ave — tiling & waterproofing'],
    ['hallett',    78_400, null,         'Hallett Cove — 6 bathroom refits, fixed price'],
    ['northgate', 206_400, null,         'Northgate Plaza food court — floor tiling, night works'],
    ['glenelg',    44_000, null,         'Glenelg Marina 3B — level 3 balcony membranes'],
    ['regency',    61_200, null,         'Regency Park Storage — epoxy floor & sealing'],
  ]
  for (const [key, sum, builderId, title] of CONTRACTS) {
    await ensureRow(boss, 'contracts', `select=id&site_id=eq.${site[key].id}`, {
      company_id: companyId, site_id: site[key].id, builder_id: builderId,
      contract_no: `CT-${key.toUpperCase()}`, title,
      contract_sum: sum, gst_inclusive: false, retention_pct: 5, payment_terms_days: 30,
      signed_on: endOfMonthsAgo(4),
      starts_on: key === 'regency' ? startMon : endOfMonthsAgo(4),
      status: 'active',
    }, `contract (${key})`)
  }

  // ------------------------------------------------------------ variations
  // Approved ones fold into job value (drawn: 184,600 = 176,400 + 8,200);
  // pending ones are the amber "with the builder" figures.
  const VARIATIONS = [
    ['L42-A1', 'lot42',     'Extra height to ensuite wall tiling',   8_200, 'approved'],
    ['NG-A1',  'northgate', 'Out-of-hours access levy',              6_500, 'approved'],
    ['GL-A1',  'glenelg',   'Additional upstand detail',             2_800, 'approved'],
    ['L42-V1', 'lot42',     'Extra 42 m² to alfresco',               8_600, 'pending_client'],
    ['L42-V2', 'lot42',     'Feature wall to Bath 2',                4_120, 'pending_client'],
    ['L42-V3', 'lot42',     'Re-set out after screed',               2_100, 'pending_client'],
    ['NG-V1',  'northgate', 'Zone C kept open Thursday night',       4_300, 'pending_client'],
    ['GL-V1',  'glenelg',   'Extra balcony B308 membrane',           2_150, 'pending_client'],
  ]
  for (const [no, key, description, cost, status] of VARIATIONS) {
    await ensureRow(boss, 'change_orders', `select=id&company_id=eq.${companyId}&co_no=eq.${no}`, {
      company_id: companyId, site_id: site[key].id, co_no: no, description,
      cost_impact: cost, status,
    }, `variation (${no})`)
  }

  // ---------------------------------------------------------------- claims
  // amount is the ex-GST claim (tax_amount stays 0), so claimed_ex sums to
  // the drawing's figures: 136,600 / 62,720 / 59,600 / 18,720.
  const CLAIMS = [
    ['lot42',     [[4, 52_400, 1], [3, 44_600, 2], [2, 28_300, 3], [1, 11_300, 4]]],
    ['hallett',   [[3, 26_400, 1], [2, 22_900, 2], [1, 13_420, 3]]],
    ['northgate', [[2, 38_200, 1], [1, 21_400, 2]]],
    ['glenelg',   [[2, 11_300, 1], [1, 7_420, 2]]],
  ]
  for (const [key, claims] of CLAIMS) {
    for (const [n, amount, monthsAgo] of claims) {
      const no = `${key.toUpperCase()}-C${n}`
      await ensureRow(boss, 'invoices', `select=id&company_id=eq.${companyId}&invoice_no=eq.${no}`, {
        company_id: companyId, site_id: site[key].id, invoice_no: no,
        client_name: key === 'lot42' ? 'Kesselman Homes' : '',
        period: `Claim ${n}`, issued_on: endOfMonthsAgo(monthsAgo),
        amount, tax_amount: 0, status: 'sent',
      }, `claim (${no})`)
    }
  }

  // ------------------------------------------------------ materials + hire
  // cost_code 'tiles' is what splits the drawn "Tile supply" row from
  // "Materials & hire". Every figure is the drawing's.
  const MATERIALS = [
    ['lot42', 'floor tile', 'Beaumont Tiles', 16_900, 'tiles'],
    ['lot42', 'Cementia Grey R11', 'Beaumont Tiles', 4_180, 'tiles'],
    ['lot42', 'Trims, spacers, wedges', null, 3_780, 'tiles'],
    ['lot42', 'Ardex screed & adhesive', null, 5_180, null],
    ['lot42', 'Silicone & sundries', null, 1_678, null],
    ['lot42', 'Mapei Ultracolor 114', null, 742, null],
    ['hallett', 'wall tile', 'Beaumont Tiles', 9_390, 'tiles'],
    ['hallett', 'units 4–6', 'Beaumont Tiles', 2_910, 'tiles'],
    ['hallett', 'Adhesive & grout', null, 3_782, null],
    ['northgate', 'Zone B porcelain', 'Tile Importer Co', 11_640, 'tiles'],
    ['northgate', 'Trims & movement joints', null, 2_180, 'tiles'],
    ['northgate', 'Adhesive & grout', null, 4_240, null],
    ['glenelg', 'Angle & trim stock', null, 820, 'tiles'],
    ['glenelg', 'Membrane & primer', null, 3_414, null],
    ['glenelg', 'Ardex WPM 300 · 4 kits', null, 1_486, null],
    ['regency', 'Sika epoxy primer & topcoat', null, 8_900, null, 'ordered'],
  ]
  for (const [key, name, supplier, cost, code, status] of MATERIALS) {
    await ensureRow(boss, 'materials', `select=id&site_id=eq.${site[key].id}&name=eq.${encodeURIComponent(name)}`, {
      company_id: companyId, site_id: site[key].id, name, supplier,
      quantity: 1, unit: 'ea', unit_cost: cost, cost_code: code,
      status: status ?? 'delivered', delivered_on: adDay(-7),
    }, `material (${key}: ${name})`)
  }

  const EXPENSES = [
    ['lot42', 'Scaffold hire', '3 weeks', 2_120],
    ['lot42', 'Bin & waste removal', null, 864],
    ['lot42', 'Kennards floor grinder', null, 396],
    ['hallett', 'Van & consumables', null, 1_300],
    ['hallett', 'Bunnings Trade', 'silicone, trims', 318],
    ['northgate', 'Coates Hire', 'lighting tower', 1_240],
    ['northgate', 'Traffic management', null, 1_000],
    ['glenelg', 'Access Hire scissor lift', null, 880],
  ]
  for (const [key, vendor, category, amount] of EXPENSES) {
    await ensureRow(boss, 'expenses', `select=id&site_id=eq.${site[key].id}&vendor=eq.${encodeURIComponent(vendor)}`, {
      company_id: companyId, site_id: site[key].id, vendor, category,
      amount, tax: 0, spent_on: adDay(-10), status: 'confirmed',
    }, `expense (${key}: ${vendor})`)
  }

  // The waterproofing subbie on Lot 42 — bought-in labour, so it lands in the
  // wages row the way the drawing lists it.
  const subbie = await ensureRow(boss, 'subcontractors', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Waterproofing subbie')}`, {
    company_id: companyId, name: 'Waterproofing subbie', trade: 'Waterproofing',
  }, 'subcontractor')
  await ensureRow(boss, 'subcontract_work', `select=id&site_id=eq.${site.lot42.id}&subcontractor_id=eq.${subbie.id}`, {
    company_id: companyId, site_id: site.lot42.id, subcontractor_id: subbie.id,
    worked_on: adDay(-14), quantity: 1, unit: 'item', rate: 3_400,
    note: 'Ensuites & bath membranes, supply and apply',
  }, 'subcontract work (lot42)')

  // --------------------------------------------------------------- defects
  for (const desc of [
    'Falls to the strip drain out of tolerance — ponding at the door end',
    'Hob tile face chipped during install, needs cutting out',
  ]) {
    await ensureRow(boss, 'defects', `select=id&site_id=eq.${site.lot42.id}&description=eq.${encodeURIComponent(desc)}`, {
      company_id: companyId, site_id: site.lot42.id, location: 'Ensuite 2',
      description: desc, raised_by_party: 'us', responsible: 'us', severity: 'major', status: 'open',
    }, 'defect (lot42)')
  }

  // --------------------------------------------------------- waterproofing
  // Glenelg is the drawn cautionary tale: two covered wet areas with no flood
  // test, which holds every claim on the job ("Needs you" / HELD UNTIL
  // SIGN-OFF). Lot 42's areas are the counter-example — tested, certified.
  const WP = [
    ['glenelg', 'Balcony B301', 'signed_off', true],
    ['glenelg', 'Balcony B302', 'signed_off', true],
    ['glenelg', 'Balcony B305', 'signed_off', false],
    ['glenelg', 'Balcony B306', 'complete', false],
    ['glenelg', 'Balcony B307', 'in_progress', false],
    ['lot42', 'Ensuite 1', 'signed_off', true],
    ['lot42', 'Ensuite 2', 'signed_off', true],
    ['lot42', 'Bath 1', 'signed_off', true],
    ['lot42', 'Laundry', 'complete', true],
  ]
  for (const [key, area, status, tested] of WP) {
    await ensureRow(boss, 'waterproofing', `select=id&site_id=eq.${site[key].id}&area=eq.${encodeURIComponent(area)}`, {
      company_id: companyId, site_id: site[key].id, area,
      product_name: 'Ardex WPM 300', substrate: key === 'glenelg' ? 'Concrete balcony slab' : 'Villaboard sheet flooring',
      primer: 'Ardex WPP primer', coats: 2, bond_breaker: true, angle_fillet: true,
      wall_height_mm: key === 'glenelg' ? 150 : 1800,
      started_on: adDay(-9), completed_on: status === 'in_progress' ? null : adDay(-2),
      flood_tested: tested, flood_test_on: tested ? adDay(-2) : status === 'in_progress' ? null : adDay(-1),
      flood_test_hours: tested ? 24 : null,
      installer_id: crew.ben.id, status,
    }, `waterproofing (${key}: ${area})`)
  }

  // -------------------------------------------------------------- progress
  // One overall assessment per job; the view averages unit-'%' areas, so
  // these read back exactly as 62 / 81 / 34 / 47.
  const PROGRESS = [['lot42', 62], ['hallett', 81], ['northgate', 34], ['glenelg', 47]]
  for (const [key, pct] of PROGRESS) {
    await ensureRow(boss, 'progress_entries', `select=id&site_id=eq.${site[key].id}&area=eq.Overall`, {
      company_id: companyId, site_id: site[key].id, area: 'Overall',
      unit: '%', pct_complete: pct, assessed_on: adDay(0), assessed_by: me.id,
    }, `progress (${key})`)
  }

  // -------------------------------------------------------------- bookings
  // Today and tomorrow, published, at the drawing's times. Start seconds
  // stagger the sites so the calendar card lists them in the drawn order.
  const BOOKINGS = [
    // day, siteKey, workers, start, end(+days), note
    [0, 'lot42', ['sam', 'kyle', 'tania'], '07:00:00', ['15:00', 0], 'Ensuite 2'],
    [0, 'hallett', ['nadia', 'joel'], '07:00:20', ['15:30', 0], 'Unit 5 set-out'],
    [0, 'glenelg', ['ben'], '07:00:40', ['14:00', 0], 'Balcony B306'],
    [0, 'northgate', ['rob', 'dev', 'priya', 'callum'], '21:30:00', ['05:30', 1], 'Zone B'],
    [1, 'lot42', ['sam', 'kyle', 'tania'], '07:00:00', ['15:00', 0], 'Ensuite 2'],
    [1, 'hallett', ['nadia', 'joel'], '07:00:20', ['15:30', 0], 'Unit 5'],
    [1, 'northgate', ['rob', 'dev', 'priya', 'callum'], '21:30:00', ['05:30', 1], 'Zone B'],
  ]
  for (const [day, key, workers, start, [end, endPlus], note] of BOOKINGS) {
    for (const [i, w] of workers.entries()) {
      const startsAt = adAt(day, start.slice(0, 6) + String(Number(start.slice(6)) + i).padStart(2, '0'))
      await ensureRow(boss, 'assignments',
        `select=id&site_id=eq.${site[key].id}&worker_id=eq.${crew[w].id}&starts_at=gte.${encodeURIComponent(adAt(day, '00:00'))}&starts_at=lt.${encodeURIComponent(adAt(day + 1, '00:00'))}`,
        {
          company_id: companyId, site_id: site[key].id, worker_id: crew[w].id,
          starts_at: startsAt, ends_at: adAt(day + endPlus, end), note, published: true,
        }, `booking (${key} +${day}d ${w})`)
    }
  }

  // ------------------------------------------------- the weeks of shifts
  // Closed shifts whose hours × rate reproduce the drawn wage totals to the
  // dollar (Sam: 37×8h + 4h = 300 h × $62 = $18,600). Day jobs run 7–3,
  // Northgate runs 9:30pm–5:30am. Seeded once per worker-and-site; weekends
  // are skipped so the history reads like a real timesheet.
  const HISTORY = [
    ['sam', 'lot42', 37, true], ['kyle', 'lot42', 37, true], ['tania', 'lot42', 38, false],
    ['dev', 'lot42', 34, false], ['dev', 'northgate', 34, false],
    ['ben', 'glenelg', 25, false],
    ['nadia', 'hallett', 39, true], ['joel', 'hallett', 36, true],
    ['rob', 'northgate', 25, false], ['priya', 'northgate', 25, false], ['callum', 'northgate', 17, true],
  ]
  const histRows = []
  for (const [w, key, fullDays, halfDay] of HISTORY) {
    const existing = await boss.get('shifts', `select=id&worker_id=eq.${crew[w].id}&site_id=eq.${site[key].id}&ended_at=not.is.null&limit=1`)
    if (Array.isArray(existing) && existing.length > 0) continue
    const night = key === 'northgate'
    let placed = 0
    const wanted = fullDays + (halfDay ? 1 : 0)
    for (let back = 2; placed < wanted && back < 120; back++) {
      const dow = new Date(`${adDay(-back)}T12:00:00${adOffset}`).toLocaleDateString('en-AU', { timeZone: AD_TZ, weekday: 'short' })
      if (dow === 'Sat' || dow === 'Sun') continue
      const half = halfDay && placed === wanted - 1
      histRows.push({
        company_id: companyId, worker_id: crew[w].id, site_id: site[key].id,
        started_at: night ? adAt(-back - 1, '21:30') : adAt(-back, '07:00'),
        // A night shift crosses midnight, so it ends on the NEXT calendar day
        // (-back), 8h after its 9:30pm start — or 4h after, on the half day.
        ended_at: night ? adAt(-back, half ? '01:30' : '05:30') : adAt(-back, half ? '11:00' : '15:00'),
        source: 'auto', approved_at: adAt(-back, '18:00'), approved_by: me.id,
      })
      placed++
    }
  }
  for (let i = 0; i < histRows.length; i += 200) {
    const res = await boss.post('shifts', histRows.slice(i, i + 200))
    if (!res.ok) throw new Error(`history shifts insert failed: HTTP ${res.status} ${await res.text()}`)
  }
  if (histRows.length) console.log(`seeded ${histRows.length} closed shifts of history`)

  // ------------------------------------------------------- today, on site
  // Close anything left open from earlier days at a believable time — its
  // own start plus eight hours, never "now". A shift closed at re-seed time
  // spans whole days, and shifts_no_overlap then rejects today's clock-ons.
  const stale = await boss.get('shifts', `select=id,started_at&company_id=eq.${companyId}&ended_at=is.null&started_at=lt.${encodeURIComponent(adAt(0, '00:00'))}`)
  for (const sh of Array.isArray(stale) ? stale : []) {
    await boss.patch('shifts', `id=eq.${sh.id}`, { ended_at: new Date(new Date(sh.started_at).getTime() + 8 * 3_600_000).toISOString() })
  }
  // Repair pass for rows an earlier run closed at "now": anything absurdly
  // long gets re-closed at start plus eight hours.
  const recent = await boss.get('shifts', `select=id,started_at,ended_at&company_id=eq.${companyId}&ended_at=not.is.null&started_at=gte.${encodeURIComponent(adAt(-8, '00:00'))}`)
  for (const sh of Array.isArray(recent) ? recent : []) {
    const span = new Date(sh.ended_at).getTime() - new Date(sh.started_at).getTime()
    if (span > 16 * 3_600_000) {
      await boss.patch('shifts', `id=eq.${sh.id}`, { ended_at: new Date(new Date(sh.started_at).getTime() + 8 * 3_600_000).toISOString() })
    }
  }
  // Then clock the drawn crew on at the drawn times. Northgate's night crew
  // "start" tonight — a future start renders as booked-tonight, exactly how
  // the drawing tells the day.
  const ON_NOW = [
    ['sam', 'lot42', '06:52'], ['kyle', 'lot42', '06:58'], ['tania', 'lot42', '07:04'],
    ['nadia', 'hallett', '07:06'], ['joel', 'hallett', '07:09'],
    ['ben', 'glenelg', '07:14'],
    ['rob', 'northgate', '21:32'], ['dev', 'northgate', '21:35'],
    ['priya', 'northgate', '21:36'], ['callum', 'northgate', '21:48'],
  ]
  for (const [w, key, hm] of ON_NOW) {
    await ensureRow(boss, 'shifts',
      `select=id&worker_id=eq.${crew[w].id}&ended_at=is.null&started_at=gte.${encodeURIComponent(adAt(0, '00:00'))}`,
      { company_id: companyId, worker_id: crew[w].id, site_id: site[key].id, started_at: adAt(0, hm), source: 'auto' },
      `open shift (${w})`)
  }

  /**
   * A blank PDF page and the handful of operators worth having on it.
   *
   * A PDF is a few objects and a byte-offset table, so the seed writes its own
   * rather than take a dependency for demo paperwork — the same reasoning as
   * apps/dashboard/src/data/pdf.ts, which does this for documents that go to
   * a builder.
   */
  function pdfPage(W, H) {
    // WinAnsi carries the punctuation a keyboard produces, but not at the
    // Unicode code points — and a latin1 Buffer truncates the difference to a
    // control character, which is how an em dash became a blank space.
    const WINANSI = {
      '—': '\x97', '–': '\x96', '‘': '\x91', '’': '\x92',
      '“': '\x93', '”': '\x94', '…': '\x85', '•': '\x95',
    }
    const esc = (t) => String(t)
      .replace(/[–—‘’“”…•]/g, (c) => WINANSI[c])
      .replace(/[\\()]/g, (c) => `\\${c}`)
    const put = []
    const api = {
      line: (x1, y1, x2, y2, w = 1, g = 0) => put.push(`q ${g} G ${w} w ${x1} ${y1} m ${x2} ${y2} l S Q`),
      rect: (x, y, w, h, lw = 1, g = 0) => put.push(`q ${g} G ${lw} w ${x} ${y} ${w} ${h} re S Q`),
      text: (t, x, y, size = 10, bold = false, g = 0) =>
        put.push(`BT /${bold ? 'HB' : 'H'} ${size} Tf ${g} g ${x} ${y} Td (${esc(t)}) Tj ET`),
      raw: (op) => put.push(op),
      // Helvetica has no width table here, and none is needed: centring a
      // stamp and a label is all the estimate is used for.
      wide: (t, size, bold) => t.length * size * (bold ? 0.58 : 0.52),
      mid: (t, cx, y, size, bold = false, g = 0) =>
        api.text(t, cx - api.wide(t, size, bold) / 2, y, size, bold, g),
      bytes: () => {
        const stream = put.join('\n')
        const objs = [
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /H 5 0 R /HB 6 0 R >> >> /Contents 4 0 R >>`,
          `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
        ]
        let out = '%PDF-1.4\n'
        const offsets = []
        objs.forEach((o, i) => {
          offsets.push(out.length)
          out += `${i + 1} 0 obj\n${o}\nendobj\n`
        })
        const xref = out.length
        out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
        for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
        out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
        return Buffer.from(out, 'latin1')
      },
    }
    return api
  }

  /**
   * A stand-in document that says what it is.
   *
   * Everything the seed uploads that is not a photo or a drawing — a data
   * sheet, a warranty, a builder's programme — is demo paperwork. Every one of
   * them used to be the same six-line stub carrying one warranty's text, so a
   * programme opened and said "Mapei product warranty". A page that carries
   * its own title is barely more code and stops the demo contradicting itself.
   */
  function stubPdf(title, lines = []) {
    const p = pdfPage(595, 842)
    p.rect(40, 40, 515, 762, 0.6, 0.7)
    p.text(COMPANY_NAME.toUpperCase(), 64, 748, 12, true)
    p.text('Wall & floor tiling · waterproofing · Adelaide SA', 64, 732, 8.5, false, 0.45)
    p.line(64, 720, 531, 720, 0.8, 0.5)

    // Titles run long — a document name is a sentence, not a label.
    let y = 676
    const words = String(title).split(/\s+/)
    let row = ''
    for (const w of words) {
      if (row && p.wide(`${row} ${w}`, 17, true) > 452) { p.text(row, 64, y, 17, true); y -= 24; row = w }
      else row = row ? `${row} ${w}` : w
    }
    if (row) { p.text(row, 64, y, 17, true); y -= 24 }

    y -= 14
    for (const l of lines) {
      if (l) p.text(l, 64, y, 10, false, 0.2)
      y -= 16
    }

    p.line(64, 96, 531, 96, 0.8, 0.5)
    p.text('DEMONSTRATION DOCUMENT — not a real certificate, data sheet or programme.', 64, 78, 8.5, false, 0.5)
    p.text('Crewline demo account · the file itself is a placeholder; everything around it is not.', 64, 64, 8.5, false, 0.5)
    return p.bytes()
  }

  /** PUT an object into a storage bucket as the signed-in owner. */
  async function putObject(path, bytes, contentType) {
    const r = await fetch(`${SB}/storage/v1/object/site-files/${path}`, {
      method: 'POST',
      headers: { Authorization: boss.H.Authorization, apikey: ANON, 'Content-Type': contentType, 'x-upsert': 'true' },
      body: bytes,
    })
    if (!r.ok && r.status !== 409) throw new Error(`storage put failed (${path}): HTTP ${r.status} ${await r.text()}`)
    return path
  }

  // ------------------------------------------------------- the photo library
  // Real bytes for every photo record. The rows used to carry demo/... paths
  // that resolved to nothing — deliberate when the grid was a drawing
  // transcription, a defect once tapping a tile opened a real viewer on a
  // file that does not exist. These are generated images (scripts/
  // demo-photos): tiled walls, membrane coats, a screeded fall — synthetic,
  // but they read as site photos in a grid, which is their whole job.
  // Storage reads require the company id as the first path segment
  // (supabase/storage.sql), so every upload goes under companyId/siteId/.
  const photoLib = Object.fromEntries(
    ['subway-white', 'subway-sage', 'floor-grey-600', 'floor-oak-plank', 'floor-terrazzo',
     'wall-half-done', 'mosaic-blue', 'floor-charcoal', 'membrane-blue', 'membrane-grey',
     'screed-fall', 'bath-hob', 'ticket-card',
    ].map((n) => [n, readFileSync(new URL(`./demo-photos/${n}.jpg`, import.meta.url))]),
  )
  /** Pick an image that suits the caption, cycling within each family. */
  const photoFor = (caption, i) => {
    const c = (caption ?? '').toLowerCase()
    const pick = (...names) => names[i % names.length]
    if (/membrane|primer|flood|upstand/.test(c)) return pick('membrane-blue', 'membrane-grey')
    if (/screed|slab|joint|fall/.test(c)) return pick('screed-fall', 'floor-grey-600')
    if (/hob|ensuite|bath|drain|laundry/.test(c)) return pick('bath-hob', 'subway-white', 'mosaic-blue')
    if (/set out|setout/.test(c)) return pick('wall-half-done', 'floor-grey-600')
    if (/grout|handover|complete/.test(c)) return pick('floor-terrazzo', 'floor-charcoal', 'floor-oak-plank')
    return pick('subway-white', 'floor-grey-600', 'wall-half-done', 'floor-charcoal', 'subway-sage', 'floor-oak-plank')
  }


  // ---------------------------------------------------------------- photos
  // Captioned rows, each backed by a real object from the photo library —
  // the grid, the tap into the viewer and the share sheet all work on them.
  const PHOTOS = [
    ['lot42', 0, ['Ensuite 2 · falls', 'Ensuite 2', 'Hob detail', '', 'Strip drain', '']],
    ['lot42', -1, ['Bath 1 · membrane', '', 'Flood test', '', '', 'Laundry', '', '', '']],
    ['hallett', 0, ['Unit 4 · grout', 'Unit 4', '', 'Unit 5 · set out', '']],
    ['hallett', -4, ['Unit 3 · handover', '', '', 'Unit 3', '', '']],
    ['northgate', -1, ['Zone B · set out', '', 'Zone B', '', 'Expansion joint', '']],
    ['northgate', -2, ['Zone A · complete', '', '']],
    ['glenelg', 0, ['B305 · membrane', 'B305', '', 'B306 · primer']],
    ['glenelg', -5, ['B301 – 304', '', '', 'Upstand detail', '']],
    ['regency', -8, ['Bay 1 · slab', '', 'Existing joint', '', 'Bay 3', '']],
  ]
  // One existence check per SITE (not per group) — a site's second day of
  // photos must not be skipped just because its first day landed.
  const photoSites = [...new Set(PHOTOS.map(([key]) => key))]
  for (const key of photoSites) {
    const have = await boss.get('site_files', `select=id&site_id=eq.${site[key].id}&kind=eq.photo&limit=1`)
    if (Array.isArray(have) && have.length > 0) continue
    const rows = []
    for (const [, day, captions] of PHOTOS.filter(([k]) => k === key)) {
      for (const [i, caption] of captions.entries()) {
        const bytes = photoLib[photoFor(caption, i)]
        const path = `${companyId}/${site[key].id}/demo-photo-${adDay(day)}-${i + 1}.jpg`
        await putObject(path, bytes, 'image/jpeg')
        rows.push({
          company_id: companyId, site_id: site[key].id, uploaded_by: me.id,
          kind: 'photo', storage_path: path, size_bytes: bytes.length,
          name: `photo-${adDay(day)}-${i + 1}.jpg`, mime: 'image/jpeg', category: 'progress',
          caption: caption || null, taken_at: adAt(day, `${String(7 + (i % 8)).padStart(2, '0')}:${String(10 + i * 5).padStart(2, '0')}`),
        })
      }
    }
    const res = await boss.post('site_files', rows)
    if (!res.ok) throw new Error(`photos insert failed (${key}): HTTP ${res.status} ${await res.text()}`)
  }

  // A demo that already ran carries rows pointing at demo/... paths from
  // before photos had bytes behind them. Repair them in place — the captions
  // and timestamps on those rows are load-bearing, so they are patched, not
  // re-seeded.
  const orphanPhotos = await boss.get('site_files', `select=id,site_id,caption&storage_path=like.demo/*&kind=eq.photo`)
  if (Array.isArray(orphanPhotos) && orphanPhotos.length > 0) {
    for (const [i, row] of orphanPhotos.entries()) {
      const bytes = photoLib[photoFor(row.caption, i)]
      const path = `${companyId}/${row.site_id}/demo-photo-repair-${i + 1}.jpg`
      await putObject(path, bytes, 'image/jpeg')
      const upd = await boss.patch('site_files', `id=eq.${row.id}`, { storage_path: path, size_bytes: bytes.length })
      if (!upd.ok) throw new Error(`photo repair failed: HTTP ${upd.status} ${await upd.text()}`)
    }
    console.log(`photos: backed ${orphanPhotos.length} placeholder rows with real images`)
  }

  // Ticket photos — the office account gets a photographed White Card so the
  // My Documents thumbnail, the viewer and the share path all demonstrate.
  {
    const cardPath = `${companyId}/tickets/demo-white-card.jpg`
    await putObject(cardPath, photoLib['ticket-card'], 'image/jpeg')
    await ensureRow(boss, 'certifications',
      `select=id&worker_id=eq.${me.id}&name=eq.${encodeURIComponent('White Card')}`,
      { company_id: companyId, worker_id: me.id, name: 'White Card', expires_on: null, document_path: cardPath },
      'ticket (office: White Card)')
    const bare = await boss.get('certifications', `select=id&or=(document_path.is.null,document_path.like.demo/*)&worker_id=eq.${me.id}`)
    for (const row of Array.isArray(bare) ? bare : []) {
      await boss.patch('certifications', `id=eq.${row.id}`, { document_path: cardPath })
    }
  }

  // -------------------------------------------------- waterproofing packages
  // The six-step record a Certificate of Compliance is issued from, seeded as
  // the two ends of the same story:
  //
  //   Glenelg  the membrane is on and the flood test is not done, so the
  //            Overview card is red and nothing on the job can be claimed
  //   Lot 42   tested, signed, photographed — everything but the certificate,
  //            which is one tap away
  //
  // Files are uploaded for real rather than pointed at dangling paths: the
  // thumbnails on these steps are the evidence, and a broken image would
  // misrepresent what the app does.
  const WP_PKGS = [
    ['glenelg', {
      product_internal: 'Mapei Mapelastic AquaDefense',
      product_external: 'Mapei Mapelastic Smart',
      installed_on: adDay(-2),
      installed_by: 'Proven Tiling Solutions',
      // Booked, not held. flood_test_result stays 'not_completed', which is
      // what makes this the outstanding item.
      flood_test_on: adDay(-1),
      scope_of_work: 'waterproofing to balconies B301 - B307',
      warranty_years: 2,
    }],
    ['lot42', {
      product_internal: 'Mapei Mapelastic AquaDefense',
      product_external: 'Mapei Mapelastic Smart',
      installed_on: adDay(-9),
      installed_by: 'Proven Tiling Solutions',
      flood_test_on: adDay(-2),
      flood_test_result: 'pass',
      flood_test_hours: 24,
      builder_signed_name: 'Marco Ferraro',
      builder_signed_at: adAt(-1, '15:20'),
      completion_on: adDay(-2),
      scope_of_work: 'waterproofing to ensuite 1 + ensuite 2 + bath 1 + laundry',
      warranty_years: 2,
    }],
  ]

  // The paperwork side of a waterproofing package is a data sheet and a
  // warranty, and a demo that shows the same warranty text under both names
  // undoes the point of showing them at all.
  const WP_DOC_TITLES = {
    'mapelastic-aquadefense-tds.pdf': 'Mapelastic AquaDefense — technical data sheet',
    'mapelastic-smart-tds.pdf': 'Mapelastic Smart — technical data sheet',
    'mapei-product-warranty.pdf': 'Mapei product warranty',
  }
  const WP_DOC_LINES = {
    'mapelastic-aquadefense-tds.pdf': [
      'Ready-to-use liquid membrane for waterproofing under tiles,',
      'internal and external, to AS 4654.2.',
      '',
      'Coverage       0.7 – 0.8 kg/m² per coat, two coats',
      'Drying         30 – 60 minutes between coats at 23 °C',
      'Tile after     4 hours',
      'Batch          AQ-2417-B',
    ],
    'mapelastic-smart-tds.pdf': [
      'Two-component flexible cementitious membrane for balconies,',
      'terraces and areas subject to movement.',
      '',
      'Mix ratio      Component A 20 kg : Component B 10 kg',
      'Coverage       1.6 kg/m² per mm of thickness',
      'Crack bridging 2 mm at 23 °C',
      'Batch          MS-1180-A',
    ],
    'mapei-product-warranty.pdf': [
      'Product warranty for the membrane system installed at',
      'Lot 42, Kentish Avenue — ensuite 1, ensuite 2, bath 1, laundry.',
      '',
      'Term           10 years from the date of installation',
      'Conditions     installed by a Mapei-registered applicator to the',
      '               published data sheet, flood tested and documented.',
    ],
  }

  const WP_FILES = [
    // key, step, kind, category, filename
    ['glenelg', 'products', 'document', null, 'mapelastic-aquadefense-tds.pdf'],
    ['glenelg', 'products', 'document', null, 'mapelastic-smart-tds.pdf'],
    ['glenelg', 'install', 'photo', null, 'b305-membrane-first-coat.jpg'],
    ['glenelg', 'install', 'photo', null, 'b305-upstand-150.jpg'],
    ['glenelg', 'install', 'photo', null, 'b306-angle-fillet.jpg'],
    ['lot42', 'products', 'document', null, 'mapelastic-aquadefense-tds.pdf'],
    ['lot42', 'install', 'photo', null, 'ensuite-1-membrane.jpg'],
    ['lot42', 'install', 'photo', null, 'ensuite-2-membrane.jpg'],
    ['lot42', 'install', 'photo', null, 'bath-1-hob-detail.jpg'],
    ['lot42', 'install', 'photo', null, 'laundry-membrane.jpg'],
    ['lot42', 'flood_test', 'photo', null, 'ensuite-1-flood-test-24h.jpg'],
    ['lot42', 'flood_test', 'photo', null, 'bath-1-flood-test-24h.jpg'],
    ['lot42', 'certificates', 'document', 'supplier_warranty', 'mapei-product-warranty.pdf'],
  ]

  const wpPkg = {}
  for (const [key, values] of WP_PKGS) {
    wpPkg[key] = await ensureRow(boss, 'waterproofing_packages',
      `select=id&site_id=eq.${site[key].id}`,
      { company_id: companyId, site_id: site[key].id, created_by: me.id, ...values },
      `waterproofing package (${key})`)
    // ensureRow only inserts, so an existing record is brought up to date here
    // — otherwise a re-run would leave last week's state on screen.
    const upd = await boss.patch('waterproofing_packages', `id=eq.${wpPkg[key].id}`, values)
    if (!upd.ok) throw new Error(`wp package patch failed (${key}): HTTP ${upd.status} ${await upd.text()}`)
  }

  for (const [idx, [key, step, kind, category, filename]] of WP_FILES.entries()) {
    const pkgId = wpPkg[key].id
    const isPhoto = kind === 'photo'
    const path = `${companyId}/${site[key].id}/demo-wp-${step}-${filename}`
    // Upsert the bytes even when the row already exists — an earlier seed
    // wrote 1x1 JPEGs here, which render as broken images, and overwriting
    // the object fixes every existing row without touching it.
    const bytes = isPhoto ? photoLib[photoFor(filename, idx)] : stubPdf(WP_DOC_TITLES[filename] ?? filename, WP_DOC_LINES[filename] ?? [])
    await putObject(path, bytes, isPhoto ? 'image/jpeg' : 'application/pdf')
    const have = await boss.get('site_files',
      `select=id&waterproofing_package_id=eq.${pkgId}&name=eq.${encodeURIComponent(filename)}&limit=1`)
    if (Array.isArray(have) && have.length > 0) {
      // The bytes behind an existing row just changed size.
      const upd = await boss.patch('site_files', `id=eq.${have[0].id}`, { size_bytes: bytes.length })
      if (!upd.ok) throw new Error(`wp file patch failed (${key}/${filename}): HTTP ${upd.status} ${await upd.text()}`)
      continue
    }
    const res = await boss.post('site_files', [{
      company_id: companyId, site_id: site[key].id, waterproofing_package_id: pkgId, wp_step: step,
      uploaded_by: me.id, kind, category, storage_path: path, name: filename,
      mime: isPhoto ? 'image/jpeg' : 'application/pdf',
      size_bytes: bytes.length,
    }])
    if (!res.ok) throw new Error(`wp file insert failed (${key}/${filename}): HTTP ${res.status} ${await res.text()}`)
  }

  const SHEET_NOTES = {
    'Tile layout': [
      'Tile setout from the centreline of each room unless',
      'noted otherwise. Cuts to be equal at opposing walls',
      'and no cut less than one third of a tile.',
      '',
      'Movement joints at 4.5 m centres, at all internal',
      'corners and over structural joints — AS 3958.1.',
      '',
      'Adhesive: C2S1 to AS ISO 13007 over primed and',
      'levelled substrate. Grout to schedule.',
    ],
    'Bathroom setout': [
      'Set out from the finished face of the wall lining.',
      'Confirm fixture positions against the hydraulic',
      'drawings before any waterproofing is applied.',
      '',
      'Floor waste centred in the shower area, falls to be',
      '1:80 minimum over the whole graded area.',
      '',
      'Hob height 100 mm above the finished floor level;',
      'membrane to turn up 150 mm minimum at all walls.',
    ],
    'Balcony waterproofing': [
      'Membrane to AS 4654.2 over the full slab, turned up',
      '150 mm at walls and dressed into the drainage outlet.',
      '',
      'Falls 1:80 minimum to the outlet, verified with a',
      'level before the screed is closed in.',
      '',
      'Perimeter angle and bond breaker at all junctions.',
      'Flood test 24 hours and photograph before tiling.',
    ],
  }

  /**
   * A drawing sheet that looks like a drawing sheet.
   *
   * Every seeded document used to be the same six-line stub, which was
   * invisible while drawings opened on a broken-image icon and became the
   * first thing you read the moment the viewer started rendering PDFs — a
   * sheet titled "L01 - Tile layout" whose contents said "Mapei product
   * warranty". A reviewer tapping a drawing is entitled to see a drawing.
   *
   * A3 landscape with a border, a title block in the corner where a drawing
   * office puts one, a notes panel, and enough linework to read as a floor
   * plan at a glance. Written by hand for the same reason data/pdf.ts is: a
   * PDF is a few objects and a byte-offset table, and that is cheaper than a
   * dependency.
   */
  function drawingPdf({ sheetName, level, revision, project, address, revisions, superseded }) {
    const W = 1191, H = 842 // A3 landscape, points
    const { line, rect, text, raw, wide, mid, bytes } = pdfPage(W, H)

    rect(24, 24, W - 48, H - 48, 2)
    rect(34, 34, W - 68, H - 68, 0.6, 0.6)

    // Header strip: the two facts a foreman checks before reading anything.
    line(50, 762, W - 50, 762, 0.8, 0.5)
    text(project, 50, 774, 12, true)
    text(address, 50 + wide(project, 12, true) + 16, 774, 9.5, false, 0.45)
    text(`${sheetName}   ·   REV ${revision}`, W - 50 - wide(`${sheetName}   ·   REV ${revision}`, 10, true), 774, 10, true, 0.3)

    // The plan sits left of the title block, not through it.
    const px = 90, py = 150, pw = 620, ph = 580
    const mx = px + 240      // the wet rooms are the left bay
    const ly = py + 330      // left bay split
    const ry = py + 300      // right bay split
    rect(px, py, pw, ph, 1.6)
    line(mx, py, mx, py + ph, 1.2)
    line(px, ly, mx, ly, 1.2)
    line(mx, ry, px + pw, ry, 1.2)

    // The hatch is the graded, membraned, tiled area — the thing every one of
    // these three sheet kinds is actually about.
    for (let gx = px + 10; gx < mx - 8; gx += 24) line(gx, py + 370, gx, py + ph - 42, 0.4, 0.72)
    for (let gy = py + 370; gy < py + ph - 42; gy += 24) line(px + 10, gy, mx - 10, gy, 0.4, 0.72)
    // The floor waste, and the falls that run to it.
    const wx = (px + mx) / 2, wy = py + 450
    raw(`q 0.45 G 1 w ${wx - 9} ${wy} m ${wx + 9} ${wy} l S ${wx} ${wy - 9} m ${wx} ${wy + 9} l S Q`)
    rect(wx - 12, wy - 12, 24, 24, 0.8, 0.45)

    const kind = sheetName.replace(/^L\d+ - /, '')
    text(kind === 'Balcony waterproofing' ? 'BALCONY SLAB' : 'WET AREA', px + 14, py + ph - 26, 11, true, 0.3)
    text('FALL 1:80 TO WASTE', px + 14, py + 346, 8.5, false, 0.45)
    text('ENSUITE', px + 14, ly - 30, 11, true, 0.3)
    text(kind === 'Balcony waterproofing' ? 'THRESHOLD' : 'LIVING', mx + 14, py + ph - 26, 11, true, 0.3)
    text(kind === 'Balcony waterproofing' ? 'SLAB EDGE' : 'BALCONY', mx + 14, ry - 24, 11, true, 0.3)

    // Dimension run under the plan, with the figures clear of the line.
    line(px, py - 40, px + pw, py - 40, 0.8, 0.45)
    for (const dx of [px, mx, px + pw]) line(dx, py - 34, dx, py - 46, 0.8, 0.45)
    mid('2400', (px + mx) / 2, py - 34, 8.5, false, 0.45)
    mid('3800', (mx + px + pw) / 2, py - 34, 8.5, false, 0.45)

    // Notes panel, above the title block, in the column the plan leaves free.
    const nx = W - 430, ny = 300, nw = 380, nh = 430
    rect(nx, ny, nw, nh, 1)
    line(nx, ny + nh - 34, nx + nw, ny + nh - 34, 0.8)
    text('NOTES', nx + 14, ny + nh - 24, 9, true, 0.35)
    let ny2 = ny + nh - 58
    text('All dimensions in millimetres. Verify on site', nx + 14, ny2, 8.5, false, 0.2)
    text('before setting out or ordering material.', nx + 14, ny2 - 14, 8.5, false, 0.2)
    ny2 -= 42
    for (const l of SHEET_NOTES[kind] ?? []) {
      if (l) text(l, nx + 14, ny2, 8.5, false, 0.2)
      ny2 -= 14
    }
    // The revision history, which is the half of the register a paper sheet
    // has to carry on its own face.
    line(nx, ny + 200, nx + nw, ny + 200, 0.8)
    text('REVISIONS', nx + 14, ny + 182, 9, true, 0.35)
    text('REV', nx + 14, ny + 162, 7.5, true, 0.5)
    text('DESCRIPTION', nx + 48, ny + 162, 7.5, true, 0.5)
    text('DATE', nx + 300, ny + 162, 7.5, true, 0.5)
    line(nx + 8, ny + 154, nx + nw - 8, ny + 154, 0.5, 0.6)
    revisions.forEach(([letter, what, when], i) => {
      const ry2 = ny + 136 - i * 18
      text(letter, nx + 14, ry2, 9, true, 0.2)
      text(what, nx + 48, ry2, 8.5, false, 0.2)
      text(when, nx + 300, ry2, 8.5, false, 0.2)
    })

    // Legend, so the hatch means something.
    line(nx, ny + 52, nx + nw, ny + 52, 0.8)
    for (let gx = nx + 16; gx < nx + 46; gx += 8) line(gx, ny + 16, gx, ny + 40, 0.4, 0.72)
    for (let gy = ny + 16; gy < ny + 40; gy += 8) line(nx + 16, gy, nx + 46, gy, 0.4, 0.72)
    rect(nx + 16, ny + 16, 30, 24, 0.6, 0.45)
    text('Graded and membraned wet area', nx + 56, ny + 32, 8.5, false, 0.2)
    text('Floor waste', nx + 56, ny + 18, 8.5, false, 0.2)

    // Title block, bottom right, the way a drawing office lays one out.
    const tx = W - 430, ty = 60, tw = 380, th = 210
    rect(tx, ty, tw, th, 1.4)
    line(tx, ty + 150, tx + tw, ty + 150, 1)
    line(tx, ty + 96, tx + tw, ty + 96, 0.8)
    line(tx, ty + 48, tx + tw, ty + 48, 0.8)
    line(tx + 250, ty, tx + 250, ty + 96, 0.8)
    text(COMPANY_NAME.toUpperCase(), tx + 14, ty + 178, 14, true)
    text('Wall & floor tiling · waterproofing', tx + 14, ty + 160, 9, false, 0.4)
    text('PROJECT', tx + 14, ty + 132, 7.5, true, 0.5)
    text(project, tx + 14, ty + 110, 11)
    text('SHEET', tx + 14, ty + 78, 7.5, true, 0.5)
    text(sheetName, tx + 14, ty + 58, 11, true)
    text('LEVEL', tx + 264, ty + 78, 7.5, true, 0.5)
    text(level, tx + 264, ty + 58, 11, true)
    text('SCALE  1:50 @ A3', tx + 14, ty + 28, 8.5, false, 0.4)
    text(`REV ${revision}`, tx + 264, ty + 28, 11, true)
    text('DO NOT SCALE FROM THIS DRAWING', tx + 14, ty + 12, 7.5, false, 0.55)

    // A stamp across the plan, because a superseded sheet that only says so in
    // a list is a sheet somebody builds off.
    if (superseded) {
      const sw = 470, sx = px + (pw - sw) / 2
      rect(sx, 496, sw, 76, 2.4, 0.45)
      mid('SUPERSEDED', sx + sw / 2, 534, 30, true, 0.45)
      mid('DO NOT BUILD FROM THIS SHEET', sx + sw / 2, 512, 10.5, true, 0.45)
    }
    text('DEMONSTRATION DRAWING — NOT FOR CONSTRUCTION', 90, 44, 9, false, 0.55)
    return bytes()
  }

  // ------------------------------------------------------------------ drawings
  // The client's own worked example: "I do a 10 storey apartment building,
  // that's 3 drawings per level." Glenelg is that building, so it carries the
  // register at the size it actually reaches — thirty current sheets across
  // ten levels, plus two the office has since reissued.
  //
  // The names carry the level because that is how a drawing office names a
  // file, and it is what the register groups on. No column, no form field.
  const SHEET_KINDS = ['Tile layout', 'Bathroom setout', 'Balcony waterproofing']
  const DRAWINGS = []
  for (let level = 1; level <= 10; level++) {
    for (const kind of SHEET_KINDS) {
      DRAWINGS.push({ name: `L${String(level).padStart(2, '0')} - ${kind}`, level, rev: 'A' })
    }
  }
  // Two reissued sheets. The superseded pair is what a foreman has to be
  // stopped from building off, so the demo has to contain some — and the
  // sheet that replaced it has to be the later revision, or the register is
  // telling a foreman to build off the older letter.
  DRAWINGS.push(
    { name: 'L03 - Tile layout Rev B', level: 3, rev: 'B', replaces: 'L03 - Tile layout' },
    { name: 'L07 - Bathroom setout Rev B', level: 7, rev: 'B', replaces: 'L07 - Bathroom setout' },
  )
  const replaced = new Set(DRAWINGS.map((d) => d.replaces).filter(Boolean))
  /** dd.mm.yy — how a revision table writes a date. */
  const shortDay = (ymd) => `${ymd.slice(8)}.${ymd.slice(5, 7)}.${ymd.slice(2, 4)}`

  // An earlier seed wrote every sheet as the same six-line warranty stub, and
  // named the reissues "REV A" while making them supersede the Rev B they
  // replaced. Both are repaired in place: the bytes are re-PUT over the old
  // object on every run, and any drawing row this list no longer names is
  // deleted rather than left in the register as a ghost.
  const sheetRows = {}
  for (const d of DRAWINGS) {
    const filename = `${d.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.pdf`
    const path = `${companyId}/${site.glenelg.id}/demo-drawing-${filename}`
    const bytes = drawingPdf({
      sheetName: d.name.replace(/ Rev [A-Z]$/, ''),
      level: `Level ${d.level}`,
      revision: d.rev,
      project: SITES.glenelg.name,
      address: SITES.glenelg.address,
      revisions: d.rev === 'B'
        ? [['A', 'Issued for construction', shortDay(adDay(-42))],
           ['B', 'Wet area setout revised', shortDay(adDay(-6))]]
        : [['A', 'Issued for construction', shortDay(adDay(-42))]],
      superseded: replaced.has(d.name),
    })
    await putObject(path, bytes, 'application/pdf')
    sheetRows[d.name] = await ensureRow(boss, 'site_files',
      `select=id,supersedes&site_id=eq.${site.glenelg.id}&category=eq.drawing&name=eq.${encodeURIComponent(d.name)}&limit=1`,
      {
        company_id: companyId, site_id: site.glenelg.id, uploaded_by: me.id,
        kind: 'document', category: 'drawing', storage_path: path, name: d.name,
        mime: 'application/pdf', size_bytes: bytes.length, version: d.rev,
      },
      `drawing (${d.name})`)
    // The size on an existing row is the stub's, and the version letter may be
    // the one the old scheme got backwards.
    const upd = await boss.patch('site_files', `id=eq.${sheetRows[d.name].id}`,
      { storage_path: path, size_bytes: bytes.length, version: d.rev, mime: 'application/pdf' })
    if (!upd.ok) throw new Error(`drawing patch failed (${d.name}): HTTP ${upd.status} ${await upd.text()}`)
  }
  // A version string on its own cannot tell you something newer exists, so
  // the newer sheet has to name the one it replaces.
  for (const d of DRAWINGS) {
    if (!d.replaces) continue
    const older = sheetRows[d.replaces]
    if (!older || sheetRows[d.name].supersedes === older.id) continue
    const upd = await boss.patch('site_files', `id=eq.${sheetRows[d.name].id}`, { supersedes: older.id })
    if (!upd.ok) throw new Error(`supersedes patch failed (${d.name}): HTTP ${upd.status} ${await upd.text()}`)
  }
  // Sheets from the old naming scheme, still in the register under a name
  // nothing issues any more.
  const ghosts = await boss.get('site_files',
    `select=id,name&site_id=eq.${site.glenelg.id}&category=eq.drawing`)
  const keep = new Set(DRAWINGS.map((d) => d.name))
  for (const row of Array.isArray(ghosts) ? ghosts : []) {
    if (keep.has(row.name)) continue
    // A refused delete matches zero rows and reports success, so the rows have
    // to be read back to know it happened.
    const gone = await body(await fetch(`${SB}/rest/v1/site_files?id=eq.${row.id}`, {
      method: 'DELETE', headers: { ...boss.H, Prefer: 'return=representation' },
    }))
    if (!Array.isArray(gone) || gone.length === 0) throw new Error(`could not delete stale drawing ${row.name}`)
    console.log(`  removed stale drawing "${row.name}"`)
  }

  // --------------------------------------------------- the builder's programme
  // Two revisions on Lot 42, because one revision proves nothing. The trigger
  // in schema_v21 demotes whatever was current when the newer one lands, so
  // seeding them oldest-first leaves Rev C current and Rev B superseded —
  // which is the state the screen exists to make obvious.
  const PROGRAMMES = [
    ['lot42', 'Rev B', adDay(-38), adDay(-36)],
    ['lot42', 'Rev C', adDay(-9), adDay(-7)],
  ]
  for (const [key, revision, issued, received] of PROGRAMMES) {
    const have = await boss.get('programmes',
      `select=id&site_id=eq.${site[key].id}&revision=eq.${encodeURIComponent(revision)}&limit=1`)
    const filename = `kesselman-construction-programme-${revision.toLowerCase().replace(/\s+/g, '-')}.pdf`
    const path = `${companyId}/${site[key].id}/demo-programme-${filename}`
    const bytes = stubPdf(`Construction programme — ${revision}`, [
      'Kesselman Homes · Lot 42, Kentish Avenue, Prospect',
      '',
      `Issued          ${fmtDay(issued)}`,
      `Received        ${fmtDay(received)}`,
      '',
      'Wet area waterproofing        weeks 14 – 15',
      'Screed and levelling          week 15',
      'Wall tiling — ensuites        weeks 16 – 17',
      'Floor tiling — living         weeks 17 – 18',
      'Grout, seal and clean         week 18',
      '',
      'The dates the app works from are the ones on the Programme tab.',
      'This page stands in for the builder\u2019s own PDF.',
    ])
    await putObject(path, bytes, 'application/pdf')
    // A row from an earlier run points at this same object, so re-PUTting the
    // bytes above is what repairs it; only a missing row needs inserting.
    if (Array.isArray(have) && have.length > 0) continue
    const res = await boss.post('programmes', [{
      company_id: companyId, site_id: site[key].id,
      name: 'Construction programme', revision,
      issued_on: issued, received_on: received,
      source: 'pdf', storage_path: path, status: 'current', imported_by: me.id,
    }])
    if (!res.ok) throw new Error(`programme insert failed (${revision}): HTTP ${res.status} ${await res.text()}`)
  }

  // ------------------------------------------------------------ safety shelves
  // The four shelves a builder means when he asks for your safety paperwork.
  // Two of them are only ever uploads; the SWMS shelf also holds the company
  // template that every issued statement is copied from.
  //
  // The template is the client's own S812.0267, read off disk rather than
  // pasted into this script so the JSON and the seed cannot drift apart. Its
  // `document` block mixes two different kinds of fact: the activity and
  // approval line, which belong to the template every job inherits, and the
  // project/principal facts it was issued with (HJ Brighton, Mykra), which
  // don't — those get stamped fresh on whatever job the template is next
  // issued to. buildTemplateContent keeps only the fields SwmsContent
  // (apps/dashboard/src/data/swms.ts) actually declares, so the per-job
  // facts have nowhere to land rather than needing to be remembered and
  // stripped by hand.
  const swmsSource = JSON.parse(readFileSync(new URL('./swms-template.json', import.meta.url), 'utf8'))

  function buildTemplateContent(src) {
    const doc = src.document ?? {}
    return {
      activity: doc.activity,
      documentNo: doc.documentNo,
      approvedByName: doc.approvedByName,
      approvedByRole: doc.approvedByRole,
      approvedOn: doc.approvedOn,
      monitoring: src.monitoring,
      riskLegend: src.riskLegend,
      ppe: src.ppe,
      safetyNotes: src.safetyNotes,
      tasks: src.tasks,
      part2: src.part2,
      jurisdiction: src.jurisdiction,
      riskAssessment: src.riskAssessment,
      signOff: {
        preparedByName: src.signOff?.preparedByName,
        preparedByPosition: src.signOff?.preparedByPosition,
        preamble: src.signOff?.preamble,
        acknowledgement: src.signOff?.acknowledgement,
        registerColumns: src.signOff?.registerColumns,
      },
    }
  }

  // The plain-text fallback every hand-typed statement still renders from —
  // SafetyScreen falls back to `body` whenever `content` is absent, and a
  // client without structured rendering still needs something readable.
  // Generated from the structured object rather than typed separately, so
  // the two tellings of the same document cannot say different things —
  // in particular, the five-column register's before/after risk pair, the
  // whole argument an inspector reads, comes out the same on both.
  function renderSwmsBody(c) {
    const lines = [`## ${c.activity}`]
    if (c.documentNo) lines.push(`Document ${c.documentNo}`)
    lines.push('')

    lines.push('## Monitoring and review')
    for (const m of c.monitoring) lines.push(`- ${m}`)
    lines.push('')

    lines.push('## Personal protective equipment')
    lines.push(c.ppe.general)
    if (c.ppe.whereRequired) lines.push(`Where required: ${c.ppe.whereRequired}`)
    lines.push('')

    lines.push('## Hazardous substances')
    for (const note of c.safetyNotes) {
      lines.push(`${note.substance}: ${note.text}`)
      lines.push('')
    }

    lines.push('## Risk rating legend')
    for (const r of c.riskLegend) lines.push(`${r.code} — ${r.label}`)
    lines.push('')

    lines.push('## Tasks')
    for (const t of c.tasks) {
      lines.push(`### ${t.task}`)
      lines.push(`Risk before controls: ${t.riskBefore}  |  after controls: ${t.riskAfter}`)
      lines.push('Hazards:')
      for (const h of t.hazards) lines.push(`- ${h}`)
      lines.push('Controls:')
      for (const group of t.controls) {
        if (group.heading) lines.push(group.heading)
        for (const item of group.items) lines.push(`- ${item}`)
      }
      lines.push(`Responsible: ${t.responsible.join(', ')}`)
      lines.push('')
    }

    if (c.part2) {
      lines.push('## Part 2 — training, supervision, plant')
      if (c.part2.trainingRequired) lines.push(`Training required: ${c.part2.trainingRequired}`)
      if (c.part2.duties?.length) { lines.push('Duties:'); for (const d of c.part2.duties) lines.push(`- ${d}`) }
      if (c.part2.trainingModules?.length) { lines.push('Training modules:'); for (const m of c.part2.trainingModules) lines.push(`- ${m}`) }
      if (c.part2.supervision?.length) { lines.push('Supervision:'); for (const s of c.part2.supervision) lines.push(`- ${s}`) }
      if (c.part2.permits) lines.push(`Permits: ${c.part2.permits}`)
      if (c.part2.legislation?.length) { lines.push('Legislation:'); for (const l of c.part2.legislation) lines.push(`- ${l}`) }
      if (c.part2.plant?.length) { lines.push('Plant:'); for (const p of c.part2.plant) lines.push(`- ${p}`) }
      if (c.part2.maintenance) lines.push(`Maintenance: ${c.part2.maintenance}`)
      lines.push('')
    }

    if (c.jurisdiction?.length) {
      lines.push('## Jurisdiction')
      for (const j of c.jurisdiction) lines.push(`- ${j}`)
      lines.push('')
    }

    lines.push('## Sign-off')
    if (c.signOff.preamble) lines.push(c.signOff.preamble)
    for (const a of c.signOff.acknowledgement) lines.push(`- ${a}`)

    return lines.join('\n')
  }

  const SWMS_CONTENT = buildTemplateContent(swmsSource)
  const SWMS_BODY = renderSwmsBody(SWMS_CONTENT)
  // Title and version come off the document itself — its activity line and
  // its own document number — rather than anything invented for the demo.
  const SWMS_TITLE = SWMS_CONTENT.activity
  const SWMS_VERSION = SWMS_CONTENT.documentNo ?? '1'

  const swmsTemplate = await ensureRow(boss, 'safety_documents',
    `select=id&company_id=eq.${companyId}&is_template=is.true&kind=eq.swms`,
    {
      company_id: companyId, site_id: null, kind: 'swms', is_template: true,
      title: SWMS_TITLE, body: SWMS_BODY, content: SWMS_CONTENT, version: SWMS_VERSION,
      created_by: me.id, updated_by: me.id,
    },
    'SWMS template')
  // Keep body/content/title current on a re-run without minting a second template.
  const swmsUpd = await boss.patch('safety_documents', `id=eq.${swmsTemplate.id}`,
    { title: SWMS_TITLE, body: SWMS_BODY, content: SWMS_CONTENT, version: SWMS_VERSION })
  if (!swmsUpd.ok) throw new Error(`SWMS template patch failed: HTTP ${swmsUpd.status} ${await swmsUpd.text()}`)

  // What each shelf's paperwork says, so a reviewer who opens one is reading
  // the kind of document its title claims.
  const SAFETY_LINES = {
    induction: [
      'Record of site induction and toolbox talks delivered to the crew',
      'before starting on site.',
      '',
      'Covers   site access and parking, exclusion zones, silica dust',
      '         controls, wet area edge protection, first aid and the',
      '         emergency assembly point.',
      '',
      'Signed by every worker on arrival and held for the life of the job.',
    ],
    swms: [
      'Safe Work Method Statement for tiling and waterproofing.',
      '',
      'The live version of this statement is the one the app issues from',
      'the company template — open it from the Safety tab to read the',
      'full risk register, controls and sign-on sheet.',
    ],
    sds: [
      'Safety Data Sheet, prepared to the Work Health and Safety',
      'Regulations and GHS Revision 7.',
      '',
      'Hazards        may cause skin and eye irritation',
      'PPE            gloves, eye protection, P2 respirator when mixing',
      'First aid      rinse with water, seek medical advice if irritation',
      '               persists',
      'Storage        cool and dry, keep from freezing',
    ],
    policy: [
      'Work health and safety policy.',
      '',
      'The company is committed to providing a safe workplace for every',
      'worker, apprentice and subcontractor, and to consulting the crew',
      'on the things that affect their safety.',
      '',
      'Reviewed annually and whenever the work changes.',
    ],
  }

  // key: null means the document is the company's and shows on every job.
  const SAFETY_DOCS = [
    [null, 'induction', 'Site induction and toolbox talk record', null, 'site-induction-record.pdf'],
    ['lot42', 'swms', 'Tiling and waterproofing — Lot 42, Kentish Ave', adDay(28), 'PTS-SWMS-current.pdf'],
    ['lot42', 'sds', 'Ardex WPM 300 safety data sheet', null, 'ardex-wpm-300-sds.pdf'],
    [null, 'sds', 'Mapei Keraflex Maxi S1 safety data sheet', null, 'mapei-keraflex-sds.pdf'],
    [null, 'policy', 'Work health and safety policy', null, 'whs-policy.pdf'],
  ]

  for (const [key, kind, title, expires, filename] of SAFETY_DOCS) {
    const siteId = key ? site[key].id : null
    const have = await boss.get('safety_documents',
      `select=id&company_id=eq.${companyId}&kind=eq.${kind}&title=eq.${encodeURIComponent(title)}&limit=1`)
    const path = `${companyId}/${siteId ?? 'company'}/demo-safety-${filename}`
    const bytes = stubPdf(title, SAFETY_LINES[kind] ?? [])
    await putObject(path, bytes, 'application/pdf')
    if (Array.isArray(have) && have.length > 0) {
      const upd = await boss.patch('safety_documents', `id=eq.${have[0].id}`, { size_bytes: bytes.length })
      if (!upd.ok) throw new Error(`safety doc patch failed (${title}): HTTP ${upd.status} ${await upd.text()}`)
      continue
    }
    const res = await boss.post('safety_documents', [{
      company_id: companyId, site_id: siteId, kind, title,
      expires_on: expires, storage_path: path, file_name: filename,
      mime: 'application/pdf', size_bytes: bytes.length,
      created_by: me.id, updated_by: me.id,
      ...(kind === 'swms' ? { document_date: adDay(-14), builder_name: 'Kesselman Homes', version: '3' } : {}),
    }])
    if (!res.ok) throw new Error(`safety doc insert failed (${title}): HTTP ${res.status} ${await res.text()}`)
  }

  // ------------------------------------------------------------------ chat
  // The drawn job-channel threads. Messages are pinned to their author by
  // RLS, so seeding other people's words goes through the service role. The
  // drawn Marco (Kesselman) line is skipped — builders are not workers, and
  // a message needs a real author.
  const THREADS = [
    ['lot42', [
      ['sam', 0, '06:41', 'Screed to both ensuites still isn’t down. We can’t start Bath 2 tomorrow.'],
      ['me', 0, '06:44', 'Photograph it and I’ll send it to Marco this morning.'],
      ['sam', 0, '06:52', 'Sent — 3 photos on Ensuite 2.'],
    ]],
    ['hallett', [
      ['nadia', 0, '11:20', 'Unit 4 grouted. Starting set-out in Unit 5 after lunch.'],
      ['me', 0, '11:26', 'Good. Get a photo of the falls before you tile.'],
    ]],
    ['northgate', [
      ['rob', -1, '21:58', 'Centre want Zone C kept open Thursday night. That pushes us a shift.'],
      ['me', -1, '22:04', 'Raise it as a variation before you move anything.'],
    ]],
    ['glenelg', [
      ['ben', 0, '08:12', 'B305 membrane is on. Flood test needs 24 hrs before the screed.'],
      ['me', 0, '08:20', 'Do not let them screed before the test is photographed.'],
    ]],
    ['regency', [
      ['me', -1, '15:00', 'Induction is 6:30 Monday. Everyone on site by 6:15.'],
    ]],
  ]
  {
    const key = await service()
    const svcH = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
    for (const [siteKey, msgs] of THREADS) {
      const ch = await boss.get('channels', `select=id&site_id=eq.${site[siteKey].id}&kind=eq.site`)
      const channel = Array.isArray(ch) ? ch[0] : null
      if (!channel) continue
      const have = await boss.get('messages', `select=id&channel_id=eq.${channel.id}&limit=1`)
      if (Array.isArray(have) && have.length > 0) continue
      const rows = msgs.map(([who, day, hm, text]) => ({
        company_id: companyId, channel_id: channel.id,
        author_id: who === 'me' ? me.id : crew[who].id,
        kind: 'user', body: text, created_at: adAt(day, hm),
      }))
      const res = await fetch(`${SB}/rest/v1/messages`, { method: 'POST', headers: svcH, body: JSON.stringify(rows) })
      if (!res.ok) throw new Error(`chat seed failed (${siteKey}): HTTP ${res.status} ${await res.text()}`)
    }
  }

  console.log('\nDemo account ready — the drawn world, live.')
  console.log(`  URL       ${APP}`)
  console.log(`  Email     ${DEMO_EMAIL}`)
  console.log(`  Password  ${DEMO_PASSWORD}`)
  console.log(`  Company   ${COMPANY_NAME}`)
  process.exit(0)
} catch (err) {
  console.error(`seed-demo failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
