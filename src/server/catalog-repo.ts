import { asc, desc, eq, getTableColumns, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { applianceChanges, appliances, user } from '../db/schema'
import type { CatalogItem } from '../lib/catalog'
import { keepStoredSources, planUpsert, retireWrite, warnAppliances, type ApplianceWarnings, type ApplianceWrite } from '../lib/catalog-diff'
import { ApplianceSchema, FigureSourcesSchema, toCatalogItem, type ApplianceInput, type ApplianceRecord } from '../lib/catalog-schema'
import { ttlCache } from '../lib/ttl-cache'

export const CATALOG_TTL_MS = 60_000
export const catalogCache = ttlCache<CatalogItem[]>(CATALOG_TTL_MS)

type Row = typeof appliances.$inferSelect

/** The stored fields of a row that make up an `ApplianceRecord`, apart from its retired state. */
function rowFields(row: Row) {
  return {
    id: row.id, category: row.category, watts: row.watts, surge: row.surge, duty: row.duty,
    tons: row.tons, acType: row.acType, labels: row.labels, sortOrder: row.sortOrder,
    kind: row.kind, surgeClass: row.surgeClass, burstSeconds: row.burstSeconds, cyclesPerHour: row.cyclesPerHour, sources: row.sources,
  }
}

/** A row that no longer passes the schema (edited by hand in the console) is skipped and logged, not served. */
function toRecord(row: Row): ApplianceRecord | null {
  const parsed = ApplianceSchema.safeParse(rowFields(row))
  if (!parsed.success) {
    console.error('[catalog] skipping invalid appliance row', { id: row.id, issues: parsed.error.issues })
    return null
  }
  return { ...parsed.data, sortOrder: row.sortOrder, retired: row.retiredAt !== null }
}

/** A row as stored, with the schema check skipped: the "before" of a write that replaces a row failing the schema. */
function storedRecord(row: Row): ApplianceRecord {
  return { ...rowFields(row), retired: row.retiredAt !== null } as ApplianceRecord
}

type ApplianceColumn = keyof Row

/** Columns an upsert overwrites with the incoming value when the row already exists. */
export const UPSERT_COLUMNS = [
  'category', 'watts', 'surge', 'duty', 'tons', 'acType', 'kind', 'surgeClass', 'burstSeconds', 'cyclesPerHour',
  'sources', 'labels', 'sortOrder', 'updatedBy',
] as const satisfies readonly ApplianceColumn[]

/** Columns an upsert never overwrites: the key, the retired state, and the two timestamps (`updatedAt` is set to now). */
export const UPSERT_SKIPPED_COLUMNS = ['id', 'retiredAt', 'createdAt', 'updatedAt'] as const satisfies readonly ApplianceColumn[]

const conflictSet = () => {
  const columns = getTableColumns(appliances)
  return {
    ...Object.fromEntries(UPSERT_COLUMNS.map((key) => [key, sql.raw(`excluded.${columns[key].name}`)])),
    updatedAt: sql`now()`,
  }
}

const selectRows = () => db.select().from(appliances).orderBy(asc(appliances.sortOrder), asc(appliances.id))

const validRecords = (rows: readonly Row[]) => rows.map(toRecord).filter((r): r is ApplianceRecord => r !== null)

export async function listRecords(): Promise<ApplianceRecord[]> {
  return validRecords(await selectRows())
}

/** Checks the table directly (unlike listRecords, includes retired rows and rows that no longer pass the schema). */
export async function applianceExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: appliances.id }).from(appliances).where(eq(appliances.id, id)).limit(1)
  return rows.length > 0
}

export async function queryCatalog(): Promise<CatalogItem[]> {
  return (await listRecords()).map(toCatalogItem)
}

/**
 * A write whose row is not in the valid list but is in the table replaces a row that fails the schema (listRecords skips
 * it). Its entry keeps that row as "before", not null ("Created"). An upsert never touches `retired_at`, so the row's
 * retired state carries over into "after"; so do its sources when the write sends none, as for any other row, unless
 * they are what fails the schema: sent back unchecked, they would keep the row failing it, so they are dropped.
 */
function keepReplacedRows(writes: readonly ApplianceWrite[], rows: readonly Row[]): ApplianceWrite[] {
  const stored = new Map(rows.map((row) => [row.id, row]))
  return writes.map((write) => {
    const row = write.before === null ? stored.get(write.after.id) : undefined
    if (!row) return write
    const before = storedRecord(row)
    const validSources = FigureSourcesSchema.safeParse(row.sources).data
    return { before, after: { ...keepStoredSources(write.after, { ...before, sources: validSources }), retired: before.retired } }
  })
}

/** The change-log entries for a batch's writes, in the order written. */
const logStatement = (writes: readonly ApplianceWrite[], actor: string) =>
  db.insert(applianceChanges).values(writes.map(({ before, after }) => ({ applianceId: after.id, actor, before, after })))

/**
 * The only way appliances are written. Unchanged items are skipped; the rows and their change-log entries go in one
 * `db.batch` (one transaction), so it is all or nothing. Warnings never stop it. Known limit, as in product-repo: the
 * rows are read before the batch, so a concurrent writer to the same item can be missing from an entry's "before".
 */
export async function upsertAppliances(items: readonly ApplianceInput[], actor: string): Promise<{ created: string[]; updated: string[]; warnings: ApplianceWarnings[] }> {
  const rows = await selectRows()
  const existing = validRecords(rows)
  const { changes, writes: planned } = planUpsert(existing, items)
  const writes = keepReplacedRows(planned, rows)
  if (writes.length > 0) {
    await db.batch([
      db
        .insert(appliances)
        .values(writes.map(({ after: r }) => ({
          id: r.id, category: r.category, watts: r.watts, surge: r.surge, duty: r.duty, tons: r.tons, acType: r.acType,
          kind: r.kind ?? null, surgeClass: r.surgeClass ?? null, burstSeconds: r.burstSeconds ?? null, cyclesPerHour: r.cyclesPerHour ?? null,
          sources: r.sources ?? {}, labels: r.labels, sortOrder: r.sortOrder, updatedBy: actor,
        })))
        .onConflictDoUpdate({
          target: appliances.id,
          set: conflictSet(),
        }),
      logStatement(writes, actor),
    ])
    catalogCache.clear()
  }
  return {
    created: changes.filter((c) => c.kind === 'new').map((c) => c.id),
    updated: changes.filter((c) => c.kind === 'changed').map((c) => c.id),
    // Against the rows this write replaced, so they match the dry run that showed the same items.
    warnings: warnAppliances(existing, items),
  }
}

/**
 * Retires or restores one appliance, with its change-log entry in the same batch. False when there is no such row, or
 * when its row fails the schema: such a row is not served or listed, and its entry would have no "before" to show.
 * Already in that state: nothing is written.
 */
export async function setRetired(id: string, retired: boolean, actor: string): Promise<boolean> {
  const [row] = await db.select().from(appliances).where(eq(appliances.id, id)).limit(1)
  const current = row ? toRecord(row) : null
  if (!current) return false
  const write = retireWrite(current, retired)
  if (!write) return true
  await db.batch([
    db.update(appliances).set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: actor }).where(eq(appliances.id, id)),
    logStatement([write], actor),
  ])
  catalogCache.clear()
  return true
}

const RECENT_CHANGES = 50

export interface ApplianceChangeEntry extends ApplianceWrite { id: number; changedAt: string; actor: string; actorEmail: string | null }

/** The 50 newest change-log entries, newest first, with the email of the account behind each (null for the token API). */
export async function recentChanges(): Promise<ApplianceChangeEntry[]> {
  const rows = await db
    .select({ id: applianceChanges.id, changedAt: applianceChanges.changedAt, actor: applianceChanges.actor, actorEmail: user.email, before: applianceChanges.before, after: applianceChanges.after })
    .from(applianceChanges)
    .leftJoin(user, eq(user.id, applianceChanges.actor))
    .orderBy(desc(applianceChanges.id))
    .limit(RECENT_CHANGES)
  return rows.map((r) => ({ ...r, changedAt: r.changedAt.toISOString() }))
}
