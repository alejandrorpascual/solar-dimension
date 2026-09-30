import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from '../../lib/quote-fixtures'
import type { QuoteExtraction } from '../../lib/quote-schema'
import { ModelError, type QuoteModel } from './model'
import {
  MAX_ATTEMPTS, planStale, processQuote, STALE_CLAIM_MS, STALE_QUEUE_MS, type ClaimedQuote, type Finish, type JobClock, type ProcessDeps,
} from './process'
import type { QuoteStorage } from './storage'

type Step = QuoteExtraction | ModelError
const BAD = extraction([line('inverter', 1000)], { tax: 0, total: 5000 }) // lines + tax don't add up to the total

function setup(steps: Record<string, Step[]>, opts: { attempts?: number; claimed?: boolean; file?: boolean } = {}) {
  const finished: Finish[] = []
  const calls: string[] = []
  const job: ClaimedQuote = { id: 'q1', blobPathname: 'quotes/u/x.pdf', mime: 'application/pdf', fileName: 'x.pdf', attempts: opts.attempts ?? 1 }
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
    repo: { claim: async () => (opts.claimed === false ? null : job), finish: async (_id, f) => { finished.push(f) } },
    storage, model, models: { primary: 'luna', fallback: 'sol' },
  }
  return { deps, finished, calls }
}
const transient = () => new ModelError('transient', '503')
const invalid = () => new ModelError('invalid', 'zod')

describe('processQuote', () => {
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
