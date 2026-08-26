import { describe, expect, it } from 'vitest'
import { readableAuthError } from './SignIn'

/**
 * The front door.
 *
 * Everything else in the app is behind this screen, so a message here that a
 * tiler cannot act on costs the whole customer, not one feature. The strings
 * below are the ones the auth server actually returned during an onboarding
 * walkthrough against production — not invented, and not paraphrased.
 */

describe('sign-in errors say what to do next', () => {
  it('translates the email cap, which is the one a real customer will hit', () => {
    // Verbatim from a third sign-up inside one hour: HTTP 429, and this is
    // the body's `msg`. A project on the shared mail sender is capped at two
    // an hour, so a business onboarding a crew walks into this repeatedly.
    const out = readableAuthError(new Error('email rate limit exceeded'))
    expect(out).not.toMatch(/rate limit/i)
    expect(out).toMatch(/wait about an hour/i)
    // It must say the attempt was not destructive, or the next move is to
    // start again with a different address and make a duplicate account.
    expect(out).toMatch(/still free/i)
  })

  it('covers the same failure under the code the API also uses for it', () => {
    expect(readableAuthError(new Error('over_email_send_rate_limit'))).toMatch(/wait about an hour/i)
    expect(readableAuthError(new Error('Too Many Requests'))).toMatch(/wait about an hour/i)
  })

  it('turns a wrong password into a check-your-typing, not a verdict', () => {
    const out = readableAuthError(new Error('Invalid login credentials'))
    expect(out).toMatch(/do not match an account/i)
    expect(out).toMatch(/typo/i)
  })

  it('tells somebody who skipped the email where the email is', () => {
    expect(readableAuthError(new Error('Email not confirmed'))).toMatch(/confirmed yet/i)
  })

  it('sends a returning owner to sign in instead of signing up again', () => {
    expect(readableAuthError(new Error('User already registered'))).toMatch(/already an account/i)
  })

  it('names reception as the likely cause on a site, not the app', () => {
    expect(readableAuthError(new TypeError('Failed to fetch'))).toMatch(/signal/i)
  })

  it('passes anything it does not recognise through untouched', () => {
    // Swallowing an unknown failure into a friendly non-answer would leave
    // somebody stuck with nothing to report and nothing to search for.
    expect(readableAuthError(new Error('database is locked'))).toBe('database is locked')
    expect(readableAuthError('a bare string')).toBe('a bare string')
  })
})
