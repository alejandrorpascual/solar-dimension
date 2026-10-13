import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { DatabaseTarget } from '../lib/db-endpoint'

const TOKEN = 't'.repeat(32)
const HERE: DatabaseTarget = { endpoint: 'ep-test-here-12345678', environment: 'test' }
const ANOTHER_ENDPOINT = 'ep-test-other-87654321'
// Typed out, not imported: the research skills send this name, so renaming the header must fail a test.
const EXPECT_DATABASE = 'x-expect-database'
const FAILURE_LIMIT = 10

/** The module on a server whose database is `dbTarget`, with the repo it writes through. Loaded fresh for each test. */
async function load(dbTarget: DatabaseTarget | undefined) {
  const setRetired = vi.fn(async () => true)
  vi.resetModules()
  vi.doMock('../db/client', () => ({ dbTarget }))
  vi.doMock('./catalog-repo', () => ({ setRetired }))
  return { ...(await import('./catalog-api')), setRetired }
}

type Call = { method?: 'GET' | 'POST'; path?: string; headers?: Record<string, string> }
const request = ({ method = 'GET', path = '/api/catalog/database', headers = {} }: Call = {}) =>
  new Request(`http://localhost${path}`, { method, headers })
const withToken = (call: Call = {}) => request({ ...call, headers: { authorization: `Bearer ${TOKEN}`, ...call.headers } })
const naming = (endpoint: string) => ({ [EXPECT_DATABASE]: endpoint })
const retireCall = (headers: Record<string, string>, query = '') =>
  ({ request: withToken({ method: 'POST', path: `/api/catalog/appliances/kettle/retire${query}`, headers }), params: { id: 'kettle' } })

/** The answer is an error and nothing else: no key beside `error`, and the server's endpoint nowhere in its text. */
async function expectNothingNamed(response: Response | null | undefined): Promise<void> {
  const body: unknown = await response?.json()
  expect(body).toEqual({ error: expect.any(String) })
  expect(JSON.stringify(body)).not.toContain(HERE.endpoint)
}

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

  const refused = [databaseHandler({ request: request() }), databaseHandler({ request: request({ headers: { authorization: `Bearer ${'w'.repeat(32)}` } }) })]

  for (const response of refused) {
    expect(response.status).toBe(401)
    await expectNothingNamed(response)
  }
})

test('names nothing when the API is off, even to a request that names another database', async () => {
  vi.stubEnv('CATALOG_API_TOKEN', '')
  const { databaseHandler } = await load(HERE)

  const response = databaseHandler({ request: withToken({ headers: naming(ANOTHER_ENDPOINT) }) })

  expect(response.status).toBe(404)
  await expectNothingNamed(response)
})

test('answers 500, not a guess, when the server cannot read its own database', async () => {
  const { databaseHandler } = await load(undefined)

  const response = databaseHandler({ request: withToken() })

  expect(response.status).toBe(500)
  await expectNothingNamed(response)
  expect(console.error).toHaveBeenCalledOnce()
})

test('lets a read through whether it names no database or this one', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken())).toBeNull()
  expect(authorize(withToken({ headers: naming(HERE.endpoint) }))).toBeNull()
})

test('lets a POST through only when it names this database', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken({ method: 'POST', path: '/api/catalog/appliances', headers: naming(HERE.endpoint) }))).toBeNull()
})

test('refuses a POST that names no database, dry run or not, without naming its own', async () => {
  const { authorize } = await load(HERE)

  const refused = ['/api/catalog/appliances', '/api/catalog/appliances?dryRun=true', '/api/catalog/appliances/some-id/retire']
    .map((path) => authorize(withToken({ method: 'POST', path })))

  for (const response of refused) {
    expect(response?.status).toBe(428)
    await expectNothingNamed(response)
  }
  expect(console.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'POST', path: '/api/catalog/appliances' }))
})

test('refuses a request that names another database, and says which one this is', async () => {
  const { authorize } = await load(HERE)

  const response = authorize(withToken({ method: 'POST', path: '/api/catalog/products', headers: naming(ANOTHER_ENDPOINT) }))

  expect(response?.status).toBe(412)
  expect(await response?.json()).toEqual({ error: expect.any(String), expected: ANOTHER_ENDPOINT, database: HERE })
  expect(console.warn).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ expected: ANOTHER_ENDPOINT, actual: HERE.endpoint, method: 'POST', path: '/api/catalog/products' }),
  )
})

test('refuses a read that names another database too', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken({ headers: naming(ANOTHER_ENDPOINT) }))?.status).toBe(412)
})

test('refuses a named database that is empty or only close to this one', async () => {
  const { authorize } = await load(HERE)

  expect(authorize(withToken({ headers: naming('') }))?.status).toBe(412)
  expect(authorize(withToken({ headers: naming(`${HERE.endpoint}-pooler`) }))?.status).toBe(412)
  expect(authorize(withToken({ headers: naming(HERE.endpoint.toUpperCase()) }))?.status).toBe(412)
})

test('a server that cannot read its own database answers 500 to every POST and to any request that names one', async () => {
  const { authorize } = await load(undefined)

  const refused = [
    authorize(withToken({ method: 'POST', headers: naming(ANOTHER_ENDPOINT) })),
    authorize(withToken({ method: 'POST' })),
    authorize(withToken({ headers: naming(ANOTHER_ENDPOINT) })),
  ]

  // Not 412 or 428: those tell the caller to ask again or to add the name, and neither can help here.
  for (const response of refused) {
    expect(response?.status).toBe(500)
    await expectNothingNamed(response)
  }
  expect(console.error).toHaveBeenCalledTimes(refused.length)
})

test('a server that cannot read its own database still lets a read through that names none', async () => {
  const { authorize } = await load(undefined)

  expect(authorize(withToken())).toBeNull()
})

test('checks the token before the database, so a refusal names nothing to a stranger', async () => {
  const { authorize } = await load(HERE)

  const refused = [authorize(request({ headers: naming(ANOTHER_ENDPOINT) })), authorize(request({ method: 'POST' }))]

  for (const response of refused) {
    expect(response?.status).toBe(401)
    await expectNothingNamed(response)
  }
})

test('after ten wrong tokens from one address, the right token is refused too', async () => {
  const { authorize } = await load(HERE)
  const fromOneAddress = { 'x-real-ip': '203.0.113.7' }

  for (let attempt = 0; attempt < FAILURE_LIMIT; attempt += 1) {
    expect(authorize(request({ headers: { ...fromOneAddress, authorization: `Bearer ${'w'.repeat(32)}` } }))?.status).toBe(401)
  }

  expect(authorize(withToken({ headers: fromOneAddress }))?.status).toBe(429)
  expect(authorize(withToken({ headers: { 'x-real-ip': '203.0.113.8' } }))).toBeNull()
})

test('a refusal over the database is not a failed sign-in: it never locks the address out', async () => {
  const { authorize } = await load(HERE)

  for (let attempt = 0; attempt <= FAILURE_LIMIT; attempt += 1) {
    expect(authorize(withToken({ method: 'POST', headers: naming(ANOTHER_ENDPOINT) }))?.status).toBe(412)
    expect(authorize(withToken({ method: 'POST' }))?.status).toBe(428)
  }

  expect(authorize(withToken())).toBeNull()
})

test('retire changes nothing for a request that names another database or none', async () => {
  const { retiredHandler, setRetired } = await load(HERE)

  const elsewhere = await retiredHandler(true)(retireCall(naming(ANOTHER_ENDPOINT)))
  const unnamed = await retiredHandler(true)(retireCall({}))

  expect(elsewhere.status).toBe(412)
  expect(unnamed.status).toBe(428)
  expect(setRetired).not.toHaveBeenCalled()
})

test('retire goes through for a request that names this database', async () => {
  const { retiredHandler, setRetired } = await load(HERE)

  const response = await retiredHandler(true)(retireCall(naming(HERE.endpoint)))

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: 'kettle', retired: true })
  expect(setRetired).toHaveBeenCalledWith('kettle', true, 'api-token')
})

test('restore un-retires: the handler passes on which of the two it is', async () => {
  const { retiredHandler, setRetired } = await load(HERE)

  const response = await retiredHandler(false)(retireCall(naming(HERE.endpoint)))

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: 'kettle', retired: false })
  expect(setRetired).toHaveBeenCalledWith('kettle', false, 'api-token')
})

test('retire refuses a query parameter instead of ignoring it: there is no dry run of a retire', async () => {
  const { retiredHandler, setRetired } = await load(HERE)

  const response = await retiredHandler(true)(retireCall(naming(HERE.endpoint), '?dryRun=true'))

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: expect.stringContaining('"dryRun"') })
  expect(setRetired).not.toHaveBeenCalled()
})
