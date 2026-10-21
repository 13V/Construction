import { afterEach, describe, expect, it, vi } from 'vitest'
import bootstrapSource from '../../../api/bootstrap.ts?raw'
import phoneSignInSource from '../../worker/simple/SignIn.tsx?raw'
import { readableAuthError } from '../phone'
import { bootstrapCompany, emailProblem, MIN_PASSWORD, passwordProblem, signInError, signUpCompany, signUpMetadata, signUpProblems, type CompanySignUp } from './signup'

/**
 * The website's company sign-up: the only place a business is created.
 *
 * What matters most is that the names typed survive the email round trip,
 * because with confirmation on there is no session to create anything with
 * at the moment of signing up. They ride on the account as metadata, under
 * the exact keys api/bootstrap.ts reads back on first sign-in. A renamed key
 * on either side would quietly turn every new business into a login attached
 * to nothing, so the keys are pinned here against the server's own source.
 */

const FORM: CompanySignUp = {
  companyName: '  ZZ-wp04 Co ',
  name: ' ZZ Owner  ',
  email: ' zz-wp04@example.invalid ',
  password: 'Correct-horse-9',
}

type SignUpArgs = { email: string; password: string; options?: { data?: object } }

/** A fake auth client: records what signUp was given, answers `reply`. */
function fakeAuth(reply: { user?: object | null; session?: object | null; error?: Error | null }) {
  const calls: SignUpArgs[] = []
  const auth = {
    signUp: async (args: SignUpArgs) => {
      calls.push(args)
      return { data: { user: reply.user ?? null, session: reply.session ?? null }, error: reply.error ?? null }
    },
  }
  return { calls, auth: auth as unknown as Parameters<typeof signUpCompany>[1] }
}

const NEW_USER = { id: 'u1', email: 'zz-wp04@example.invalid', identities: [{ id: 'i1', provider: 'email' }] }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('signing a company up', () => {
  it('parks the trimmed company and person names on the account, under the keys bootstrap reads', async () => {
    const { calls, auth } = fakeAuth({ user: NEW_USER })
    await signUpCompany(FORM, auth)
    expect(calls).toHaveLength(1)
    expect(calls[0].email).toBe('zz-wp04@example.invalid')
    // The password goes exactly as typed: spaces in a password are characters.
    expect(calls[0].password).toBe(FORM.password)
    expect(calls[0].options?.data).toEqual({ company_name: 'ZZ-wp04 Co', full_name: 'ZZ Owner' })
  })

  it('says to check the email when no session comes back, and makes no other request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { auth } = fakeAuth({ user: NEW_USER, session: null })
    expect(await signUpCompany(FORM, auth)).toEqual({ kind: 'check-email', email: 'zz-wp04@example.invalid' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('leaves the company to useSession when a session does come back, so it is created once', async () => {
    // useSession hears the session inside signUp() and posts /api/bootstrap
    // itself; a second post from here would race it into two companies.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { auth } = fakeAuth({ user: NEW_USER, session: { access_token: 't', user: NEW_USER } })
    expect(await signUpCompany(FORM, auth)).toEqual({ kind: 'signed-in' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not promise an email for an address that already has an account', async () => {
    // The server's answer for a taken address: a user with no identities, no
    // error, and no email sent.
    const { auth } = fakeAuth({ user: { ...NEW_USER, identities: [] }, session: null })
    const out = await signUpCompany(FORM, auth)
    expect(out.kind).toBe('failed')
    expect(out.kind === 'failed' && out.message).toMatch(/already an account/i)
  })

  it('puts auth errors into words a person can act on', async () => {
    const limited = fakeAuth({ error: new Error('email rate limit exceeded') })
    const out = await signUpCompany(FORM, limited.auth)
    expect(out.kind === 'failed' && out.message).toMatch(/wait about an hour/i)

    const thrown = { auth: { signUp: async () => Promise.reject(new TypeError('Failed to fetch')) } as unknown as Parameters<typeof signUpCompany>[1] }
    const offline = await signUpCompany(FORM, thrown.auth)
    expect(offline.kind === 'failed' && offline.message).toMatch(/check your signal/i)
  })
})

describe("signing in: the website's own words for a wrong password", () => {
  it("points at the website's own Forgot password? link, not at the website's address or a company sign-up", () => {
    const out = signInError(new Error('Invalid login credentials'))
    expect(out).toMatch(/do not match an account/i)
    expect(out).toMatch(/typo/i)
    expect(out).toContain('Forgot password?')
    expect(out).not.toMatch(/\/reset|new company/i)
    // The phone's words for the same answer are the app's: they send people here.
    expect(readableAuthError(new Error('Invalid login credentials'))).not.toBe(out)
  })

  it('matches the server answer the phone matches, written any way', () => {
    // The phone's regex, read from its source, so the two cannot drift apart.
    const phoneRe = /if \(\/(.+?)\/i\.test\(raw\)\) \{\s*return `That email and password/.exec(phoneSignInSource)
    expect(phoneRe).not.toBeNull()
    for (const said of ['Invalid login credentials', 'invalid login credentials', 'AuthApiError: Invalid login credentials']) {
      expect(new RegExp(phoneRe![1], 'i').test(said)).toBe(true)
      expect(signInError(new Error(said))).toContain('Forgot password?')
    }
  })

  it('says everything else as the phone says it', () => {
    for (const err of [new Error('email rate limit exceeded'), new Error('Email not confirmed'), new TypeError('Failed to fetch'), new Error('database is locked')]) {
      expect(signInError(err)).toBe(readableAuthError(err))
    }
  })
})

describe('the sign-up form checks', () => {
  it('passes a complete form', () => {
    expect(signUpProblems(FORM)).toEqual({})
  })

  it('names every missing field at once', () => {
    const out = signUpProblems({ companyName: ' ', name: '', email: '', password: '' })
    expect(Object.keys(out).sort()).toEqual(['companyName', 'email', 'name', 'password'])
  })

  it('catches a half-typed email and a short password', () => {
    expect(emailProblem('dean@')).toMatch(/does not look like/)
    expect(emailProblem(' dean@proven.com.au ')).toBeNull()
    expect(passwordProblem('x'.repeat(MIN_PASSWORD - 1))).toMatch(new RegExp(`${MIN_PASSWORD} characters`))
    expect(passwordProblem('x'.repeat(MIN_PASSWORD))).toBeNull()
  })

  it('asks for the same minimum as the phone', () => {
    expect(phoneSignInSource).toContain(`minLength={${MIN_PASSWORD}}`)
  })
})

describe('the metadata contract with the server and the phone', () => {
  it('uses the keys api/bootstrap.ts reads from user metadata', () => {
    const keys = Object.keys(signUpMetadata({ companyName: 'a', name: 'b' })).sort()
    expect(keys).toEqual(['company_name', 'full_name'])
    for (const key of keys) expect(bootstrapSource).toMatch(new RegExp(`meta\\.${key}\\b`))
  })

  it('uses the same keys as the phone sign-up', () => {
    expect(phoneSignInSource).toMatch(/company_name:\s*company\.trim\(\)/)
    expect(phoneSignInSource).toMatch(/full_name:\s*name\.trim\(\)/)
  })

  it('posts the body fields api/bootstrap.ts reads from the request', () => {
    expect(bootstrapSource).toMatch(/req\.body\?\.companyName/)
    expect(bootstrapSource).toMatch(/req\.body\?\.name\b/)
  })
})

describe('finishing a company after sign-in', () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('posts the trimmed names with the bearer token', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = []
    const out = await bootstrapCompany('tok-123', { companyName: ' ZZ-wp04 Co ', name: ' ZZ Owner ' }, async (url, init) => {
      seen.push({ url, init })
      return new Response(JSON.stringify({ ok: true, companyId: 'c', workerId: 'w' }), { status: 200 })
    })
    expect(out).toEqual({ ok: true, joined: false })
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toMatch(/\/api\/bootstrap$/)
    expect(seen[0].init.method).toBe('POST')
    expect((seen[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ companyName: 'ZZ-wp04 Co', name: 'ZZ Owner' })
  })

  it('reports a claimed invitation, where no company was made', async () => {
    expect(await bootstrapCompany('t', { companyName: 'a', name: 'b' }, reply(200, { ok: true, workerId: 'w', joined: true }))).toEqual({ ok: true, joined: true })
  })

  it("shows the server's own words for an unconfirmed address", async () => {
    const out = await bootstrapCompany('t', { companyName: 'a', name: 'b' }, reply(403, { error: 'Confirm your email address first — check your inbox for the link.' }))
    expect(out).toEqual({ ok: false, message: 'Confirm your email address first — check your inbox for the link.' })
  })

  it('never shows a bare code or status', async () => {
    const missing = await bootstrapCompany('t', { companyName: '', name: '' }, reply(404, { error: 'no_pending_company' }))
    expect(missing.ok === false && missing.message).not.toMatch(/no_pending_company/)
    const expired = await bootstrapCompany('t', { companyName: 'a', name: 'b' }, reply(401, { error: 'Not authenticated' }))
    expect(expired.ok === false && expired.message).toMatch(/sign in again/i)
    const broken = await bootstrapCompany('t', { companyName: 'a', name: 'b' }, async () => new Response('<html>', { status: 502 }))
    expect(broken.ok === false && broken.message).toMatch(/try again/i)
    const offline = await bootstrapCompany('t', { companyName: 'a', name: 'b' }, async () => Promise.reject(new TypeError('Failed to fetch')))
    expect(offline.ok === false && offline.message).toMatch(/check your signal/i)
  })
})
