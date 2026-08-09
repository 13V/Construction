#!/usr/bin/env node
/**
 * Production smoke test.
 *
 *   node scripts/smoke.mjs        # keys from apps/dashboard/.env.local
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

import { readFileSync } from 'node:fs'

/**
 * Falls back to apps/dashboard/.env.local so neither key has to be typed onto a
 * command line, where it would land in shell history.
 */
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
    del: (t, q) => fetch(`${SB}/rest/v1/${t}?${q}`, { method: 'DELETE', headers: H }),
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
  ok('a stranger reads no invoice_payments', (await stranger.get('invoice_payments', 'select=id')).length === 0)
  ok('a stranger reads no notifications', (await stranger.get('notifications', 'select=id')).length === 0)

  // ----------------------------------------------------------------- chat
  // Realtime delivery is not asserted here — it needs the client library and a
  // subscription handshake, and racing that produces flaky failures that mean
  // nothing. Verified separately; what matters below is that the channel
  // exists without being asked for and that RLS holds on both sides.
  const chans = await boss.get('channels', `select=id,name,site_id&company_id=eq.${companyId}`)
  const siteChan = chans.find((c) => c.site_id === site.id)
  ok('a new job site gets its own chat channel automatically', Boolean(siteChan), siteChan?.name)

  if (siteChan) {
    ok('a field worker can post to the site channel',
      (await field.post('messages', { company_id: companyId, channel_id: siteChan.id, author_id: fieldRow.id, body: 'Slab pour done.' })).ok)
    ok('the office can reply',
      (await boss.post('messages', { company_id: companyId, channel_id: siteChan.id, author_id: bossId, body: 'Sparky booked Tuesday.' })).ok)
    ok('the worker sees both sides of the thread',
      (await field.get('messages', `select=id&channel_id=eq.${siteChan.id}`)).length === 2)
    // Authorship is identity, not a form field.
    ok('a worker cannot post as somebody else',
      (await field.post('messages', { company_id: companyId, channel_id: siteChan.id, author_id: bossId, body: 'Everyone gets a raise' })).status === 403)
    ok('a stranger reads no messages and no channels',
      (await stranger.get('messages', 'select=id')).length === 0 && (await stranger.get('channels', 'select=id')).length === 0)
  }

  // v15 added builders and subcontract labour behind a company-wide read,
  // reopening exactly what v14 closed. v16 shut it; this keeps it shut.
  ok('a field worker reads no builders', (await field.get('builders', 'select=id')).length === 0)
  ok('a field worker reads no subcontractors', (await field.get('subcontractors', 'select=id')).length === 0)
  ok('a field worker reads no subcontract work', (await field.get('subcontract_work', 'select=id')).length === 0)
  // Contacts stay company-wide on purpose: a chippie at a locked gate needs
  // the supervisor's mobile, and a phone number is not a commercial term.
  ok('but a field worker CAN reach a site supervisor',
    Array.isArray(await field.get('builder_contacts', 'select=id')))
  ok('a field worker cannot rewrite the company ABN',
    (await field.patch('companies', `id=eq.${companyId}`, { abn: '99999999999' })).ok
      ? (await field.get('companies', `select=abn&id=eq.${companyId}`))[0]?.abn !== '99999999999'
      : true)

  // ------------------------------------------------- the money is office-only
  // is_office gated every WRITE and not one READ, so any signed-in field
  // worker could select colleagues' pay, invoices and expenses. Verified
  // against the live database before schema_v14 closed it.
  ok('a field worker reads no invoices', (await field.get('invoices', 'select=id')).length === 0)
  ok('a field worker reads no estimates', (await field.get('estimates', 'select=id')).length === 0)
  ok('a field worker reads no purchase orders', (await field.get('purchase_orders', 'select=id')).length === 0)
  ok('a field worker reads no change orders', (await field.get('change_orders', 'select=id')).length === 0)
  ok('a field worker reads no job budgets', (await field.get('job_money_v', 'select=site_id')).length === 0)
  ok('the office still reads its own invoices', (await boss.get('invoices', `select=id&company_id=eq.${companyId}`)).length > 0)

  // ---------------------------------------------------------- money maths
  const v = (await boss.get('invoice_status_v', `select=id,invoice_no,overdue,outstanding&company_id=eq.${companyId}`))[0]
  ok('overdue is derived, not stored', v.overdue === true && Number(v.outstanding) === 5000)

  // paid_amount and status follow the payment ledger. A part payment is the
  // ordinary case on a progress claim, and it has to leave the invoice open.
  const invId = v.id
  const paidNow = async () => (await boss.get('invoices', `select=paid_amount,status&id=eq.${invId}`))[0]
  const pay = await body(await boss.post('invoice_payments', {
    company_id: companyId, invoice_id: invId, amount: 2000, received_on: day(-1), method: 'bank', reference: 'EFT 1', created_by: bossId,
  }))
  let inv = await paidNow()
  ok('a part payment leaves the invoice open', Number(inv.paid_amount) === 2000 && inv.status === 'sent',
    `paid ${inv.paid_amount}, ${inv.status}`)

  await boss.post('invoice_payments', {
    company_id: companyId, invoice_id: invId, amount: 3000, received_on: day(0), method: 'bank', reference: 'EFT 2', created_by: bossId,
  })
  inv = await paidNow()
  ok('the balance marks it paid without anyone setting it', Number(inv.paid_amount) === 5000 && inv.status === 'paid')

  const stillOverdue = (await boss.get('invoice_status_v', `select=overdue,outstanding&id=eq.${invId}`))[0]
  ok('paying a late invoice clears overdue', stillOverdue.overdue === false && Number(stillOverdue.outstanding) === 0)

  await boss.del('invoice_payments', `id=eq.${pay[0].id}`)
  inv = await paidNow()
  ok('reversing a payment reopens the invoice', Number(inv.paid_amount) === 3000 && inv.status === 'sent')

  // The ledger is the system of record — a hand-written paid_amount must not
  // survive the next payment, or the two disagree silently.
  await boss.patch('invoices', `id=eq.${invId}`, { paid_amount: 4999 })
  await boss.post('invoice_payments', { company_id: companyId, invoice_id: invId, amount: 1, received_on: day(0), method: 'other' })
  inv = await paidNow()
  ok('a hand-written paid_amount is overwritten by the ledger', Number(inv.paid_amount) === 3001, `paid_amount ${inv.paid_amount}`)

  ok('a field worker cannot record a payment',
    (await field.post('invoice_payments', { company_id: companyId, invoice_id: invId, amount: 500, received_on: day(0), method: 'cash' })).status === 403)

  const mats = await body(await boss.post('materials', [
    { company_id: companyId, site_id: site.id, name: '90x45 MGP10', quantity: 126.5, unit: 'lm', unit_cost: '8.42', cost_code: '06-110', supplier: 'Bowens', status: 'delivered', created_by: bossId },
    { company_id: companyId, site_id: site.id, name: 'Sent back', quantity: 10, unit: 'ea', unit_cost: '99.00', cost_code: '06-110', supplier: 'Bowens', status: 'returned', created_by: bossId },
  ]))
  ok('generated total_cost is exact', Number(mats[0].total_cost) === 1065.13, `$${mats[0].total_cost}`)
  const forge = await boss.post('materials', { company_id: companyId, site_id: site.id, name: 'Forged', quantity: 1, unit_cost: '1.00', total_cost: '99999.00' })
  ok('a generated column cannot be written', forge.status === 400, `HTTP ${forge.status}`)

  // ------------------------------------------- the contract (schema_v17)
  // Everything commercial used to be measured against job_sites.contract_value:
  // a column with no writer anywhere in the app, that an approved variation
  // changed not at all.
  // Its own job site, so every figure below is exact rather than a delta on
  // whatever the invoice tests left on Smoke Site.
  const csite = (await body(await boss.post('job_sites', {
    company_id: companyId, name: 'Contract Site', lat: -34.9285, lng: 138.6007, radius_m: 150,
  })))[0]

  const contract = (await body(await boss.post('contracts', {
    company_id: companyId, site_id: csite.id, contract_no: 'C-2291',
    contract_sum: 80000, gst_inclusive: false, retention_pct: 5, status: 'active',
  })))[0]
  ok('the office can enter a contract', Boolean(contract?.id), contract?.contract_no)

  const dupe = await boss.post('contracts', { company_id: companyId, site_id: csite.id, contract_sum: 1 })
  ok('a job cannot carry two contracts', dupe.status === 409, `HTTP ${dupe.status}`)

  const vo = (await body(await boss.post('change_orders', [
    { company_id: companyId, site_id: csite.id, contract_id: contract.id, co_no: 'VO-1', description: 'Extra wet area', cost_impact: 12000, status: 'draft' },
    { company_id: companyId, site_id: csite.id, contract_id: contract.id, co_no: 'VO-2', description: 'Feature niche', cost_impact: 6400, status: 'pending_client' },
  ])))
  const voId = vo.find((r) => r.co_no === 'VO-1').id
  ok('a draft variation carries no approval date', vo.every((r) => r.approved_on === null))

  const jv = async () => (await boss.get('job_value_v', `select=*&site_id=eq.${csite.id}`))[0]
  let value = await jv()
  ok('an unapproved variation adds nothing to the contract',
    Number(value.job_value_ex) === 80000 && Number(value.pending_variations) === 6400,
    `value ${value.job_value_ex}, pending ${value.pending_variations}`)

  await boss.patch('change_orders', `id=eq.${voId}`, { status: 'approved' })
  const approved = (await boss.get('change_orders', `select=approved_on&id=eq.${voId}`))[0]
  ok('approving stamps the date in the database, not the client', approved.approved_on === day(0), approved.approved_on)

  value = await jv()
  ok('an approved variation goes on the contract',
    Number(value.job_value_ex) === 92000 && Number(value.job_value_inc) === 101200,
    `${value.job_value_ex} ex / ${value.job_value_inc} inc`)

  // Walking it back must take the authority to bill with it.
  await boss.patch('change_orders', `id=eq.${voId}`, { status: 'rejected' })
  ok('declining clears the approval date',
    (await boss.get('change_orders', `select=approved_on&id=eq.${voId}`))[0].approved_on === null)
  ok('declining takes the value back off the contract', Number((await jv()).job_value_ex) === 80000)
  await boss.patch('change_orders', `id=eq.${voId}`, { status: 'approved' })

  // A claim lands on the contract, and only a SENT claim counts as claimed.
  await boss.post('invoices', [
    { company_id: companyId, site_id: csite.id, contract_id: contract.id, invoice_no: `C1-${stamp}`, amount: 44000, tax_amount: 4000, retention_pct: 5, retention_amount: 2000, status: 'sent' },
    { company_id: companyId, site_id: csite.id, contract_id: contract.id, invoice_no: `C2-${stamp}`, amount: 99000, tax_amount: 9000, status: 'draft' },
  ])
  value = await jv()
  ok('a draft claim is not a claim',
    Number(value.claimed_inc) === 44000 && Number(value.draft_invoice_count) === 1,
    `claimed ${value.claimed_inc}, ${value.draft_invoice_count} draft`)
  ok('left to claim is job value less what has been claimed',
    Number(value.to_claim_inc) === 57200, `${value.to_claim_inc}`)
  ok('retention held comes off the claims', Number(value.retention_held) === 2000)

  ok('a field worker reads no contracts', (await field.get('contracts', 'select=id')).length === 0)
  ok('a field worker reads no job value', (await field.get('job_value_v', 'select=site_id')).length === 0)
  ok('a field worker cannot enter a contract',
    (await field.post('contracts', { company_id: companyId, site_id: csite.id, contract_sum: 1 })).status === 403)

  // ---------------------------------------- the captain tier (schema_v18)
  // Checked through PostgREST rather than only in SQL, because the REST layer
  // is the actual attack surface: a policy can be right and still be reachable
  // around if a view or an embed exposes the table another way.
  const capEmail = `smoke-captain-${stamp}@mailinator.com`
  await boss.post('workers', {
    company_id: companyId, name: 'Lead Hand', initials: 'LH',
    trade: 'Tiler', rate: 62, role: 'captain', invite_email: capEmail,
  })
  const capRow = (await boss.get('workers', `select=id,is_office,role&invite_email=eq.${capEmail}`))[0]
  ok('a captain is not office', capRow.role === 'captain' && capRow.is_office === false)

  const captain = await user(capEmail)
  await fetch(`${APP}/api/bootstrap`, { method: 'POST', headers: captain.H, body: JSON.stringify({}) })
  await boss.patch('job_sites', `id=eq.${csite.id}`, { captain_id: capRow.id })

  ok('a captain sees their own job\'s variations',
    (await captain.get('change_orders', `select=id&site_id=eq.${csite.id}`)).length > 0)
  ok('a captain reads no contracts', (await captain.get('contracts', 'select=id')).length === 0)
  ok('a captain reads no invoices', (await captain.get('invoices', 'select=id')).length === 0)
  ok('a captain reads no job value', (await captain.get('job_value_v', 'select=site_id')).length === 0)
  ok('a captain reads no job profit', (await captain.get('job_profit_v', 'select=site_id')).length === 0)
  ok('a captain reads no company overview', (await captain.get('company_overview_v', 'select=active_jobs')).length === 0)

  // -------------------------------------------- site records (schema_v19)
  ok('anyone in the company can raise a defect',
    (await field.post('defects', {
      company_id: companyId, site_id: site.id, location: 'Ensuite',
      description: 'Chipped tile beside the waste',
    })).ok)

  const defect = (await body(await boss.post('defects', {
    company_id: companyId, site_id: site.id, description: 'Grout cracked', cost_estimate: 480,
  })))[0]
  await field.patch('defects', `id=eq.${defect.id}`, { severity: 'critical' })
  ok('but a field worker cannot edit one',
    (await boss.get('defects', `select=severity&id=eq.${defect.id}`))[0].severity === 'minor')

  const wp = (await body(await boss.post('waterproofing', {
    company_id: companyId, site_id: site.id, area: 'Ensuite',
    product_name: 'Ardex WPM 300', batch_no: 'B-4471', status: 'in_progress',
  })))[0]
  await boss.patch('waterproofing', `id=eq.${wp.id}`, {
    status: 'signed_off', signed_off_name: 'Somebody Else', signed_off_at: '2020-01-01T00:00:00Z',
  })
  const signed = (await boss.get('waterproofing', `select=signed_off_name,signed_off_at&id=eq.${wp.id}`))[0]
  ok('a waterproofing sign-off is stamped from identity, not the form',
    signed.signed_off_name === 'Smoke Boss' && signed.signed_off_at.slice(0, 4) !== '2020',
    `${signed.signed_off_name}, ${signed.signed_off_at}`)

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
