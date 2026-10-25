// Runs only with `npm run test:db`, on the test database (vitest.db.setup.ts refuses any other). Each battery has a
// brand of its own, so no other row is named as its possible duplicate, and its row is deleted at the end, as CI runs
// of other branches share that database.
import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { db } from '../db/client'
import { products } from '../db/schema'
import { battery, NONE, stated, stating } from '../lib/product-fixtures'
import { productKey } from '../lib/product-schema'
import { previewProducts, upsertProducts } from './product-repo'

const keys: string[] = []

afterAll(async () => {
  await db.delete(products).where(inArray(products.key, keys))
})

/** A battery with these specs, stored under a brand of its own. */
async function storedBattery(specs: Parameters<typeof battery>[0]) {
  const product = { ...battery(specs), brand: `DB ${randomUUID().slice(0, 8)}` }
  keys.push(productKey(product))
  await upsertProducts([product], { replace: false, actor: 'test-db' })
  return product
}

describe('previewProducts on the test database', () => {
  test('warns on a kWh the dry run would fill into a stored battery, checked against its stored volts × Ah', async () => {
    const stored = await storedBattery({ kWh: NONE })

    const preview = await previewProducts([stating(stored, { kWh: stated(6, '6kWh') })], false)

    expect(preview.changes).toEqual([expect.objectContaining({ status: 'updated', fills: ['specs.kWh'] })])
    expect(preview.warnings).toEqual([{
      key: productKey(stored),
      messages: ['6 kWh is 17% off 51.2 V × 100 Ah = 5.12 kWh: check the energy, the voltage and the amp-hours.'],
    }])
  })

  test('gives no warning from a stored battery’s own values when the dry run states none of their fields', async () => {
    const stored = await storedBattery({ kWh: stated(6, '6kWh') })

    const preview = await previewProducts([stating(stored, { warrantyYears: stated(10, '10-year warranty') })], false)

    expect(preview.warnings).toEqual([])
  })
})
