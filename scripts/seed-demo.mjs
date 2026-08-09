#!/usr/bin/env node
/**
 * Demo account for App Review.
 *
 *   node scripts/seed-demo.mjs        # keys from apps/dashboard/.env.local
 *
 * Apple's Guideline 2.1 requires working credentials for an app gated behind
 * a login, and a reviewer cannot make their own: signup needs a confirmed
 * email (DEPLOY.md explains why that has to stay on) and, even confirmed, a
 * brand new account lands in an empty tenant with no job sites, no crew and
 * nothing to look at. This script creates one company that already has all
 * of that, and prints the login for whoever is filling in the App Store
 * Connect review notes.
 *
 * The demo account this project shipped before — demo@crewline.app, company
 * "Whitcomb Builders" — is retired for a reason SHIP.md records: its
 * password sat inside a public JavaScript bundle for as long as auto-sign-in
 * demo mode was on, so anyone who saved that bundle can still sign in as Ray
 * Whitcomb. This script deliberately does not resurrect that account. It
 * mints a new email, a new company, and a new password that has never shipped
 * anywhere.
 *
 * Idempotent: re-running this must not create a second demo company. Most of
 * this script therefore checks for a row before creating one rather than
 * inserting unconditionally — the one exception is the two shifts near the
 * bottom, which are keyed to a fixed time on TODAY's calendar date and so are
 * naturally idempotent within a day but will add another day's shift if you
 * run this again tomorrow. That is by design: a reviewer opening the app a
 * week after this ran should still see the crew clocked in today, not a
 * dashboard stuck on whatever day this last ran.
 *
 * Users are minted through the admin API with the address pre-confirmed, the
 * same way scripts/smoke.mjs does — signup cannot be used here for the same
 * reason it cannot there: email confirmation is on. The PAT is needed to read
 * the service_role key; it is never printed, and neither is the key. The demo
 * PASSWORD below is the one exception — it is meant to be handed to Apple, so
 * this script prints it deliberately, once, at the end.
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

// Distinct from the retired demo@crewline.app on purpose — see the header.
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

/**
 * Mints the reviewer's login if it does not exist yet, and signs in either
 * way. This is the idempotency seam for the whole script: a second run hits
 * "already registered" from the admin API, falls through to the sign-in
 * below, and gets back the same account with the same password it was given
 * the first time.
 */
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

const iso = (d) => d.toISOString()
/** A fixed hour on today's date, so re-running the script on the same day is idempotent. */
const todayAt = (h, m = 0) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
const daysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

try {
  const boss = await ensureUser(DEMO_EMAIL, DEMO_PASSWORD)

  // bootstrap.ts is already idempotent — a second call for an existing worker
  // returns {existing:true} without touching the company. It doesn't hand back
  // companyId on that path, so the company and worker id are read back below
  // regardless of which branch it took.
  const bootRes = await fetch(`${APP}/api/bootstrap`, {
    method: 'POST',
    headers: boss.H,
    body: JSON.stringify({ companyName: COMPANY_NAME, name: OWNER_NAME }),
  })
  if (!bootRes.ok && bootRes.status !== 200) throw new Error(`bootstrap failed: HTTP ${bootRes.status} ${await bootRes.text()}`)

  const me = (await boss.get('workers', `select=id,company_id&auth_user_id=eq.${boss.id}`))[0]
  if (!me) throw new Error('bootstrap ran but the owner has no worker row — cannot continue')
  const companyId = me.company_id
  const bossId = me.id
  console.log(`company ${COMPANY_NAME} — ${companyId}`)

  // ------------------------------------------------------------- job sites
  const siteA = await ensureRow(boss, 'job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Lot 22, Golden Grove')}`, {
    company_id: companyId, name: 'Lot 22, Golden Grove',
    address: '22 Wisteria Rise, Golden Grove SA 5125',
    job_type: 'New build — ensuites & bathrooms',
    status: 'active', lat: -34.7686, lng: 138.7180, radius_m: 150,
  }, 'job site (Golden Grove)')

  const siteB = await ensureRow(boss, 'job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Semaphore Beach House Reno')}`, {
    company_id: companyId, name: 'Semaphore Beach House Reno',
    address: '14 Military Rd, Semaphore SA 5019',
    job_type: 'Renovation — bathroom & laundry',
    status: 'starting_soon', lat: -34.8412, lng: 138.4823, radius_m: 120,
  }, 'job site (Semaphore)')

  /**
   * A third job site, at Apple Park.
   *
   * Everything this app does hangs off being INSIDE a geofence, and both real
   * sites are in Adelaide. App Review sits in Cupertino, so a reviewer running
   * the app on a real device is 13,000 km outside every fence: the clock never
   * starts on its own, and "Clock in manually" correctly refuses with "You need
   * to be inside a job site to clock in." A reviewer would reasonably conclude
   * the app does not work — the same rejection as if it genuinely didn't.
   *
   * Simulating a location in Xcode is the documented alternative, but it asks a
   * reviewer to go and do something before the app does anything, and if they
   * don't, the app looks broken. A fence they are already standing in costs
   * nothing and removes the question.
   *
   * 1 Apple Park Way. The radius is wide because the campus is, and because a
   * reviewer may be anywhere on it or in the surrounding buildings.
   */
  await ensureRow(boss, 'job_sites', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('App Review demo site')}`, {
    company_id: companyId, name: 'App Review demo site',
    address: '1 Apple Park Way, Cupertino CA',
    job_type: 'Demonstration site for App Review — not a real job',
    status: 'active', lat: 37.3349, lng: -122.0090, radius_m: 800,
  }, 'job site (App Review, Cupertino)')

  // ------------------------------------------------------------------ crew
  const crew = {}
  for (const [key, name, initials, trade, rate] of [
    ['tiler', 'Jayden Hoad', 'JH', 'Tiler', 58],
    ['waterproofer', 'Priya Nathan', 'PN', 'Waterproofer', 54],
    ['labourer', 'Coby Anderson', 'CA', 'Labourer', 42],
  ]) {
    crew[key] = await ensureRow(boss, 'workers', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent(name)}`, {
      company_id: companyId, name, initials, trade, rate, is_office: false, active: true,
    }, `crew member (${name})`)
  }
  console.log(`crew: ${OWNER_NAME} (office), ${Object.values(crew).length} field workers`)

  // -------------------------------------------------------------- builder
  const builder = await ensureRow(boss, 'builders', `select=id&company_id=eq.${companyId}&name=eq.${encodeURIComponent('Torrens Coastal Constructions')}`, {
    company_id: companyId, name: 'Torrens Coastal Constructions',
    abn: '54123456789', accounts_email: 'accounts@torrenscoastal.example',
    phone: '08 8212 4477', address: '210 Port Rd, Hindmarsh SA 5007',
    payment_terms_days: 30, default_retention_pct: 5,
  }, 'builder')

  // ------------------------------------------------------ contract + variation
  const contract = await ensureRow(boss, 'contracts', `select=id&site_id=eq.${siteA.id}`, {
    company_id: companyId, site_id: siteA.id, builder_id: builder.id,
    contract_no: 'TC-1042', title: 'Lot 22 Golden Grove — tiling & waterproofing',
    contract_sum: 68000, gst_inclusive: false, retention_pct: 5, payment_terms_days: 30,
    signed_on: iso(daysAgo(42)).slice(0, 10),
    starts_on: iso(daysAgo(35)).slice(0, 10),
    due_on: iso(daysAgo(-21)).slice(0, 10),
    status: 'active',
  }, 'contract')

  const variation = await ensureRow(boss, 'change_orders', `select=id&company_id=eq.${companyId}&co_no=eq.VO-1`, {
    company_id: companyId, site_id: siteA.id, contract_id: contract.id,
    co_no: 'VO-1', description: 'Upgrade to 900x900 porcelain with a mitred stone hob',
    cost_impact: 4200, status: 'approved',
  }, 'variation')
  void variation

  // ------------------------------------------------------------- defects
  await ensureRow(boss, 'defects', `select=id&site_id=eq.${siteB.id}&description=eq.${encodeURIComponent('Chipped tile beside the hob — looks like transit damage, not ours')}`, {
    company_id: companyId, site_id: siteB.id, location: 'Ensuite',
    description: 'Chipped tile beside the hob — looks like transit damage, not ours',
    raised_by_party: 'us', responsible: 'unknown', severity: 'minor', status: 'open',
  }, 'defect (ensuite chip)')

  await ensureRow(boss, 'defects', `select=id&site_id=eq.${siteB.id}&description=eq.${encodeURIComponent('Grout line cracked along the slab control joint')}`, {
    company_id: companyId, site_id: siteB.id, location: 'Laundry',
    description: 'Grout line cracked along the slab control joint',
    raised_by_party: 'builder', responsible: 'builder', severity: 'major', status: 'in_progress',
  }, 'defect (laundry crack)')

  // -------------------------------------------------------- waterproofing
  await ensureRow(boss, 'waterproofing', `select=id&site_id=eq.${siteB.id}&area=eq.Ensuite`, {
    company_id: companyId, site_id: siteB.id, area: 'Ensuite',
    product_name: 'Ardex WPM 300', batch_no: 'B-88231',
    substrate: 'Villaboard sheet flooring', primer: 'Ardex WPP primer', coats: 2,
    bond_breaker: true, angle_fillet: true, wall_height_mm: 1800,
    started_on: iso(daysAgo(4)).slice(0, 10), completed_on: iso(daysAgo(3)).slice(0, 10),
    flood_tested: true, flood_test_on: iso(daysAgo(3)).slice(0, 10), flood_test_hours: 24,
    installer_id: crew.waterproofer.id, status: 'signed_off', signed_off_by: crew.waterproofer.id,
  }, 'waterproofing record')

  // ------------------------------------------------------------ shifts + today
  // One finished this morning (labourer, Lot 22) and one still open (tiler,
  // Semaphore) — so a reviewer signing in during business hours sees the live
  // map doing something rather than an empty dashboard.
  const finishedStart = todayAt(7, 0)
  const finishedEnd = todayAt(11, 0)
  await ensureRow(boss, 'shifts',
    `select=id&worker_id=eq.${crew.labourer.id}&started_at=gte.${iso(todayAt(0, 0))}&started_at=lt.${iso(todayAt(23, 59))}`,
    { company_id: companyId, worker_id: crew.labourer.id, site_id: siteA.id, started_at: iso(finishedStart), ended_at: iso(finishedEnd), source: 'auto', approved_at: iso(finishedEnd), approved_by: bossId },
    'finished shift')

  const openStart = new Date(Date.now() - 3 * 3_600_000)
  const openShift = await ensureRow(boss, 'shifts',
    `select=id&worker_id=eq.${crew.tiler.id}&ended_at=is.null`,
    { company_id: companyId, worker_id: crew.tiler.id, site_id: siteB.id, started_at: iso(openStart), source: 'auto' },
    'open shift')
  void openShift

  // A recent position so the open shift has a pin on the live map — useLive
  // derives the pin from the last trail point, not from the shift row alone.
  // Same coordinates as the Semaphore site above, not a read of siteB: the
  // "already exists" branch of ensureRow only ever selects id, so siteB may
  // not carry lat/lng on a second run.
  //
  // This one write has to go through the service role: `positions_insert_own`
  // is worker_id = the CALLER's own row, not company-and-office like every
  // other table here — an office login writing a position for the tiler is
  // exactly the write the office-only tables above accept and this table
  // refuses, on purpose (schema.sql: "a worker may only ever write their own
  // location"). Reading it back can stay as the boss — office reads any
  // teammate's position under the same policy.
  const recentPing = await boss.get('positions', `select=id&worker_id=eq.${crew.tiler.id}&at=gte.${iso(new Date(Date.now() - 30 * 60_000))}`)
  if (!recentPing.length) {
    const key = await service()
    const posRes = await fetch(`${SB}/rest/v1/positions`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: crew.tiler.id, at: iso(new Date(Date.now() - 5 * 60_000)), lat: -34.8412, lng: 138.4823, accuracy_m: 8 }),
    })
    if (!posRes.ok) throw new Error(`could not seed a position: HTTP ${posRes.status} ${await posRes.text()}`)
  }

  console.log('\nDemo account ready.')
  console.log(`  URL       ${APP}`)
  console.log(`  Email     ${DEMO_EMAIL}`)
  console.log(`  Password  ${DEMO_PASSWORD}`)
  console.log(`  Company   ${COMPANY_NAME}`)
  process.exit(0)
} catch (err) {
  console.error(`seed-demo failed: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
