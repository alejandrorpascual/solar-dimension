import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { projects } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { clampStamp, type LeftOut, type Nameable, type NamedEdits, type StartedFrom } from '../lib/sync'

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

export async function listForUser(userId: string): Promise<Project[]> {
  const rows = await db.select().from(projects).where(eq(projects.userId, userId)).orderBy(projects.createdAt)
  return rows.map(toProject)
}

/** What a save writes over the stored copy of a project: every field but the key, as the save carries it (`excluded`). */
const INCOMING = {
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
} satisfies Record<Exclude<keyof Project, 'id'>, SQL>

/**
 * Last edit wins by the client's `updatedAt`, not by arrival order: a save that a reload cut off can still reach the
 * database after a newer write, so the update only applies when the incoming stamp is not older than the stored one.
 * A stamp from a clock far ahead is stored as the server's time (clampStamp), or it would refuse every edit after it.
 * A field the save left out (`leftOut`) keeps its stored value: a build older than the field must not clear it.
 * Returns the ids it wrote: a project that is missing from them was refused as older than the stored copy.
 */
export async function upsertAll(userId: string, list: Project[], leftOut: LeftOut = new Map()): Promise<Set<string>> {
  // One statement per set of fields left out, as the update names its columns once: a save from one build is one.
  const groups = new Map<string, { skipped: readonly (keyof Project)[]; list: Project[] }>()
  for (const p of list) {
    const skipped = leftOut.get(p.id) ?? []
    const key = skipped.join()
    groups.set(key, { skipped, list: [...(groups.get(key)?.list ?? []), p] })
  }
  const written = await Promise.all([...groups.values()].map(({ skipped, list: group }) => upsertGroup(userId, group, skipped)))
  return new Set(written.flat())
}

async function upsertGroup(userId: string, list: Project[], skipped: readonly (keyof Project)[]): Promise<string[]> {
  const now = Date.now()
  const written = await db
    .insert(projects)
    .values(list.map((p) => ({ ...p, userId, updatedAt: new Date(clampStamp(p.updatedAt, now)) })))
    .onConflictDoUpdate({
      target: [projects.userId, projects.id],
      set: Object.fromEntries(Object.entries(INCOMING).filter(([field]) => !skipped.includes(field as keyof Project))),
      setWhere: sql`excluded.updated_at >= ${projects.updatedAt}`,
    })
    .returning({ id: projects.id })
  return written.map((row) => row.id)
}

const JSONB = new Set<Nameable>(['qty', 'custom', 'requester', 'dutyOverrides', 'electrical', 'solar'])

/**
 * A named field's new value: the save's when the account still holds the value the edit started from (no other tab or
 * device changed it since), or when the save is not older than the stored copy; the stored one otherwise, as someone
 * else changed that field later than this edit. Edits to different fields of one project so all reach the account,
 * whatever order their saves arrive in, and of two edits to one field the later stays.
 */
function guarded(field: Nameable, start: unknown): SQL {
  const column = projects[field]
  const startedFrom = start === null ? sql`null` : JSONB.has(field) ? sql`${JSON.stringify(start)}::jsonb` : sql`${start}`
  return sql`case when ${column} is not distinct from ${startedFrom} or excluded.updated_at >= ${projects.updatedAt} then ${INCOMING[field]} else ${column} end`
}

/**
 * Writes the fields each project names (`named`), each guarded by the value it started from, and keeps the later of the
 * two stamps. A project the account does not hold is inserted whole: the save carries all of it. One statement per
 * project, as each one's starting values differ, sent as one batch. Returns the ids whose named fields all hold the
 * save's values: one where the account kept a newer value is answered as refused, with its copy.
 */
async function upsertNamed(userId: string, list: Project[], named: NamedEdits): Promise<string[]> {
  const now = Date.now()
  const [first, ...rest] = list.map((p) => {
    const starts: StartedFrom = named[p.id] ?? {}
    return db
      .insert(projects)
      .values({ ...p, userId, updatedAt: new Date(clampStamp(p.updatedAt, now)) })
      .onConflictDoUpdate({
        target: [projects.userId, projects.id],
        set: {
          ...Object.fromEntries(Object.entries(starts).map(([field, start]) => [field, guarded(field as Nameable, start)])),
          updatedAt: sql`greatest(${projects.updatedAt}, excluded.updated_at)`,
        },
      })
      .returning()
  })
  if (!first) return []
  const rows = await db.batch([first, ...rest])
  const sent = new Map(list.map((p) => [p.id, p]))
  return rows.flat().map(toProject).filter((row) => {
    const copy = sent.get(row.id)!
    return Object.keys(named[row.id] ?? {}).every((field) => JSON.stringify(row[field as Nameable]) === JSON.stringify(copy[field as Nameable]))
  }).map((row) => row.id)
}

/**
 * Saves the projects it is given and answers with `stale`: the account's copy of each one it refused as older, so the
 * device shows what the account holds instead of an edit that was never stored. A project the save names fields of
 * (`named`) is written field by field (upsertNamed); the rest whole (upsertAll).
 */
export async function saveForUser(userId: string, list: Project[], leftOut: LeftOut = new Map(), named: NamedEdits = {}): Promise<{ ok: true; stale: Project[] }> {
  const [whole, byField] = await Promise.all([
    upsertAll(userId, list.filter((p) => !named[p.id]), leftOut),
    upsertNamed(userId, list.filter((p) => named[p.id]), named),
  ])
  const written = new Set([...whole, ...byField])
  const refused = list.filter((p) => !written.has(p.id)).map((p) => p.id)
  if (refused.length === 0) return { ok: true, stale: [] }
  const rows = await db.select().from(projects).where(and(eq(projects.userId, userId), inArray(projects.id, refused)))
  return { ok: true, stale: rows.map(toProject) }
}
