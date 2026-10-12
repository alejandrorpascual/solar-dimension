import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'dotenv'
// With its `.ts`: ci.yml and scripts/start-on-test-db.ts load this file with plain `node`, which resolves an import
// only as written.
import { endpointOf, PRODUCTION_DB_ENDPOINT, TEST_DB_ENDPOINT_ENV } from '../src/lib/db-endpoint.ts'

/** The e2e database lives here (git-ignored): a Neon branch of its own, never the one dev or prod uses. */
export const TEST_ENV_FILE = '.env.test.local'
const DEV_ENV_FILE = '.env.local'

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {}
}

/** Throws unless `url` is a database tests may write to, and returns its endpoint. CI also runs this before its migrations. */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) throw new Error(`e2e needs DATABASE_URL: set it in ${TEST_ENV_FILE} (a Neon branch for tests) or, in CI, as a secret.`)
  const endpoint = endpointOf(url)
  if (!endpoint) throw new Error('e2e refuses to run: DATABASE_URL is not a valid URL.')
  if (endpoint === PRODUCTION_DB_ENDPOINT) {
    throw new Error(`e2e refuses to run: DATABASE_URL is the production database (${endpoint}). Point it at a Neon branch for tests.`)
  }
  return endpoint
}

/**
 * Loads the e2e environment. `.env.test.local` wins over everything, so a `DATABASE_URL` exported in the shell can't
 * send tests elsewhere; then the shell (CI secrets); then `.env.local` for the rest (auth secret and so on). The
 * webServer inherits it, and `node --env-file` / dotenv never override a variable that is already set, so the test
 * build talks to the test database too.
 *
 * Throws, so no test runs, when the database is production, is not declared for tests, or is the one `.env.local`
 * points at: e2e runs create users, projects and catalog rows, and they once filled the production catalog that way.
 *
 * A database that passes is vouched for in TEST_DB_ENDPOINT, which a server started with this environment reads: it is
 * the only way a server answers /api/catalog/database with "test".
 */
export function loadTestEnv(): void {
  const testEnv = readEnvFile(TEST_ENV_FILE)
  const devEnv = readEnvFile(DEV_ENV_FILE)
  for (const [key, value] of Object.entries(testEnv)) process.env[key] = value
  for (const [key, value] of Object.entries(devEnv)) process.env[key] ??= value
  // A vouch left in the shell or in a file says nothing about this run, and a run that is refused must leave none.
  delete process.env[TEST_DB_ENDPOINT_ENV]

  const url = process.env.DATABASE_URL
  const endpoint = assertTestDatabase(url)
  if (!process.env.CI && !testEnv.DATABASE_URL) {
    throw new Error(`e2e refuses to run without ${TEST_ENV_FILE}: put the test branch's DATABASE_URL there, so tests never use ${DEV_ENV_FILE}'s database.`)
  }
  if (endpoint === endpointOf(devEnv.DATABASE_URL)) {
    throw new Error(`e2e refuses to run: DATABASE_URL points at the same database as ${DEV_ENV_FILE} (${endpoint}). Use a separate Neon branch.`)
  }
  process.env[TEST_DB_ENDPOINT_ENV] = endpoint
}
