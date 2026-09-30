import { afterEach, describe, expect, test, vi } from 'vitest'
import { db } from '../../db/client'
import { MAX_ATTEMPTS, STALE_CLAIM_MS, type JobClock } from './process'
import { recoverStaleQuotes } from './repo'

vi.mock('../../db/client', () => ({ db: { select: vi.fn(), update: vi.fn() } }))

/** A query builder that resolves to `result` at the end of any chain of calls. */
function chain(result: unknown): unknown {
  const builder: Record<string, unknown> = {
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
  }
  for (const m of ['from', 'where', 'orderBy', 'limit', 'set']) builder[m] = () => builder
  return builder
}

const stuck = (id: string, attempts: number): JobClock => ({
  id, status: 'processing', attempts, claimedAt: new Date(Date.now() - STALE_CLAIM_MS - 60_000), createdAt: new Date(0),
})

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

  test('nothing is failed or logged when no stuck quote is out of attempts', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.select).mockReturnValue(chain([stuck('again', 1)]) as never)
    expect(await recoverStaleQuotes('u1')).toEqual(['again'])
    expect(db.update).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
  })
})
