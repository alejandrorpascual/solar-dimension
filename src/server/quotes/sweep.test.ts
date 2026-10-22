import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyQuoteTrash } from './deps'
import { JOB_WORST_CASE_MS, processQuote } from './process'
import { recoverStaleQuotes } from './repo'
import { sweepHandler } from './sweep'

vi.mock('./deps', () => ({ defaultDeps: vi.fn(() => ({})), emptyQuoteTrash: vi.fn() }))
vi.mock('./repo', () => ({ recoverStaleQuotes: vi.fn() }))
vi.mock('./process', async (importOriginal) => ({ ...(await importOriginal<typeof import('./process')>()), processQuote: vi.fn() }))

/** The quote functions' time limit: 300 s, the default on every Vercel plan with fluid compute. */
const FUNCTION_LIMIT_MS = 300_000
const SECRET = 's'.repeat(32)

const sweep = (token: string) =>
  sweepHandler({ request: new Request('http://localhost/api/quotes/sweep', { headers: { authorization: `Bearer ${token}` } }) })

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.mocked(emptyQuoteTrash).mockResolvedValue({ removed: [], kept: [] })
  vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: [], gaveUp: 0 })
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('the sweep and the function time limit', () => {
  /** Each read takes `readMs` on a clock the test keeps; returns the time, from the call, each read started at. */
  function readsTaking(readMs: number): number[] {
    const startedAt: number[] = []
    vi.mocked(processQuote).mockImplementation(async () => {
      startedAt.push(Date.now())
      vi.setSystemTime(Date.now() + readMs)
      return 'ready'
    })
    return startedAt
  }

  test('starts no job that could end past the limit; the rest wait for a poll or the next sweep', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 0 })
    vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: ['a', 'b', 'c', 'd', 'e'], gaveUp: 0 })
    const startedAt = readsTaking(20_000)

    const response = await sweep(SECRET)

    expect(startedAt.length).toBeGreaterThan(0)
    for (const t of startedAt) expect(t + JOB_WORST_CASE_MS).toBeLessThanOrEqual(FUNCTION_LIMIT_MS)
    expect(await response.json()).toMatchObject({ processed: startedAt.length, left: 5 - startedAt.length })
  })

  test('a slow trash pass leaves no time for a read: none is started', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 0 })
    vi.mocked(emptyQuoteTrash).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 60_000)
      return { removed: [], kept: [] }
    })
    vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: ['a'], gaveUp: 0 })
    const startedAt = readsTaking(20_000)

    const response = await sweep(SECRET)

    expect(startedAt).toEqual([])
    expect(await response.json()).toMatchObject({ processed: 0, left: 1 })
  })
})

describe("the sweep's counts", () => {
  test('a run that gives up on one stuck job reports stuck 1 and failed 1', async () => {
    vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: [], gaveUp: 1 })

    const response = await sweep(SECRET)

    expect(await response.json()).toMatchObject({ stuck: 1, failed: 1, trashed: 0 })
  })

  test('a stuck job started again counts as stuck, and as failed only when its read ends failed', async () => {
    vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: ['a', 'b', 'c'], gaveUp: 0 })
    const outcomes = { a: 'failed', b: 'ready', c: 'needs_review' } as const
    vi.mocked(processQuote).mockImplementation(async (id) => outcomes[id as keyof typeof outcomes])

    const response = await sweep(SECRET)

    expect(await response.json()).toMatchObject({ stuck: 3, failed: 1, processed: 3 })
  })

  test('a stuck job left for later still counts as stuck', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 0 })
    // A trash pass that takes the whole limit leaves no time to start the stuck job.
    vi.mocked(emptyQuoteTrash).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + FUNCTION_LIMIT_MS)
      return { removed: [], kept: [] }
    })
    vi.mocked(recoverStaleQuotes).mockResolvedValue({ kick: ['a'], gaveUp: 1 })

    const response = await sweep(SECRET)

    expect(await response.json()).toMatchObject({ stuck: 2, failed: 1, processed: 0, left: 1 })
  })

  test('trashed counts the files removed; the ones storage refused are kept apart', async () => {
    vi.mocked(emptyQuoteTrash).mockResolvedValue({ removed: ['quotes/u/1.pdf', 'quotes/u/2.pdf'], kept: ['quotes/u/3.pdf'] })

    const response = await sweep(SECRET)

    expect(await response.json()).toMatchObject({ trashed: 2, trashKept: 1 })
  })
})

describe('the cron secret', () => {
  test.each([16, 31])('a %i-character secret refuses even its own token, with one error that names the minimum', async (length) => {
    const secret = 'c'.repeat(length)
    vi.stubEnv('CRON_SECRET', secret)

    const response = await sweep(secret)

    expect(response.status).toBe(401)
    expect(errors).toHaveBeenCalledTimes(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain('32 characters')
    // The log says what is wrong, never the secret itself.
    expect(JSON.stringify(errors.mock.calls)).not.toContain(secret)
    expect(processQuote).not.toHaveBeenCalled()
  })

  test('a 32-character secret lets its own token run the sweep, with no error', async () => {
    const response = await sweep(SECRET)

    expect(response.status).toBe(200)
    expect(errors).not.toHaveBeenCalled()
  })

  test('a wrong token against a good secret is refused without blaming the secret', async () => {
    const response = await sweep('w'.repeat(32))

    expect(response.status).toBe(401)
    expect(errors).not.toHaveBeenCalled()
  })

  test('no secret at all: the sweep is off, refused without an error', async () => {
    vi.stubEnv('CRON_SECRET', undefined)

    const response = await sweep(SECRET)

    expect(response.status).toBe(401)
    expect(errors).not.toHaveBeenCalled()
  })

  // Anyone on the internet can call the route, so a refusal must come before any work: the trash pass deletes files.
  test.each<[string, string | undefined, HeadersInit]>([
    ['a wrong token', SECRET, { authorization: `Bearer ${'w'.repeat(32)}` }],
    ['no Authorization header', SECRET, {}],
    ['no secret set', undefined, { authorization: `Bearer ${SECRET}` }],
    ['a 16-character secret, with its own token', 'c'.repeat(16), { authorization: `Bearer ${'c'.repeat(16)}` }],
  ])('a refused call (%s) empties no trash, scans no quotes and starts no read', async (_case, secret, headers) => {
    vi.stubEnv('CRON_SECRET', secret)

    const response = await sweepHandler({ request: new Request('http://localhost/api/quotes/sweep', { headers }) })

    expect(response.status).toBe(401)
    expect(emptyQuoteTrash).not.toHaveBeenCalled()
    expect(recoverStaleQuotes).not.toHaveBeenCalled()
    expect(processQuote).not.toHaveBeenCalled()
  })
})
