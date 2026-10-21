import type { VercelRequest, VercelResponse } from '@vercel/node'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb, FakeResponse } from './fakeDb.js'

/**
 * Who the functions let in: callerWorker refuses a worker the office took off
 * the crew; bootstrap claims an invite only for the exact address, and never
 * one for a removed worker; delete-account will not delete the public demo.
 */

const h = vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  delete process.env.DEMO_EMAIL
  return {
    db: undefined as unknown,
    user: null as null | { id: string; email?: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> },
  }
})

// A client made with the caller's bearer token can only say who they are; the
// service-role client is the in-memory database.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    if (opts?.global?.headers?.Authorization) {
      return {
        auth: {
          getUser: async () =>
            h.user ? { data: { user: h.user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } },
        },
      }
    }
    return h.db
  },
}))

const { callerWorker, REMOVED_FROM_CREW } = await import('../_supabase.js')
const { default: bootstrap } = await import('../bootstrap.js')
const { default: deleteAccount } = await import('../delete-account.js')
const { default: demo } = await import('../demo.js')

let db: FakeDb
beforeEach(() => {
  db = new FakeDb()
  h.db = db
  h.user = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const confirmed = (id: string, email: string) => ({
  id,
  email,
  email_confirmed_at: '2026-10-01T00:00:00Z',
  user_metadata: {},
})

async function call(handler: (req: VercelRequest, res: VercelResponse) => unknown, body: unknown = {}) {
  const res = new FakeResponse()
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer token' }, body } as unknown as VercelRequest,
    res as unknown as VercelResponse,
  )
  return { status: res.statusCode, body: res.body as Record<string, unknown> }
}

describe('callerWorker', () => {
  const row = { id: 'w1', company_id: 'co1', name: 'Sam', is_office: false, active: true, auth_user_id: 'u1' }

  it('lets an active worker through, with only what the functions use', async () => {
    db.seed('workers', row)
    h.user = confirmed('u1', 'sam@example.com')
    expect(await callerWorker('Bearer token')).toEqual({
      ok: true,
      worker: { id: 'w1', company_id: 'co1', name: 'Sam', is_office: false },
    })
  })

  it('refuses a worker who has been taken off the crew, plainly', async () => {
    db.seed('workers', { ...row, active: false })
    h.user = confirmed('u1', 'sam@example.com')
    expect(await callerWorker('Bearer token')).toEqual({
      ok: false,
      status: 403,
      body: { error: "You've been taken off this company's crew. Ask the office if that's a mistake.", removed: true },
    })
    expect(REMOVED_FROM_CREW).toBe("You've been taken off this company's crew. Ask the office if that's a mistake.")
  })

  it('is 401 with no token, a bad token, or no worker row', async () => {
    const notAuthenticated = { ok: false, status: 401, body: { error: 'Not authenticated' } }
    expect(await callerWorker(undefined)).toEqual(notAuthenticated)
    expect(await callerWorker('Token abc')).toEqual(notAuthenticated)
    expect(await callerWorker('Bearer token')).toEqual(notAuthenticated) // getUser fails
    h.user = confirmed('u9', 'nobody@example.com')
    expect(await callerWorker('Bearer token')).toEqual(notAuthenticated)
  })

  it('is a 500 worth retrying when the lookup itself fails', async () => {
    h.user = confirmed('u1', 'sam@example.com')
    db.failing.workers = { code: '08006', message: 'connection failure' }
    expect(await callerWorker('Bearer token')).toMatchObject({ ok: false, status: 500 })
  })
})

describe('bootstrap: claiming an invite', () => {
  const invite = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
    id,
    company_id: 'co1',
    name: id,
    invite_email: email,
    auth_user_id: null,
    active: true,
    is_office: false,
    role: 'employee',
    ...extra,
  })

  it('claims the invite for the same address in any letter case', async () => {
    db.seed('workers', invite('jane', 'Jane.Doe@Example.com'))
    h.user = confirmed('u-jane', 'jane.doe@example.com')
    const reply = await call(bootstrap)
    expect(reply).toEqual({ status: 200, body: { ok: true, workerId: 'jane', joined: true } })
    expect(db.rows('workers')[0]).toMatchObject({ auth_user_id: 'u-jane', invite_email: null })
  })

  it('does not hand an invite to a look-alike address', async () => {
    db.seed('workers', invite('jane', 'jane.doe@example.com'))
    h.user = confirmed('u-imposter', 'jane_doe@example.com')
    const reply = await call(bootstrap)
    expect(reply.status).toBe(404)
    expect(db.rows('workers')[0]).toMatchObject({ auth_user_id: null, invite_email: 'jane.doe@example.com' })
  })

  it('does not hand out an Office invite to an address made of wildcards', async () => {
    db.seed('workers', invite('boss', 'boss@tiling.com.au', { is_office: true, role: 'owner' }))
    for (const email of ['%@tiling.com.au', 'b*@tiling.com.au', 'bos_@tiling.com.au', '%']) {
      h.user = confirmed(`u-${email}`, email)
      expect((await call(bootstrap)).status).toBe(404)
    }
    expect(db.rows('workers')[0]).toMatchObject({ auth_user_id: null })
  })

  it('still claims an invite whose own address has an underscore in it', async () => {
    db.seed('workers', invite('look', 'jane.doe@example.com'), invite('real', 'jane_doe@example.com'))
    h.user = confirmed('u-real', 'Jane_Doe@example.com')
    expect(await call(bootstrap)).toEqual({ status: 200, body: { ok: true, workerId: 'real', joined: true } })
    expect(db.rows('workers').map((w) => w.auth_user_id)).toEqual([null, 'u-real'])
  })

  it('refuses to link a login to a worker taken off the crew', async () => {
    db.seed('workers', invite('jane', 'jane.doe@example.com', { active: false }))
    h.user = confirmed('u-jane', 'jane.doe@example.com')
    expect(await call(bootstrap)).toEqual({ status: 403, body: { error: REMOVED_FROM_CREW, removed: true } })
    expect(db.rows('workers')[0]).toMatchObject({ auth_user_id: null })
  })

  it('leaves the rest as it was: unconfirmed addresses wait, a linked login is idempotent', async () => {
    db.seed('workers', invite('jane', 'jane.doe@example.com'))
    h.user = { ...confirmed('u-jane', 'jane.doe@example.com'), email_confirmed_at: null }
    expect((await call(bootstrap)).status).toBe(403)
    expect(db.rows('workers')[0]).toMatchObject({ auth_user_id: null })

    h.user = confirmed('u-jane', 'jane.doe@example.com')
    expect((await call(bootstrap)).body).toMatchObject({ joined: true })
    expect((await call(bootstrap)).body).toEqual({ ok: true, workerId: 'jane', existing: true })
  })

  it('tells a linked login that was taken off the crew so, instead of "linked"', async () => {
    db.seed('workers', invite('jane', 'jane.doe@example.com'))
    h.user = confirmed('u-jane', 'jane.doe@example.com')
    expect((await call(bootstrap)).body).toMatchObject({ joined: true })
    db.rows('workers')[0]!.active = false
    expect(await call(bootstrap)).toEqual({ status: 403, body: { error: REMOVED_FROM_CREW, removed: true } })
  })
})

describe('delete-account and the public demo', () => {
  beforeEach(() => {
    db.rpcs.delete_worker_account = () => ({ data: null, error: null })
  })

  it('will not delete the demo account, whatever the letter case', async () => {
    db.seed('workers', { id: 'marnie', company_id: 'demo', role: 'owner', auth_user_id: 'u-demo' })
    for (const email of ['appreview@crewline.app', 'AppReview@Crewline.app']) {
      h.user = confirmed('u-demo', email)
      expect(await call(deleteAccount, { deleteCompany: true })).toEqual({
        status: 403,
        body: { error: "The demo company can't be deleted." },
      })
    }
    expect(db.log.filter((s) => s.table.startsWith('rpc:'))).toEqual([])
    expect(db.deletedUsers).toEqual([])
  })

  it('still deletes App Review’s own account, and any other', async () => {
    db.seed('workers', { id: 'rev', company_id: 'review', role: 'owner', auth_user_id: 'u-review' })
    h.user = confirmed('u-review', 'appstore.review@crewline.app')
    expect(await call(deleteAccount)).toEqual({ status: 200, body: { ok: true } })
    expect(db.deletedUsers).toEqual(['u-review'])
  })

  it('lets a worker who was taken off the crew delete their own account', async () => {
    db.seed('workers', { id: 'w1', company_id: 'co1', role: 'employee', auth_user_id: 'u1', active: false })
    h.user = confirmed('u1', 'sam@example.com')
    expect(await call(deleteAccount)).toEqual({ status: 200, body: { ok: true } })
    expect(db.deletedUsers).toEqual(['u1'])
  })

  it('leaves "Try the demo" asking for the same account it always did', async () => {
    const res = new FakeResponse()
    await demo({ method: 'POST', headers: {} } as unknown as VercelRequest, res as unknown as VercelResponse)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ token_hash: 'hash' })
    expect(db.generatedLinks).toEqual([{ type: 'magiclink', email: 'appreview@crewline.app' }])
  })
})
