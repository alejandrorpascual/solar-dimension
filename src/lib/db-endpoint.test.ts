import { expect, test } from 'vitest'
import { databaseTarget, endpointOf, PRODUCTION_DB_ENDPOINT } from './db-endpoint'

const PASSWORD = 'not-a-real-password'
const TEST_ENDPOINT = 'ep-made-up-test-12345678'
const OTHER_ENDPOINT = 'ep-made-up-other-87654321'
const directUrl = (endpoint: string) => `postgresql://neondb_owner:${PASSWORD}@${endpoint}.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
const pooledUrl = (endpoint: string) => directUrl(`${endpoint}-pooler`)

test('ep-round-sea-auutoq9o is the production database', () => {
  // Typed out, not imported: changing the constant must fail a test, since the e2e guard and the API answer rest on it.
  expect(PRODUCTION_DB_ENDPOINT).toBe('ep-round-sea-auutoq9o')
  expect(databaseTarget(pooledUrl('ep-round-sea-auutoq9o'), undefined)?.environment).toBe('production')
})

test('reads the endpoint id from a direct host', () => {
  expect(endpointOf(directUrl(TEST_ENDPOINT))).toBe(TEST_ENDPOINT)
})

test('the pooled and the direct host of one database give the same id', () => {
  expect(endpointOf(pooledUrl(TEST_ENDPOINT))).toBe(TEST_ENDPOINT)
})

test('reads it whatever the scheme, port or query string', () => {
  const host = `${TEST_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`

  expect(endpointOf(`postgres://user:pass@${host}/neondb`)).toBe(TEST_ENDPOINT)
  expect(endpointOf(`postgresql://user:pass@${host}:5432/neondb`)).toBe(TEST_ENDPOINT)
  expect(endpointOf(`postgresql://user:pass@${host}/neondb?options=endpoint%3D${OTHER_ENDPOINT}`)).toBe(TEST_ENDPOINT)
})

test('reads a host written in upper case as the same database', () => {
  expect(endpointOf(pooledUrl(TEST_ENDPOINT).replace(`${TEST_ENDPOINT}-pooler`, `${TEST_ENDPOINT.toUpperCase()}-POOLER`))).toBe(TEST_ENDPOINT)
})

test('reads a host as the driver dials it: a letter written as %65, as a look-alike or around a soft hyphen is the same database', () => {
  const written = (first: string) => pooledUrl(TEST_ENDPOINT).replace(`@${TEST_ENDPOINT}`, `@${first}${TEST_ENDPOINT.slice(1)}`)

  expect(endpointOf(written('%65'))).toBe(TEST_ENDPOINT)
  expect(endpointOf(written('ｅ'))).toBe(TEST_ENDPOINT)
  expect(endpointOf(written('e­'))).toBe(TEST_ENDPOINT)
})

test('reads the host of a URL pasted with an @ in its password or a trailing newline', () => {
  const host = `${TEST_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`

  expect(endpointOf(`postgresql://user:p@ss@${host}/neondb`)).toBe(TEST_ENDPOINT)
  expect(endpointOf(`${pooledUrl(TEST_ENDPOINT)}\n`)).toBe(TEST_ENDPOINT)
})

test('gives the first label of a host that is not a Neon one', () => {
  expect(endpointOf('postgresql://user:pass@localhost:5432/test')).toBe('localhost')
})

test('gives nothing for a missing, empty or unreadable URL', () => {
  expect(endpointOf(undefined)).toBeUndefined()
  expect(endpointOf('')).toBeUndefined()
  expect(endpointOf('not a url')).toBeUndefined()
  expect(endpointOf('postgresql:///neondb')).toBeUndefined()
})

test('names the production database as production, through either host and in any letter case', () => {
  const upperCase = pooledUrl(PRODUCTION_DB_ENDPOINT).replace(PRODUCTION_DB_ENDPOINT, PRODUCTION_DB_ENDPOINT.toUpperCase())

  expect(databaseTarget(pooledUrl(PRODUCTION_DB_ENDPOINT), undefined)).toEqual({ endpoint: PRODUCTION_DB_ENDPOINT, environment: 'production' })
  expect(databaseTarget(directUrl(PRODUCTION_DB_ENDPOINT), undefined)?.environment).toBe('production')
  expect(databaseTarget(upperCase, undefined)?.environment).toBe('production')
})

test('names the production database as production when its host is written so that only the driver would know it', () => {
  const escaped = pooledUrl(PRODUCTION_DB_ENDPOINT).replace(`@${PRODUCTION_DB_ENDPOINT}`, `@%65${PRODUCTION_DB_ENDPOINT.slice(1)}`)

  expect(databaseTarget(escaped, undefined)).toEqual({ endpoint: PRODUCTION_DB_ENDPOINT, environment: 'production' })
})

test('production stays production even when something vouches for it as a test database', () => {
  expect(databaseTarget(pooledUrl(PRODUCTION_DB_ENDPOINT), PRODUCTION_DB_ENDPOINT)?.environment).toBe('production')
})

test('calls a database a test one only when it is the endpoint that was vouched for', () => {
  expect(databaseTarget(pooledUrl(TEST_ENDPOINT), TEST_ENDPOINT)).toEqual({ endpoint: TEST_ENDPOINT, environment: 'test' })
  expect(databaseTarget('postgresql://user:pass@localhost:5432/test', 'localhost')).toEqual({ endpoint: 'localhost', environment: 'test' })
})

test('a database nobody vouched for is unknown, never "not production"', () => {
  expect(databaseTarget(pooledUrl(TEST_ENDPOINT), undefined)).toEqual({ endpoint: TEST_ENDPOINT, environment: 'unknown' })
  expect(databaseTarget(pooledUrl(TEST_ENDPOINT), OTHER_ENDPOINT)?.environment).toBe('unknown')
  expect(databaseTarget(pooledUrl(TEST_ENDPOINT), '')?.environment).toBe('unknown')
  expect(databaseTarget('postgresql://user:pass@localhost:5432/test', undefined)?.environment).toBe('unknown')
})

test('an endpoint that only starts like the production one is not production', () => {
  expect(databaseTarget(directUrl(`${PRODUCTION_DB_ENDPOINT}x`), undefined)?.environment).toBe('unknown')
})

test('names no database when the URL cannot be read, whatever was vouched for', () => {
  expect(databaseTarget(undefined, TEST_ENDPOINT)).toBeUndefined()
  expect(databaseTarget('not a url', TEST_ENDPOINT)).toBeUndefined()
})

test('the answer carries nothing of the URL but the endpoint id', () => {
  const target = databaseTarget(pooledUrl(TEST_ENDPOINT), TEST_ENDPOINT)
  const answer = JSON.stringify(target)

  expect(Object.keys(target ?? {}).sort()).toEqual(['endpoint', 'environment'])
  expect(answer).not.toContain(PASSWORD)
  expect(answer).not.toContain('neondb_owner')
  expect(answer).not.toContain('neon.tech')
})
