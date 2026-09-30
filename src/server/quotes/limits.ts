import { and, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { quotes, quoteUsage } from '../../db/schema'
import { monthStart, QUOTE_LIMITS, type QuoteMime } from '../../lib/quote-limits'

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

export interface NewQuote { id: string; userId: string; projectId: string; fileName: string; blobPathname: string; mime: QuoteMime; sizeBytes: number; pages: number | null }

/**
 * Adds the quote only if both limits still allow it, and counts it in `quote_usage`, in one transaction. The Neon HTTP
 * driver has no interactive transactions, but `batch` runs as one. The advisory lock makes a user's uploads take turns,
 * so parallel uploads cannot all pass the same count. Returns whether the row was inserted.
 */
export async function insertWithinLimits(q: NewQuote): Promise<boolean> {
  const month = usageMonth()
  const [, inserted] = await db.batch([
    lockUserQuotes(q.userId),
    db.execute(sql`
      insert into quotes (id, user_id, project_id, file_name, blob_pathname, mime, size_bytes, pages)
      select ${q.id}::uuid, ${q.userId}::text, ${q.projectId}::text, ${q.fileName}::text, ${q.blobPathname}::text, ${q.mime}::text, ${q.sizeBytes}::integer, ${q.pages}::integer
      where (select count(*) from quotes where user_id = ${q.userId} and project_id = ${q.projectId}) < ${QUOTE_LIMITS.perProject}
        and coalesce((select uploads from quote_usage where user_id = ${q.userId} and month = ${month}::date), 0) < ${QUOTE_LIMITS.perMonth}
      returning id`),
    db.execute(sql`
      insert into quote_usage (user_id, month, uploads)
      select ${q.userId}, ${month}::date, 1 where exists (select 1 from quotes where id = ${q.id}::uuid)
      on conflict (user_id, month) do update set uploads = quote_usage.uploads + 1`),
  ])
  return inserted.rows.length > 0
}
