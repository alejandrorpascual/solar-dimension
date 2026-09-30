import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { db } from '../../db/client'
import { projects, quotes, quoteSettings } from '../../db/schema'
import { computeProject } from '../../lib/project-summary'
import { inspectUpload, MustsInput, OverrideInput, ProjectId, QuoteId, RETRYABLE, TotalInput, uploadRejection } from '../../lib/quote-guards'
import { kitNeeds, resolveMusts, type Musts } from '../../lib/quote-items'
import { summarizeProject, type JobQuote, type ProjectJobs } from '../../lib/quote-jobs'
import { checkBasics, cleanFileName, monthStart, type Rejection } from '../../lib/quote-limits'
import { FINISHED, type QuoteStatus } from '../../lib/quote-schema'
import type { Project } from '../../lib/schema'
import { loadCatalog } from '../catalog'
import { toProject } from '../projects'
import { requireUserId } from '../session'
import { defaultDeps } from './deps'
import { kickQuotes } from './kick'
import { recoverStaleQuotes } from './repo'
import { quotePath } from './storage'

export type UploadResult = { ok: true; id: string } | { ok: false; rejection: Rejection }
export interface ProjectQuotes { project: Project; quotes: JobQuote[]; musts: Musts }

type QuoteRow = typeof quotes.$inferSelect
function toJobQuote(r: QuoteRow): JobQuote {
  return {
    id: r.id, fileName: r.fileName, label: r.vendorLabel, status: r.status, extraction: r.extraction ?? null,
    overrides: r.overrides, totalOverride: r.totalOverride, createdAt: r.createdAt.getTime(), seenAt: r.seenAt?.getTime() ?? null,
  }
}

const ownProject = (userId: string, projectId: string) => and(eq(projects.userId, userId), eq(projects.id, projectId))
const ownQuote = (userId: string, quoteId: string) => and(eq(quotes.id, quoteId), eq(quotes.userId, userId))
const reject = (rejection: Rejection): UploadResult => ({ ok: false, rejection })

async function quoteCounts(userId: string, projectId: string): Promise<{ project: number; month: number }> {
  const since = monthStart(new Date()).toISOString()
  const [row] = await db
    .select({
      project: sql<number>`count(*) filter (where ${quotes.projectId} = ${projectId})`.mapWith(Number),
      month: sql<number>`count(*) filter (where ${quotes.createdAt} >= ${since}::timestamptz)`.mapWith(Number),
    })
    .from(quotes)
    .where(eq(quotes.userId, userId))
  return row ?? { project: 0, month: 0 }
}

/** One file per call: the client uploads a batch one by one, so the limit counts stay exact. */
export const uploadQuote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('Expected FormData')
    const file = d.get('file')
    if (!(file instanceof File)) throw new Error('Expected a file')
    return { projectId: ProjectId.parse(d.get('projectId')), file }
  })
  .handler(async ({ data }): Promise<UploadResult> => {
    const userId = await requireUserId()
    const basic = checkBasics(data.file)
    if (basic) return reject(basic)
    const [project] = await db.select({ id: projects.id }).from(projects).where(ownProject(userId, data.projectId)).limit(1)
    const counts = project ? await quoteCounts(userId, data.projectId) : { project: 0, month: 0 }
    const blocked = uploadRejection({ ownsProject: project !== undefined, counts })
    if (blocked) return reject(blocked)

    const bytes = new Uint8Array(await data.file.arrayBuffer())
    const inspected = await inspectUpload(bytes)
    if (!inspected.ok) return reject(inspected.rejection)
    const { mime, pages } = inspected

    const id = crypto.randomUUID()
    const blobPathname = quotePath(userId, id, mime)
    const { storage } = defaultDeps()
    try {
      await storage.put(blobPathname, bytes, mime)
      await db.insert(quotes).values({
        id, userId, projectId: data.projectId, fileName: cleanFileName(data.file.name), blobPathname, mime, sizeBytes: bytes.byteLength, pages,
      })
    } catch (error) {
      console.error('[quotes] upload failed', { userId, id, error })
      await storage.remove([blobPathname]).catch(() => undefined)
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

/** Updates the user's own quote, only when it is in one of the `only` statuses if given. Throws when nothing matched. */
async function updateOwn(userId: string, quoteId: string, set: PgUpdateSetSource<typeof quotes>, only?: readonly QuoteStatus[]) {
  const where = and(ownQuote(userId, quoteId), only ? inArray(quotes.status, [...only]) : undefined)
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

export const setQuoteMusts = createServerFn({ method: 'POST' })
  .validator((d: unknown) => MustsInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const [p] = await db.select({ id: projects.id }).from(projects).where(ownProject(userId, data.projectId)).limit(1)
    if (!p) throw new Error('Not found')
    await db.insert(quoteSettings)
      .values({ userId, projectId: data.projectId, musts: data.musts, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [quoteSettings.userId, quoteSettings.projectId], set: { musts: data.musts, updatedAt: new Date() } })
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
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    await updateOwn(userId, data.quoteId, { status: 'queued', attempts: 0, error: null, claimedAt: null, seenAt: null }, RETRYABLE)
    kickQuotes([data.quoteId])
    return { ok: true as const }
  })

export const deleteQuote = createServerFn({ method: 'POST' })
  .validator((d: unknown) => z.object({ quoteId: QuoteId }).parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const rows = await db.delete(quotes).where(ownQuote(userId, data.quoteId)).returning({ path: quotes.blobPathname })
    if (rows.length === 0) throw new Error('Not found')
    await defaultDeps().storage.remove(rows.map((r) => r.path))
      .catch((error) => console.error('[quotes] removing a deleted quote file failed', { quoteId: data.quoteId, error }))
    return { ok: true as const }
  })
