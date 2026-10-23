import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { db } from '../db/client'
import { auth } from '../lib/auth'
import { PublicError } from '../lib/server-error'
import { adminListFailedQuotes } from './admin-quotes'

// Outside the Start runtime a server function cannot run, so here each one is its own handler. The admin check is the
// real one (admin-catalog.ts and lib/admin.ts); only the session it reads and the database are stand-ins.
vi.mock('@tanstack/react-start', () => {
  const builder = { validator: () => builder, handler: <T>(fn: T): T => fn }
  return { createServerFn: () => builder, createServerOnlyFn: <T>(fn: T): T => fn }
})
vi.mock('@tanstack/react-start/server', () => ({ getRequestHeaders: () => new Headers() }))
vi.mock('../lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('../db/client', () => ({ db: { select: vi.fn() } }))

const ADMIN = 'owner@example.com'

/** A query builder that resolves to `rows` at the end of any chain of calls, and keeps the `where` and `limit` it got. */
function chain(rows: unknown[], seen: { where?: SQL; limit?: number } = {}): unknown {
  const builder: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(rows).then(ok, bad),
  }
  for (const m of ['from', 'leftJoin', 'orderBy']) builder[m] = () => builder
  builder.where = (w: SQL) => {
    seen.where = w
    return builder
  }
  builder.limit = (n: number) => {
    seen.limit = n
    return builder
  }
  return builder
}

const signedInAs = (email: string, emailVerified = true) =>
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { email, emailVerified } } as never)

beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', ADMIN)
  vi.mocked(db.select).mockReturnValue(chain([]) as never)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('adminListFailedQuotes refuses anyone but the admin', () => {
  // The page's 404 comes from its own check; the call itself is a public endpoint anyone can send.
  test.each([
    ['a signed-out caller', () => vi.mocked(auth.api.getSession).mockResolvedValue(null as never)],
    ['an account not in ADMIN_EMAILS', () => signedInAs('someone@example.com')],
    ["the admin's address, not verified", () => signedInAs(ADMIN, false)],
  ])('%s gets "Not found" and no quote is read', async (_who, arrange) => {
    arrange()

    const call = adminListFailedQuotes()

    await expect(call).rejects.toThrow(new PublicError('Not found'))
    expect(db.select).not.toHaveBeenCalled()
  })
})

describe('adminListFailedQuotes for the admin', () => {
  test('asks for the 50 newest failed reads only', async () => {
    signedInAs(ADMIN)
    const seen: { where?: SQL; limit?: number } = {}
    vi.mocked(db.select).mockReturnValue(chain([], seen) as never)

    await adminListFailedQuotes()

    expect(seen.limit).toBe(50)
    const where = new PgDialect().sqlToQuery(seen.where!)
    expect(where.sql).toBe('"quotes"."status" = $1')
    expect(where.params).toEqual(['failed'])
  })

  test('each read carries its file, account, project and error, at the time it failed, else the time it was uploaded', async () => {
    signedInAs(ADMIN)
    vi.mocked(db.select).mockReturnValue(chain([
      {
        id: 'q1', fileName: 'unreadable.pdf', email: 'buyer@example.com', project: 'Casa', error: 'invalid: No stub fixture matches unreadable.pdf',
        processedAt: new Date('2026-10-22T21:05:00Z'), createdAt: new Date('2026-10-22T21:04:00Z'),
      },
      {
        id: 'q2', fileName: 'gone.pdf', email: null, project: null, error: null,
        processedAt: null, createdAt: new Date('2026-10-01T08:30:00Z'),
      },
    ]) as never)

    const reads = await adminListFailedQuotes()

    expect(reads).toEqual([
      {
        id: 'q1', fileName: 'unreadable.pdf', email: 'buyer@example.com', project: 'Casa',
        error: 'invalid: No stub fixture matches unreadable.pdf', at: '2026-10-22T21:05:00.000Z',
      },
      { id: 'q2', fileName: 'gone.pdf', email: null, project: null, error: null, at: '2026-10-01T08:30:00.000Z' },
    ])
  })
})
