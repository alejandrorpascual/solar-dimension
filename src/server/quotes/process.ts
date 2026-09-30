import { checkExtraction } from '../../lib/quote-checks'
import type { QuoteMime } from '../../lib/quote-limits'
import { normalizeExtraction, type QuoteExtraction, type QuoteStatus, type QuoteUsage } from '../../lib/quote-schema'
import { ModelError, type ModelInput, type QuoteModel } from './model'
import type { QuoteStorage } from './storage'

export const MAX_ATTEMPTS = 3
/**
 * One job can run 2 models x (a try and a retry) x the 120 s request timeout in model.ts = 8 min, so a claim older
 * than 10 min belongs to a worker that died. This plan sets no maxDuration; a platform limit only makes that more likely.
 */
export const STALE_CLAIM_MS = 10 * 60_000
/** A queued job that no worker picked up (or that went back to the queue) waits this long before a re-kick. */
export const STALE_QUEUE_MS = 60_000

export interface ClaimedQuote { id: string; blobPathname: string; mime: QuoteMime; fileName: string; attempts: number }
export type Finish =
  | { status: 'ready' | 'needs_review'; extraction: QuoteExtraction; modelUsed: string; usage: QuoteUsage[] }
  | { status: 'queued' | 'failed'; error: string; usage: QuoteUsage[] }
export interface QuoteJobRepo {
  /** Takes the job, or returns null when another worker has it or its attempts are used up. */
  claim(id: string): Promise<ClaimedQuote | null>
  finish(id: string, f: Finish): Promise<void>
}
export interface ProcessDeps { repo: QuoteJobRepo; storage: QuoteStorage; model: QuoteModel; models: { primary: string; fallback: string } }
export type Outcome = 'skipped' | Finish['status']

type Attempt =
  | { ok: true; extraction: QuoteExtraction; passes: boolean; usage: QuoteUsage }
  | { ok: false; error: ModelError }

const asModelError = (e: unknown): ModelError => (e instanceof ModelError ? e : new ModelError('invalid', String(e)))

/** One model's answer; a transient error gets one immediate retry. */
async function attempt(deps: ProcessDeps, input: ModelInput, model: string): Promise<Attempt> {
  const once = async (): Promise<Attempt> => {
    const out = await deps.model.extract(input, model)
    const extraction = normalizeExtraction(out.extraction)
    return { ok: true, extraction, passes: checkExtraction(extraction).length === 0, usage: { model, input: out.input, output: out.output } }
  }
  try {
    return await once()
  } catch (first) {
    const error = asModelError(first)
    if (error.kind !== 'transient') return { ok: false, error }
    try {
      return await once()
    } catch (second) {
      return { ok: false, error: asModelError(second) }
    }
  }
}

/**
 * What to store. A passing answer is ready. An answer that fails the checks still beats no answer: needs_review.
 * No answer at all goes back to the queue only when every error was transient and attempts remain.
 */
export function decide(primary: Attempt, fallback: Attempt | null, attempts: number, models: ProcessDeps['models']): Finish {
  const usage = [primary, fallback].flatMap((a) => (a?.ok ? [a.usage] : []))
  if (primary.ok && primary.passes) return { status: 'ready', extraction: primary.extraction, modelUsed: models.primary, usage }
  if (fallback?.ok && fallback.passes) return { status: 'ready', extraction: fallback.extraction, modelUsed: models.fallback, usage }
  if (fallback?.ok) return { status: 'needs_review', extraction: fallback.extraction, modelUsed: models.fallback, usage }
  if (primary.ok) return { status: 'needs_review', extraction: primary.extraction, modelUsed: models.primary, usage }
  const errors = [primary, fallback].flatMap((a) => (a && !a.ok ? [a.error] : []))
  const onlyTransient = errors.every((e) => e.kind === 'transient')
  return {
    status: onlyTransient && attempts < MAX_ATTEMPTS ? 'queued' : 'failed',
    error: errors.map((e) => `${e.kind}: ${e.message}`).join(' | '),
    usage,
  }
}

/** The columns that say whether an in-flight job is stuck. */
export interface JobClock { id: string; status: QuoteStatus; attempts: number; claimedAt: Date | null; createdAt: Date }

/**
 * Which stuck jobs to start again (`kick`) and which to give up on (`fail`). A job with no attempts left can't be
 * claimed again, so it would stay in flight forever, and the client would poll for it forever.
 */
export function planStale(jobs: readonly JobClock[], now: Date): { kick: string[]; fail: string[] } {
  const ageMs = (d: Date): number => now.getTime() - d.getTime()
  const kick: string[] = []
  const fail: string[] = []
  for (const j of jobs) {
    const isStale =
      j.status === 'processing' ? j.claimedAt !== null && ageMs(j.claimedAt) > STALE_CLAIM_MS
      : j.status === 'queued' ? ageMs(j.claimedAt ?? j.createdAt) > STALE_QUEUE_MS
      : false
    if (isStale) (j.attempts >= MAX_ATTEMPTS ? fail : kick).push(j.id)
  }
  return { kick, fail }
}

export async function processQuote(id: string, deps: ProcessDeps): Promise<Outcome> {
  const job = await deps.repo.claim(id)
  if (!job) return 'skipped'
  /** Stores the outcome. A failure is also logged: otherwise a revoked key or a model outage shows only in the database. */
  const finish = async (f: Finish): Promise<Outcome> => {
    await deps.repo.finish(id, f)
    if ('error' in f && f.status === 'failed') console.error('[quotes] a quote could not be read', { id, error: f.error })
    return f.status
  }
  let bytes: Uint8Array | null
  try {
    bytes = await deps.storage.get(job.blobPathname)
  } catch (error) {
    return finish({ status: job.attempts < MAX_ATTEMPTS ? 'queued' : 'failed', error: `storage: ${String(error)}`, usage: [] })
  }
  if (!bytes) return finish({ status: 'failed', error: 'file missing from storage', usage: [] })
  const input: ModelInput = { bytes, mime: job.mime, fileName: job.fileName }
  const primary = await attempt(deps, input, deps.models.primary)
  const fallback = primary.ok && primary.passes ? null : await attempt(deps, input, deps.models.fallback)
  return finish(decide(primary, fallback, job.attempts, deps.models))
}
