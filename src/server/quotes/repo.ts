import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { quotes } from '../../db/schema'
import type { QuoteMime } from '../../lib/quote-limits'
import { MAX_ATTEMPTS, planStale, STALE_CLAIM_MS, type ClaimedQuote, type Finish, type QuoteJobRepo } from './process'

/** A worker that dies mid-read leaves the job "processing"; after STALE_CLAIM_MS another may take it over. */
const claimable = () =>
  or(eq(quotes.status, 'queued'), and(eq(quotes.status, 'processing'), lt(quotes.claimedAt, new Date(Date.now() - STALE_CLAIM_MS))))
/** The most in-flight jobs one recovery pass looks at, oldest first. */
const IN_FLIGHT_SCAN_LIMIT = 200
const GAVE_UP = 'gave up: the reading stopped and its attempts are used up'

export const dbJobRepo: QuoteJobRepo = {
  async claim(id) {
    const rows = await db
      .update(quotes)
      .set({ status: 'processing', claimedAt: sql`now()`, attempts: sql`${quotes.attempts} + 1` })
      .where(and(eq(quotes.id, id), lt(quotes.attempts, MAX_ATTEMPTS), claimable()))
      .returning({
        id: quotes.id, blobPathname: quotes.blobPathname, mime: quotes.mime, fileName: quotes.fileName, attempts: quotes.attempts,
        claimedAt: sql<string>`${quotes.claimedAt}::text`,
      })
    const row = rows[0]
    return row ? ({ ...row, mime: row.mime as QuoteMime } satisfies ClaimedQuote) : null
  },
  async finish(job: ClaimedQuote, f: Finish) {
    const usage = sql`coalesce(${quotes.usage}, '[]'::jsonb) || ${JSON.stringify(f.usage)}::jsonb`
    // Fenced on the claim: every claim bumps attempts and stamps claimed_at, so a late worker whose claim went stale and
    // was taken over matches no row. claimed_at also covers a retry, which resets attempts to 0.
    const underClaim = and(
      eq(quotes.id, job.id), eq(quotes.status, 'processing'), eq(quotes.attempts, job.attempts),
      eq(quotes.claimedAt, sql`${job.claimedAt}::timestamptz`),
    )
    // `in` narrows Finish here; comparing f.status did not under this TypeScript version.
    const set = !('extraction' in f)
      // claimed_at is kept on a re-queue, so the stale-queue wait counts from the last attempt, not from the upload.
      ? { status: f.status, error: f.error, usage, processedAt: f.status === 'failed' ? new Date() : null }
      : { status: f.status, extraction: f.extraction, modelUsed: f.modelUsed, error: null, usage, processedAt: new Date() }
    const rows = await db.update(quotes).set(set).where(underClaim).returning({ id: quotes.id })
    return rows.length > 0
  },
}

/**
 * Looks at the queued and processing jobs (one user's, or everyone's for the cron), marks as failed the stuck ones
 * with no attempts left, and returns the ids of the stuck ones that should be started again.
 */
export async function recoverStaleQuotes(userId?: string, limit = 10): Promise<string[]> {
  const inFlight = inArray(quotes.status, ['queued', 'processing'])
  const rows = await db
    .select({ id: quotes.id, status: quotes.status, attempts: quotes.attempts, claimedAt: quotes.claimedAt, createdAt: quotes.createdAt })
    .from(quotes)
    .where(userId ? and(inFlight, eq(quotes.userId, userId)) : inFlight)
    .orderBy(asc(quotes.createdAt))
    .limit(IN_FLIGHT_SCAN_LIMIT)
  const { kick, fail } = planStale(rows, new Date())
  if (fail.length > 0) {
    await db.update(quotes).set({ status: 'failed', error: GAVE_UP, processedAt: new Date() }).where(and(inArray(quotes.id, fail), inFlight))
    // Logged like a failed read: otherwise a worker that keeps dying shows only in the database.
    console.error('[quotes] gave up on a stuck quote', { ids: fail })
  }
  return kick.slice(0, limit)
}
