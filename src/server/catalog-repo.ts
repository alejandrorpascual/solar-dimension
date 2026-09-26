import { asc } from 'drizzle-orm'
import { db } from '../db/client'
import { appliances } from '../db/schema'
import type { CatalogItem } from '../lib/catalog'
import { ApplianceSchema, toCatalogItem, type ApplianceRecord } from '../lib/catalog-schema'
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
