import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { projects, quotes, user } from '../db/schema'
import { requireAdmin } from './admin-catalog'

/** How many failed reads the admin page lists, newest first. */
const FAILED_READS_LIMIT = 50

export interface FailedRead {
  id: string
  fileName: string
  /** Null only if the account or project went away without its quotes. */
  email: string | null
  project: string | null
  error: string | null
  /** When the read failed, ISO 8601: processed_at, stamped on failure, else the upload time. */
  at: string
}

/** The newest reads that ended failed, across every account, for the admin. A non-admin gets "Not found". */
export const adminListFailedQuotes = createServerFn({ method: 'GET' }).handler(async (): Promise<FailedRead[]> => {
  await requireAdmin()
  const rows = await db
    .select({
      id: quotes.id, fileName: quotes.fileName, email: user.email, project: projects.name, error: quotes.error,
      processedAt: quotes.processedAt, createdAt: quotes.createdAt,
    })
    .from(quotes)
    .leftJoin(user, eq(user.id, quotes.userId))
    .leftJoin(projects, and(eq(projects.userId, quotes.userId), eq(projects.id, quotes.projectId)))
    .where(eq(quotes.status, 'failed'))
    .orderBy(desc(sql`coalesce(${quotes.processedAt}, ${quotes.createdAt})`))
    .limit(FAILED_READS_LIMIT)
  return rows.map(({ processedAt, createdAt, ...r }) => ({ ...r, at: (processedAt ?? createdAt).toISOString() }))
})
