import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'
import { projects } from '../db/schema'
import { ProjectSchema, type Project } from '../lib/schema'
import { clampStamp, isNameable, NAMEABLE, namedFields, type LeftOut, type Nameable, type NamedEdits } from '../lib/sync'

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

/** The stamp (ms) of the stored row's last write: the latest of its fields'. */
const ROW_STAMP = sql`(extract(epoch from ${projects.updatedAt}) * 1000)::bigint`

/** The stamp (ms) of the edit that last wrote `field` in the stored row: its own when recorded, the row's otherwise. */
function stampOf(field: Nameable): SQL {
  return sql`coalesce((${projects.fieldStamps} ->> ${field}::text)::bigint, ${ROW_STAMP})`
}

/**
 * The `fieldStamps` a write leaves: each field's stamp from `stamps`, left out where it equals the row's new stamp
 * (`rowStamp`), which a field missing from the map reads as.
 */
function stampsAfter(stamps: readonly (readonly [Nameable, SQL])[], rowStamp: SQL): SQL {
  const pairs = stamps.map(([field, stamp]) => sql`${field}::text, nullif(${stamp}, ${rowStamp})`)
  return sql`jsonb_strip_nulls(jsonb_build_object(${sql.join(pairs, sql`, `)}))`
}

/**
 * Last edit wins by the client's `updatedAt`, not by arrival order: a save that a reload cut off can still reach the
 * database after a newer write, so the update only applies when the incoming stamp is not older than the stored one.
 * A stamp from a clock far ahead is stored as the server's time (clampStamp), or it would refuse every edit after it.
 * A field the save left out (`leftOut`) keeps its stored value and the stamp of its last write: a build older than the
 * field must not clear it, nor make an edit of it made since its last write look older.
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
      set: {
        ...Object.fromEntries(Object.entries(INCOMING).filter(([field]) => !skipped.includes(field as keyof Project))),
        fieldStamps: stampsAfter(skipped.filter(isNameable).map((field) => [field, stampOf(field)]), sql`(extract(epoch from excluded.updated_at) * 1000)::bigint`),
      },
      setWhere: sql`excluded.updated_at >= ${projects.updatedAt}`,
    })
    .returning({ id: projects.id })
  return written.map((row) => row.id)
}

/**
 * The stamp the account stores for each field a save names (`fields`): the stamp of the edit that set it, clamped as the
 * project's is, and never later than the project's own (`rowStamp`), the stamp of its latest edit.
 */
function namedStamps(fields: NamedEdits[string], rowStamp: number, now: number): Partial<Record<Nameable, number>> {
  return Object.fromEntries(namedFields(fields).map((field) => [field, Math.min(clampStamp(fields[field]!, now), rowStamp)]))
}

/**
 * Writes the fields each project names (`named`), each unless the account holds a later edit of it, by that field's own
 * stamp (`fieldStamps`) against the stamp of the edit that set the value sent: edits to different fields of one project
 * so all reach the account, whatever order their saves arrive in, and of two edits to one field the later stays, though
 * it set the field back to where the other started, or its save carries a later edit to another field. A project the
 * account does not hold is inserted whole: the save carries all of it. One statement per project, as each one's fields
 * differ, sent as one batch. Returns the ids whose named fields were all written: one where the account kept a later
 * edit is answered as refused, with its copy.
 */
async function upsertNamed(userId: string, list: Project[], named: NamedEdits): Promise<string[]> {
  const now = Date.now()
  const rowStamps = new Map(list.map((p) => [p.id, clampStamp(p.updatedAt, now)]))
  const fieldStamps = new Map(list.map((p) => [p.id, namedStamps(named[p.id] ?? {}, rowStamps.get(p.id)!, now)]))
  const [first, ...rest] = list.map((p) => {
    const stamps = fieldStamps.get(p.id)!
    const fields = namedFields(stamps)
    const stampSent = (field: Nameable) => sql`${stamps[field]}::bigint`
    const isLater = (field: Nameable) => sql`${stampSent(field)} >= ${stampOf(field)}`
    return db
      .insert(projects)
      .values({ ...p, userId, updatedAt: new Date(rowStamps.get(p.id)!) })
      .onConflictDoUpdate({
        target: [projects.userId, projects.id],
        set: {
          ...Object.fromEntries(fields.map((field) => [field, sql`case when ${isLater(field)} then ${INCOMING[field]} else ${projects[field]} end`])),
          fieldStamps: stampsAfter(
            NAMEABLE.map((field) => [field, fields.includes(field) ? sql`greatest(${stampSent(field)}, ${stampOf(field)})` : stampOf(field)]),
            sql`greatest(${ROW_STAMP}, ${rowStamps.get(p.id)}::bigint)`,
          ),
          updatedAt: sql`greatest(${projects.updatedAt}, excluded.updated_at)`,
        },
      })
      .returning({ id: projects.id, fieldStamps: projects.fieldStamps, updatedAt: projects.updatedAt })
  })
  if (!first) return []
  const rows = await db.batch([first, ...rest])
  // A field written by this save carries its stamp; one the account kept carries the later stamp of its own write.
  const isWritten = (row: { id: string; fieldStamps: Record<string, number>; updatedAt: Date }) =>
    Object.entries(fieldStamps.get(row.id) ?? {}).every(([field, stamp]) => (row.fieldStamps[field] ?? row.updatedAt.getTime()) <= stamp)
  return rows.flat().filter(isWritten).map((row) => row.id)
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
