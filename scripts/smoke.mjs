#!/usr/bin/env node
/**
 * Production smoke test.
 *
 *   SUPABASE_PAT=sbp_... node scripts/smoke.mjs
 *
 * Runs against the live database and the deployed functions, because the
 * things most worth checking here are RLS policies and database constraints,
 * and neither exists in a unit test. It creates a throwaway company, asserts,
 * and deletes it.
 *
 * Users are minted through the admin API with the address pre-confirmed.
 * Signup cannot be used: email confirmation is on (it has to be — see
 * DEPLOY.md), and the built-in mailer is rate limited to a handful an hour.
 *
 * The PAT is needed to read the service_role key and to clean up. It is never
 * printed, and neither is the key.
 */

const SB = process.env.SUPABASE_URL ?? 'https://vkpdlsxiporsmqlfjvjw.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY ?? ''
const APP = process.env.APP_URL ?? 'https://construction-opal-three.vercel.app'
const PAT = process.env.SUPABASE_PAT ?? ''
const PROJECT = SB.replace(/^https:\/\//, '').split('.')[0]

if (!ANON || !PAT) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_PAT (and optionally SUPABASE_URL / APP_URL).')
  process.exit(2)
}

let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' PASS' : '*FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const body = async (r) => {
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    return t.slice(0, 300)
  }
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return body(r)
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

const PASSWORD = 'SmokeTest!2026xyz'
async function user(email) {
  const key = await service()
  const made = await fetch(`${SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  if (!made.ok) throw new Error(`admin create failed: ${(await made.text()).slice(0, 200)}`)
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const d = await r.json()
  if (!d.access_token) throw new Error(`sign-in failed: ${JSON.stringify(d).slice(0, 200)}`)
  const H = { Authorization: `Bearer ${d.access_token}`, apikey: ANON, 'Content-Type': 'application/json' }
  return {
    id: d.user.id,
    H,
    HR: { ...H, Prefer: 'return=representation' },
    get: (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H }).then(body),
    post: (t, b) => fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }),
    patch: (t, q, b) => fetch(`${SB}/rest/v1/${t}?${q}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(b) }),
  }
}

const stamp = Date.now()
const day = (o) => {
  const d = new Date()
  d.setDate(d.getDate() + o)
  return d.toISOString().slice(0, 10)
}
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString()
/** Positive is forwards, which reads right at the call site for a roster. */
const hoursAhead = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
/** An exclusion violation arrives as 400 with 23P01, not the 409 a unique gives. */
const clashed = async (r) => !r.ok && (await r.clone().json().catch(() => ({}))).code === '23P01'

let companyId = null

try {
  // ---------------------------------------------------------------- setup
  const boss = await user(`smoke-boss-${stamp}@mailinator.com`)
  const bootRes = await fetch(`${APP}/api/bootstrap`, {
    method: 'POST',
    headers: boss.H,
    body: JSON.stringify({ companyName: `Smoke Co ${stamp}`, name: 'Smoke Boss' }),
  })
  const boot = await body(bootRes)
  ok('bootstrap creates a company', bootRes.ok && Boolean(boot.companyId), `HTTP ${bootRes.status}`)
  companyId = boot.companyId
  const bossId = boot.workerId

  const site = (await body(await boss.post('job_sites', {
    company_id: companyId, name: 'Smoke Site', lat: -34.9285, lng: 138.6007,
    radius_m: 150, budget: 100000, contract_value: 150000,
  })))[0]

  const fieldEmail = `smoke-field-${stamp}@mailinator.com`
  const fieldRow = (await body(await boss.post('workers', {
    company_id: companyId, name: 'Kane Brooker', initials: 'KB',
    trade: 'Labourer', rate: 45, is_office: false, invite_email: fieldEmail,
  })))[0]
  const field = await user(fieldEmail)
  const joinRes = await fetch(`${APP}/api/bootstrap`, { method: 'POST', headers: field.H, body: JSON.stringify({}) })
  ok('an invited worker claims their row with a confirmed email', joinRes.ok, `HTTP ${joinRes.status}`)

  // ------------------------------------------------- the takeover defence
  const impostorEmail = `smoke-impostor-${stamp}@mailinator.com`
  const decoy = (await body(await boss.post('workers', {
    company_id: companyId, name: 'Bec Lindqvist', initials: 'BL',
    trade: 'Carpenter', rate: 58, is_office: false, invite_email: impostorEmail,
  })))[0]
  const key = await service()
  await fetch(`${SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: impostorEmail, password: PASSWORD, email_confirm: false }),
  })
  const impSignIn = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: impostorEmail, password: PASSWORD }),
  })).json()
  if (impSignIn.access_token) {
    const r = await fetch(`${APP}/api/bootstrap`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${impSignIn.access_token}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    ok('an unconfirmed email cannot claim an invited worker row', r.status === 403, `HTTP ${r.status}`)
  } else {
    // Supabase refused the sign-in outright, which is the same protection.
    ok('an unconfirmed email cannot even sign in', true, impSignIn.error_code ?? '')
  }
  const stillOpen = (await boss.get('workers', `select=auth_user_id&id=eq.${decoy.id}`))[0]
  ok('the decoy row is still unclaimed', stillOpen.auth_user_id === null)

  // -------------------------------------------------------- shift overlap
  await boss.post('shifts', { company_id: companyId, worker_id: fieldRow.id, site_id: site.id, started_at: hoursAgo(9), ended_at: hoursAgo(5), source: 'manual' })
  const overlap = await boss.post('shifts', { company_id: companyId, worker_id: fieldRow.id, site_id: site.id, started_at: hoursAgo(6), ended_at: hoursAgo(2), source: 'manual' })
  ok('a worker cannot hold two overlapping shifts', await clashed(overlap), `HTTP ${overlap.status}`)
  const abutting = await boss.post('shifts', { company_id: companyId, worker_id: fieldRow.id, site_id: site.id, started_at: hoursAgo(5), ended_at: hoursAgo(1), source: 'manual' })
  ok('a shift starting when the last ended is fine', abutting.ok, `HTTP ${abutting.status}`)

  // ------------------------------------------------- worker-owned records
  const open = (await body(await boss.post('shifts', { company_id: companyId, worker_id: fieldRow.id, site_id: site.id, started_at: hoursAgo(0.5), source: 'auto' })))[0]
  await fetch(`${SB}/rest/v1/shifts?id=eq.${open.id}`, { method: 'PATCH', headers: field.H, body: JSON.stringify({ cost_code: '06-100', break_minutes: 30 }) })
  const annotated = (await field.get('shifts', `select=cost_code,break_minutes&id=eq.${open.id}`))[0]
  ok('a worker annotates their own open shift', annotated.cost_code === '06-100' && annotated.break_minutes === 30)

  const wasStart = open.started_at
  await fetch(`${SB}/rest/v1/shifts?id=eq.${open.id}`, { method: 'PATCH', headers: field.H, body: JSON.stringify({ started_at: hoursAgo(9) }) })
  const after = (await field.get('shifts', `select=started_at,approved_at&id=eq.${open.id}`))[0]
  ok('a worker cannot move their own clock-in', after.started_at === wasStart)
  await fetch(`${SB}/rest/v1/shifts?id=eq.${open.id}`, { method: 'PATCH', headers: field.H, body: JSON.stringify({ approved_at: new Date().toISOString() }) })
  ok('a worker cannot approve their own shift', (await field.get('shifts', `select=approved_at&id=eq.${open.id}`))[0].approved_at === null)

  // ------------------------------------------------------- notifications
  const asg = (await body(await boss.post('assignments', { company_id: companyId, worker_id: fieldRow.id, site_id: site.id, starts_at: hoursAhead(16), ends_at: hoursAhead(24), published: false })))[0]
  ok('an unpublished roster notifies nobody', (await boss.get('notifications', 'select=id&kind=eq.roster_published')).length === 0)
  await boss.patch('assignments', `id=eq.${asg.id}`, { published: true })
  ok('publishing notifies the rostered worker', (await field.get('notifications', 'select=id&kind=eq.roster_published')).length === 1)

  const leave = (await body(await fetch(`${SB}/rest/v1/time_off_requests`, { method: 'POST', headers: field.HR, body: JSON.stringify({ company_id: companyId, worker_id: fieldRow.id, starts_on: day(20), ends_on: day(21), status: 'pending' }) })))[0]
  ok('a leave request reaches the office', (await boss.get('notifications', 'select=id&kind=eq.timeoff_requested')).length === 1)
  const selfApprove = await fetch(`${SB}/rest/v1/time_off_requests?id=eq.${leave.id}`, { method: 'PATCH', headers: field.H, body: JSON.stringify({ status: 'approved' }) })
  ok('a worker cannot approve their own leave', !selfApprove.ok, `HTTP ${selfApprove.status}`)
  await boss.patch('time_off_requests', `id=eq.${leave.id}`, { status: 'approved', decided_by: bossId, decided_at: new Date().toISOString() })
  ok('the decision reaches the worker', (await field.get('notifications', 'select=id&kind=eq.leave_decided')).length === 1)

  // --------------------------------------------------------- the view leak
  const stranger = await user(`smoke-stranger-${stamp}@mailinator.com`)
  await boss.post('invoices', { company_id: companyId, site_id: site.id, invoice_no: `INV-${stamp}`, client_name: 'A Client', issued_on: day(-10), due_on: day(-3), amount: 5000, status: 'sent' })
  ok('a stranger reads no invoices', (await stranger.get('invoices', 'select=id')).length === 0)
  ok('a stranger reads no invoice_status_v (the view honours RLS)', (await stranger.get('invoice_status_v', 'select=id')).length === 0)
  ok('a stranger reads no notifications', (await stranger.get('notifications', 'select=id')).length === 0)

  // ---------------------------------------------------------- money maths
  const v = (await boss.get('invoice_status_v', `select=invoice_no,overdue,outstanding&company_id=eq.${companyId}`))[0]
  ok('overdue is derived, not stored', v.overdue === true && Number(v.outstanding) === 5000)

  const mats = await body(await boss.post('materials', [
    { company_id: companyId, site_id: site.id, name: '90x45 MGP10', quantity: 126.5, unit: 'lm', unit_cost: '8.42', cost_code: '06-110', supplier: 'Bowens', status: 'delivered', created_by: bossId },
    { company_id: companyId, site_id: site.id, name: 'Sent back', quantity: 10, unit: 'ea', unit_cost: '99.00', cost_code: '06-110', supplier: 'Bowens', status: 'returned', created_by: bossId },
  ]))
  ok('generated total_cost is exact', Number(mats[0].total_cost) === 1065.13, `$${mats[0].total_cost}`)
  const forge = await boss.post('materials', { company_id: companyId, site_id: site.id, name: 'Forged', quantity: 1, unit_cost: '1.00', total_cost: '99999.00' })
  ok('a generated column cannot be written', forge.status === 400, `HTTP ${forge.status}`)

  // ------------------------------------------------------------ the AI key
  const ai = await fetch(`${APP}/api/parse-receipt`, { method: 'POST', headers: boss.H, body: JSON.stringify({}) })
  ok('receipt extraction answers honestly without a key', ai.status === 501 || ai.ok, `HTTP ${ai.status}`)
} catch (err) {
  fail++
  console.log(`*FAIL  threw: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (companyId) {
    await sql(`
      delete from auth.users u using workers w
        where w.auth_user_id = u.id and w.company_id = '${companyId}';
      delete from auth.users where email like 'smoke-%${stamp}@mailinator.com';
      delete from companies where id = '${companyId}';`)
    console.log('\ncleaned up the throwaway company')
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
}
