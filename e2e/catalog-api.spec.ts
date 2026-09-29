import { expect, test } from '@playwright/test'
import { catalogAuthHeader as auth } from './catalog-token'
import { deleteTestAppliance } from './db'

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== 'desktop', 'API checks run once')
})

test('the catalog API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/appliances')).status()).toBe(401)
  expect((await request.get('/api/catalog/appliances', { headers: { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' } })).status()).toBe(401)
})

test('dry run, create, show in the picker in both languages, then retire', async ({ request, page }) => {
  const id = `e2e-${Date.now()}`
  const item = {
    id, category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
    labels: { en: { name: `E2E cooktop ${id}`, note: 'Test item' }, es: { name: `Anafe E2E ${id}`, note: 'Ítem de prueba' } },
  }
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
