import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { projects, quoteFileTrash, quotes } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { emptyQuoteTrash } from './quotes/deps'
import { lockUserQuotes } from './quotes/limits'
import { trashQuoteFiles } from './quotes/repo'
import { requireUserId } from './session'

const MAX_BATCH = 200

const ProjectsInput = z.object({ projects: z.array(ProjectSchema).max(MAX_BATCH) })
const IdsInput = z.object({ ids: z.array(z.string().min(1)).max(MAX_BATCH) })

export function toProject(row: typeof projects.$inferSelect): Project {
  return ProjectSchema.parse({
    id: row.id, name: row.name, qty: row.qty, custom: row.custom, hours: row.hours, volts: row.volts, chemistry: row.chemistry,
    batteryUnit: row.batteryUnit,
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
 */
async function upsertAll(userId: string, list: Project[]): Promise<void> {
  if (list.length === 0) return
  await db
    .insert(projects)
    .values(list.map((p) => ({ ...p, userId, updatedAt: new Date(p.updatedAt) })))
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
        updatedAt: sql`excluded.updated_at`,
      },
      setWhere: sql`excluded.updated_at >= ${projects.updatedAt}`,
    })
}

export const listProjects = createServerFn({ method: 'GET' }).handler(async (): Promise<Project[]> => {
  return listForUser(await requireUserId())
})

export const saveProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ProjectsInput.parse(d))
  .handler(async ({ data }) => {
    await upsertAll(await requireUserId(), data.projects)
    return { ok: true }
  })

export const deleteProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => IdsInput.parse(d))
  .handler(async ({ data }) => {
    const userId = await requireUserId()
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
    const userId = await requireUserId()
    await upsertAll(userId, data.projects)
    return listForUser(userId)
  })
