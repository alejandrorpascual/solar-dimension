import { expect, test, type APIRequestContext } from '@playwright/test'
import { productKey } from '../src/lib/product-schema'
import { catalogAuthHeader as auth } from './catalog-token'
import { deleteTestProduct, insertUnreadableTestProduct, rawTestProduct, testProductDates } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

const SHEET = 'https://example.com/e2e-datasheet.pdf'
const NONE = { value: null, source: null, asWritten: null }
const stated = (value: number, asWritten: string) => ({ value, source: SHEET, asWritten })

function inverter(model: string, continuousW = 6000, chargerA: ReturnType<typeof stated> | typeof NONE = NONE) {
  return {
    kind: 'inverter', brand: 'E2E Power', model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(continuousW, `Rated power ${continuousW}W`),
      surges: [{ w: 12000, seconds: 3.5, asWritten: '12,000W for ≈3.5 seconds', source: SHEET }],
      batteryVolts: stated(48, '48 VDC'), splitPhase: NONE, chargerA, pvInputW: NONE, pvVocMax: NONE,
      maxParallelUnits: NONE, idleW: NONE, peakEfficiencyPct: NONE, warrantyYears: NONE, bmsComms: ['can'], compatibleBatteryBrands: [],
    },
  }
}

const post = (request: APIRequestContext, query: string, data: unknown) => request.post(`/api/catalog/products${query}`, { headers: auth, data })
const stored = async (request: APIRequestContext, key: string) =>
  ((await (await request.get('/api/catalog/products', { headers: auth })).json()).items as Array<{ key: string }>).find((i) => i.key === key)

test('the products API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/products')).status()).toBe(401)
  expect((await request.post('/api/catalog/products', { data: [inverter(`X${Date.now()}`)] })).status()).toBe(401)
})

test('dry run, create, keep a conflicting reading aside, then replace it', async ({ request }) => {
  const model = `X${Date.now()}`
  // Known before anything is written, so `finally` always cleans up.
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  try {
    const dry = await post(request, '?dryRun=true', [inverter(model)])
    expect(dry.status()).toBe(200)
    expect((await dry.json()).changes).toEqual([expect.objectContaining({ status: 'new', key, brand: 'E2E Power', model })])

    const base = inverter(model)
    const unsourced = { ...base, specs: { ...base.specs, continuousW: { value: 6000, source: null, asWritten: null } } }
    expect((await post(request, '', [unsourced])).status()).toBe(422)

    expect(await (await post(request, '', [inverter(model)])).json()).toEqual({ created: [key], updated: [], unchanged: [], conflicts: [] })
    expect(await stored(request, key)).toMatchObject({ origin: 'admin', specs: { continuousW: { value: 6000 } }, conflicts: [] })

    const conflict = await post(request, '', [inverter(model, 5000)])
    expect(await conflict.json()).toEqual({ created: [], updated: [], unchanged: [], conflicts: [{ key, fields: ['specs.continuousW'] }] })
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 6000 } }, conflicts: [{ field: 'specs.continuousW', found: 5000 }] })

    const replaced = await post(request, '?replace=true', [inverter(model, 5000)])
    expect(await replaced.json()).toEqual({ created: [], updated: [key], unchanged: [], conflicts: [] })
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 5000 } }, conflicts: [] })
  } finally {
    // Runs even when an assertion fails midway, so no run leaves its row behind.
    await deleteTestProduct(key)
  }
})

test('a stored product that no longer passes the schema is never overwritten', async ({ request }) => {
  const model = `U${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const refusal = { error: expect.stringContaining('no longer pass the schema'), keys: [key] }
  try {
    await insertUnreadableTestProduct(key)
    const untouched = { specs: {}, updatedBy: 'e2e' }

    for (const query of ['?dryRun=true', '?dryRun=true&replace=true', '', '?replace=true']) {
      const res = await post(request, query, [inverter(model)])
      expect(res.status(), `POST ${query || '(write)'}`).toBe(409)
      expect(await res.json()).toEqual(refusal)
      expect(await rawTestProduct(key)).toEqual(untouched)
    }
    expect(await stored(request, key)).toBeUndefined()
  } finally {
    await deleteTestProduct(key)
  }
})

test('a write that fills one spec and finds another differing is in updated and in conflicts', async ({ request }) => {
  const model = `M${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  try {
    // Arrange: stored with chargerA unstated
    expect(await (await post(request, '', [inverter(model)])).json()).toEqual({ created: [key], updated: [], unchanged: [], conflicts: [] })

    // Act: fills chargerA and reads a different continuousW
    const mixed = await post(request, '', [inverter(model, 5000, stated(125, 'Max. charge current 125A'))])

    // Assert: the answer lists it twice, and the row holds both
    expect(await mixed.json()).toEqual({ created: [], updated: [key], unchanged: [], conflicts: [{ key, fields: ['specs.continuousW'] }] })
    expect(await stored(request, key)).toMatchObject({
      specs: { continuousW: { value: 6000 }, chargerA: { value: 125 } },
      conflicts: [{ field: 'specs.continuousW', found: 5000 }],
    })
  } finally {
    await deleteTestProduct(key)
  }
})

/** Database clocks tick in microseconds and Dates in milliseconds; a pause keeps two writes from landing on one tick. */
const pauseForClock = () => new Promise((resolve) => setTimeout(resolve, 20))

test('sending an unchanged product again moves last_seen_at and nothing else', async ({ request }) => {
  const model = `S${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  try {
    // Arrange
    await post(request, '', [inverter(model)])
    const before = await testProductDates(key)
    const rowBefore = await rawTestProduct(key)
    await pauseForClock()

    // Act
    const again = await post(request, '', [inverter(model)])

    // Assert
    expect(await again.json()).toEqual({ created: [], updated: [], unchanged: [key], conflicts: [] })
    const after = await testProductDates(key)
    expect(after!.lastSeenAt.getTime()).toBeGreaterThan(before!.lastSeenAt.getTime())
    expect(after!.updatedAt).toEqual(before!.updatedAt)
    expect(await rawTestProduct(key)).toEqual(rowBefore)
  } finally {
    await deleteTestProduct(key)
  }
})

test('a write of one new and one unchanged product creates the first and moves last_seen_at of the second', async ({ request }) => {
  const known = `K${Date.now()}`
  const fresh = `N${Date.now()}`
  const knownKey = productKey({ kind: 'inverter', brand: 'E2E Power', model: known })
  const freshKey = productKey({ kind: 'inverter', brand: 'E2E Power', model: fresh })
  try {
    await post(request, '', [inverter(known)])
    const before = await testProductDates(knownKey)
    await pauseForClock()

    const res = await post(request, '', [inverter(known), inverter(fresh)])

    expect(await res.json()).toEqual({ created: [freshKey], updated: [], unchanged: [knownKey], conflicts: [] })
    expect((await testProductDates(knownKey))!.lastSeenAt.getTime()).toBeGreaterThan(before!.lastSeenAt.getTime())
    expect(await stored(request, freshKey)).toBeDefined()
  } finally {
    await deleteTestProduct(knownKey)
    await deleteTestProduct(freshKey)
  }
})
