import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { projects } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { requireUserId } from './session'

const MAX_BATCH = 200

const ProjectsInput = z.object({ projects: z.array(ProjectSchema).max(MAX_BATCH) })
const IdsInput = z.object({ ids: z.array(z.string().min(1)).max(MAX_BATCH) })

function toProject(row: typeof projects.$inferSelect): Project {
  return ProjectSchema.parse({
    id: row.id, name: row.name, qty: row.qty, custom: row.custom, hours: row.hours, volts: row.volts, chemistry: row.chemistry,
  })
}

async function listForUser(userId: string): Promise<Project[]> {
  const rows = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(projects.createdAt)
  return rows.map(toProject)
}

async function upsertAll(userId: string, list: Project[]): Promise<void> {
  if (list.length === 0) return
  await db
    .insert(projects)
    .values(list.map((p) => ({ ...p, userId, updatedAt: new Date() })))
    .onConflictDoUpdate({
      target: [projects.userId, projects.id],
      set: {
        name: sql`excluded.name`,
        qty: sql`excluded.qty`,
        custom: sql`excluded.custom`,
        hours: sql`excluded.hours`,
        volts: sql`excluded.volts`,
        chemistry: sql`excluded.chemistry`,
        updatedAt: new Date(),
      },
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
    if (data.ids.length) await db.delete(projects).where(and(eq(projects.userId, userId), inArray(projects.id, data.ids)))
    return { ok: true }
  })

export const importProjects = createServerFn({ method: 'POST' })
  .validator((d: unknown) => ProjectsInput.parse(d))
  .handler(async ({ data }): Promise<Project[]> => {
    const userId = await requireUserId()
    await upsertAll(userId, data.projects)
    return listForUser(userId)
  })
