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

test('evicts stale keys when recording a new failure after window expires', () => {
  let now = 0
  const t = failureThrottle({ limit: 1, windowMs: 1000, now: () => now })
  t.recordFailure('old')
  expect(t.isBlocked('old')).toBe(true)
  now = 1000 // window expires
  expect(t.isBlocked('old')).toBe(false) // stale entry filtered out
  t.recordFailure('new') // recording new failure cleans up stale keys
  expect(t.isBlocked('old')).toBe(false) // old is gone from tracking
  expect(t.isBlocked('new')).toBe(true)
})

test('evicts oldest keys when exceeding maxKeys', () => {
  let now = 0
  const t = failureThrottle({ limit: 1, windowMs: 1000, now: () => now, maxKeys: 2 })
  t.recordFailure('a')
  expect(t.isBlocked('a')).toBe(true)
  t.recordFailure('b')
  expect(t.isBlocked('b')).toBe(true)
  t.recordFailure('c') // exceeds maxKeys, evicts 'a' (oldest)
  expect(t.isBlocked('c')).toBe(true)
  expect(t.isBlocked('a')).toBe(false) // 'a' was evicted
  expect(t.isBlocked('b')).toBe(true)  // 'b' still tracked
})
