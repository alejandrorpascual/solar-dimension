import { describe, expect, test } from 'vitest'
import { createLatest } from './latest-only'

/** A promise the test resolves by hand, to land responses in any order. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

describe('createLatest', () => {
  test('only the newest request is current', () => {
    const latest = createLatest()
    const first = latest.begin()
    expect(first()).toBe(true)
    const second = latest.begin()
    expect(first()).toBe(false)
    expect(second()).toBe(true)
  })
  test('invalidate makes every request in flight stale, as on sign-out or an optimistic change', () => {
    const latest = createLatest()
    const inFlight = latest.begin()
    latest.invalidate()
    expect(inFlight()).toBe(false)
    expect(latest.begin()()).toBe(true)
  })
  test('an older response that lands after a newer one is dropped', async () => {
    const latest = createLatest()
    const applied: string[] = []
    const load = async (answer: Promise<string>) => {
      const isCurrent = latest.begin()
      const value = await answer
      if (isCurrent()) applied.push(value)
    }
    const slow = deferred<string>()
    const fast = deferred<string>()
    const a = load(slow.promise)
    const b = load(fast.promise)
    fast.resolve('user B')
    await b
    slow.resolve('user A')
    await a
    expect(applied).toEqual(['user B'])
  })
})
