import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { db } from '../../db/client'
import { MAX_ATTEMPTS, STALE_CLAIM_MS, type ClaimedQuote, type JobClock } from './process'
import { dbJobRepo, recoverStaleQuotes } from './repo'

vi.mock('../../db/client', () => ({ db: { select: vi.fn(), update: vi.fn() } }))

/** A query builder that resolves to `result` at the end of any chain of calls, and keeps the last `where` and `set` it got. */
function chain(result: unknown, seen: { where?: SQL; set?: Record<string, unknown> } = {}): unknown {
  const builder: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
  }
  for (const m of ['from', 'orderBy', 'limit', 'returning']) builder[m] = () => builder
  builder.set = (v: Record<string, unknown>) => {
    seen.set = v
    return builder
  }
  builder.where = (w: SQL) => {
    seen.where = w
    return builder
  }
  return builder
}

const stuck = (id: string, attempts: number): JobClock => ({
  id, status: 'processing', attempts, claimedAt: new Date(Date.now() - STALE_CLAIM_MS - 60_000), createdAt: new Date(0),
})

const FAILED_STATUS = `case when "quotes"."extraction" is not null then 'needs_review' else 'failed' end`
const statusSql = (set: Record<string, unknown> | undefined): string => new PgDialect().sqlToQuery(set!.status as SQL).sql

describe('recoverStaleQuotes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  test('a stuck quote with no attempts left is failed and logged; one with attempts left is started again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.select).mockReturnValue(chain([stuck('spent', MAX_ATTEMPTS), stuck('again', 1)]) as never)
    vi.mocked(db.update).mockReturnValue(chain(undefined) as never)
    expect(await recoverStaleQuotes('u1')).toEqual(['again'])
    expect(db.update).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledWith('[quotes] gave up on a stuck quote', { ids: ['spent'] })
  })

  test('giving up on a stuck quote that already has a reading leaves it to check, not failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: { set?: Record<string, unknown> } = {}
    vi.mocked(db.select).mockReturnValue(chain([stuck('spent', MAX_ATTEMPTS)]) as never)
    vi.mocked(db.update).mockReturnValue(chain(undefined, seen) as never)
    await recoverStaleQuotes('u1')
    expect(statusSql(seen.set)).toBe(FAILED_STATUS)
  })

  test('nothing is failed or logged when no stuck quote is out of attempts', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.select).mockReturnValue(chain([stuck('again', 1)]) as never)
    expect(await recoverStaleQuotes('u1')).toEqual(['again'])
    expect(db.update).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('dbJobRepo.finish', () => {
  const job: ClaimedQuote = { id: 'q1', blobPathname: 'quotes/u/x.pdf', mime: 'application/pdf', fileName: 'x.pdf', attempts: 2,
    claimedAt: '2026-09-30 11:00:00.123456+00', pages: null,
  }
  const ready = { status: 'ready' as const, extraction: { lines: [] } as never, modelUsed: 'luna', usage: [] }
  const requeue = { status: 'queued' as const, error: 'transient: 503', usage: [] }
  afterEach(() => { vi.clearAllMocks() })

  test.each([['a result', ready], ['a re-queue', requeue]])('writes %s only under the claim that read it', async (_name, f) => {
    const seen: { where?: SQL } = {}
    vi.mocked(db.update).mockReturnValue(chain([{ id: 'q1' }], seen) as never)
    expect(await dbJobRepo.finish(job, f)).toBe(true)
    const { sql: text, params } = new PgDialect().sqlToQuery(seen.where!)
    expect(text).toContain('"quotes"."status" = $')
    expect(text).toContain('"quotes"."attempts" = $')
    expect(text).toContain('"quotes"."claimed_at" = $')
    expect(params).toEqual(expect.arrayContaining(['q1', 'processing', 2, job.claimedAt]))
  })

  test('a failed read of a quote that already has a reading leaves it to check; a re-queue stays queued', async () => {
    const seen: { set?: Record<string, unknown> } = {}
    vi.mocked(db.update).mockReturnValue(chain([{ id: 'q1' }], seen) as never)
    await dbJobRepo.finish(job, { status: 'failed', error: 'invalid', usage: [] })
    expect(statusSql(seen.set)).toBe(FAILED_STATUS)
    expect(seen.set).toMatchObject({ error: 'invalid', processedAt: expect.any(Date) })
    await dbJobRepo.finish(job, requeue)
    expect(seen.set).toMatchObject({ status: 'queued', processedAt: null })
  })

  test('a read that ends ready clears the typed total; one that needs review keeps it', async () => {
    const seen: { set?: Record<string, unknown> } = {}
    vi.mocked(db.update).mockReturnValue(chain([{ id: 'q1' }], seen) as never)
    await dbJobRepo.finish(job, ready)
    expect(seen.set).toHaveProperty('totalOverride', null)
    await dbJobRepo.finish(job, { ...ready, status: 'needs_review' })
    expect(seen.set).not.toHaveProperty('totalOverride')
  })

  test('reports a lost claim when no row matched', async () => {
    vi.mocked(db.update).mockReturnValue(chain([]) as never)
    expect(await dbJobRepo.finish(job, ready)).toBe(false)
    expect(await dbJobRepo.finish(job, requeue)).toBe(false)
  })
})
