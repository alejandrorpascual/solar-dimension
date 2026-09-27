import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { appliances } from '../db/schema'
import type { CatalogItem } from '../lib/catalog'
import { assignSortOrders, diffAppliances } from '../lib/catalog-diff'
import { ApplianceSchema, toCatalogItem, type ApplianceInput, type ApplianceRecord } from '../lib/catalog-schema'
import { ttlCache } from '../lib/ttl-cache'

export const CATALOG_TTL_MS = 60_000
export const catalogCache = ttlCache<CatalogItem[]>(CATALOG_TTL_MS)

type Row = typeof appliances.$inferSelect

/** A row that no longer passes the schema (edited by hand in the console) is skipped and logged, not served. */
function toRecord(row: Row): ApplianceRecord | null {
  const parsed = ApplianceSchema.safeParse({
    id: row.id, category: row.category, watts: row.watts, surge: row.surge, duty: row.duty,
    tons: row.tons, acType: row.acType, labels: row.labels, sortOrder: row.sortOrder,
  })
  if (!parsed.success) {
    console.error('[catalog] skipping invalid appliance row', { id: row.id, issues: parsed.error.issues })
    return null
  }
  return { ...parsed.data, sortOrder: row.sortOrder, retired: row.retiredAt !== null }
}

export async function listRecords(): Promise<ApplianceRecord[]> {
  const rows = await db.select().from(appliances).orderBy(asc(appliances.sortOrder), asc(appliances.id))
  return rows.map(toRecord).filter((r): r is ApplianceRecord => r !== null)
}

export async function queryCatalog(): Promise<CatalogItem[]> {
  return (await listRecords()).map(toCatalogItem)
}

/** The only way appliances are written. Unchanged items are skipped; one statement, so it is all or nothing. */
export async function upsertAppliances(items: readonly ApplianceInput[], actor: string): Promise<{ created: string[]; updated: string[] }> {
  const existing = await listRecords()
  const changes = diffAppliances(existing, items)
  const toWrite = assignSortOrders(existing, items).filter((_, i) => changes[i]!.kind !== 'unchanged')
  if (toWrite.length > 0) {
    await db
      .insert(appliances)
      .values(toWrite.map((r) => ({
        id: r.id, category: r.category, watts: r.watts, surge: r.surge, duty: r.duty, tons: r.tons, acType: r.acType,
        labels: r.labels, sortOrder: r.sortOrder, updatedBy: actor,
      })))
      .onConflictDoUpdate({
        target: appliances.id,
        set: {
          category: sql`excluded.category`, watts: sql`excluded.watts`, surge: sql`excluded.surge`, duty: sql`excluded.duty`,
          tons: sql`excluded.tons`, acType: sql`excluded.ac_type`, labels: sql`excluded.labels`, sortOrder: sql`excluded.sort_order`,
          updatedAt: sql`now()`, updatedBy: sql`excluded.updated_by`,
        },
      })
    catalogCache.clear()
  }
  return {
    created: changes.filter((c) => c.kind === 'new').map((c) => c.id),
    updated: changes.filter((c) => c.kind === 'changed').map((c) => c.id),
  }
}

export async function setRetired(id: string, retired: boolean, actor: string): Promise<boolean> {
  const rows = await db
    .update(appliances)
    .set({ retiredAt: retired ? sql`now()` : null, updatedAt: sql`now()`, updatedBy: actor })
    .where(eq(appliances.id, id))
    .returning({ id: appliances.id })
  if (rows.length > 0) catalogCache.clear()
  return rows.length > 0
}
