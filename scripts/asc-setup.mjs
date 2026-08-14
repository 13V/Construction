/**
 * Everything the Apple portal needs, done through the App Store Connect API.
 *
 * The client's enrolment is an Individual account, so nobody but the account
 * holder can ever open Certificates, Identifiers & Profiles — and nobody
 * needs to. An Admin team key operates on the team through the API:
 *
 *   1. registers the bundle ID          app.crewline.worker
 *   2. issues an Apple Distribution certificate from a CSR minted here
 *   3. creates the App Store provisioning profile
 *   4. derives the Team ID from the certificate it just issued
 *   5. prints the nine GitHub secrets, paste-ready
 *
 * Run:
 *   ASC_KEY_ID=7U5W993BRK \
 *   ASC_ISSUER_ID=5770897c-... \
 *   ASC_P8_PATH=ios-signing/AuthKey_7U5W993BRK.p8 \
 *   node scripts/asc-setup.mjs
 *
 * Safe to re-run: an already-registered bundle ID is found and reused; the
 * certificate and profile are created fresh each run (a certificate is only
 * usable with the private key minted beside it, so reusing someone else's is
 * never possible anyway).
 *
 * `node scripts/asc-setup.mjs --selftest` exercises the JWT signing and the
 * CSR/PEM plumbing against a throwaway key, no network, no credentials.
 */
import { createPrivateKey, createSign, generateKeyPairSync, randomBytes, sign as edSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.env.IOS_SIGNING_DIR || join(ROOT, 'ios-signing')
const BUNDLE_ID = 'app.crewline.worker'
const API = 'https://api.appstoreconnect.apple.com/v1'

const b64url = (buf) => Buffer.from(buf).toString('base64url')

/** ES256 JWT, the only authentication the ASC API takes. */
function mintToken(keyId, issuerId, p8pem) {
  const key = createPrivateKey(p8pem)
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }))
  // 15 minutes. Apple rejects anything over 20, and a long-lived token in a
  // shell history is a credential nobody meant to make.
  const payload = b64url(JSON.stringify({ iss: issuerId, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))
  const signer = createSign('SHA256')
  signer.update(`${header}.${payload}`)
  // JWT ES256 wants the raw 64-byte (r,s) form, not ASN.1 DER.
  const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(sig)}`
}

async function asc(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* some 204s are empty */ }
  if (!r.ok) {
    const detail = json?.errors?.map((e) => `${e.status} ${e.code}: ${e.detail || e.title}`).join('; ') || text.slice(0, 300)
    throw new Error(`${method} ${path} → ${r.status}\n  ${detail}`)
  }
  return json
}

function sh(cmd, args, input) {
  return execFileSync(cmd, args, { input, encoding: 'buffer' })
}

/** DER → PEM with the usual 64-column folding. */
const pem = (label, der) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END ${label}-----\n`

// ---------------------------------------------------------------- selftest

if (process.argv.includes('--selftest')) {
  // A throwaway P-256 key stands in for Apple's .p8 — same curve, same format.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const p8 = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const jwt = mintToken('TESTKEYID', 'test-issuer', p8)
  const [h, p, s] = jwt.split('.')
  const header = JSON.parse(Buffer.from(h, 'base64url'))
  const payload = JSON.parse(Buffer.from(p, 'base64url'))
  if (header.alg !== 'ES256' || header.kid !== 'TESTKEYID') throw new Error('bad header')
  if (payload.aud !== 'appstoreconnect-v1' || payload.exp - payload.iat !== 900) throw new Error('bad payload')
  if (Buffer.from(s, 'base64url').length !== 64) throw new Error(`ES256 signature must be 64 raw bytes, got ${Buffer.from(s, 'base64url').length}`)

  // And the CSR path: openssl must accept what we build the request from.
  mkdirSync(OUT, { recursive: true })
  const keyPath = join(OUT, 'selftest.key')
  sh('openssl', ['genrsa', '-out', keyPath, '2048'])
  const csr = sh('openssl', ['req', '-new', '-key', keyPath, '-subj', '/CN=selftest/C=AU', '-outform', 'DER']).toString('base64')
  if (csr.length < 100) throw new Error('CSR came out empty')
  console.log('selftest: JWT shape, ES256 raw signature, and CSR generation all pass')
  process.exit(0)
}

// ------------------------------------------------------------------- main

const KEY_ID = process.env.ASC_KEY_ID
const ISSUER_ID = process.env.ASC_ISSUER_ID
const P8_PATH = process.env.ASC_P8_PATH
if (!KEY_ID || !ISSUER_ID || !P8_PATH) {
  console.error('Need ASC_KEY_ID, ASC_ISSUER_ID and ASC_P8_PATH. See the header comment.')
  process.exit(2)
}
if (!existsSync(P8_PATH)) {
  console.error(`No file at ${P8_PATH}. Save the AuthKey_${KEY_ID}.p8 contents there first.`)
  process.exit(2)
}

mkdirSync(OUT, { recursive: true })
const token = mintToken(KEY_ID, ISSUER_ID, readFileSync(P8_PATH, 'utf8'))

// 1 ─ the bundle ID. The deliberate, permanent act: this is the moment
//     app.crewline.worker becomes the client's.
let bundle = (await asc(token, 'GET', `/bundleIds?filter[identifier]=${BUNDLE_ID}`)).data?.[0]
if (bundle) {
  console.log(`bundle ID already registered: ${BUNDLE_ID} (${bundle.id}) — reusing`)
} else {
  bundle = (await asc(token, 'POST', '/bundleIds', {
    data: { type: 'bundleIds', attributes: { identifier: BUNDLE_ID, name: 'Crewline worker app', platform: 'IOS' } },
  })).data
  console.log(`registered bundle ID ${BUNDLE_ID} (${bundle.id})`)
}

// 2 ─ the distribution certificate, from a CSR whose private key never
//     leaves this machine.
const certKeyPath = join(OUT, 'ios_distribution.key')
if (!existsSync(certKeyPath)) sh('openssl', ['genrsa', '-out', certKeyPath, '2048'])
const csrDer = sh('openssl', ['req', '-new', '-key', certKeyPath, '-subj', '/CN=Crewline Distribution/C=AU', '-outform', 'DER'])

const cert = (await asc(token, 'POST', '/certificates', {
  data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: csrDer.toString('base64') } },
})).data
const certDer = Buffer.from(cert.attributes.certificateContent, 'base64')
const certPem = pem('CERTIFICATE', certDer)
writeFileSync(join(OUT, 'distribution.pem'), certPem)

const subject = sh('openssl', ['x509', '-noout', '-subject'], Buffer.from(certPem)).toString()
console.log(`issued: ${subject.trim()}`)
const team = subject.match(/OU\s*=\s*([A-Z0-9]{10})/)
if (!team) throw new Error(`could not read a Team ID out of the certificate subject: ${subject}`)
const TEAM_ID = team[1]
console.log(`Team ID (from the certificate itself): ${TEAM_ID}`)

// 3 ─ p12, in the legacy container macOS `security import` can read.
const p12Pass = randomBytes(18).toString('base64')
const legacy = sh('openssl', ['pkcs12', '-help']).toString() + execFileSync('openssl', ['pkcs12', '-help'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const legacyFlag = /-legacy/.test(legacy) ? ['-legacy'] : []
const p12Path = join(OUT, 'ios_distribution.p12')
sh('openssl', ['pkcs12', '-export', ...legacyFlag,
  '-inkey', certKeyPath, '-in', join(OUT, 'distribution.pem'),
  '-name', 'Apple Distribution', '-out', p12Path, '-passout', `pass:${p12Pass}`])

// 4 ─ the App Store provisioning profile.
const profile = (await asc(token, 'POST', '/profiles', {
  data: {
    type: 'profiles',
    attributes: { name: `Crewline App Store ${new Date().toISOString().slice(0, 10)}`, profileType: 'IOS_APP_STORE' },
    relationships: {
      bundleId: { data: { type: 'bundleIds', id: bundle.id } },
      certificates: { data: [{ type: 'certificates', id: cert.id }] },
    },
  },
})).data
const profilePath = join(OUT, 'crewline-appstore.mobileprovision')
writeFileSync(profilePath, Buffer.from(profile.attributes.profileContent, 'base64'))
console.log(`profile created: ${profile.attributes.name} (expires ${profile.attributes.expirationDate})`)

// 5 ─ the nine secrets, exactly as GitHub wants them.
const env = {}
try {
  for (const line of readFileSync(join(ROOT, 'apps/dashboard/.env.local'), 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trim().startsWith('#')) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
} catch { /* fine — the two VITE_ values just print as reminders */ }

const secrets = [
  ['APPLE_TEAM_ID', TEAM_ID],
  ['APP_STORE_CONNECT_KEY_ID', KEY_ID],
  ['APP_STORE_CONNECT_ISSUER_ID', ISSUER_ID],
  ['APP_STORE_CONNECT_PRIVATE_KEY', readFileSync(P8_PATH, 'utf8').trim()],
  ['IOS_DIST_CERT_P12_BASE64', readFileSync(p12Path).toString('base64')],
  ['IOS_DIST_CERT_PASSWORD', p12Pass],
  ['IOS_PROVISIONING_PROFILE_BASE64', readFileSync(profilePath).toString('base64')],
  ['VITE_SUPABASE_URL', env.VITE_SUPABASE_URL || '<from Supabase → Project Settings → API>'],
  ['VITE_SUPABASE_ANON_KEY', env.VITE_SUPABASE_ANON_KEY || '<the anon key, never service_role>'],
]

const out = secrets.map(([k, v]) => `───────── ${k} ─────────\n${v}`).join('\n\n')
writeFileSync(join(OUT, 'github-secrets.txt'), out + '\n')
console.log(`\nAll nine secrets written to ${join(OUT, 'github-secrets.txt')}`)
console.log('Paste each into GitHub → Settings → Secrets and variables → Actions.')
console.log('That file lives in ios-signing/, which is gitignored — do not move it into the repo.')
