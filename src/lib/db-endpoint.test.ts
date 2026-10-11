import { expect, test } from 'vitest'
import { databaseTarget, endpointOf, PRODUCTION_DB_ENDPOINT } from './db-endpoint'

const PASSWORD = 'not-a-real-password'
const neonUrl = (host: string) => `postgresql://neondb_owner:${PASSWORD}@${host}/neondb?sslmode=require&channel_binding=require`
const TEST_ENDPOINT = 'ep-crimson-rain-au38702t'

test('reads the endpoint id from a direct host', () => {
  expect(endpointOf(neonUrl(`${TEST_ENDPOINT}.c-2.us-east-1.aws.neon.tech`))).toBe(TEST_ENDPOINT)
})

test('the pooled and the direct host of one database give the same id', () => {
  expect(endpointOf(neonUrl(`${TEST_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`))).toBe(TEST_ENDPOINT)
})

test('reads it whatever the scheme, port or query string', () => {
  const host = `${TEST_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`

  expect(endpointOf(`postgres://user:pass@${host}/neondb`)).toBe(TEST_ENDPOINT)
  expect(endpointOf(`postgresql://user:pass@${host}:5432/neondb`)).toBe(TEST_ENDPOINT)
  expect(endpointOf(`postgresql://user:pass@${host}/neondb?options=endpoint%3Dep-other-12345678`)).toBe(TEST_ENDPOINT)
})

test('reads a host written in upper case as the same database', () => {
  expect(endpointOf(neonUrl(`${TEST_ENDPOINT.toUpperCase()}-POOLER.c-2.us-east-1.aws.neon.tech`))).toBe(TEST_ENDPOINT)
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

test('names the production database as production', () => {
  const target = databaseTarget(neonUrl(`${PRODUCTION_DB_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`))

  expect(target).toEqual({ endpoint: PRODUCTION_DB_ENDPOINT, production: true })
})

test('names production as production through its direct host and in upper case too', () => {
  expect(databaseTarget(neonUrl(`${PRODUCTION_DB_ENDPOINT}.c-2.us-east-1.aws.neon.tech`))?.production).toBe(true)
  expect(databaseTarget(neonUrl(`${PRODUCTION_DB_ENDPOINT.toUpperCase()}-pooler.c-2.us-east-1.aws.neon.tech`))?.production).toBe(true)
})

test('names any other database by its id, not as production', () => {
  expect(databaseTarget(neonUrl(`${TEST_ENDPOINT}.c-2.us-east-1.aws.neon.tech`))).toEqual({ endpoint: TEST_ENDPOINT, production: false })
  expect(databaseTarget('postgresql://user:pass@localhost:5432/test')).toEqual({ endpoint: 'localhost', production: false })
})

test('an endpoint that only starts like the production one is not production', () => {
  expect(databaseTarget(neonUrl(`${PRODUCTION_DB_ENDPOINT}x.c-2.us-east-1.aws.neon.tech`))?.production).toBe(false)
})

test('names no database when the URL cannot be read', () => {
  expect(databaseTarget(undefined)).toBeUndefined()
  expect(databaseTarget('not a url')).toBeUndefined()
})

test('the answer carries nothing of the URL but the endpoint id', () => {
  const answer = JSON.stringify(databaseTarget(neonUrl(`${TEST_ENDPOINT}-pooler.c-2.us-east-1.aws.neon.tech`)))

  expect(answer).toBe(`{"endpoint":"${TEST_ENDPOINT}","production":false}`)
  expect(answer).not.toContain(PASSWORD)
  expect(answer).not.toContain('neondb_owner')
  expect(answer).not.toContain('neon.tech')
})
