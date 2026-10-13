import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { projects, quoteFileTrash, quotes } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { clampStamp, importable } from '../lib/sync'
import { emptyQuoteTrash } from './quotes/deps'
import { lockUserQuotes } from './quotes/limits'
import { trashQuoteFiles } from './quotes/repo'
import { requireUserId } from './session'

const MAX_BATCH = 200

/**
 * `account` is the account the page that sends the request was loaded for. A page built before this field existed
 * does not send it.
 */
const Account = z.string().min(1).optional()
const ProjectsInput = z.object({ account: Account, projects: z.array(ProjectSchema).max(MAX_BATCH) })
const IdsInput = z.object({ account: Account, ids: z.array(z.string().min(1)).max(MAX_BATCH) })

/**
 * The signed-in account, refused when it is not the one the page was loaded for. A tab left open across a sign-out
 * and another account's sign-in still shows the first account's projects and sends its edits with the second
 * account's cookie: without this they would be saved into the second account, over its own.
 */
async function requireAccount(claimed: string | undefined): Promise<string> {
  const userId = await requireUserId()
  if (claimed !== undefined && claimed !== userId) throw new Error('This page was loaded for another account')
  return userId
}

export function toProject(row: typeof projects.$inferSelect): Project {
  return ProjectSchema.parse({
    id: row.id, name: row.name, qty: row.qty, custom: row.custom, hours: row.hours, volts: row.volts, chemistry: row.chemistry,
    batteryUnit: row.batteryUnit,
    requester: row.requester,
    solar: row.solar,
    dutyOverrides: row.dutyOverrides,
    electrical: row.electrical,
    updatedAt: row.updatedAt.getTime(),
  })
}

async function listForUser(userId: string): Promise<Project[]> {
  const rows = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(projects.createdAt)
  return rows.map(toProject)
}

/**
 * Last edit wins by the client's `updatedAt`, not by arrival order: a save that a reload cut off can still reach the
 * database after a newer write, so the update only applies when the incoming stamp is not older than the stored one.
 * A stamp from a clock far ahead is stored as the server's time (clampStamp), or it would refuse every edit after it.
 * Returns the ids it wrote: a project that is missing from them was refused as older than the stored copy.
 */
async function upsertAll(userId: string, list: Project[]): Promise<Set<string>> {
  if (list.length === 0) return new Set()
  const now = Date.now()
  const written = await db
    .insert(projects)
    .values(list.map((p) => ({ ...p, userId, updatedAt: new Date(clampStamp(p.updatedAt, now)) })))
    .onConflictDoUpdate({
      target: [projects.userId, projects.id],
      set: {
        name: sql`excluded.name`,
        qty: sql`excluded.qty`,
        custom: sql`excluded.custom`,
        hours: sql`excluded.hours`,
        volts: sql`excluded.volts`,
        chemistry: sql`excluded.chemistry`,
        batteryUnit: sql`excluded.battery_unit`,
        requester: sql`excluded.requester`,
        solar: sql`excluded.solar`,
        dutyOverrides: sql`excluded.duty_overrides`,
        electrical: sql`excluded.electrical`,
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.updated_at >= ${projects.updatedAt}`,
    })
    .returning({ id: projects.id })
  return new Set(written.map((row) => row.id))
}

export const listProjects = createServerFn({ method: 'GET' }).handler(async (): Promise<Project[]> => {
  return listForUser(await requireUserId())
})

/**
 * Saves the projects it is given and answers with `stale`: the account's copy of each one it refused as older, so the
 * device shows what the account holds instead of an edit that was never stored.
 */
export const saveProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ProjectsInput.parse(d))
  .handler(async ({ data }): Promise<{ ok: true; stale: Project[] }> => {
    const userId = await requireAccount(data.account)
    const written = await upsertAll(userId, data.projects)
    const refused = data.projects.filter((p) => !written.has(p.id)).map((p) => p.id)
    if (refused.length === 0) return { ok: true, stale: [] }
    const rows = await db.select().from(projects).where(and(eq(projects.userId, userId), inArray(projects.id, refused)))
    return { ok: true, stale: rows.map(toProject) }
  })

export const deleteProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => IdsInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireAccount(data.account)
    if (data.ids.length === 0) return { ok: true }
    // Quote rows go with the project (foreign key cascade); their files are trashed in the same transaction. The upload
    // lock orders this against the user's uploads: one that stored its row before is trashed here, and one after fails
    // on the foreign key and removes its own file.
    const [, trashed] = await db.batch([
      lockUserQuotes(userId),
      trashQuoteFiles(and(eq(quotes.userId, userId), inArray(quotes.projectId, data.ids))).returning({ path: quoteFileTrash.pathname }),
      db.delete(projects).where(and(eq(projects.userId, userId), inArray(projects.id, data.ids))),
    ])
    // Never throws: a file that can't be removed now (a missing Blob token, a Blob outage) stays trashed for the sweep.
    if (trashed.length) await emptyQuoteTrash(trashed.map((r) => r.path))
    return { ok: true }
  })

export const importProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ProjectsInput.parse(d))
  .handler(async ({ data }): Promise<Project[]> => {
    const userId = await requireAccount(data.account)
    const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).limit(1)
    await upsertAll(userId, importable(data.projects, existing !== undefined))
    return listForUser(userId)
  })
