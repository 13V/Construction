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

import { readFileSync } from 'node:fs'

function fromEnvFile(key) {
  try {
    const url = new URL('../apps/dashboard/.env.local', import.meta.url)
    return readFileSync(url, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

const SB = process.env.SUPABASE_URL ?? fromEnvFile('VITE_SUPABASE_URL') ?? 'https://vkpdlsxiporsmqlfjvjw.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY ?? fromEnvFile('VITE_SUPABASE_ANON_KEY') ?? ''
const APP = process.env.APP_URL ?? 'https://construction-opal-three.vercel.app'
const PAT = process.env.SUPABASE_PAT ?? fromEnvFile('SUPABASE_PAT') ?? ''
const PROJECT = SB.replace(/^https:\/\//, '').split('.')[0]

if (!ANON || !PAT) {
  console.error('Need SUPABASE_ANON_KEY and SUPABASE_PAT — in the environment, or in apps/dashboard/.env.local.')
  process.exit(2)
}

const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'appreview@crewline.app'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'Crewline-Review-2026!'
const COMPANY_NAME = 'Semaphore Tiling & Waterproofing'
const OWNER_NAME = 'Marnie Sutcliffe'

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
    legal_name: 'Semaphore Trades Pty. Ltd.',
    abn: '54002000004',
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
    // PATCH, not ensure: schema_v24's backfill trigger creates an empty
    // worker_pay row the moment the worker lands, so "a row exists" proves
    // nothing about the rate being set.
    const paid = await boss.patch('worker_pay', `worker_id=eq.${crew[key].id}`, { rate })
    if (!paid.ok) throw new Error(`pay rate (${name}): HTTP ${paid.status} ${await paid.text()}`)
  }
  console.log(`crew: ${OWNER_NAME} (office) + ${CREW.length} on the tools`)

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
  await boss.patch('job_sites', `id=eq.${site.lot42.id}`, { supervisor_contact_id: marco.id })

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

  // ---------------------------------------------------------------- photos
  // Captioned rows with demo storage paths. The paths resolve to nothing, so
  // the grid shows the drawing's placeholder tiles with caption pills — which
  // is exactly what the drawing draws.
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
    const rows = PHOTOS.filter(([k]) => k === key).flatMap(([, day, captions]) =>
      captions.map((caption, i) => ({
        company_id: companyId, site_id: site[key].id, uploaded_by: me.id,
        kind: 'photo', storage_path: `demo/${key}/${adDay(day)}-${i + 1}.jpg`,
        name: `photo-${adDay(day)}-${i + 1}.jpg`, mime: 'image/jpeg', category: 'progress',
        caption: caption || null, taken_at: adAt(day, `${String(7 + (i % 8)).padStart(2, '0')}:${String(10 + i * 5).padStart(2, '0')}`),
      })),
    )
    const res = await boss.post('site_files', rows)
    if (!res.ok) throw new Error(`photos insert failed (${key}): HTTP ${res.status} ${await res.text()}`)
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

  // A 1x1 JPEG and a one-line PDF. Enough to be a real object in the bucket,
  // small enough to be honest about being demo evidence.
  const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwcJC4nICIsIxwcKDcpLDA1NTU1MDVAQEBAQEBAQEBAQEBAQEBAQEBAQP/bAEMBCQkJDAsMGA0N' +
    'GDIhHCEyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMv/A' +
    'ABEIAAEAAQMBIgACEQEDEQH/xABTAAEBAQAAAAAAAAAAAAAAAAABAgMBAQEBAAAAAAAAAAAAAAAA' +
    'AAECAxABAQAAAAAAAAAAAAAAAAAAABEBAAIRAxIhMQARAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQAC' +
    'EQMRAD8AmgAf/9k=', 'base64')
  const TINY_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj\n' +
    '4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n' +
    '5 0 obj<</Length 96>>stream\nBT /F1 14 Tf 60 760 Td (Mapei product warranty - demo document) Tj ET\nendstream endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')

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

  for (const [key, step, kind, category, filename] of WP_FILES) {
    const pkgId = wpPkg[key].id
    const have = await boss.get('site_files',
      `select=id&waterproofing_package_id=eq.${pkgId}&name=eq.${encodeURIComponent(filename)}&limit=1`)
    if (Array.isArray(have) && have.length > 0) continue
    const isPhoto = kind === 'photo'
    const path = `${companyId}/${site[key].id}/demo-wp-${step}-${filename}`
    await putObject(path, isPhoto ? TINY_JPEG : TINY_PDF, isPhoto ? 'image/jpeg' : 'application/pdf')
    const res = await boss.post('site_files', [{
      company_id: companyId, site_id: site[key].id, waterproofing_package_id: pkgId, wp_step: step,
      uploaded_by: me.id, kind, category, storage_path: path, name: filename,
      mime: isPhoto ? 'image/jpeg' : 'application/pdf',
      size_bytes: (isPhoto ? TINY_JPEG : TINY_PDF).length,
    }])
    if (!res.ok) throw new Error(`wp file insert failed (${key}/${filename}): HTTP ${res.status} ${await res.text()}`)
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
      DRAWINGS.push([`L${String(level).padStart(2, '0')} - ${kind}`, false])
    }
  }
  // Two reissued sheets: the superseded pair is what a foreman has to be
  // stopped from building off, so the demo has to contain some.
  DRAWINGS.push(['L03 - Tile layout REV A', true], ['L07 - Bathroom setout REV A', true])

  const haveSheets = await boss.get('site_files',
    `select=id&site_id=eq.${site.glenelg.id}&kind=eq.document&selection_id=is.null&waterproofing_package_id=is.null&limit=1`)
  if (!Array.isArray(haveSheets) || haveSheets.length === 0) {
    const made = {}
    for (const [name, isOld] of DRAWINGS) {
      const filename = `${name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.pdf`
      const path = `${companyId}/${site.glenelg.id}/demo-drawing-${filename}`
      await putObject(path, TINY_PDF, 'application/pdf')
      const res = await boss.post('site_files', [{
        company_id: companyId, site_id: site.glenelg.id, uploaded_by: me.id,
        kind: 'document', category: 'drawing', storage_path: path, name,
        mime: 'application/pdf', size_bytes: TINY_PDF.length,
        version: isOld ? 'A' : 'B',
      }])
      if (!res.ok) throw new Error(`drawing insert failed (${name}): HTTP ${res.status} ${await res.text()}`)
      made[name] = (await body(res))[0]
    }
    // The REV A sheets supersede the originals they were reissued from — a
    // version string on its own cannot tell you something newer exists, so
    // the newer sheet has to name the one it replaces.
    for (const [oldName, newName] of [['L03 - Tile layout', 'L03 - Tile layout REV A'],
                                      ['L07 - Bathroom setout', 'L07 - Bathroom setout REV A']]) {
      await boss.patch('site_files', `id=eq.${made[newName].id}`, { supersedes: made[oldName].id })
    }
  }

  // ------------------------------------------------------------ safety shelves
  // The four shelves a builder means when he asks for your safety paperwork.
  // Two of them are only ever uploads; the SWMS shelf also holds the company
  // template that every issued statement is copied from.
  //
  // The generic statement below is a placeholder with real bones — it is
  // shaped the way a SWMS has to be shaped, and it is meant to be replaced by
  // the company's own. It lives in the database precisely so replacing it is
  // an edit and not a release.
  const SWMS_BODY = [
    '## Scope of work',
    'Wall and floor tiling, waterproofing of internal wet areas and external balconies, screeding,',
    'grouting and silicone sealing, including preparation and clean-up.',
    '',
    '## High risk construction work',
    '- Work on or near a surface a person could fall more than 2 metres from.',
    '- Work involving a risk of a person being exposed to hazardous chemicals (membranes, primers,',
    '  epoxy grouts, cleaning acids).',
    '- Use of powered plant that generates respirable crystalline silica dust.',
    '',
    '## Hazards and controls',
    '- Silica dust from cutting tiles. Cut wet, or on-tool extraction with an H-class vacuum. P2',
    '  respirator fitted and fit-tested. Nobody else within the cutting area.',
    '- Chemical exposure from membranes, primers and epoxies. Read the SDS before opening the pail.',
    '  Nitrile gloves, eye protection, ventilation. Eyewash on site.',
    '- Falls from balconies and stairwells. Do not work outside the edge protection. Report removed',
    '  or damaged handrail to the site supervisor and stop until it is back.',
    '- Manual handling of tile boxes and pails. Two people over 20 kg, or use the trolley. Break',
    '  pallets down where they land rather than carrying full boxes up.',
    '- Slips on wet membrane and screed. Barricade and sign wet areas. Nobody walks a membrane',
    '  before it has cured.',
    '- Kneeling injuries. Knee pads worn for all floor work.',
    '- Electrical. Test and tag current on every tool. RCD at the board before anything is plugged in.',
    '',
    '## Personal protective equipment',
    'Safety boots, hi-vis, safety glasses, gloves suited to the product, P2 respirator for cutting and',
    'for mixing powders, knee pads, hearing protection when cutting.',
    '',
    '## Plant and equipment',
    'Wet tile saw, angle grinder with on-tool extraction, mixing drill and paddle, laser level,',
    'trestles and planks within their rated height, extension leads on RCD.',
    '',
    '## Before work starts',
    '- Site induction complete for everyone on the crew.',
    '- This statement read and signed by everyone carrying out the work.',
    '- SDS on site for every product being used that day.',
    '- Edge protection, lighting and access checked and acceptable.',
    '',
    '## If something changes',
    'Stop. A change to the work, the plant, the products or the site conditions means this statement',
    'is reviewed and re-signed before work continues. Report incidents and near misses to the site',
    'supervisor and to the office the same day.',
  ].join('\n')

  const swmsTemplate = await ensureRow(boss, 'safety_documents',
    `select=id&company_id=eq.${companyId}&is_template=is.true&kind=eq.swms`,
    {
      company_id: companyId, site_id: null, kind: 'swms', is_template: true,
      title: 'Tiling and waterproofing', body: SWMS_BODY, version: '3',
      created_by: me.id, updated_by: me.id,
    },
    'SWMS template')
  // Keep the body current on a re-run without minting a second template.
  await boss.patch('safety_documents', `id=eq.${swmsTemplate.id}`, { body: SWMS_BODY, version: '3' })

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
    if (Array.isArray(have) && have.length > 0) continue
    const path = `${companyId}/${siteId ?? 'company'}/demo-safety-${filename}`
    await putObject(path, TINY_PDF, 'application/pdf')
    const res = await boss.post('safety_documents', [{
      company_id: companyId, site_id: siteId, kind, title,
      expires_on: expires, storage_path: path, file_name: filename,
      mime: 'application/pdf', size_bytes: TINY_PDF.length,
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
