import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from '../../lib/quote-fixtures'
import type { QuoteExtraction, QuoteStatus } from '../../lib/quote-schema'
import { ModelError, type QuoteModel } from './model'
import {
  MAX_ATTEMPTS, planStale, processQuote, STALE_CLAIM_MS, STALE_QUEUE_MS, type ClaimedQuote, type Finish, type JobClock,
  type ProcessDeps, type QuoteJobRepo,
} from './process'
import type { QuoteStorage } from './storage'

type Step = QuoteExtraction | ModelError
const BAD = extraction([line('inverter', 1000)], { tax: 0, total: 5000 }) // lines + tax don't add up to the total

function setup(steps: Record<string, Step[]>, opts: { attempts?: number; claimed?: boolean; file?: boolean } = {}) {
  const finished: Finish[] = []
  const calls: string[] = []
  const job: ClaimedQuote = { id: 'q1', blobPathname: 'quotes/u/x.pdf', mime: 'application/pdf', fileName: 'x.pdf', attempts: opts.attempts ?? 1,
    claimedAt: '2026-09-30 11:00:00.123456+00',
  }
  const model: QuoteModel = {
    async extract(_input, name) {
      calls.push(name)
      const next = steps[name]?.shift()
      if (!next) throw new Error(`no scripted answer for ${name}`)
      if (next instanceof ModelError) throw next
      return { extraction: next, input: 10, output: 5 }
    },
  }
  const storage: QuoteStorage = { put: async () => {}, get: async () => (opts.file === false ? null : new Uint8Array([1])), remove: async () => {} }
  const deps: ProcessDeps = {
    repo: { claim: async () => (opts.claimed === false ? null : job), finish: async (_job, f) => { finished.push(f); return true } },
    storage, model, models: { primary: 'luna', fallback: 'sol' },
  }
  return { deps, finished, calls }
}
const transient = () => new ModelError('transient', '503')
const invalid = () => new ModelError('invalid', 'zod')

describe('processQuote', () => {
  // A failed quote is logged on purpose (see the test below); the other failure tests don't need the noise.
  let errors: ReturnType<typeof vi.spyOn>
  beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { errors.mockRestore() })

  test('primary passes: ready with the primary model', async () => {
    const s = setup({ luna: [SAMPLE_QUOTES.solartec] })
    expect(await processQuote('q1', s.deps)).toBe('ready')
    expect(s.finished[0]).toMatchObject({ status: 'ready', modelUsed: 'luna', usage: [{ model: 'luna', input: 10, output: 5 }] })
    expect(s.calls).toEqual(['luna'])
  })
  test('primary fails the checks, fallback passes: ready with the fallback', async () => {
    const s = setup({ luna: [BAD], sol: [SAMPLE_QUOTES.solartec] })
    expect(await processQuote('q1', s.deps)).toBe('ready')
    expect(s.finished[0]).toMatchObject({ modelUsed: 'sol' })
    expect(s.finished[0]!.usage).toHaveLength(2)
  })
  test('both answer but fail the checks: needs_review with the fallback extraction', async () => {
    const s = setup({ luna: [BAD], sol: [BAD] })
    expect(await processQuote('q1', s.deps)).toBe('needs_review')
    expect(s.finished[0]).toMatchObject({ modelUsed: 'sol' })
  })
  test('primary answers badly, fallback errors: needs_review with the primary extraction', async () => {
    const s = setup({ luna: [BAD], sol: [invalid()] })
    expect(await processQuote('q1', s.deps)).toBe('needs_review')
    expect(s.finished[0]).toMatchObject({ modelUsed: 'luna' })
  })
  test('a transient error is retried once on the same model', async () => {
    const s = setup({ luna: [transient(), SAMPLE_QUOTES.solartec] })
    expect(await processQuote('q1', s.deps)).toBe('ready')
    expect(s.calls).toEqual(['luna', 'luna'])
  })
  test('only transient errors: back to queued while attempts remain, then failed', async () => {
    const answers = () => ({ luna: [transient(), transient()], sol: [transient(), transient()] })
    expect(await processQuote('q1', setup(answers(), { attempts: 1 }).deps)).toBe('queued')
    expect(await processQuote('q1', setup(answers(), { attempts: MAX_ATTEMPTS }).deps)).toBe('failed')
  })
  test('refusals or invalid answers from both: failed straight away', async () => {
    const s = setup({ luna: [invalid()], sol: [new ModelError('refused', 'no')] })
    expect(await processQuote('q1', s.deps)).toBe('failed')
    expect(s.finished[0]).toMatchObject({ status: 'failed' })
  })
  test('a failed quote is logged with its error, so a revoked key or an outage shows in the logs', async () => {
    const s = setup({ luna: [invalid()], sol: [invalid()] })
    expect(await processQuote('q1', s.deps)).toBe('failed')
    expect(errors).toHaveBeenCalledWith('[quotes] a quote could not be read', { id: 'q1', error: 'invalid: zod | invalid: zod' })
  })
  test('a quote that is read or queued again is not logged as a failure', async () => {
    await processQuote('q1', setup({ luna: [SAMPLE_QUOTES.solartec] }).deps)
    await processQuote('q1', setup({ luna: [transient(), transient()], sol: [transient(), transient()] }).deps)
    expect(errors).not.toHaveBeenCalled()
  })
  test('someone else holds the job: skipped, nothing written', async () => {
    const s = setup({}, { claimed: false })
    expect(await processQuote('q1', s.deps)).toBe('skipped')
    expect(s.finished).toEqual([])
  })
  test('the file is gone: failed without calling a model', async () => {
    const s = setup({}, { file: false })
    expect(await processQuote('q1', s.deps)).toBe('failed')
    expect(s.calls).toEqual([])
  })
})

/**
 * A one-row repo that fences `finish` like the database does: it writes only while the row is still processing under
 * the same claim (every claim bumps attempts and stamps claimed_at).
 */
function fencedRepo() {
  const row: { status: QuoteStatus; attempts: number; claimedAt: string | null; stored: Finish | null } = {
    status: 'queued', attempts: 0, claimedAt: null, stored: null,
  }
  const repo: QuoteJobRepo = {
    async claim(id) {
      row.status = 'processing'
      row.attempts += 1
      row.claimedAt = `claim ${row.attempts}`
      return { id, blobPathname: 'quotes/u/x.pdf', mime: 'application/pdf', fileName: 'x.pdf', attempts: row.attempts, claimedAt: row.claimedAt }
    },
    async finish(job, f) {
      if (row.status !== 'processing' || row.attempts !== job.attempts || row.claimedAt !== job.claimedAt) return false
      row.status = f.status
      row.stored = f
      return true
    },
  }
  return { repo, row }
}

describe('processQuote with a lost claim', () => {
  const storage: QuoteStorage = { put: async () => {}, get: async () => new Uint8Array([1]), remove: async () => {} }
  const models = { primary: 'luna', fallback: 'sol' }
  const fresh: QuoteModel = { extract: async () => ({ extraction: SAMPLE_QUOTES.solartec, input: 1, output: 1 }) }
  let warns: ReturnType<typeof vi.spyOn>
  let errors: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    warns.mockRestore()
    errors.mockRestore()
  })

  /**
   * The first worker's read outlives its claim: on its first model call, a second worker claims the quote and stores a
   * result. Then every call of the first worker fails with `late`.
   */
  function slowWorker(repo: QuoteJobRepo, late: () => ModelError): QuoteModel {
    let isTakenOver = false
    return {
      async extract() {
        if (!isTakenOver) {
          isTakenOver = true
          await processQuote('q1', { repo, storage, model: fresh, models })
        }
        throw late()
      },
    }
  }

  test('a late worker whose claim was taken over writes nothing, logs it, and does not throw', async () => {
    const { repo, row } = fencedRepo()
    const slow = slowWorker(repo, () => new ModelError('invalid', 'late answer'))
    await expect(processQuote('q1', { repo, storage, model: slow, models })).resolves.toBe('skipped')
    expect(row.status).toBe('ready')
    expect(row.stored).toMatchObject({ status: 'ready', modelUsed: 'luna' })
    expect(warns).toHaveBeenCalledWith('[quotes] a late worker lost its claim', { id: 'q1' })
    // The late failure was not stored, so it is not reported as a quote that could not be read.
    expect(errors).not.toHaveBeenCalled()
  })

  test('a late worker cannot send a finished quote back to the queue', async () => {
    const { repo, row } = fencedRepo()
    const slow = slowWorker(repo, () => new ModelError('transient', '503'))
    expect(await processQuote('q1', { repo, storage, model: slow, models })).toBe('skipped')
    expect(row.status).toBe('ready')
    expect(row.attempts).toBe(2)
  })
})

describe('planStale', () => {
  const now = new Date('2026-09-29T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const job = (over: Partial<JobClock>): JobClock => ({
    id: 'q', status: 'processing', attempts: 1, claimedAt: ago(0), createdAt: ago(60 * 60_000), ...over,
  })

  test('a claim younger than the worst-case run is left alone', () => {
    expect(planStale([job({ claimedAt: ago(STALE_CLAIM_MS - 1000) })], now)).toEqual({ kick: [], fail: [] })
  })
  test('a dead claim with attempts left is started again', () => {
    expect(planStale([job({ claimedAt: ago(STALE_CLAIM_MS + 1000), attempts: MAX_ATTEMPTS - 1 })], now)).toEqual({ kick: ['q'], fail: [] })
  })
  test('a dead claim on the last attempt is given up on, not left processing forever', () => {
    expect(planStale([job({ claimedAt: ago(STALE_CLAIM_MS + 1000), attempts: MAX_ATTEMPTS })], now)).toEqual({ kick: [], fail: ['q'] })
  })
  test('a queued job waits from its last claim, or from its upload when it was never claimed', () => {
    const queued = (over: Partial<JobClock>) => job({ status: 'queued', ...over })
    expect(planStale([queued({ claimedAt: null, createdAt: ago(STALE_QUEUE_MS + 1000) })], now).kick).toEqual(['q'])
    expect(planStale([queued({ claimedAt: null, createdAt: ago(STALE_QUEUE_MS - 1000) })], now).kick).toEqual([])
    expect(planStale([queued({ claimedAt: ago(1000), createdAt: ago(60 * 60_000) })], now).kick).toEqual([])
  })
  test('finished jobs are never touched', () => {
    const done = (['ready', 'needs_review', 'failed'] as const).map((status, i) => job({ id: `d${i}`, status, claimedAt: ago(60 * 60_000), attempts: MAX_ATTEMPTS }))
    expect(planStale(done, now)).toEqual({ kick: [], fail: [] })
  })
})
