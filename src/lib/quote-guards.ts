import { z } from 'zod'
import { parseAmount } from './parse-amount'
import { pdfInfo } from './pdf-info'
import { ITEM_IDS, OVERRIDES } from './quote-items'
import { limitRejection, QUOTE_LIMITS, sniffMime, type QuoteMime, type Rejection } from './quote-limits'
import type { QuoteStatus } from './quote-schema'

/** The largest total a user can type for a quote, in the quote's own currency. */
export const MAX_TOTAL = 10_000_000

export const ProjectId = z.string().min(1).max(64)
export const QuoteId = z.string().uuid()
export const OverrideInput = z.object({ quoteId: QuoteId, item: z.enum(ITEM_IDS), value: z.enum(OVERRIDES).nullable() })
export const TotalInput = z.object({ quoteId: QuoteId, total: z.number().positive().max(MAX_TOTAL) })
/** Zod 4 makes a record over an enum exhaustive: all eight items must be there. The client always sends the full `Musts`. */
export const MustsInput = z.object({ projectId: ProjectId, musts: z.record(z.enum(ITEM_IDS), z.boolean()) })

/** Only a quote the model gave up on can be retried; a read one stays until it is deleted. */
export const RETRYABLE: readonly QuoteStatus[] = ['failed']
/** Retries are free against the monthly limit, so each quote gets only this many: each one can cost up to 4 model calls. */
export const MAX_RETRIES = 3

/** Whether the user may retry a quote. The server checks the same limits in the update itself. */
export function canRetry(q: { status: QuoteStatus; retries: number }): boolean {
  return RETRYABLE.includes(q.status) && q.retries < MAX_RETRIES
}

/** A total typed by the user, or null when it isn't a positive amount up to MAX_TOTAL. */
export function parseTotal(s: string): number | null {
  const n = parseAmount(s)
  return n !== null && TotalInput.shape.total.safeParse(n).success ? n : null
}

/** Whether an upload may go ahead: the project must be the user's own and the limits not reached. */
export function uploadRejection(input: { ownsProject: boolean; counts: { project: number; month: number } }): Rejection | null {
  if (!input.ownsProject) return { code: 'not_saved' }
  return limitRejection(input.counts)
}

/** Why the atomic insert took no row: the limit the fresh counts show, or a plain failure if a slot has opened since. */
export function refusedInsertRejection(counts: { project: number; month: number }): Rejection {
  return limitRejection(counts) ?? { code: 'upload' }
}

export type Inspection = { ok: true; mime: QuoteMime; pages: number | null } | { ok: false; rejection: Rejection }

/** What the file really is, from its first bytes, and for a PDF its page count. The browser's checks are only a hint. */
export async function inspectUpload(bytes: Uint8Array): Promise<Inspection> {
  const mime = sniffMime(bytes)
  if (!mime) return { ok: false, rejection: { code: 'type' } }
  if (mime !== 'application/pdf') return { ok: true, mime, pages: null }
  const info = await pdfInfo(bytes)
  if (!info.ok) return { ok: false, rejection: info.reason === 'encrypted' ? { code: 'encrypted' } : { code: 'type' } }
  if (info.pages > QUOTE_LIMITS.maxPages) return { ok: false, rejection: { code: 'pages', pages: info.pages } }
  return { ok: true, mime, pages: info.pages }
}
