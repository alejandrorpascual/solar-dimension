import { expect, test } from '@playwright/test'
import { ANOTHER_ENDPOINT, catalogAuthHeader as auth, meantFor, testEndpoint, writeHeaders, wrongTokenHeader } from './catalog-token'
import { deleteTestAppliance, testApplianceExists } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

const cooktop = (id: string) => ({
  id, category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  labels: { en: { name: `E2E cooktop ${id}`, note: 'Test item' }, es: { name: `Anafe E2E ${id}`, note: 'Ítem de prueba' } },
})

test('the catalog API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/appliances')).status()).toBe(401)
  expect((await request.get('/api/catalog/appliances', { headers: wrongTokenHeader })).status()).toBe(401)
})

test('says which database it is on, as a test one, and only to a request with the token', async ({ request }) => {
  // One refused request, not two: the server locks an address out after ten, and every e2e request shares one address.
  const stranger = await request.get('/api/catalog/database')
  expect(stranger.status()).toBe(401)
  expect(await stranger.json()).toEqual({ error: expect.any(String) })
  expect(JSON.stringify(stranger.headers())).not.toContain(testEndpoint())

  const named = await request.get('/api/catalog/database', { headers: auth })
  expect(named.status()).toBe(200)
  // "test" because loadTestEnv() vouched for this database when the run started; any other server says "unknown".
  expect(await named.json()).toEqual({ endpoint: testEndpoint(), environment: 'test' })
})

test('writes only when the POST names this database, and writes to the database it names', async ({ request }) => {
  const id = `e2e-named-${Date.now()}`
  try {
    const unnamed = await request.post('/api/catalog/appliances', { headers: auth, data: [cooktop(id)] })
    expect(unnamed.status()).toBe(428)
    expect(await unnamed.json()).toEqual({ error: expect.any(String) })

    const elsewhere = await request.post('/api/catalog/appliances', { headers: meantFor(ANOTHER_ENDPOINT), data: [cooktop(id)] })
    expect(elsewhere.status()).toBe(412)
    expect(await elsewhere.json()).toEqual({
      error: expect.any(String), expected: ANOTHER_ENDPOINT, database: { endpoint: testEndpoint(), environment: 'test' },
    })
    expect(await testApplianceExists(id)).toBe(false)

    const here = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [cooktop(id)] })
    expect(await here.json()).toEqual({ created: [id], updated: [] })
    // Read on the test's own connection: the row is in the database the server named, not somewhere else.
    expect(await testApplianceExists(id)).toBe(true)
  } finally {
    await deleteTestAppliance(id)
  }
})

test('a mistyped flag answers 400 naming it, and nothing is written', async ({ request }) => {
  const id = `e2e-flag-${Date.now()}`
  const mistyped = [['?dryRun=1', 'dryRun'], ['?dryrun=true', 'dryrun'], ['?dryRun=True', 'dryRun'], ['?replace=true', 'replace'], ['?dryRun=true&dryRun=false', 'dryRun']]
  try {
    for (const [query, name] of mistyped) {
      const res = await request.post(`/api/catalog/appliances${query}`, { headers: writeHeaders(), data: [cooktop(id)] })
      expect(res.status(), `POST ${query}`).toBe(400)
      expect(await res.json()).toEqual({ error: expect.stringContaining(`"${name}"`) })
      expect(await testApplianceExists(id), `POST ${query} wrote a row`).toBe(false)
    }
  } finally {
    await deleteTestAppliance(id)
  }
})

test('dry run, create, show in the picker in both languages, then retire', async ({ request, page }) => {
  const id = `e2e-${Date.now()}`
  const item = cooktop(id)
  try {
    const dry = await request.post('/api/catalog/appliances?dryRun=true', { headers: writeHeaders(), data: item })
    expect(dry.status()).toBe(200)
    expect(await dry.json()).toEqual({ changes: [{ id, kind: 'new' }] })
    expect((await request.get('/api/catalog/appliances', { headers: auth })).ok()).toBe(true)

    const bad = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: { ...item, surge: 1 } })
    expect(bad.status()).toBe(422)

    const created = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [item] })
    expect(await created.json()).toEqual({ created: [id], updated: [] })

    await page.goto('/?step=1')
    await expect(page.getByText(`E2E cooktop ${id}`)).toBeVisible()
    await page.context().addCookies([{ name: 'lang', value: 'es', url: page.url() }])
    await page.reload()
    await expect(page.getByText(`Anafe E2E ${id}`)).toBeVisible()

    // Retire has no dry run: asking for one is refused, not carried out, and the item is still there after a reload.
    expect((await request.post(`/api/catalog/appliances/${id}/retire?dryRun=true`, { headers: writeHeaders() })).status()).toBe(400)
    await page.reload()
    await expect(page.getByText(`Anafe E2E ${id}`)).toBeVisible()
    expect((await request.post(`/api/catalog/appliances/${id}/retire`, { headers: writeHeaders() })).status()).toBe(200)
    await page.reload()
    await expect(page.getByText(`Anafe E2E ${id}`)).toHaveCount(0)
    expect((await request.post('/api/catalog/appliances/no-such-id/retire', { headers: writeHeaders() })).status()).toBe(404)
  } finally {
    // Runs even if an assertion above throws midway, so no run leaves its e2e-* row behind.
    await deleteTestAppliance(id)
  }
})
