import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { db } from '../../db/client'
import { projects, quotes, quoteSettings } from '../../db/schema'
import { computeProject } from '../../lib/project-summary'
import { inspectUpload, MustInput, OverrideInput, ProjectId, QuoteId, refusedInsertRejection, retryRefusal, TotalInput, uploadRejection } from '../../lib/quote-guards'
import { kitNeeds, resolveMusts, type Musts } from '../../lib/quote-items'
import { summarizeProject, type JobQuote, type ProjectJobs } from '../../lib/quote-jobs'
import { checkBasics, cleanFileName, type Rejection } from '../../lib/quote-limits'
import { FINISHED } from '../../lib/quote-schema'
import type { Project } from '../../lib/schema'
import { loadCatalog } from '../catalog'
import { toProject } from '../projects'
import { requireQuoteUser, requireUserId } from '../session'
import { defaultStorage, emptyQuoteTrash } from './deps'
import { kickQuotes } from './kick'
import { dailyBudget, insertWithinLimits, quoteCounts, retryWithinBudget } from './limits'
import { recoverStaleQuotes, trashQuoteFiles } from './repo'
import { quotePath } from './storage'

export type UploadResult = { ok: true; id: string } | { ok: false; rejection: Rejection }
export type RetryResult = { ok: true } | { ok: false; rejection: Rejection }
export interface ProjectQuotes { project: Project; quotes: JobQuote[]; musts: Musts }

type QuoteRow = typeof quotes.$inferSelect
function toJobQuote(r: QuoteRow): JobQuote {
  return {
    id: r.id, fileName: r.fileName, label: r.vendorLabel, status: r.status, extraction: r.extraction ?? null,
    overrides: r.overrides, totalOverride: r.totalOverride, createdAt: r.createdAt.getTime(), seenAt: r.seenAt?.getTime() ?? null,
    retries: r.retries,
  }
}

const ownProject = (userId: string, projectId: string) => and(eq(projects.userId, userId), eq(projects.id, projectId))
const ownQuote = (userId: string, quoteId: string) => and(eq(quotes.id, quoteId), eq(quotes.userId, userId))
const reject = (rejection: Rejection): UploadResult => ({ ok: false, rejection })

/** A spent daily budget is the owner's business too: it is logged whenever it turns a read away. */
function logSpentBudget(rejection: Rejection, userId: string, kind: 'upload' | 'retry'): Rejection {
  if (rejection.code === 'daily_limit') console.warn('[quotes] the daily read budget is spent; a read was refused', { userId, kind })
  return rejection
}

/**
 * One file per call, only from an account that may start reads (requireQuoteUser). The counts are checked first so an over-limit upload is refused before any work; the real guard is
 * `insertWithinLimits`, which the server runs after the file is stored, so parallel uploads cannot exceed the limits.
 */
export const uploadQuote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('Expected FormData')
    const file = d.get('file')
    if (!(file instanceof File)) throw new Error('Expected a file')
    return { projectId: ProjectId.parse(d.get('projectId')), file }
  })
  .handler(async ({ data }): Promise<UploadResult> => {
    const access = await requireQuoteUser()
    if (!access.ok) return reject(access.rejection)
    const { userId } = access
    const basic = checkBasics(data.file)
    if (basic) return reject(basic)
    const [project] = await db.select({ id: projects.id }).from(projects).where(ownProject(userId, data.projectId)).limit(1)
    const [counts, daily] = await Promise.all([project ? quoteCounts(userId, data.projectId) : { project: 0, month: 0 }, dailyBudget()])
    const blocked = uploadRejection({ ownsProject: project !== undefined, counts, daily })
    if (blocked) return reject(logSpentBudget(blocked, userId, 'upload'))

    const bytes = new Uint8Array(await data.file.arrayBuffer())
    const inspected = await inspectUpload(bytes)
    if (!inspected.ok) return reject(inspected.rejection)
    const { mime, pages } = inspected

    const id = crypto.randomUUID()
    const blobPathname = quotePath(userId, id, mime)
    const dropFile = () => defaultStorage.remove([blobPathname]).catch((error) => console.error('[quotes] removing an unused file failed', { userId, id, error }))
    try {
      await defaultStorage.put(blobPathname, bytes, mime)
      const added = await insertWithinLimits({
        id, userId, projectId: data.projectId, fileName: cleanFileName(data.file.name), blobPathname, mime, sizeBytes: bytes.byteLength, pages,
      })
      if (!added) {
        // Another upload took the last slot, or the day's last read, while this file was being read and stored.
        await dropFile()
        const [fresh, freshDaily] = await Promise.all([quoteCounts(userId, data.projectId), dailyBudget()])
        return reject(logSpentBudget(refusedInsertRejection(fresh, freshDaily), userId, 'upload'))
      }
    } catch (error) {
      console.error('[quotes] upload failed', { userId, id, error })
      await dropFile()
      return reject({ code: 'upload' })
    }
    kickQuotes([id])
    return { ok: true, id }
  })

/** Every project of the user that has quotes, for the tray and the cards. Also re-kicks jobs that went quiet. */
export const getQuoteJobs = createServerFn({ method: 'GET' }).handler(async (): Promise<ProjectJobs[]> => {
  const userId = await requireUserId()
  const stale = await recoverStaleQuotes(userId)
  if (stale.length) kickQuotes(stale)
  const rows = await db.select().from(quotes).where(eq(quotes.userId, userId)).orderBy(quotes.createdAt)
  if (rows.length === 0) return []
  const ids = [...new Set(rows.map((r) => r.projectId))]
  const [projectRows, settingRows, catalog] = await Promise.all([
    db.select().from(projects).where(and(eq(projects.userId, userId), inArray(projects.id, ids))),
    db.select().from(quoteSettings).where(and(eq(quoteSettings.userId, userId), inArray(quoteSettings.projectId, ids))),
    loadCatalog(),
  ])
  return projectRows.map((p) => {
    const result = computeProject(toProject(p), catalog)
    const musts = resolveMusts(settingRows.find((s) => s.projectId === p.id)?.musts)
    const own = rows.filter((q) => q.projectId === p.id).map(toJobQuote)
    return summarizeProject(p.id, p.name, own, result.empty ? null : kitNeeds(result), musts)
  })
})

export const getProjectQuotes = createServerFn({ method: 'GET' })
  .validator((d: unknown) => z.object({ projectId: ProjectId }).parse(d))
  .handler(async ({ data }): Promise<ProjectQuotes> => {
    const userId = await requireUserId()
    const [p] = await db.select().from(projects).where(ownProject(userId, data.projectId)).limit(1)
    if (!p) throw notFound()
    const [rows, settings] = await Promise.all([
      db.select().from(quotes).where(and(eq(quotes.userId, userId), eq(quotes.projectId, data.projectId))).orderBy(quotes.createdAt),
      db.select().from(quoteSettings).where(and(eq(quoteSettings.userId, userId), eq(quoteSettings.projectId, data.projectId))).limit(1),
    ])
    return { project: toProject(p), quotes: rows.map(toJobQuote), musts: resolveMusts(settings[0]?.musts) }
  })

/** Updates the user's own quote, only when `when` also holds if given. Throws when nothing matched. */
async function updateOwn(userId: string, quoteId: string, set: PgUpdateSetSource<typeof quotes>, when?: SQL) {
  const where = and(ownQuote(userId, quoteId), when)
  const rows = await db.update(quotes).set(set).where(where).returning({ id: quotes.id })
  if (rows.length === 0) throw new Error('Not found')
}

export const setQuoteOverride = createServerFn({ method: 'POST' })
  .validator((d: unknown) => OverrideInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const overrides = data.value === null
      ? sql`${quotes.overrides} - ${data.item}::text`
      : sql`${quotes.overrides} || jsonb_build_object(${data.item}::text, ${data.value}::text)`
    await updateOwn(userId, data.quoteId, { overrides })
    return { ok: true as const }
  })

export const setQuoteTotal = createServerFn({ method: 'POST' })
  .validator((d: unknown) => TotalInput.parse(d))
  .handler(async ({ data }) => {
    await updateOwn(await requireUserId(), data.quoteId, { totalOverride: data.total })
    return { ok: true as const }
  })

/**
 * Saves one must-have, merged into the stored ones in a single upsert, so changes to different items never overwrite
 * each other whatever order they land in. A first save starts from the defaults.
 */
export const setQuoteMust = createServerFn({ method: 'POST' })
  .validator((d: unknown) => MustInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const [p] = await db.select({ id: projects.id }).from(projects).where(ownProject(userId, data.projectId)).limit(1)
    if (!p) throw new Error('Not found')
    const merged = sql`coalesce(${quoteSettings.musts}, '{}'::jsonb) || jsonb_build_object(${data.item}::text, ${data.value}::boolean)`
    await db.insert(quoteSettings)
      .values({ userId, projectId: data.projectId, musts: resolveMusts({ [data.item]: data.value }), updatedAt: new Date() })
      .onConflictDoUpdate({ target: [quoteSettings.userId, quoteSettings.projectId], set: { musts: merged, updatedAt: new Date() } })
    return { ok: true as const }
  })

export const markQuotesSeen = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ projectId: ProjectId }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await db.update(quotes).set({ seenAt: new Date() }).where(and(
      eq(quotes.userId, userId), eq(quotes.projectId, data.projectId), isNull(quotes.seenAt), inArray(quotes.status, [...FINISHED]),
    ))
    return { ok: true as const }
  })

export const retryQuote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ quoteId: QuoteId }).parse(d))
  .handler(async ({ data }): Promise<RetryResult> => {
    const access = await requireQuoteUser()
    if (!access.ok) return access
    // Retries are free against the monthly limit, so the cap is checked in the update itself: parallel calls can't pass it.
    // Each one takes a read from the daily budget in the same statement, and a spent budget leaves the quote as it was.
    const refusal = retryRefusal(await retryWithinBudget(access.userId, data.quoteId))
    if (refusal === 'not_found') throw new Error('Not found')
    if (refusal) return { ok: false, rejection: logSpentBudget(refusal, access.userId, 'retry') }
    kickQuotes([data.quoteId])
    return { ok: true }
  })

export const deleteQuote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ quoteId: QuoteId }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const own = ownQuote(userId, data.quoteId)
    // The file is trashed with the row, in one transaction, so a storage failure below leaves it for the sweep.
    const [, rows] = await db.batch([trashQuoteFiles(own), db.delete(quotes).where(own).returning({ path: quotes.blobPathname })])
    if (rows.length === 0) throw new Error('Not found')
    await emptyQuoteTrash(rows.map((r) => r.path))
    return { ok: true as const }
  })
