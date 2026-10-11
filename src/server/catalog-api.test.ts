import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DatabaseTarget } from '../lib/db-endpoint'

const TOKEN = 't'.repeat(32)
const HERE: DatabaseTarget = { endpoint: 'ep-test-here-12345678', production: false }
const ELSEWHERE = 'ep-test-other-87654321'
// Typed out, not imported: the research skills send this name, so renaming the header must fail a test.
const EXPECT_DATABASE = 'x-expect-database'

/** The module on a server whose database is `dbTarget`. Loaded fresh, so each test also gets its own throttle. */
async function load(dbTarget: DatabaseTarget | undefined) {
  vi.resetModules()
  vi.doMock('../db/client', () => ({ dbTarget }))
  vi.doMock('./catalog-repo', () => ({ setRetired: vi.fn() }))
  return import('./catalog-api')
}

const request = (headers: Record<string, string> = {}) => new Request('http://localhost/api/catalog/database', { headers })
const withToken = (headers: Record<string, string> = {}) => request({ authorization: `Bearer ${TOKEN}`, ...headers })

beforeEach(() => {
  vi.stubEnv('CATALOG_API_TOKEN', TOKEN)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test('names the database to a request with the token', async () => {
  const { databaseHandler } = await load(HERE)

  const response = databaseHandler({ request: withToken() })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(HERE)
})

test('names nothing without the token or with a wrong one', async () => {
  const { databaseHandler } = await load(HERE)

  const refused = [databaseHandler({ request: request() }), databaseHandler({ request: request({ authorization: `Bearer ${'w'.repeat(32)}` }) })]

  for (const response of refused) {
    expect(response.status).toBe(401)
    expect(await response.text()).not.toContain(HERE.endpoint)
  }
})

test('names nothing when the API is off', async () => {
  vi.stubEnv('CATALOG_API_TOKEN', '')
  const { databaseHandler } = await load(HERE)

  const response = databaseHandler({ request: withToken() })

  expect(response.status).toBe(404)
  expect(await response.text()).not.toContain(HERE.endpoint)
})

test('answers 500, not a guess, when the server cannot read its own database', async () => {
  const { databaseHandler } = await load(undefined)

  const response = databaseHandler({ request: withToken() })

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: expect.any(String) })
  expect(console.error).toHaveBeenCalledOnce()
})

test('lets a request through when it expects no database or this one', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken())).toBeNull()
  expect(authorize(withToken({ [EXPECT_DATABASE]: HERE.endpoint }))).toBeNull()
})

test('refuses a request that expects another database, and says which one this is', async () => {
  const { authorize } = await load(HERE)

  const response = authorize(withToken({ [EXPECT_DATABASE]: ELSEWHERE }))

  expect(response?.status).toBe(412)
  expect(await response?.json()).toEqual({ error: expect.any(String), database: HERE })
  expect(console.warn).toHaveBeenCalledWith(expect.any(String), { expected: ELSEWHERE, actual: HERE.endpoint, path: '/api/catalog/database' })
})

test('refuses an expected database that is empty or only close to this one', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken({ [EXPECT_DATABASE]: '' }))?.status).toBe(412)
  expect(authorize(withToken({ [EXPECT_DATABASE]: `${HERE.endpoint}-pooler` }))?.status).toBe(412)
  expect(authorize(withToken({ [EXPECT_DATABASE]: HERE.endpoint.toUpperCase() }))?.status).toBe(412)
})

test('refuses any expected database when the server cannot read its own', async () => {
  const { authorize } = await load(undefined)

  const response = authorize(withToken({ [EXPECT_DATABASE]: ELSEWHERE }))

  expect(response?.status).toBe(412)
  expect(await response?.json()).toEqual({ error: expect.any(String), database: null })
})

test('checks the token before the expected database, so a refusal names nothing to a stranger', async () => {
  const { authorize } = await load(HERE)

  const response = authorize(request({ [EXPECT_DATABASE]: ELSEWHERE }))

  expect(response?.status).toBe(401)
  expect(await response?.text()).not.toContain(HERE.endpoint)
})
