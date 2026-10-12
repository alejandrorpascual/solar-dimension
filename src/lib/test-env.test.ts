import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TEST_DB_ENDPOINT_ENV } from './db-endpoint'

// The guard itself is e2e/test-env.ts: Playwright loads it, and would collect a test file next to it as its own, so
// its unit tests live here.
const TEST = 'ep-made-up-test-12345678'
const DEV = 'ep-made-up-dev-87654321'
const pooledUrl = (endpoint: string) => `postgresql://neondb_owner:not-a-real-password@${endpoint}-pooler.c-2.us-east-1.aws.neon.tech/neondb`
const directUrl = (endpoint: string) => pooledUrl(endpoint).replace('-pooler', '')
const TEST_FILE = '.env.test.local'
const DEV_FILE = '.env.local'
const TOUCHED = ['DATABASE_URL', 'CI', 'BETTER_AUTH_SECRET', TEST_DB_ENDPOINT_ENV] as const

/** The guard in a checkout whose env files hold `files`; a name that is not a key is a file that does not exist. */
async function loadGuard(files: Record<string, string> = {}) {
  vi.resetModules()
  vi.doMock('node:fs', () => ({ existsSync: (path: string) => path in files, readFileSync: (path: string) => files[path] }))
  return import('../../e2e/test-env.ts')
}

beforeEach(() => {
  // The guard writes to process.env, so each test starts without the variables it reads and gets them back afterwards.
  for (const key of TOUCHED) vi.stubEnv(key, undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test('refuses the production database through either host and in any letter case, and says which it is', async () => {
  const { assertTestDatabase } = await loadGuard()
  // Typed out on purpose: this is the id the guard must refuse whatever the constant says.
  const production = 'ep-round-sea-auutoq9o'

  for (const url of [pooledUrl(production), directUrl(production), pooledUrl(production).replace(production, production.toUpperCase())]) {
    expect(() => assertTestDatabase(url)).toThrow(`the production database (${production})`)
  }
})

test('refuses a missing URL and one it cannot read', async () => {
  const { assertTestDatabase } = await loadGuard()

  expect(() => assertTestDatabase(undefined)).toThrow('e2e needs DATABASE_URL')
  expect(() => assertTestDatabase('not a url')).toThrow('not a valid URL')
})

test('allows a database that is not production, and gives its endpoint', async () => {
  const { assertTestDatabase } = await loadGuard()

  expect(assertTestDatabase(pooledUrl(TEST))).toBe(TEST)
})

test('the test file wins over the shell, the dev file fills the rest, and the database is vouched for', async () => {
  process.env.DATABASE_URL = pooledUrl('ep-made-up-shell-11112222')
  const { loadTestEnv } = await loadGuard({
    [TEST_FILE]: `DATABASE_URL=${pooledUrl(TEST)}`,
    [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}\nBETTER_AUTH_SECRET=from-the-dev-file`,
  })

  const vouched = loadTestEnv()

  expect(vouched).toBe(TEST)
  expect(process.env.DATABASE_URL).toBe(pooledUrl(TEST))
  expect(process.env.BETTER_AUTH_SECRET).toBe('from-the-dev-file')
  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBe(TEST)
})

test('refuses a test file that points at production, and vouches for nothing', async () => {
  process.env[TEST_DB_ENDPOINT_ENV] = 'ep-made-up-left-over-33334444'
  const { loadTestEnv } = await loadGuard({ [TEST_FILE]: `DATABASE_URL=${pooledUrl('ep-round-sea-auutoq9o')}`, [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}` })

  expect(() => loadTestEnv()).toThrow('the production database')
  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBeUndefined()
})

test('outside CI, refuses to run without a test file, so the dev file never supplies the database', async () => {
  const { loadTestEnv } = await loadGuard({ [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}` })

  expect(() => loadTestEnv()).toThrow(`refuses to run without ${TEST_FILE}`)
  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBeUndefined()
})

test('outside CI, a DATABASE_URL exported in the shell does not stand in for the test file', async () => {
  process.env.DATABASE_URL = pooledUrl(TEST)
  const { loadTestEnv } = await loadGuard({ [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}` })

  expect(() => loadTestEnv()).toThrow(`refuses to run without ${TEST_FILE}`)
  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBeUndefined()
})

test('refuses the database the dev file points at, through the other host or in another letter case', async () => {
  const { loadTestEnv } = await loadGuard({
    [TEST_FILE]: `DATABASE_URL=${directUrl(DEV).replace(DEV, DEV.toUpperCase())}`,
    [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}`,
  })

  expect(() => loadTestEnv()).toThrow(`the same database as ${DEV_FILE} (${DEV})`)
  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBeUndefined()
})

test('in CI the database comes from the environment, and is vouched for', async () => {
  process.env.CI = 'true'
  process.env.DATABASE_URL = pooledUrl(TEST)
  const { loadTestEnv } = await loadGuard()

  loadTestEnv()

  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBe(TEST)
})

test('replaces a vouch left in the shell for another database', async () => {
  process.env[TEST_DB_ENDPOINT_ENV] = 'ep-made-up-left-over-33334444'
  const { loadTestEnv } = await loadGuard({ [TEST_FILE]: `DATABASE_URL=${pooledUrl(TEST)}`, [DEV_FILE]: `DATABASE_URL=${pooledUrl(DEV)}` })

  loadTestEnv()

  expect(process.env[TEST_DB_ENDPOINT_ENV]).toBe(TEST)
})
