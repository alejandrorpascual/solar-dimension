import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { quoteDailyUsage, quotes, quoteUsage } from '../../db/schema'
import { parseDailyReads, utcDay, type DailyBudget } from '../../lib/quote-budget'
import { MAX_RETRIES, RETRYABLE } from '../../lib/quote-guards'
import { monthStart, QUOTE_LIMITS, type QuoteMime } from '../../lib/quote-limits'

/** QUOTES_DAILY_READS, read once when the server starts. An invalid value is logged once, without the value itself. */
const DAILY_READS = parseDailyReads(process.env.QUOTES_DAILY_READS)
if (DAILY_READS.isInvalid) console.warn('[quotes] QUOTES_DAILY_READS is not a whole number; using the default', { limit: DAILY_READS.limit })

/** Today's (UTC) reads across every account, and the daily limit. */
export async function dailyBudget(): Promise<DailyBudget> {
  const [row] = await db.select({ n: quoteDailyUsage.reads }).from(quoteDailyUsage).where(eq(quoteDailyUsage.day, utcDay(new Date())))
  return { reads: row?.n ?? 0, limit: DAILY_READS.limit }
}

/**
 * Takes one of today's reads, if any are left, and returns whether it got one. The only way `quote_daily_usage` grows,
 * and it is atomic across accounts without a lock of its own: `on conflict do update` locks today's row, and a
 * concurrent upsert waits for that lock and then re-checks `reads < limit` against the committed row (Postgres always
 * evaluates the conflict branch on the newest version, even under read committed). So when two reads race at limit - 1,
 * one gets `day` back and the other gets nothing. The first read of a day inserts the row; a racing insert hits the
 * conflict, waits, and takes the update path; it too checks the limit, so a limit of 0 pauses even the first read.
 * `admit` is the rest of the admission check: no row, no read taken.
 */
const takeDailyRead = (day: string, admit: ReturnType<typeof sql>) => sql`
  insert into quote_daily_usage (day, reads)
  select ${day}::date, 1 where ${admit} and ${DAILY_READS.limit}::integer > 0
  on conflict (day) do update set reads = quote_daily_usage.reads + 1 where quote_daily_usage.reads < ${DAILY_READS.limit}::integer
  returning day`

/**
 * Makes one user's writes to their quotes take turns until the batch (one transaction) ends: uploads, and project
 * deletes, which must see every quote an upload added before them.
 */
export const lockUserQuotes = (userId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)

/** The UTC month's first day as a date string, the key of `quote_usage`. */
const usageMonth = (): string => monthStart(new Date()).toISOString().slice(0, 10)

/** The project's live quotes, and the uploads counted this UTC month (deleted quotes still count). */
export async function quoteCounts(userId: string, projectId: string): Promise<{ project: number; month: number }> {
  const [[projectRow], [usageRow]] = await Promise.all([
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(quotes).where(and(eq(quotes.userId, userId), eq(quotes.projectId, projectId))),
    db.select({ n: quoteUsage.uploads }).from(quoteUsage).where(and(eq(quoteUsage.userId, userId), eq(quoteUsage.month, usageMonth()))),
  ])
  return { project: projectRow?.n ?? 0, month: usageRow?.n ?? 0 }
}

export interface NewQuote { id: string; userId: string; projectId: string; fileName: string; blobPathname: string; mime: QuoteMime; sizeBytes: number; pages: number | null; fileHash: string }

/**
 * Adds the quote only if the account's limits and today's read budget still allow it, and counts it in `quote_usage`
 * and `quote_daily_usage`, in one transaction. The Neon HTTP driver has no interactive transactions, but `batch` runs
 * as one. The advisory lock makes a user's uploads take turns, so parallel uploads cannot all pass the same count; it
 * is per user, so the daily budget, shared by every account, is guarded by takeDailyRead's conditional upsert
 * instead. The quote is inserted only when that upsert returned today's row, in the same statement, so a read is never
 * taken without its quote nor a quote added without its read. Returns whether the row was inserted.
 */
export async function insertWithinLimits(q: NewQuote): Promise<boolean> {
  const month = usageMonth()
  const withinAccountLimits = sql`
    (select count(*) from quotes where user_id = ${q.userId} and project_id = ${q.projectId}) < ${QUOTE_LIMITS.perProject}
    and coalesce((select uploads from quote_usage where user_id = ${q.userId} and month = ${month}::date), 0) < ${QUOTE_LIMITS.perMonth}`
  const [, inserted] = await db.batch([
    lockUserQuotes(q.userId),
    db.execute(sql`
      with admitted as (${takeDailyRead(utcDay(new Date()), withinAccountLimits)})
      insert into quotes (id, user_id, project_id, file_name, blob_pathname, mime, size_bytes, pages, file_hash)
      select ${q.id}::uuid, ${q.userId}::text, ${q.projectId}::text, ${q.fileName}::text, ${q.blobPathname}::text, ${q.mime}::text, ${q.sizeBytes}::integer, ${q.pages}::integer, ${q.fileHash}::text
      where exists (select 1 from admitted)
      returning id`),
    db.execute(sql`
      insert into quote_usage (user_id, month, uploads)
      select ${q.userId}, ${month}::date, 1 where exists (select 1 from quotes where id = ${q.id}::uuid)
      on conflict (user_id, month) do update set uploads = quote_usage.uploads + 1`),
  ])
  return inserted.rows.length > 0
}

export interface RetryAttempt { retried: boolean; retryable: boolean; admitted: boolean }

/**
 * Queues a failed or needs-review quote of the user's again, if it has retries left and today's read budget admits it, in one
 * statement (so one transaction): the read is taken only for a retryable quote, and the quote changes only when the
 * read was taken. `target` locks the quote row (`for update`), so a second retry of the same quote waits for the
 * first to commit; Postgres then re-checks the row against the WHERE (read committed re-evaluates a locked row), finds
 * it queued, and leaves `target` empty: the second retry takes no read and changes nothing.
 */
export async function retryWithinBudget(userId: string, quoteId: string): Promise<RetryAttempt> {
  const retryable = and(eq(quotes.id, quoteId), eq(quotes.userId, userId), inArray(quotes.status, [...RETRYABLE]), lt(quotes.retries, MAX_RETRIES))
  const result = await db.execute(sql`
    with target as (select id from quotes where ${retryable} for update),
    admitted as (${takeDailyRead(utcDay(new Date()), sql`exists (select 1 from target)`)}),
    retried as (
      update quotes set status = 'queued', attempts = 0, retries = retries + 1, error = null, claimed_at = null, seen_at = null
      where ${retryable} and exists (select 1 from admitted)
      returning id
    )
    select exists (select 1 from target) as retryable, exists (select 1 from admitted) as admitted, exists (select 1 from retried) as retried`)
  const row = result.rows[0] as Partial<RetryAttempt> | undefined
  return { retried: row?.retried === true, retryable: row?.retryable === true, admitted: row?.admitted === true }
}
