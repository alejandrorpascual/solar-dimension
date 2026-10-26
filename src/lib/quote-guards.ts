import { z } from 'zod'
import { parseAmount } from './parse-amount'
import { dailyRejection, type DailyBudget } from './quote-budget'
import { ITEM_IDS, OVERRIDES } from './quote-items'
import { limitRejection, type Rejection } from './quote-limits'
import type { QuoteStatus } from './quote-schema'

/**
 * The largest total a user can type for a quote, in the quote's own currency: the cap a reading's amounts have
 * (PLAUSIBLE.AMOUNT in quote-checks), so a total in COP or VES fits.
 */
export const MAX_TOTAL = 1_000_000_000

export const ProjectId = z.string().min(1).max(64)
export const QuoteId = z.string().uuid()
export const OverrideInput = z.object({ quoteId: QuoteId, item: z.enum(ITEM_IDS), value: z.enum(OVERRIDES).nullable() })
export const TotalInput = z.object({ quoteId: QuoteId, total: z.number().positive().max(MAX_TOTAL) })
/** One must-have switched on or off. Each change saves only its own item, so two quick changes can't undo each other. */
export const MustInput = z.object({ projectId: ProjectId, item: z.enum(ITEM_IDS), value: z.boolean() })

/**
 * A quote the model gave up on can be retried, and one whose numbers need checking can be read again (a reading from
 * before options, for one). A ready quote stays until it is deleted.
 */
export const RETRYABLE: readonly QuoteStatus[] = ['failed', 'needs_review']
/** Retries are free against the monthly limit, so each quote gets only this many: each one can cost up to 4 model calls. */
export const MAX_RETRIES = 3

/** Whether the user may retry a quote. The server checks the same limits in the update itself. */
export function canRetry(q: { status: QuoteStatus; retries: number }): boolean {
  return RETRYABLE.includes(q.status) && q.retries < MAX_RETRIES
}

/**
 * What a failed or needs-review quote's card offers: Retry, a note that its retries are used up, or nothing for an account that may not
 * start reads (the server would refuse the retry).
 */
export function retryOffer(q: { status: QuoteStatus; retries: number }, canUseQuotes: boolean): 'retry' | 'used_up' | 'none' {
  if (!canUseQuotes) return 'none'
  return canRetry(q) ? 'retry' : 'used_up'
}

/** A total typed by the user, or null when it isn't a positive amount up to MAX_TOTAL. */
export function parseTotal(s: string): number | null {
  const n = parseAmount(s)
  return n !== null && TotalInput.shape.total.safeParse(n).success ? n : null
}

/**
 * Whether an upload may go ahead: the project must be the user's own, the account's limits not reached, and today's
 * reads across every account still under the daily budget.
 */
export function uploadRejection(input: { ownsProject: boolean; counts: { project: number; month: number }; daily: DailyBudget }): Rejection | null {
  if (!input.ownsProject) return { code: 'not_saved' }
  return limitRejection(input.counts) ?? dailyRejection(input.daily)
}

/** Why the atomic insert took no row: the limit the fresh counts show, or a plain failure if a slot has opened since. */
export function refusedInsertRejection(counts: { project: number; month: number }, daily: DailyBudget): Rejection {
  return limitRejection(counts) ?? dailyRejection(daily) ?? { code: 'upload' }
}

/**
 * Why a retry did not go through, from what its one statement saw: whether the quote was the user's and retryable,
 * and whether the daily budget admitted it. A quote that is not retryable (or not the user's) is "not found".
 */
export function retryRefusal(r: { retried: boolean; retryable: boolean; admitted: boolean }): Rejection | 'not_found' | null {
  if (r.retried) return null
  return r.retryable && !r.admitted ? { code: 'daily_limit' } : 'not_found'
}

/**
 * The file's fingerprint: the hex SHA-256 of its bytes. Stored on the quote (quotes.file_hash) so the same file uploaded
 * again is spotted as a duplicate whatever its reading says; the bytes themselves are kept only in the quote's blob.
 */
export async function fileFingerprint(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
