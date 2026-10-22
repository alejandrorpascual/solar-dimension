import { and, asc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/client'
import { quoteFileTrash, quotes } from '../../db/schema'
import type { QuoteMime } from '../../lib/quote-limits'
import { MAX_ATTEMPTS, planStale, STALE_CLAIM_MS, type ClaimedQuote, type Finish, type QuoteJobRepo } from './process'
import type { TrashRepo } from './trash'

/** A worker that dies mid-read leaves the job "processing"; after STALE_CLAIM_MS another may take it over. */
const claimable = () =>
  or(eq(quotes.status, 'queued'), and(eq(quotes.status, 'processing'), lt(quotes.claimedAt, new Date(Date.now() - STALE_CLAIM_MS))))
/** The most in-flight jobs one recovery pass looks at, oldest first. */
const IN_FLIGHT_SCAN_LIMIT = 200
/**
 * The status of a read that failed. A read of a quote that already has a reading (a Read again of one to check) never
 * makes it unusable: it goes back to needs_review, with the error; the retry is spent.
 */
const failedStatus = sql<'needs_review' | 'failed'>`case when ${quotes.extraction} is not null then 'needs_review' else 'failed' end`
const GAVE_UP = 'gave up: the reading stopped and its attempts are used up'

export const dbJobRepo: QuoteJobRepo = {
  async claim(id) {
    const rows = await db
      .update(quotes)
      .set({ status: 'processing', claimedAt: sql`now()`, attempts: sql`${quotes.attempts} + 1` })
      .where(and(eq(quotes.id, id), lt(quotes.attempts, MAX_ATTEMPTS), claimable()))
      .returning({
        id: quotes.id, blobPathname: quotes.blobPathname, mime: quotes.mime, fileName: quotes.fileName, attempts: quotes.attempts,
        claimedAt: sql<string>`${quotes.claimedAt}::text`, pages: quotes.pages,
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
      ? { status: f.status === 'failed' ? failedStatus : f.status, error: f.error, usage, processedAt: f.status === 'failed' ? new Date() : null }
      // A typed total exists only because an earlier reading needed one. A read that ends ready passed the checks with its
      // own total, which must win now: a ready card has no total form to correct a stale typed one.
      : {
          status: f.status, extraction: f.extraction, modelUsed: f.modelUsed, error: null, usage, processedAt: new Date(),
          ...(f.status === 'ready' ? { totalOverride: null } : {}),
        }
    const rows = await db.update(quotes).set(set).where(underClaim).returning({ status: quotes.status })
    return rows[0]?.status ?? null
  },
}

/** What one recovery pass did with the stuck jobs. */
export interface StaleQuotes {
  /** The stuck jobs to start again, oldest first, at most the pass's limit. */
  kick: string[]
  /** How many stuck jobs it found: the ones to start again, past the limit too, and the ones it gave up on. */
  stuck: number
  /** How many of the jobs it gave up on ended failed. One that already has a reading goes back to needs_review. */
  failed: number
}

/**
 * Looks at the queued and processing jobs (one user's, or everyone's for the cron), marks as failed the stuck ones
 * with no attempts left, and returns the ids of the stuck ones that should be started again.
 */
export async function recoverStaleQuotes(userId?: string, limit = 10): Promise<StaleQuotes> {
  const inFlight = inArray(quotes.status, ['queued', 'processing'])
  const rows = await db
    .select({ id: quotes.id, status: quotes.status, attempts: quotes.attempts, claimedAt: quotes.claimedAt, createdAt: quotes.createdAt })
    .from(quotes)
    .where(userId ? and(inFlight, eq(quotes.userId, userId)) : inFlight)
    .orderBy(asc(quotes.createdAt))
    .limit(IN_FLIGHT_SCAN_LIMIT)
  const { kick, fail } = planStale(rows, new Date())
  const ended = fail.length > 0 ? await giveUp(fail, inFlight) : []
  return { kick: kick.slice(0, limit), stuck: kick.length + fail.length, failed: ended.filter((r) => r.status === 'failed').length }
}

/**
 * Ends the reads of stuck jobs with no attempts left. Returns the rows it changed, with the status each now has: a job
 * that finished since the scan is no longer in flight, so it is left as it is.
 */
async function giveUp(ids: string[], inFlight: SQL) {
  const ended = await db.update(quotes).set({ status: failedStatus, error: GAVE_UP, processedAt: new Date() })
    .where(and(inArray(quotes.id, ids), inFlight))
    .returning({ status: quotes.status })
  // Logged like a failed read: otherwise a worker that keeps dying shows only in the database.
  console.error('[quotes] gave up on a stuck quote', { ids })
  return ended
}

/**
 * Adds the files of the quotes `where` selects to the trash. It goes in the same batch (one transaction) as the delete
 * of those quotes, so a deleted quote's file is always either trashed or still owned by its row.
 */
export const trashQuoteFiles = (where: SQL | undefined) =>
  db.insert(quoteFileTrash)
    .select(db.select({ pathname: quotes.blobPathname, createdAt: sql<Date>`now()`.as('created_at') }).from(quotes).where(where))
    .onConflictDoNothing()

export const dbTrashRepo: TrashRepo = {
  async oldest(limit) {
    const rows = await db.select({ path: quoteFileTrash.pathname }).from(quoteFileTrash).orderBy(asc(quoteFileTrash.createdAt)).limit(limit)
    return rows.map((r) => r.path)
  },
  async clear(paths) {
    if (paths.length) await db.delete(quoteFileTrash).where(inArray(quoteFileTrash.pathname, [...paths]))
  },
}
