#!/usr/bin/env node
/**
 * Apply the pending migrations to the live database.
 *
 *   node scripts/migrate.mjs            # what would run, and nothing else
 *   node scripts/migrate.mjs --apply    # actually run them
 *
 * Reads SUPABASE_PAT and SUPABASE_URL from the environment, falling back to
 * apps/dashboard/.env.local. The token is never printed and never written
 * anywhere.
 *
 * Why this exists rather than pasting into the SQL editor: the editor gives you
 * no record of what ran, and DEPLOY.md's whole warning is about a run that
 * stops half way. This checks what is already there, runs only what is missing,
 * wraps each file in its own transaction so a failure rolls that file back
 * whole, and stops at the first error instead of ploughing on — which is
 * exactly the failure that has bitten this project twice.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Migrations in DEPLOY.md's order, with what each one should leave behind. */
const MIGRATIONS = [
  // schema.sql is in this list because schema_v24 changed it: worker_pay is
  // declared there, next to workers, and schema_v20's job_cost_v reads it —
  // so it has to exist before v20 runs, not after v24. The file is idempotent
  // (create table if not exists throughout, and scripts/schema-check.sh
  // applies the whole chain three times over to prove it), so re-running it on
  // a database that is already at v23 is a no-op apart from the new table.
  { file: 'schema.sql', proves: ['worker_pay'] },
  { file: 'schema_v17.sql', proves: ['contracts', 'job_value_v'] },
  { file: 'schema_v18.sql', proves: ['crews', 'crew_members'] },
  { file: 'schema_v19.sql', proves: ['defects', 'site_instructions', 'progress_entries', 'waterproofing'] },
  { file: 'schema_v20.sql', proves: ['job_cost_v', 'job_profit_v', 'company_overview_v'] },
  { file: 'schema_v21.sql', proves: ['programmes', 'programme_tasks', 'site_programme_v'] },
  // v22 and v23 add no tables — a retention function and a deletion RPC. Probing
  // for a relation would never see them, so these are proved by the routines
  // themselves; `proves` is matched against functions as well as relations.
  { file: 'schema_v22.sql', proves: ['prune_positions'] },
  { file: 'schema_v23.sql', proves: ['delete_worker_account'] },
  { file: 'schema_v24.sql', proves: ['crew_v', 'site_variations_v'] },
  // Column-only migration: proven by table.column, which the probe also lists.
  { file: 'schema_v25.sql', proves: ['job_sites.colour'] },
  // v26 created worker_avatars; v27 renamed it to worker_profiles, so the
  // proof of v26 having run is the table under its later name.
  { file: 'schema_v26.sql', proves: ['worker_profiles'] },
  { file: 'schema_v27.sql', proves: ['worker_profiles.phone', 'certifications.document_path'] },
  { file: 'schema_v28.sql', proves: ['selections.scope_key', 'site_notes'] },
  { file: 'schema_v29.sql', proves: ['site_files.selection_id'] },
  { file: 'schema_v30.sql', proves: ['waterproofing_packages', 'site_files.wp_step', 'companies.legal_name'] },
  { file: 'schema_v31.sql', proves: ['safety_documents.storage_path', 'safety_documents.expires_on', 'safety_shelf_v'] },
  { file: 'schema_v32.sql', proves: ['builder_contacts_role_check_v32'] },
  { file: 'schema_v33.sql', proves: ['job_sites.starts_on', 'job_sites.ends_on'] },
  { file: 'schema_v34.sql', proves: ['shifts_read_v34', 'channels_dm_create', 'channel_members_dm_join'] },
  { file: 'schema_v35.sql', proves: ['safety_documents.content'] },
]

// ------------------------------------------------------------- credentials

function fromEnvFile(key) {
  try {
    const text = readFileSync(join(ROOT, 'apps/dashboard/.env.local'), 'utf8')
    return text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

const URL_ = process.env.SUPABASE_URL ?? fromEnvFile('VITE_SUPABASE_URL') ?? fromEnvFile('SUPABASE_URL')
const PAT = process.env.SUPABASE_PAT ?? fromEnvFile('SUPABASE_PAT')

if (!URL_) {
  console.error('No Supabase URL. Set SUPABASE_URL, or VITE_SUPABASE_URL in apps/dashboard/.env.local.')
  process.exit(2)
}
if (!PAT) {
  console.error(
    [
      'No Supabase access token.',
      '',
      'Add one line to apps/dashboard/.env.local:',
      '',
      '    SUPABASE_PAT=sbp_...',
      '',
      'Generate it at Supabase → Account → Access Tokens. Or export SUPABASE_PAT',
      'in the shell. It is read, used against the Management API, and never',
      'printed or stored anywhere by this script.',
    ].join('\n'),
  )
  process.exit(2)
}

const PROJECT = URL_.replace(/^https:\/\//, '').split('.')[0]
const API = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`

/** Run SQL through the Management API. Returns rows, or throws with the server's message. */
async function sql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = text
  }
  if (!res.ok) {
    const detail = typeof payload === 'string' ? payload.slice(0, 400) : (payload.message ?? JSON.stringify(payload).slice(0, 400))
    throw new Error(`HTTP ${res.status}: ${detail}`)
  }
  return payload
}

// ------------------------------------------------------------------- main

const apply = process.argv.includes('--apply')

try {
  const who = await sql('select current_database() as db, version() as v')
  console.log(`connected to ${PROJECT} · ${who[0].db} · ${String(who[0].v).split(' ').slice(0, 2).join(' ')}\n`)

  // What is already there. A relation is a relation whether it is a table or a
  // view, so both are counted the same way.
  const present = new Set(
    (
      await sql(`select table_name as n from information_schema.tables where table_schema = 'public'
                 union all
                 select table_name as n from information_schema.views where table_schema = 'public'
                 union all
                 select p.proname as n from pg_proc p
                   join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public'
                 union all
                 select table_name || '.' || column_name as n
                   from information_schema.columns where table_schema = 'public'
                 union all
                 select c.conname as n from pg_constraint c
                   join pg_namespace ns on ns.oid = c.connamespace
                  where ns.nspname = 'public'
                 union all
                 select policyname as n from pg_policies where schemaname = 'public'`)
    ).map((r) => r.n),
  )

  const pending = MIGRATIONS.filter((m) => !m.proves.every((t) => present.has(t)))

  for (const m of MIGRATIONS) {
    const done = m.proves.every((t) => present.has(t))
    console.log(` ${done ? '✓' : '·'} ${m.file}${done ? '' : `   missing: ${m.proves.filter((t) => !present.has(t)).join(', ')}`}`)
  }

  if (pending.length === 0) {
    console.log('\nNothing to do — the database is up to date.')
    process.exit(0)
  }

  if (!apply) {
    console.log(`\n${pending.length} migration(s) would run. Re-run with --apply.`)
    process.exit(0)
  }

  console.log('')
  for (const m of pending) {
    const body = readFileSync(join(ROOT, 'supabase', m.file), 'utf8')
    process.stdout.write(`applying ${m.file} … `)
    try {
      // Its own transaction: a failure rolls that file back whole rather than
      // leaving the schema half-changed.
      await sql(`begin;\n${body}\ncommit;`)
    } catch (err) {
      console.log('FAILED')
      console.error(`\n${err.message}\n`)
      console.error('Rolled back. Nothing after this ran — fix and re-run.')
      process.exit(1)
    }
    console.log('ok')
  }

  // Verify against the database rather than trusting that the statements ran.
  const after = new Set(
    (
      await sql(`select table_name as n from information_schema.tables where table_schema = 'public'
                 union all
                 select table_name as n from information_schema.views where table_schema = 'public'
                 union all
                 select p.proname as n from pg_proc p
                   join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public'
                 union all
                 select table_name || '.' || column_name as n
                   from information_schema.columns where table_schema = 'public'
                 union all
                 select c.conname as n from pg_constraint c
                   join pg_namespace ns on ns.oid = c.connamespace
                  where ns.nspname = 'public'
                 union all
                 select policyname as n from pg_policies where schemaname = 'public'`)
    ).map((r) => r.n),
  )
  const missing = MIGRATIONS.flatMap((m) => m.proves).filter((t) => !after.has(t))
  if (missing.length) {
    console.error(`\nApplied without error, but these are still missing: ${missing.join(', ')}`)
    process.exit(1)
  }
  console.log('\nAll migrations applied and verified.')
} catch (err) {
  console.error(`\n${err.message}`)
  if (String(err.message).includes('401') || String(err.message).includes('403')) {
    console.error('That token was rejected. Generate a fresh one at Supabase → Account → Access Tokens.')
  }
  process.exit(1)
}
