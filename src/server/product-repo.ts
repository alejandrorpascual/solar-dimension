import { asc, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { products } from '../db/schema'
import { mergeProduct, summarize, type MergeResult, type ProductChange, type UpsertSummary } from '../lib/product-merge'
import { ProductConflictSchema, ProductInputSchema, productKey, type ProductInput, type ProductOrigin, type ProductRecord } from '../lib/product-schema'
import { warnProducts, type ProductWarnings } from '../lib/product-warnings'

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

/**
 * What a dry run answers: each product's change, and the soft checks worth a second look. Duplicates are looked for
 * across every stored product, since one stored under another spelling has another key; the library is tens of rows.
 * The checks across fields also read each product as the write would store it, so a filled-in value meets the stored ones.
 */
export async function previewProducts(
  items: readonly ProductInput[], replace: boolean,
): Promise<{ changes: ProductChange[]; warnings: ProductWarnings[] }> {
  const [merged, stored] = await Promise.all([plan(items, replace), listProducts()])
  return { changes: merged.map((m) => m.change), warnings: warnProducts(stored, items, merged.map((m) => m.next)) }
}

/** New and changed products in one insert; a product that exists is updated in place. */
const upsertStatement = (writes: readonly MergeResult[], actor: string) =>
  db
    .insert(products)
    .values(writes.map(({ change, next, conflicts }) => ({
      kind: next.kind, key: change.key, brand: next.brand, model: next.model, makerUrl: next.makerUrl, datasheetUrl: next.datasheetUrl,
      specs: next.specs, extraSpecs: next.extraSpecs, price: next.price, origin: 'admin' satisfies ProductOrigin, conflicts, updatedBy: actor,
    })))
    .onConflictDoUpdate({
      target: products.key,
      set: {
        makerUrl: sql`excluded.maker_url`, datasheetUrl: sql`excluded.datasheet_url`, specs: sql`excluded.specs`,
        extraSpecs: sql`excluded.extra_specs`, price: sql`excluded.price`, conflicts: sql`excluded.conflicts`,
        updatedAt: sql`now()`, lastSeenAt: sql`now()`, updatedBy: sql`excluded.updated_by`,
      },
    })

/** Moves `last_seen_at` of products found again with nothing to change; no other column is touched. */
const seenAgainStatement = (keys: readonly string[]) => db.update(products).set({ lastSeenAt: sql`now()` }).where(inArray(products.key, keys))

/**
 * The only way products are written. New and changed products are upserted and every unchanged one has its `last_seen_at`
 * moved, in one `db.batch` (one transaction; the neon-http driver has no interactive ones), so it is all or nothing.
 * Known limit: the merge reads the stored rows and writes in a second statement, so two concurrent writers to one product
 * can lose a fill or a conflict; today the only writer is one admin through the skill.
 */
export async function upsertProducts(items: readonly ProductInput[], opts: { replace: boolean; actor: string }): Promise<UpsertSummary> {
  const merged = await plan(items, opts.replace)
  const isUnchanged = (m: MergeResult) => m.change.status === 'unchanged'
  const writes = merged.filter((m) => !isUnchanged(m))
  const seenAgain = merged.filter(isUnchanged).map((m) => m.change.key)
  const [first, ...rest] = [
    ...(writes.length > 0 ? [upsertStatement(writes, opts.actor)] : []),
    ...(seenAgain.length > 0 ? [seenAgainStatement(seenAgain)] : []),
  ]
  if (first) await db.batch([first, ...rest])
  return summarize(merged.map((m) => m.change))
}
