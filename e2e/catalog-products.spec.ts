import { expect, test, type APIRequestContext } from '@playwright/test'
import { productKey } from '../src/lib/product-schema'
import { catalogAuthHeader as auth } from './catalog-token'
import { deleteTestProduct, insertUnreadableTestProduct, rawTestProduct } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

const SHEET = 'https://example.com/e2e-datasheet.pdf'
const NONE = { value: null, source: null, asWritten: null }
const stated = (value: number, asWritten: string) => ({ value, source: SHEET, asWritten })

function inverter(model: string, continuousW = 6000) {
  return {
    kind: 'inverter', brand: 'E2E Power', model, makerUrl: null, datasheetUrl: SHEET, extraSpecs: [], price: null,
    specs: {
      continuousW: stated(continuousW, `Rated power ${continuousW}W`),
      surges: [{ w: 12000, seconds: 3.5, asWritten: '12,000W for ≈3.5 seconds', source: SHEET }],
      batteryVolts: stated(48, '48 VDC'), splitPhase: NONE, chargerA: NONE, pvInputW: NONE, pvVocMax: NONE,
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
