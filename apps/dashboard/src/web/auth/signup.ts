/**
 * Creating a company from the website, and finishing one after sign-in.
 *
 * The website is the only place a business signs up: App Review was told so,
 * and the phone build strips its own copy (SignIn.tsx's CAN_CREATE_COMPANY).
 * This is the same logic as SignIn.tsx:182-206, kept here so the website never
 * needs that file, which ships to iOS, to change:
 *
 *  1. auth.signUp, with the company name and the person's name parked on the
 *     account (user metadata). Email confirmation is on, so signUp returns no
 *     session and nothing can be created yet; the names have to survive the
 *     trip to the inbox, possibly to another device.
 *  2. On the first confirmed sign-in, useSession (shared with the phone) POSTs
 *     /api/bootstrap with an empty body, and the server creates the company
 *     and an owner from that metadata.
 *
 * Kept free of React so signup.test.ts can drive it with a fake auth client
 * and a fake fetch.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { api, readableAuthError, supabase } from '../phone'

/** The phone's sign-up asks for 8 (SignIn.tsx), so the website does too. */
export const MIN_PASSWORD = 8

export interface CompanySignUp {
  companyName: string
  name: string
  email: string
  password: string
}

export type SignUpField = keyof CompanySignUp

/**
 * What is wrong with the form, field by field, before anything is sent. Empty
 * when it can go. Said as what to do, beside the field it is about, rather
 * than as the browser's own bubble on the first bad field only.
 */
export function signUpProblems(input: CompanySignUp): Partial<Record<SignUpField, string>> {
  const out: Partial<Record<SignUpField, string>> = {}
  if (!input.companyName.trim()) out.companyName = 'Enter your company’s name.'
  if (!input.name.trim()) out.name = 'Enter your name.'
  const email = emailProblem(input.email)
  if (email) out.email = email
  const password = passwordProblem(input.password)
  if (password) out.password = password
  return out
}

/** The email check every front-door form shares. Null when it is fine. */
export function emailProblem(email: string): string | null {
  const e = email.trim()
  if (!e) return 'Enter your email address.'
  // Deliberately loose: the auth server is the judge. This only catches the
  // half-typed address before a round trip spends one of the hour's emails.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'That does not look like an email address.'
  return null
}

/** The password rule for a new password, at sign-up and at reset. Null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`
  return null
}

/**
 * What signUp parks on the account. The keys are the ones api/bootstrap.ts
 * reads back (user_metadata.company_name / full_name); signup.test.ts pins
 * them against that file.
 */
export function signUpMetadata(input: Pick<CompanySignUp, 'companyName' | 'name'>) {
  return { company_name: input.companyName.trim(), full_name: input.name.trim() }
}

export type SignUpOutcome =
  /** The usual case: a confirmation email is on its way. */
  | { kind: 'check-email'; email: string }
  /** The project confirmed the address on the spot and handed back a session. */
  | { kind: 'signed-in' }
  | { kind: 'failed'; message: string }

type Auth = Pick<SupabaseClient['auth'], 'signUp'>

/**
 * Sign a new business up. Never throws: every failure comes back as words a
 * person can act on (readableAuthError, the phone's own wording, tested in
 * SignIn.test.ts).
 *
 * When a session comes back (a project with email confirmation turned off),
 * this deliberately does NOT post /api/bootstrap itself, although SignIn.tsx
 * does. supabase-js announces the new session to useSession inside signUp(),
 * and useSession immediately finds no workers row and posts /api/bootstrap
 * from the metadata above. A second post from here would run alongside it,
 * both would pass the server's "no workers row yet" check, and the business
 * would get two companies. One post, from useSession, creates exactly one,
 * with the same names.
 */
export async function signUpCompany(input: CompanySignUp, auth: Auth = supabase().auth): Promise<SignUpOutcome> {
  const email = input.email.trim()
  try {
    const { data, error } = await auth.signUp({
      email,
      password: input.password,
      options: { data: signUpMetadata(input) },
    })
    if (error) throw error
    if (data.session) return { kind: 'signed-in' }
    // An address that already has an account comes back as a user with no
    // identities and no error, and no email is sent (the server will not say
    // outright that the address exists). "Check your email" would leave them
    // waiting for nothing, so say what the phone says for the explicit error.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { kind: 'failed', message: readableAuthError(new Error('User already registered')) }
    }
    return { kind: 'check-email', email }
  } catch (err) {
    return { kind: 'failed', message: readableAuthError(err) }
  }
}

export interface BootstrapBody {
  companyName: string
  name: string
}

export type BootstrapOutcome = { ok: true; joined: boolean } | { ok: false; message: string }

/**
 * POST /api/bootstrap as the signed-in person, with the company and their name
 * typed again (FinishSetup: an account whose metadata never had them, such as
 * one made on the old dashboard's sign-up, which did not park them).
 *
 * The server is idempotent for someone who already has a workers row, refuses
 * an unconfirmed address (403, with its own wording, which is shown as is),
 * and claims a row the office made for this email before it creates anything,
 * in which case `joined` is true and no company was made.
 */
export async function bootstrapCompany(
  token: string,
  body: BootstrapBody,
  send: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
): Promise<BootstrapOutcome> {
  let res: Response
  try {
    res = await send(api('/api/bootstrap'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ companyName: body.companyName.trim(), name: body.name.trim() }),
    })
  } catch (err) {
    return { ok: false, message: readableAuthError(err) }
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; joined?: boolean }
  if (res.ok) return { ok: true, joined: json.joined === true }
  if (res.status === 401) return { ok: false, message: 'Your sign-in has run out. Sign out, sign in again, and finish from there.' }
  // 'no_pending_company' is a code, not a sentence. It means the server had no
  // names to create a company with, which only an empty form can cause.
  if (res.status === 404) return { ok: false, message: 'Enter your company’s name and your own, then try again.' }
  return { ok: false, message: json.error || `Could not finish setting up your account (error ${res.status}). Try again in a minute.` }
}
