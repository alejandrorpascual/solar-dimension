import { checkExtraction } from '../../lib/quote-checks'
import type { QuoteMime } from '../../lib/quote-limits'
import { normalizeExtraction, type QuoteExtraction, type QuoteStatus, type QuoteUsage } from '../../lib/quote-schema'
import { ModelError, REQUEST_TIMEOUT_MS, type ModelInput, type QuoteModel } from './model'
import type { QuoteStorage } from './storage'
import { FUNCTION_MAX_DURATION_MS } from './time-limits'

export const MAX_ATTEMPTS = 3
const MODELS_PER_JOB = 2
/** A try and one retry (attempt). */
const CALLS_PER_MODEL = 2
/**
 * Room for the claim, the file read and the write of the outcome around the model calls.
 * ponytail: storage and the database have no timeout of their own; a call that hangs runs into the function limit,
 * and the stale-claim window below starts the job again.
 */
const JOB_OVERHEAD_MS = 30_000
/**
 * The longest one job can run: both models, every retry, each call running to the request timeout, plus the overhead.
 * It is under the function limit (time-limits.ts), so a read that starts at once ends, or fails, before the platform
 * cuts it off; the sweep starts a job only while this much time is left.
 */
export const JOB_WORST_CASE_MS = MODELS_PER_JOB * CALLS_PER_MODEL * REQUEST_TIMEOUT_MS + JOB_OVERHEAD_MS
/** Slack for the server clock (which ages a claim) running ahead of the database clock (which stamps it). */
const CLOCK_SKEW_MS = 60_000
/**
 * The platform stops a worker at the function limit, so a claim older than that, plus the clock skew, belongs to a
 * worker that died or was cut off: another may take the job over.
 */
export const STALE_CLAIM_MS = FUNCTION_MAX_DURATION_MS + CLOCK_SKEW_MS
/** A queued job that no worker picked up (or that went back to the queue) waits this long before a re-kick. */
export const STALE_QUEUE_MS = 60_000

export interface ClaimedQuote {
  id: string; blobPathname: string; mime: QuoteMime; fileName: string; attempts: number
  /** The claim's time as the database wrote it, as text so no microseconds are lost; `finish` compares it. */
  claimedAt: string
  /** The file's page count, which the reading's source pages are checked against; null for an image. */
  pages: number | null
}
export type Finish =
  | { status: 'ready' | 'needs_review'; extraction: QuoteExtraction; modelUsed: string; usage: QuoteUsage[] }
  | { status: 'queued' | 'failed'; error: string; usage: QuoteUsage[] }
export interface QuoteJobRepo {
  /** Takes the job, or returns null when another worker has it or its attempts are used up. */
  claim(id: string): Promise<ClaimedQuote | null>
  /**
   * Stores the outcome only while `job`'s claim still holds: the row is processing and no later claim bumped its
   * attempts. Returns false, writing nothing, when the claim went stale and another worker took the job over.
   */
  finish(job: ClaimedQuote, f: Finish): Promise<boolean>
}
export interface ProcessDeps { repo: QuoteJobRepo; storage: QuoteStorage; model: QuoteModel; models: { primary: string; fallback: string } }
export type Outcome = 'skipped' | Finish['status']

type Attempt =
  | { ok: true; extraction: QuoteExtraction; passes: boolean; usage: QuoteUsage }
  | { ok: false; error: ModelError }

const asModelError = (e: unknown): ModelError => (e instanceof ModelError ? e : new ModelError('invalid', String(e)))

/**
 * One model's answer, checked against the file's page count. A transient error gets one immediate retry; a timeout
 * does not, since a second wait as long would push the read past the function limit: the other model goes next.
 */
async function attempt(deps: ProcessDeps, input: ModelInput, model: string, pages: number | null): Promise<Attempt> {
  const once = async (): Promise<Attempt> => {
    const out = await deps.model.extract(input, model)
    const extraction = normalizeExtraction(out.extraction)
    return { ok: true, extraction, passes: checkExtraction(extraction, pages).length === 0, usage: { model, input: out.input, output: out.output } }
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

/** Errors that may pass on a later attempt. */
const canPassLater = (e: ModelError): boolean => e.kind === 'transient' || e.kind === 'timeout'

/**
 * What to store. A passing answer is ready. An answer that fails the checks still beats no answer: needs_review.
 * No answer at all goes back to the queue only when every error was transient (a timeout included) and attempts remain.
 */
export function decide(primary: Attempt, fallback: Attempt | null, attempts: number, models: ProcessDeps['models']): Finish {
  const usage = [primary, fallback].flatMap((a) => (a?.ok ? [a.usage] : []))
  if (primary.ok && primary.passes) return { status: 'ready', extraction: primary.extraction, modelUsed: models.primary, usage }
  if (fallback?.ok && fallback.passes) return { status: 'ready', extraction: fallback.extraction, modelUsed: models.fallback, usage }
  if (fallback?.ok) return { status: 'needs_review', extraction: fallback.extraction, modelUsed: models.fallback, usage }
  if (primary.ok) return { status: 'needs_review', extraction: primary.extraction, modelUsed: models.primary, usage }
  const errors = [primary, fallback].flatMap((a) => (a && !a.ok ? [a.error] : []))
  const onlyTransient = errors.every(canPassLater)
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
  /**
   * Stores the outcome. A failure is also logged: otherwise a revoked key or a model outage shows only in the database.
   * A worker that lost its claim stores nothing, so it never overwrites the newer worker's result.
   */
  const finish = async (f: Finish): Promise<Outcome> => {
    if (!(await deps.repo.finish(job, f))) {
      console.warn('[quotes] a late worker lost its claim', { id })
      return 'skipped'
    }
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
  const primary = await attempt(deps, input, deps.models.primary, job.pages)
  const fallback = primary.ok && primary.passes ? null : await attempt(deps, input, deps.models.fallback, job.pages)
  return finish(decide(primary, fallback, job.attempts, deps.models))
}
