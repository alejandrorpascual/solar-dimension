import { expect, test } from '@playwright/test'
import { ANOTHER_ENDPOINT, catalogAuthHeader as auth, meantFor, testEndpoint, writeHeaders, wrongTokenHeader } from './catalog-token'
import { deleteTestAppliance, testApplianceChanges, testApplianceExists } from './db'

const cooktop = (id: string) => ({
  id, category: 'Kitchen', watts: 3500, surge: 3500, duty: 0.15, tons: null, acType: null,
  labels: { en: { name: `E2E cooktop ${id}`, note: 'Test item' }, es: { name: `Anafe E2E ${id}`, note: 'Ítem de prueba' } },
})

test('the catalog API needs the token', async ({ request }) => {
  expect((await request.get('/api/catalog/appliances')).status()).toBe(401)
  expect((await request.get('/api/catalog/appliances', { headers: wrongTokenHeader })).status()).toBe(401)
})

test('says which database it is on, as a test one, and only to a request with the token', async ({ request }) => {
  // Only one refused request: refusals count toward the lockout, and every e2e request shares one address.
  const stranger = await request.get('/api/catalog/database')
  expect(stranger.status()).toBe(401)
  expect(await stranger.json()).toEqual({ error: expect.any(String) })
  expect(await stranger.text()).not.toContain(testEndpoint())
  expect(JSON.stringify(stranger.headers())).not.toContain(testEndpoint())

  const named = await request.get('/api/catalog/database', { headers: auth })
  expect(named.status()).toBe(200)
  // "test" because loadTestEnv() vouched for this database when the run started. A server started any other way
  // says "unknown", or "production" on production.
  expect(await named.json()).toEqual({ endpoint: testEndpoint(), environment: 'test' })
})

test('writes only when the POST names this database, and writes to the database it names', async ({ request }) => {
  const id = `e2e-named-${Date.now()}`
  try {
    const unnamed = await request.post('/api/catalog/appliances', { headers: auth, data: [cooktop(id)] })
    expect(unnamed.status()).toBe(428)
    expect(await unnamed.json()).toEqual({ error: expect.any(String) })
    // The name has to come from the answer the user was shown, so the refusal does not hand it over.
    expect(await unnamed.text()).not.toContain(testEndpoint())

    const elsewhere = await request.post('/api/catalog/appliances', { headers: meantFor(ANOTHER_ENDPOINT), data: [cooktop(id)] })
    expect(elsewhere.status()).toBe(412)
    expect(await elsewhere.json()).toEqual({
      error: expect.any(String), expected: ANOTHER_ENDPOINT, database: { endpoint: testEndpoint(), environment: 'test' },
    })
    expect(await testApplianceExists(id)).toBe(false)

    const here = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [cooktop(id)] })
    expect(await here.json()).toEqual({ created: [id], updated: [], warnings: [] })
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

test('the dry run and the write both carry plausibility warnings, and a warning never stops the write', async ({ request }) => {
  const id = `e2e-warn-${Date.now()}`
  const pump = { ...cooktop(id), category: 'Utility', watts: 100, surge: 3000, duty: 0.1 }
  const surgeWarning = [{ id, messages: [expect.stringMatching(/^Surge is 30× the running watts/)] }]
  const raised = { ...pump, watts: 160, surge: 480 }
  const changeWarning = [{
    id,
    messages: [
      'Running watts from the stored 100 to 160 is a change of 60%: check the digits and the unit.',
      'Surge from the stored 3000 to 480 is a change of 84%: check the digits and the unit.',
    ],
  }]
  try {
    const dry = await request.post('/api/catalog/appliances?dryRun=true', { headers: writeHeaders(), data: [pump] })
    expect(await dry.json()).toEqual({ changes: [{ id, kind: 'new' }], warnings: surgeWarning })
    const created = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [pump] })
    expect(await created.json()).toEqual({ created: [id], updated: [], warnings: surgeWarning })
    expect(await testApplianceExists(id)).toBe(true)

    const dryUpdate = await request.post('/api/catalog/appliances?dryRun=true', { headers: writeHeaders(), data: [raised] })
    expect(await dryUpdate.json()).toEqual({
      changes: [{ id, kind: 'changed', fields: [{ field: 'watts', from: 100, to: 160 }, { field: 'surge', from: 3000, to: 480 }] }],
      warnings: changeWarning,
    })
    const updated = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [raised] })
    expect(await updated.json()).toEqual({ created: [], updated: [id], warnings: changeWarning })
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
    expect(await dry.json()).toEqual({ changes: [{ id, kind: 'new' }], warnings: [] })
    expect((await request.get('/api/catalog/appliances', { headers: auth })).ok()).toBe(true)

    const bad = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: { ...item, surge: 1 } })
    expect(bad.status()).toBe(422)

    const created = await request.post('/api/catalog/appliances', { headers: writeHeaders(), data: [item] })
    expect(await created.json()).toEqual({ created: [id], updated: [], warnings: [] })

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

test('every write to an appliance is logged with the row before and after; an unchanged write logs nothing', async ({ request }) => {
  const id = `e2e-log-${Date.now()}`
  const item = cooktop(id)
  const post = (path: string, data?: unknown) => request.post(path, { headers: writeHeaders(), data })
  try {
    expect((await post('/api/catalog/appliances', [item])).status()).toBe(200)
    expect((await post('/api/catalog/appliances', [item])).status()).toBe(200)
    expect((await post('/api/catalog/appliances', [{ ...item, watts: 3000, surge: 3000 }])).status()).toBe(200)
    expect((await post(`/api/catalog/appliances/${id}/retire`)).status()).toBe(200)
    expect((await post(`/api/catalog/appliances/${id}/restore`)).status()).toBe(200)

    const log = await testApplianceChanges(id)
    // Created, changed, retired, restored: the repeated write of the same item added nothing.
    expect(log.map((e) => [e.before?.watts ?? null, e.after.watts, e.before?.retired ?? null, e.after.retired])).toEqual([
      [null, 3500, null, false],
      [3500, 3000, false, false],
      [3000, 3000, false, true],
      [3000, 3000, true, false],
    ])
    expect(log.every((e) => e.actor === 'api-token')).toBe(true)
    expect(log[1]!.after).toEqual({ ...item, watts: 3000, surge: 3000, kind: null, surgeClass: null, burstSeconds: null, cyclesPerHour: null, sortOrder: log[0]!.after.sortOrder, retired: false })
  } finally {
    await deleteTestAppliance(id)
  }
})
