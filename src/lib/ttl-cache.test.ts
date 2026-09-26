import { expect, test, vi } from 'vitest'
import { ttlCache, withFallback } from './ttl-cache'

test('serves the cached value until the TTL passes, then reloads', async () => {
  let now = 0
  const cache = ttlCache<number>(60_000, () => now)
  const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  expect(await cache.get(load)).toBe(1)
  now = 59_999
  expect(await cache.get(load)).toBe(1)
  now = 60_000
  expect(await cache.get(load)).toBe(2)
  expect(load).toHaveBeenCalledTimes(2)
})

test('clear forces the next read to reload', async () => {
  const cache = ttlCache<number>(60_000, () => 0)
  const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
  await cache.get(load)
  cache.clear()
  expect(await cache.get(load)).toBe(2)
})

test('a failed load is not cached', async () => {
  const cache = ttlCache<number>(60_000, () => 0)
  await expect(cache.get(() => Promise.reject(new Error('db down')))).rejects.toThrow('db down')
  expect(await cache.get(() => Promise.resolve(3))).toBe(3)
})

test('withFallback returns the fallback and reports the error', async () => {
  const onError = vi.fn()
  expect(await withFallback(() => Promise.reject(new Error('x')), 'snap', onError)).toBe('snap')
  expect(onError).toHaveBeenCalledWith(expect.any(Error))
  expect(await withFallback(() => Promise.resolve('live'), 'snap', onError)).toBe('live')
})
