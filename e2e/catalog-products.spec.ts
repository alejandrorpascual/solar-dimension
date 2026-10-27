import { expect, test, type APIRequestContext } from '@playwright/test'
import { productKey } from '../src/lib/product-schema'
import { catalogAuthHeader as auth, writeHeaders } from './catalog-token'
import { deleteTestProduct, insertUnreadableTestProduct, rawTestProduct, testProductDates } from './db'

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

// Every POST names this run's database; the server refuses one that does not (see e2e/catalog-api.spec.ts).
const post = (request: APIRequestContext, query: string, data: unknown) => request.post(`/api/catalog/products${query}`, { headers: writeHeaders(), data })
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
    expect(await stored(request, key)).toMatchObject({ origin: 'admin', specs: { continuousW: { value: 6000 } }, conflicts: [], verification: { status: 'unverified' } })

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

test('a dry run warns on an odd spec and names a stored possible duplicate, and writes nothing', async ({ request }) => {
  const first = `W${Date.now()}`
  const second = `${first}b`
  const [firstKey, secondKey] = [first, second].map((model) => productKey({ kind: 'inverter', brand: 'E2E Power', model }))
  try {
    await post(request, '', [inverter(first)])

    const dry = await post(request, '?dryRun=true', [inverter(second, 50)])

    expect(dry.status()).toBe(200)
    // Every e2e product shares a maker and a datasheet, so rows of a parallel run may be named too.
    expect((await dry.json()).warnings).toEqual([{
      key: secondKey,
      messages: expect.arrayContaining([
        '50 W continuous is under 100 W: check the power is in watts.',
        `Possible duplicate of the stored E2E Power ${first} (${firstKey}).`,
      ]),
    }])
    expect(await stored(request, secondKey)).toBeUndefined()
  } finally {
    await deleteTestProduct(firstKey)
    await deleteTestProduct(secondKey)
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

test('a mistyped flag answers 400 naming it, and nothing is written', async ({ request }) => {
  const model = `F${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const mistyped = [['?dryRun=1', 'dryRun'], ['?dryrun=true', 'dryrun'], ['?dryRun=True', 'dryRun'], ['?replace=yes', 'replace'], ['?dryRun=true&dryRun=false', 'dryRun']]
  try {
    for (const [query, name] of mistyped) {
      const res = await post(request, query, [inverter(model)])
      expect(res.status(), `POST ${query}`).toBe(400)
      expect(await res.json()).toEqual({ error: expect.stringContaining(`"${name}"`) })
      expect(await stored(request, key), `POST ${query} wrote a row`).toBeUndefined()
    }
  } finally {
    await deleteTestProduct(key)
  }
})

test('a dry run with replace shows what it would overwrite, and writes nothing', async ({ request }) => {
  const model = `R${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const seen = { amount: 1199, currency: 'USD', seller: 'Shop', url: 'https://shop.example.com/p', seenOn: '2026-10-09' }
  const later = { ...seen, amount: 1099, seenOn: '2026-10-10' }
  try {
    await post(request, '', [{ ...inverter(model), price: seen }])

    const dry = await post(request, '?dryRun=true&replace=true', [{ ...inverter(model, 5000), price: later }])

    expect(dry.status()).toBe(200)
    const [change] = (await dry.json()).changes
    expect(change).toMatchObject({ key, status: 'updated', fills: [], conflicts: [], dropped: [] })
    expect(change.replaced).toHaveLength(2)
    expect(change.replaced).toEqual(expect.arrayContaining([
      { field: 'specs.continuousW', stored: 6000, found: 5000 },
      { field: 'price', stored: seen, found: later },
    ]))
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 6000 } }, price: seen })
  } finally {
    await deleteTestProduct(key)
  }
})

test('a retired product leaves the list, and restore brings it back', async ({ request }) => {
  const model = `R${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const listed = async (query = '') =>
    ((await (await request.get(`/api/catalog/products${query}`, { headers: auth })).json()).items as Array<{ key: string; retired: boolean }>).find((i) => i.key === key)
  const flip = (verb: string, id: string) => request.post(`/api/catalog/products/${id}/${verb}`, { headers: writeHeaders() })
  try {
    await post(request, '', [inverter(model)])
    const { id } = (await stored(request, key)) as unknown as { id: string }

    expect(await (await flip('retire', id)).json()).toEqual({ id, retired: true })
    expect(await listed()).toBeUndefined()
    expect(await listed('?includeRetired=true')).toMatchObject({ retired: true })

    expect(await (await flip('restore', id)).json()).toEqual({ id, retired: false })
    expect(await listed()).toMatchObject({ retired: false })

    expect((await flip('retire', '00000000-0000-4000-8000-000000000000')).status()).toBe(404)
    expect((await flip('retire', 'not-a-uuid')).status()).toBe(404)
  } finally {
    await deleteTestProduct(key)
  }
})

test('a token write to a retired product keeps it retired, and the list refuses a query it does not know', async ({ request }) => {
  const model = `W${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const withRetired = async () =>
    ((await (await request.get('/api/catalog/products?includeRetired=true', { headers: auth })).json()).items as Array<{ key: string }>).find((i) => i.key === key)
  try {
    await post(request, '', [inverter(model)])
    const { id } = (await stored(request, key)) as unknown as { id: string }
    const retire = () => request.post(`/api/catalog/products/${id}/retire`, { headers: writeHeaders() })
    expect(await (await retire()).json()).toEqual({ id, retired: true })
    expect(await (await retire()).json()).toEqual({ id, retired: true })

    expect(await (await post(request, '?replace=true', [inverter(model, 5000)])).json()).toMatchObject({ updated: [key] })
    expect(await stored(request, key)).toBeUndefined()
    expect(await withRetired()).toMatchObject({ retired: true, specs: { continuousW: { value: 5000 } } })

    for (const query of ['?retired=1', '?includeRetired=yes', '?includeRetired=true&includeRetired=false']) {
      expect((await request.get(`/api/catalog/products${query}`, { headers: auth })).status(), query).toBe(400)
    }
    expect((await request.post(`/api/catalog/products/${id}/restore?dryRun=true`, { headers: writeHeaders() })).status()).toBe(400)
    expect(await withRetired()).toMatchObject({ retired: true })
  } finally {
    await deleteTestProduct(key)
  }
})

test('replace with clear empties a stored value; a clear without replace is refused', async ({ request }) => {
  const model = `C${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  try {
    await post(request, '', [inverter(model, 6000, stated(125, 'Charge current 125A'))])
    const clearing = { ...inverter(model), clear: ['specs.chargerA'] }

    expect((await post(request, '', [clearing])).status()).toBe(422)
    expect(await stored(request, key)).toMatchObject({ specs: { chargerA: { value: 125 } } })

    const dry = await (await post(request, '?dryRun=true&replace=true', [clearing])).json()
    expect(dry.changes).toEqual([expect.objectContaining({ status: 'updated', removed: ['specs.chargerA'] })])

    expect(await (await post(request, '?replace=true', [clearing])).json()).toEqual({ created: [], updated: [key], unchanged: [], conflicts: [] })
    expect(await stored(request, key)).toMatchObject({ specs: { chargerA: NONE } })
  } finally {
    await deleteTestProduct(key)
  }
})

test('replace with the same value from a new source updates the source', async ({ request }) => {
  const model = `S${Date.now()}`
  const key = productKey({ kind: 'inverter', brand: 'E2E Power', model })
  const NEW_SHEET = 'https://example.com/e2e-datasheet-v2.pdf'
  try {
    await post(request, '', [inverter(model)])
    const base = inverter(model)
    const moved = { ...base, specs: { ...base.specs, continuousW: { value: 6000, source: NEW_SHEET, asWritten: 'Rated power 6000W' } } }

    expect((await (await post(request, '', [moved])).json()).unchanged).toEqual([key])
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { source: SHEET } } })

    expect((await (await post(request, '?replace=true', [moved])).json()).updated).toEqual([key])
    expect(await stored(request, key)).toMatchObject({ specs: { continuousW: { value: 6000, source: NEW_SHEET } } })
  } finally {
    await deleteTestProduct(key)
  }
})
