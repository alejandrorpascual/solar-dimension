import { afterEach, expect, test, vi } from 'vitest'
import { TEST_DB_ENDPOINT_ENV } from '../lib/db-endpoint'

const ENDPOINT = 'ep-made-up-test-12345678'
const URL_OF = (endpoint: string) => `postgresql://neondb_owner:not-a-real-password@${endpoint}-pooler.c-2.us-east-1.aws.neon.tech/neondb`

/** The client module as a server would load it, with `vouched` in the variable the e2e guard sets (undefined = unset). */
async function loadClient(vouched: string | undefined) {
  vi.resetModules()
  vi.stubEnv('DATABASE_URL', URL_OF(ENDPOINT))
  vi.stubEnv(TEST_DB_ENDPOINT_ENV, vouched)
  return import('./client')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

test('a server nobody vouched for does not know its database to be a test one', async () => {
  const { dbTarget } = await loadClient(undefined)

  expect(dbTarget).toEqual({ endpoint: ENDPOINT, environment: 'unknown' })
})

test('a vouch for another database says nothing about this one', async () => {
  const { dbTarget } = await loadClient('ep-made-up-other-87654321')

  expect(dbTarget?.environment).toBe('unknown')
})

test('the database is a test one only when the vouch names its endpoint', async () => {
  const { dbTarget } = await loadClient(ENDPOINT)

  expect(dbTarget).toEqual({ endpoint: ENDPOINT, environment: 'test' })
})
