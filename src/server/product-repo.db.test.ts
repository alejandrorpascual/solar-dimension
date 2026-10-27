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
import { listProducts, previewProducts, upsertProducts, verifyProduct } from './product-repo'

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

describe('verification on the test database', () => {
  const TOKEN = 'catalog-api'
  const ADMIN = 'test-db-admin'
  const read = async (key: string) => (await listProducts()).find((p) => p.key === key)!
  /** A stored battery, verified by the admin as read back. */
  async function verifiedBattery(specs: Parameters<typeof battery>[0] = {}) {
    const product = await storedBattery(specs)
    const seen = await read(productKey(product))
    expect(await verifyProduct(seen.id, seen.updatedAt, ADMIN)).toBe(true)
    return product
  }

  test('a token write is unverified, and an admin verifies it with who and when', async () => {
    const product = await storedBattery({})
    const key = productKey(product)
    expect((await read(key)).verification).toEqual({ status: 'unverified' })

    const seen = await read(key)
    expect(await verifyProduct(seen.id, seen.updatedAt, ADMIN)).toBe(true)

    expect((await read(key)).verification).toEqual({ status: 'verified', by: ADMIN, at: expect.any(String) })
  })

  test.each([
    ['fills a value', { cycleLife: NONE }, { cycleLife: stated(6000, '6000 cycles') }, false],
    ['replaces a value', {}, { ah: stated(105, '105Ah') }, true],
  ] as const)('a token write that %s makes a verified product unverified again', async (_, specs, change, replace) => {
    const product = await verifiedBattery(specs)

    await upsertProducts([stating(product, change)], { replace, actor: TOKEN })

    expect((await read(productKey(product))).verification).toEqual({ status: 'unverified' })
  })

  test.each([
    ['the same values', (p: ReturnType<typeof battery>) => p],
    ['a differing value kept aside as a conflict', (p: ReturnType<typeof battery>) => stating(p, { ah: stated(105, '105Ah') })],
  ])('a token write with %s keeps a product verified', async (_, incoming) => {
    const product = await verifiedBattery()

    await upsertProducts([incoming(product)], { replace: false, actor: TOKEN })

    expect((await read(productKey(product))).verification).toMatchObject({ status: 'verified', by: ADMIN })
  })

  test('an admin cannot verify a product the token changed after the admin read it', async () => {
    const product = await storedBattery({ cycleLife: NONE })
    const seen = await read(productKey(product))
    await upsertProducts([stating(product, { cycleLife: stated(6000, '6000 cycles') })], { replace: false, actor: TOKEN })

    expect(await verifyProduct(seen.id, seen.updatedAt, ADMIN)).toBe(false)

    expect((await read(productKey(product))).verification).toEqual({ status: 'unverified' })
  })
})
