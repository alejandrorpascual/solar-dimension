import { asc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { products } from '../db/schema'
import { mergeProduct, type MergeResult, type ProductChange } from '../lib/product-merge'
import { ProductConflictSchema, ProductInputSchema, productKey, type ProductInput, type ProductOrigin, type ProductRecord } from '../lib/product-schema'

type Row = typeof products.$inferSelect
const Conflicts = z.array(ProductConflictSchema)

/** A row that no longer passes the schema (edited by hand) is skipped and logged, not served. */
function toRecord(row: Row): ProductRecord | null {
  const product = ProductInputSchema.safeParse({
    kind: row.kind, brand: row.brand, model: row.model, makerUrl: row.makerUrl, datasheetUrl: row.datasheetUrl,
    specs: row.specs, extraSpecs: row.extraSpecs, price: row.price,
  })
  const conflicts = Conflicts.safeParse(row.conflicts)
  if (!product.success || !conflicts.success) {
    console.error('[products] skipping invalid product row', { key: row.key, issues: product.error?.issues ?? conflicts.error?.issues })
    return null
  }
  return { ...product.data, id: row.id, key: row.key, origin: row.origin as ProductOrigin, conflicts: conflicts.data, retired: row.retiredAt !== null }
}

const isRecord = (r: ProductRecord | null): r is ProductRecord => r !== null

export async function listProducts(): Promise<ProductRecord[]> {
  const rows = await db.select().from(products).orderBy(asc(products.kind), asc(products.brand), asc(products.model))
  return rows.map(toRecord).filter(isRecord)
}

/** Stored products an incoming item matches but that no longer pass the schema. Merging would call them new and overwrite them. */
export class UnreadableProductsError extends Error {
  constructor(readonly keys: readonly string[]) {
    super(`Stored products no longer pass the schema: ${keys.join(', ')}`)
    this.name = 'UnreadableProductsError'
  }
}

/** Throws UnreadableProductsError, before anything is merged or written, when a stored row can't be read: a dry run and a write both refuse. */
async function plan(items: readonly ProductInput[], replace: boolean): Promise<MergeResult[]> {
  const rows = await db.select().from(products).where(inArray(products.key, items.map(productKey)))
  const decoded = rows.map((row) => ({ key: row.key, record: toRecord(row) }))
  const unreadable = decoded.filter((d) => d.record === null).map((d) => d.key)
  if (unreadable.length > 0) throw new UnreadableProductsError(unreadable)
  const byKey = new Map(decoded.map((d) => d.record).filter(isRecord).map((r) => [r.key, r]))
  const now = new Date().toISOString()
  return items.map((item) => mergeProduct(byKey.get(productKey(item)) ?? null, item, { replace, now }))
}

export async function previewProducts(items: readonly ProductInput[], replace: boolean): Promise<ProductChange[]> {
  return (await plan(items, replace)).map((m) => m.change)
}

export interface UpsertSummary { created: string[]; updated: string[]; unchanged: string[]; conflicts: Array<{ key: string; fields: string[] }> }

/** The only way products are written. Unchanged products are skipped; one statement, so it is all or nothing. */
export async function upsertProducts(items: readonly ProductInput[], opts: { replace: boolean; actor: string }): Promise<UpsertSummary> {
  const merged = await plan(items, opts.replace)
  const toWrite = merged.filter((m) => m.change.status !== 'unchanged')
  if (toWrite.length > 0) {
    await db
      .insert(products)
      .values(toWrite.map(({ change, next, conflicts }) => ({
        kind: next.kind, key: change.key, brand: next.brand, model: next.model, makerUrl: next.makerUrl, datasheetUrl: next.datasheetUrl,
        specs: next.specs, extraSpecs: next.extraSpecs, price: next.price, origin: 'admin' satisfies ProductOrigin, conflicts, updatedBy: opts.actor,
      })))
      .onConflictDoUpdate({
        target: products.key,
        set: {
          makerUrl: sql`excluded.maker_url`, datasheetUrl: sql`excluded.datasheet_url`, specs: sql`excluded.specs`,
          extraSpecs: sql`excluded.extra_specs`, price: sql`excluded.price`, conflicts: sql`excluded.conflicts`,
          updatedAt: sql`now()`, lastSeenAt: sql`now()`, updatedBy: sql`excluded.updated_by`,
        },
      })
  }
  const keysWith = (status: ProductChange['status']) => merged.filter((m) => m.change.status === status).map((m) => m.change.key)
  return {
    created: keysWith('new'),
    updated: keysWith('updated'),
    unchanged: keysWith('unchanged'),
    conflicts: merged.filter((m) => m.change.status === 'conflicts').map((m) => ({ key: m.change.key, fields: m.change.conflicts.map((c) => c.field) })),
  }
}
