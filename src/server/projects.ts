import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { projects, quoteFileTrash, quotes } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { importable, leftOut } from '../lib/sync'
import { listForUser, saveForUser, upsertAll } from './projects-repo'
import { emptyQuoteTrash } from './quotes/deps'
import { lockUserQuotes } from './quotes/limits'
import { trashQuoteFiles } from './quotes/repo'
import { AccountClaim, requireAccount } from './session'

const MAX_BATCH = 200

const ProjectsInput = z.object({ account: AccountClaim, projects: z.array(ProjectSchema).max(MAX_BATCH) })
const IdsInput = z.object({ account: AccountClaim, ids: z.array(z.string().min(1)).max(MAX_BATCH) })
const ListInput = z.object({ account: AccountClaim }).optional()

/** A save as parsed, with the fields each project left out (leftOut): the account keeps its own value of those. */
function parseSave(d: unknown) {
  const input = ProjectsInput.parse(d)
  return { ...input, leftOut: leftOut((d as { projects: unknown[] }).projects) }
}

export const listProjects = createServerFn({ method: 'GET' })
  .validator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data }): Promise<Project[]> => listForUser(await requireAccount(data?.account)))

/** saveForUser for the account the page was loaded for: `stale` holds the account's copy of each project it refused. */
export const saveProjects = createServerFn({ method: 'POST' })
  .validator(parseSave)
  .handler(async ({ data }): Promise<{ ok: true; stale: Project[] }> => saveForUser(await requireAccount(data.account), data.projects, data.leftOut))

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
  .validator(parseSave)
  .handler(async ({ data }): Promise<Project[]> => {
    const userId = await requireAccount(data.account)
    const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)).limit(1)
    await upsertAll(userId, importable(data.projects, existing !== undefined), data.leftOut)
    return listForUser(userId)
  })
