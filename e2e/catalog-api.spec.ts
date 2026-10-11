import { expect, test } from '@playwright/test'
import { endpointOf } from '../src/lib/db-endpoint'
import { ANOTHER_DATABASE, catalogAuthHeader as auth, expectingDatabase, wrongTokenHeader } from './catalog-token'
import { deleteTestAppliance } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

/** The run's database as the server names it. loadTestEnv() already refused to start without a readable DATABASE_URL. */
const testDatabase = () => endpointOf(process.env.DATABASE_URL)!

const cooktop = (id: string) => ({
  id, category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  labels: { en: { name: `E2E cooktop ${id}`, note: 'Test item' }, es: { name: `Anafe E2E ${id}`, note: 'Ítem de prueba' } },
})

test('the catalog API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/appliances')).status()).toBe(401)
  expect((await request.get('/api/catalog/appliances', { headers: wrongTokenHeader })).status()).toBe(401)
})

test('names the database it writes to, and only to a request with the token', async ({ request }) => {
  const endpoint = testDatabase()

  const refused = [await request.get('/api/catalog/database'), await request.get('/api/catalog/database', { headers: wrongTokenHeader })]
  for (const response of refused) {
    expect(response.status()).toBe(401)
    expect(await response.text()).not.toContain(endpoint)
    expect(JSON.stringify(response.headers())).not.toContain(endpoint)
  }

  const named = await request.get('/api/catalog/database', { headers: auth })
  expect(named.status()).toBe(200)
  // The e2e database is never the production one: loadTestEnv() refuses to start the run otherwise.
  expect(await named.json()).toEqual({ endpoint, production: false })
})

test('refuses a write meant for another database, and takes one meant for this one', async ({ request }) => {
  const endpoint = testDatabase()
  const id = `e2e-pinned-${Date.now()}`
  try {
    const elsewhere = await request.post('/api/catalog/appliances', { headers: expectingDatabase(ANOTHER_DATABASE), data: [cooktop(id)] })
    expect(elsewhere.status()).toBe(412)
    expect(await elsewhere.json()).toEqual({ error: expect.any(String), database: { endpoint, production: false } })
    const afterRefusal = await request.post('/api/catalog/appliances?dryRun=true', { headers: expectingDatabase(endpoint), data: [cooktop(id)] })
    expect(await afterRefusal.json()).toEqual({ changes: [{ id, kind: 'new' }] })

    const here = await request.post('/api/catalog/appliances', { headers: expectingDatabase(endpoint), data: [cooktop(id)] })
    expect(await here.json()).toEqual({ created: [id], updated: [] })
  } finally {
    await deleteTestAppliance(id)
  }
})

test('dry run, create, show in the picker in both languages, then retire', async ({ request, page }) => {
  const id = `e2e-${Date.now()}`
  const item = cooktop(id)
  try {
    const dry = await request.post('/api/catalog/appliances?dryRun=true', { headers: auth, data: item })
    expect(dry.status()).toBe(200)
    expect(await dry.json()).toEqual({ changes: [{ id, kind: 'new' }] })
    expect((await request.get('/api/catalog/appliances', { headers: auth })).ok()).toBe(true)

    const bad = await request.post('/api/catalog/appliances', { headers: auth, data: { ...item, surge: 1 } })
    expect(bad.status()).toBe(422)

    const created = await request.post('/api/catalog/appliances', { headers: auth, data: [item] })
    expect(await created.json()).toEqual({ created: [id], updated: [] })

    await page.goto('/?step=1')
    await expect(page.getByText(`E2E cooktop ${id}`)).toBeVisible()
    await page.context().addCookies([{ name: 'lang', value: 'es', url: page.url() }])
    await page.reload()
    await expect(page.getByText(`Anafe E2E ${id}`)).toBeVisible()

    expect((await request.post(`/api/catalog/appliances/${id}/retire`, { headers: auth })).status()).toBe(200)
    await page.reload()
    await expect(page.getByText(`Anafe E2E ${id}`)).toHaveCount(0)
    expect((await request.post('/api/catalog/appliances/no-such-id/retire', { headers: auth })).status()).toBe(404)
  } finally {
    // Runs even if an assertion above throws midway, so no run leaves its e2e-* row behind.
    await deleteTestAppliance(id)
  }
})
