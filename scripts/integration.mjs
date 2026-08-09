#!/usr/bin/env node
/**
 * Cross-surface integration test.
 *
 *   SUPABASE_ANON_KEY=... SUPABASE_PAT=sbp_... node scripts/integration.mjs
 *
 * scripts/smoke.mjs proves each surface obeys RLS on its own. This proves the
 * surfaces actually reach each other, which is a different question and the
 * one that breaks quietly: the phone, the office dashboard and the client
 * portal are three apps over one database, and nothing in a unit test notices
 * when a trigger stops firing or a realtime publication drops a table.
 *
 * The path exercised end to end:
 *
 *   phone --/api/ping--> geofence engine --> shift --> office (realtime)
 *   phone --> photo --> office
 *   office <--> phone   chat, both ways, over realtime
 *   office --> roster --> phone's notification
 *   client portal       sees the job, and none of the crew's hours
 *
 * Run it after any schema change, any change to api/ping.ts, and before a
 * release. It creates a throwaway company and deletes it.
 */

import { createClient } from '../apps/dashboard/node_modules/@supabase/supabase-js/dist/index.mjs'
const SB = process.env.SUPABASE_URL ?? 'https://vkpdlsxiporsmqlfjvjw.supabase.co'
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.ANON ?? ''
const APP = process.env.APP_URL ?? 'https://construction-opal-three.vercel.app'
const PAT = process.env.SUPABASE_PAT ?? ''
const PROJECT = SB.replace(/^https:\/\//, '').split('.')[0]

if (!ANON || !PAT) {
  console.error('Set SUPABASE_ANON_KEY and SUPABASE_PAT.')
  process.exit(2)
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  return r.text()
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
/** Signup needs a real inbox now, so test users are minted pre-confirmed. */
async function newConfirmedUser(email) {
  const key = await service()
  await fetch(`${SB}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  })
  const d = await (await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })).json()
  if (!d.access_token) throw new Error(`sign-in failed for ${email}`)
  const H = { Authorization: `Bearer ${d.access_token}`, apikey: ANON, 'Content-Type': 'application/json' }
  return { userId: d.user.id, H, HR: { ...H, Prefer: 'return=representation' } }
}
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? ' PASS' : '*FAIL'}  ${n}${x ? '  ' + x : ''}`) }
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return t.slice(0, 240) } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`       ${m}`)
/** Must match src/geofence/dwell.ts. */
const DWELL_OUT_MS = 3 * 60_000

const stamp = Date.now()
/** Origin for the simulated drive. Every ping stamp is T0 + something. */
const T0 = Date.now()
const SITE = { lat: -34.9285, lng: 138.6007 }

// --- the office sets up the job
const boss = await newConfirmedUser(`x-boss-${stamp}@mailinator.com`)
const boot = await j(await fetch(`${APP}/api/bootstrap`, { method: 'POST', headers: boss.H, body: JSON.stringify({ companyName: `CrossApp ${stamp}`, name: 'Ray' }) }))
const co = boot.companyId, bossId = boot.workerId
const site = (await j(await fetch(`${SB}/rest/v1/job_sites`, { method: 'POST', headers: boss.HR, body: JSON.stringify({ company_id: co, name: 'Maple Ridge', lat: SITE.lat, lng: SITE.lng, radius_m: 150, client_name: 'Deb Marchetti' }) })))[0]

// --- a chippie joins from their phone
const fEmail = `x-field-${stamp}@mailinator.com`
const fw = (await j(await fetch(`${SB}/rest/v1/workers`, { method: 'POST', headers: boss.HR, body: JSON.stringify({ company_id: co, name: 'Kane Brooker', initials: 'KB', trade: 'Carpenter', is_office: false, invite_email: fEmail }) })))[0]
const phone = await newConfirmedUser(fEmail)
const claim = await j(await fetch(`${APP}/api/bootstrap`, { method: 'POST', headers: phone.H, body: JSON.stringify({}) }))
ok('the phone claims the crew row the office created', claim.workerId === fw.id)

// --- the office dashboard opens a realtime subscription, as it does on load
const rt = createClient(SB, ANON, { global: { headers: { Authorization: boss.H.Authorization } } })
await rt.realtime.setAuth(boss.H.Authorization.replace('Bearer ', ''))
const live = { shifts: [], messages: [], files: [] }
const chan = rt.channel(`x-${stamp}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, (p) => live.shifts.push(p.new))
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => live.messages.push(p.new))
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_files' }, (p) => live.files.push(p.new))
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('subscribe timeout')), 20000)
  chan.subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(t); res() } })
})

// --- the phone drives to site and dwells, exactly as the native watcher would
const ping = (lat, lng, at) => fetch(`${APP}/api/ping`, { method: 'POST', headers: phone.H, body: JSON.stringify({ lat, lng, accuracyM: 8, at }) }).then(j)

// Well outside the fence first — arriving, not yet there.
let r = await ping(-34.9500, 138.6400, T0 - 10_000)
ok('a fix outside every fence opens no shift', !r.shift && !r.event?.kind?.includes('in'), JSON.stringify(r).slice(0, 90))

// Inside, but only just arrived: the dwell rule must refuse to clock in yet.
r = await ping(SITE.lat, SITE.lng, T0)
const openAfterFirst = await j(await fetch(`${SB}/rest/v1/shifts?select=id&worker_id=eq.${fw.id}&ended_at=is.null`, { headers: boss.H }))
ok('arriving on site does not clock in immediately (dwell)', openAfterFirst.length === 0, `${openAfterFirst.length} open shifts`)

// Still there two and a half minutes later. DWELL_IN_MS is 2 minutes, and the
// server clamps client time to ±5 min, so this is inside what it will accept.
r = await ping(SITE.lat + 0.0001, SITE.lng, T0 + 150_000)
await wait(1500)
const open = await j(await fetch(`${SB}/rest/v1/shifts?select=id,site_id,started_at&worker_id=eq.${fw.id}&ended_at=is.null`, { headers: boss.H }))
ok('dwelling on site clocks the worker in, server-side', open.length === 1 && open[0].site_id === site.id,
  open.length ? `shift on ${open[0].site_id === site.id ? 'the right site' : 'WRONG site'}` : 'no shift')

await wait(3000)
ok('the office dashboard is told about the shift over realtime, no refresh',
  live.shifts.length > 0, `${live.shifts.length} shift events pushed`)

// --- and then they leave.
//
// This is the assertion that was missing, and its absence hid the worst bug in
// the product for weeks. shifts_worker_guard is a trigger, and triggers are
// NOT bypassed by the service role the way RLS is — so the geofence engine
// could open a shift and was then refused permission to close it. The shift
// stayed open, shifts_no_overlap treated it as running to infinity, the next
// day's clock-in collided with it, and the worker silently stopped being
// tracked. Everything above this line passed the whole time.
//
// DWELL_OUT_MS is 3 minutes and the server clamps client time to +/-5 min, so
// the exit is driven at +4 minutes: far enough out to trip the dwell, near
// enough that the clamp still accepts it.
const away = { lat: -34.9600, lng: 138.6500 }

// Timestamps have to keep moving FORWARD. The clock-in above was driven at
// T0+150s, so the engine's state already sits 150s in the future; an exit ping
// at real `now` would go backwards and be ignored. And the two dwells cannot
// both fit inside the +/-5 min clamp (120 + 180 = 300s exactly), so the clock
// is advanced virtually while real time is allowed to catch up underneath it.
await ping(away.lat, away.lng, T0 + 160_000)     // outside: the exit dwell starts
log('letting real time catch up so the next stamp stays inside the clamp…')
await wait(105_000)
await ping(away.lat, away.lng, T0 + 345_000)     // 185s later: past DWELL_OUT_MS
await wait(2500)

const closed = await j(await fetch(`${SB}/rest/v1/shifts?select=id,started_at,ended_at&worker_id=eq.${fw.id}&order=started_at.desc`, { headers: boss.H }))
ok('leaving the site closes the shift', closed.length > 0 && closed[0].ended_at !== null,
  closed.length ? `ended_at ${closed[0].ended_at ?? 'STILL NULL'}` : 'no shift at all')

// The point of closing it: the worker can clock in again tomorrow. An open
// shift blocks the next one through shifts_no_overlap, which is how a failed
// clock-out turned into a worker who stopped being tracked entirely.
const openNow = await j(await fetch(`${SB}/rest/v1/shifts?select=id&worker_id=eq.${fw.id}&ended_at=is.null`, { headers: boss.H }))
ok('no shift is left open to block the next clock-in', openNow.length === 0, `${openNow.length} still open`)

// --- chat, both directions
const chans = await j(await fetch(`${SB}/rest/v1/channels?select=id,site_id&company_id=eq.${co}`, { headers: boss.H }))
const chatId = chans.find((c) => c.site_id === site.id)?.id
await fetch(`${SB}/rest/v1/messages`, { method: 'POST', headers: boss.HR, body: JSON.stringify({ company_id: co, channel_id: chatId, author_id: bossId, body: 'Sparky is coming at 2.' }) })
await fetch(`${SB}/rest/v1/messages`, { method: 'POST', headers: phone.HR, body: JSON.stringify({ company_id: co, channel_id: chatId, author_id: fw.id, body: 'Righto, framing done by then.' }) })
const thread = await j(await fetch(`${SB}/rest/v1/messages?select=body,kind&channel_id=eq.${chatId}&order=created_at`, { headers: phone.H }))
ok('office and phone see the same conversation',
  thread.filter((m) => m.kind === 'user').length === 2, thread.map((m) => m.body.slice(0, 16)).join(' / '))
// The geofence engine is a participant in the chat too: clocking in posts a
// system line into the site's channel, so the office reads it as it happens.
ok('the clock-in announces itself in the site chat',
  thread.some((m) => m.kind === 'system' && /clocked in/.test(m.body)),
  thread.find((m) => m.kind === 'system')?.body ?? '(no system message)')
await wait(2500)
ok('chat reaches the dashboard over realtime', live.messages.length >= 2, `${live.messages.length} pushed`)

// --- the office rosters them; the phone must find out
const asg = (await j(await fetch(`${SB}/rest/v1/assignments`, { method: 'POST', headers: boss.HR, body: JSON.stringify({ company_id: co, site_id: site.id, worker_id: fw.id, starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: new Date(Date.now() + 115200000).toISOString(), published: false }) })))[0]
await fetch(`${SB}/rest/v1/assignments?id=eq.${asg.id}`, { method: 'PATCH', headers: boss.HR, body: JSON.stringify({ published: true }) })
const notices = await j(await fetch(`${SB}/rest/v1/notifications?select=kind,title&worker_id=eq.${fw.id}`, { headers: phone.H }))
ok('publishing a roster notifies the phone', notices.some((n) => n.kind === 'roster_published'), notices.map((n) => n.kind).join(','))

// --- a photo from the phone lands in the office
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const path = `${co}/${site.id}/${crypto.randomUUID()}.png`
await fetch(`${SB}/storage/v1/object/site-files/${path}`, { method: 'POST', headers: { ...phone.H, 'Content-Type': 'image/png' }, body: png })
await fetch(`${SB}/rest/v1/site_files`, { method: 'POST', headers: phone.HR, body: JSON.stringify({ company_id: co, site_id: site.id, uploaded_by: fw.id, kind: 'photo', storage_path: path, name: 'frame.png', mime: 'image/png', size_bytes: png.length, category: 'progress', caption: 'North wall framed' }) })
const seen = await j(await fetch(`${SB}/rest/v1/site_files?select=caption&site_id=eq.${site.id}`, { headers: boss.H }))
ok('a photo from the phone shows up for the office', seen.some((f) => f.caption === 'North wall framed'))

// --- the client portal is a third app on the same data
const cEmail = `x-client-${stamp}@mailinator.com`
const client = await newConfirmedUser(cEmail)
await fetch(`${SB}/rest/v1/portal_contacts`, { method: 'POST', headers: boss.HR, body: JSON.stringify({ company_id: co, site_id: site.id, kind: 'client', name: 'Deb Marchetti', invite_email: cEmail, auth_user_id: client.userId, active: true }) })
const pSites = await j(await fetch(`${SB}/rest/v1/portal_site_v?select=name`, { headers: client.H }))
const pShifts = await j(await fetch(`${SB}/rest/v1/shifts?select=id`, { headers: client.H }))
const pWorkers = await j(await fetch(`${SB}/rest/v1/workers?select=id`, { headers: client.H }))
ok('the client portal sees their job but not the crew or their hours',
  pSites.length === 1 && pSites[0].name === 'Maple Ridge' && pShifts.length === 0 && pWorkers.length === 0,
  `site "${pSites[0]?.name ?? '-'}", ${pShifts.length} shifts, ${pWorkers.length} workers`)

await chan.unsubscribe()
await sql(`delete from companies where id = '${co}'`)
await sql(`delete from auth.users where email like 'x-%${stamp}@mailinator.com'`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
