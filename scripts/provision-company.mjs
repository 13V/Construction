/**
 * Set up a real company — the one-time step between "signed up" and "ready to
 * run a job on".
 *
 * Signing up creates a company with nothing in it but a name (api/bootstrap.ts
 * has nothing else to go on). Two things are then missing that a business
 * notices only at the worst moment:
 *
 *   - The compliance details. A tax invoice with no ABN can have its GST
 *     credit refused; a waterproofing certificate with no builders licence on
 *     it is a letter, not a certificate. Both documents render what is there
 *     and silently omit what is not, so the gap is invisible until a builder
 *     declines to pay.
 *
 *   - The SWMS template. Every issued statement is a copy of it, and a
 *     five-column risk register is not something anybody is going to type into
 *     a phone. The client's own S812.0267 lives in scripts/swms-template.json
 *     and is installed from here.
 *
 * The details are also editable in the app now (Me → Business details), so
 * this is a convenience, not a lock-in: everything it writes can be changed
 * later by the office from the phone. The SWMS template is the part that
 * genuinely cannot be done by hand.
 *
 * Deliberately NOT bundled into the app: S812.0267 was written by the client's
 * safety consultant and paid for by the client. It belongs in their tenant,
 * not in every copy of the binary for every future customer.
 *
 * Usage:
 *   node scripts/provision-company.mjs --email zep@example.com [--dry-run]
 *   node scripts/provision-company.mjs --company "Proven Tiling Solutions"
 *
 * Idempotent: run it again after fixing a detail and it patches rather than
 * duplicates.
 */
import { readFileSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url)

function fromEnvFile(key) {
  try {
    const text = readFileSync(new URL('apps/dashboard/.env.local', ROOT), 'utf8')
    return text.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1]?.trim()
  } catch {
    return undefined
  }
}

const URL_ = process.env.SUPABASE_URL ?? fromEnvFile('VITE_SUPABASE_URL') ?? fromEnvFile('SUPABASE_URL')
const PAT = process.env.SUPABASE_PAT ?? fromEnvFile('SUPABASE_PAT')
if (!URL_ || !PAT) {
  console.error('Need VITE_SUPABASE_URL and SUPABASE_PAT in apps/dashboard/.env.local (or the environment).')
  process.exit(2)
}
const PROJECT = URL_.replace(/^https:\/\//, '').split('.')[0]
const API = `https://api.supabase.com/v1/projects/${PROJECT}/database/query`

async function sql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  return JSON.parse(text)
}

/** Single-quote escaping for a SQL literal. */
const lit = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const DRY = argv.includes('--dry-run')
const email = arg('email')
const companyName = arg('company')
if (!email && !companyName) {
  console.error('Give --email <the owner\'s login> or --company "<name>".')
  process.exit(2)
}

/**
 * The client's own details, off their Certificate of Compliance letterhead and
 * their SWMS. Anything genuinely unknown is left null rather than guessed —
 * a wrong address on a legal document is worse than a blank one, and the app
 * now shows exactly which fields are still missing.
 */
const PROVEN = {
  match: /proven tiling/i,
  name: 'Proven Tiling Solutions',
  legal_name: null,
  abn: '72101512485',
  acn: null,
  licence_no: 'BLD 187384',
  certifier_name: 'Giuseppe Ciccone',
  address: null, // Zep to add in the app — not on any document I have.
  phone: '0412 705 243',
  email: null,
  gst_registered: true,
}

// ------------------------------------------------------------------- the work

const swmsSource = JSON.parse(readFileSync(new URL('swms-template.json', import.meta.url), 'utf8'))

/**
 * The template keeps what belongs to every job; the per-job facts in the
 * source's `document` block (the project, the principal contractor, the job
 * description it happened to be issued against) are dropped, because they get
 * stamped fresh on whatever job it is next issued to.
 */
function templateContent(src) {
  const doc = src.document ?? {}
  const { preparedOn, ...signOff } = src.signOff ?? {}
  void preparedOn
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
    signOff,
  }
}

try {
  const who = await sql('select current_database() as db')
  console.log(`connected to ${PROJECT} · ${who[0].db}\n`)

  const found = email
    ? await sql(`
        select c.id, c.name, w.id as worker_id, w.name as worker, w.role, w.is_office
          from auth.users u
          join workers w on w.auth_user_id = u.id
          join companies c on c.id = w.company_id
         where lower(u.email) = lower(${lit(email)})`)
    : await sql(`select id, name, null::uuid as worker_id, null as worker, null as role, null as is_office
                   from companies where name ilike ${lit(companyName)}`)

  if (!found.length) {
    console.error(
      email
        ? `No account for ${email}. They need to sign up in the app first — this fills in the company they land in.`
        : `No company named "${companyName}".`,
    )
    process.exit(1)
  }
  const company = found[0]
  console.log(`company  ${company.name} (${company.id})`)
  if (company.worker) console.log(`owner    ${company.worker} · role ${company.role} · office ${company.is_office}`)

  const details = PROVEN.match.test(company.name) ? PROVEN : null
  if (!details) {
    console.log('\nNo stored details for this company — installing the SWMS template only.')
    console.log('Fill the compliance fields in the app: Me → Business details.')
  }

  if (DRY) {
    console.log('\n--dry-run: nothing written.')
    process.exit(0)
  }

  // The founder must own the company. Accounts created before bootstrap.ts
  // set this defaulted to 'employee', which left the sole administrator
  // outside the guard that stops them deleting the company's last owner.
  if (company.worker_id && company.role !== 'owner') {
    await sql(`update workers set role = 'owner' where id = ${lit(company.worker_id)}`)
    console.log(`  ✓ ${company.worker} is now an owner (was ${company.role})`)
  }

  if (details) {
    // Only fills blanks. Anything already typed in the app wins — this script
    // must never quietly overwrite a correction somebody made on the phone.
    const sets = [
      `name = coalesce(nullif(name, ''), ${lit(details.name)})`,
      `abn = coalesce(abn, ${lit(details.abn)})`,
      `licence_no = coalesce(licence_no, ${lit(details.licence_no)})`,
      `certifier_name = coalesce(certifier_name, ${lit(details.certifier_name)})`,
      `phone = coalesce(phone, ${lit(details.phone)})`,
      `legal_name = coalesce(legal_name, ${lit(details.legal_name)})`,
      `address = coalesce(address, ${lit(details.address)})`,
      `email = coalesce(email, ${lit(details.email)})`,
      `gst_registered = ${details.gst_registered ? 'true' : 'false'}`,
    ]
    const updated = await sql(
      `update companies set ${sets.join(', ')} where id = ${lit(company.id)} returning abn, licence_no, certifier_name, address, phone`,
    )
    const row = updated[0]
    console.log('  ✓ compliance details')
    for (const [k, v] of Object.entries(row)) {
      console.log(`      ${k.padEnd(15)} ${v ?? '— still blank, add it in the app'}`)
    }
  }

  const content = templateContent(swmsSource)
  const existing = await sql(
    `select id from safety_documents where company_id = ${lit(company.id)} and is_template and kind = 'swms' limit 1`,
  )
  const payload = {
    title: content.activity,
    version: content.documentNo,
    content: JSON.stringify(content),
  }
  if (existing.length) {
    await sql(`
      update safety_documents
         set title = ${lit(payload.title)}, version = ${lit(payload.version)},
             content = ${lit(payload.content)}::jsonb, updated_at = now()
       where id = ${lit(existing[0].id)}`)
    console.log(`  ✓ SWMS template updated (${content.tasks.length} task rows)`)
  } else {
    await sql(`
      insert into safety_documents (company_id, site_id, kind, is_template, title, version, content, created_by)
      values (${lit(company.id)}, null, 'swms', true, ${lit(payload.title)}, ${lit(payload.version)},
              ${lit(payload.content)}::jsonb, ${lit(company.worker_id)})`)
    console.log(`  ✓ SWMS template installed (${content.tasks.length} task rows)`)
  }

  console.log('\nReady. In the app: Me → Business details to check, then Projects → + to make the first job.')
} catch (err) {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
