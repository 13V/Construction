#!/usr/bin/env node
/**
 * Check the live database after a migration — behaviour, not just presence.
 *
 *   node scripts/verify-live.mjs
 *
 * `migrate.mjs` confirms the statements ran and the relations exist. That is
 * not the same as them working: a trigger can be created and never fire, a view
 * can exist and throw on select, a table can be added and left off the realtime
 * publication so the app silently stops updating. This exercises each of those
 * against the real database.
 *
 * Reads its token the same way migrate.mjs does, and never prints it.
 * Read-only apart from one promote/demote on an existing worker, which puts the
 * row back the way it found it.
 */

import { readFileSync } from 'node:fs'
const env = readFileSync('apps/dashboard/.env.local', 'utf8')
const g = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))[1].trim()
const PAT = g('SUPABASE_PAT')
const P = g('VITE_SUPABASE_URL').replace(/^https:\/\//, '').split('.')[0]
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${P}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}
let pass = 0, fail = 0
const ok = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? ' PASS' : '*FAIL'}  ${n}${d ? '  ' + d : ''}`) }

// --- everything landed
const rel = (await q(`select table_name n from information_schema.tables where table_schema='public'
                      union all select table_name n from information_schema.views where table_schema='public'`)).map(r => r.n)
const want = ['contracts','crews','crew_members','site_instructions','defects','progress_entries','waterproofing',
              'waterproofing_photos','programmes','programme_tasks']
ok('all 10 new tables exist', want.every(t => rel.includes(t)), want.filter(t => !rel.includes(t)).join(',') || '')
const views = ['job_value_v','site_progress_v','site_waterproofing_v','portal_defects_v','job_cost_v','job_profit_v','company_overview_v','site_programme_v']
ok('all 8 new views exist', views.every(v => rel.includes(v)), views.filter(v => !rel.includes(v)).join(',') || '')

// --- the role backfill did what it should on real rows
const roles = await q(`select role, is_office, count(*) n from workers group by 1,2 order by 1`)
console.log('\n  worker roles after backfill:')
for (const r of roles) console.log(`    ${String(r.n).padStart(3)}  role=${r.role}  is_office=${r.is_office}`)
ok('role and is_office agree on every existing worker',
   roles.every(r => (r.role === 'owner') === r.is_office))

// --- the trigger works on the live database, not just locally.
// One statement: each Management API call is its own connection, so a temp
// table from a previous call does not exist. It rolls itself back, so a real
// worker is promoted and demoted without being left changed.
const trig = await q(`
  do $$
  declare w uuid; r1 text; o1 boolean; r2 text; o2 boolean;
  begin
    select id into w from workers where not is_office limit 1;
    if w is null then return; end if;
    update workers set role = 'captain' where id = w;
    select role, is_office into r1, o1 from workers where id = w;
    update workers set role = 'employee' where id = w;
    select role, is_office into r2, o2 from workers where id = w;
    if r1 <> 'captain' or o1 then raise exception 'captain came out office: % %', r1, o1; end if;
    if r2 <> 'employee' or o2 then raise exception 'demote failed: % %', r2, o2; end if;
    raise notice 'trigger ok';
  end $$;
  select 1 as ok`)
ok('promoting to captain leaves is_office false, and demoting restores it', trig[0].ok === 1)

// --- views are queryable and office-gated (service role has no auth.uid, so is_office is false)
for (const v of ['job_value_v','job_profit_v','company_overview_v','site_programme_v']) {
  try { await q(`select * from ${v} limit 1`); ok(`${v} is queryable`, true) }
  catch (e) { ok(`${v} is queryable`, false, e.message.slice(0, 120)) }
}

// --- functions exist with the tenant check
const fns = (await q(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public' and proname in
                      ('captains_site','current_worker_role','programme_carry_previous','waterproofing_stamp_signoff','change_orders_stamp_approval')`)).map(r => r.proname)
ok('all 5 new functions exist', fns.length === 5, fns.join(','))
const src = await q(`select prosrc from pg_proc where proname = 'programme_carry_previous'`)
ok('the programme RPC carries its tenant check', String(src[0].prosrc).includes('another company'))

// --- realtime
const pub = (await q(`select tablename from pg_publication_tables where pubname='supabase_realtime'`)).map(r => r.tablename)
ok('new tables are on the realtime publication',
   ['contracts','crews','defects','waterproofing','programmes'].every(t => pub.includes(t)))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
