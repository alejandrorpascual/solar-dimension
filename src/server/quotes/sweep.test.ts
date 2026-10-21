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
  vi.mocked(recoverStaleQuotes).mockResolvedValue([])
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
    vi.mocked(recoverStaleQuotes).mockResolvedValue(['a', 'b', 'c', 'd', 'e'])
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
    vi.mocked(recoverStaleQuotes).mockResolvedValue(['a'])
    const startedAt = readsTaking(20_000)

    const response = await sweep(SECRET)

    expect(startedAt).toEqual([])
    expect(await response.json()).toMatchObject({ processed: 0, left: 1 })
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
})
