import { expect, test } from 'vitest'
import { bearerToken, failureThrottle, isApiEnabled, tokenMatches } from './api-token'

const TOKEN = 'x'.repeat(32)

test('the API is off without a token of at least 32 characters', () => {
  expect(isApiEnabled(undefined)).toBe(false)
  expect(isApiEnabled('short')).toBe(false)
  expect(isApiEnabled(TOKEN)).toBe(true)
})

test('reads a bearer token', () => {
  expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN)
  expect(bearerToken(`bearer  ${TOKEN} `)).toBe(TOKEN)
  expect(bearerToken('Basic abc')).toBeNull()
  expect(bearerToken(null)).toBeNull()
})

test('matches only the exact configured token', () => {
  expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
  expect(tokenMatches(`${TOKEN}y`, TOKEN)).toBe(false)
  expect(tokenMatches(null, TOKEN)).toBe(false)
  expect(tokenMatches(TOKEN, undefined)).toBe(false)
  expect(tokenMatches('short', 'short')).toBe(false)
})

test('throttles a key after the limit within the window, then forgets', () => {
  let now = 0
  const t = failureThrottle({ limit: 2, windowMs: 1000, now: () => now })
  t.recordFailure('ip')
  expect(t.isBlocked('ip')).toBe(false)
  t.recordFailure('ip')
  expect(t.isBlocked('ip')).toBe(true)
  expect(t.isBlocked('other')).toBe(false)
  now = 1000
  expect(t.isBlocked('ip')).toBe(false)
})
