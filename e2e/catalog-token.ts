import { TEST_DB_ENDPOINT_ENV } from '../src/lib/db-endpoint'

// Matches the CATALOG_API_TOKEN the webServer command sets in playwright.config.ts.
export const CATALOG_API_TOKEN = 'e2e-catalog-token-0123456789abcdef0123456789abcdef'
export const catalogAuthHeader = { Authorization: `Bearer ${CATALOG_API_TOKEN}` }
export const wrongTokenHeader = { Authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong' }
/** Shaped like a Neon endpoint id, and no database of ours. */
export const ANOTHER_ENDPOINT = 'ep-not-this-one-12345678'

/** The run's database as the server names it: the endpoint the guard vouched for when the Playwright config loaded. */
export function testEndpoint(): string {
  const endpoint = process.env[TEST_DB_ENDPOINT_ENV]
  if (!endpoint) throw new Error(`${TEST_DB_ENDPOINT_ENV} is not set: loadTestEnv() vouches for the database when playwright.config.ts loads`)
  return endpoint
}

/** The token plus the database the request is meant for: a server on any other database answers 412. */
export const meantFor = (endpoint: string) => ({ ...catalogAuthHeader, 'X-Expect-Database': endpoint })
/** What every catalog POST carries: the token and this run's database. Without the database the server answers 428. */
export const writeHeaders = () => meantFor(testEndpoint())
