import { describe, expect, test } from 'vitest'
import { RELOAD_GUARD_MS, isChunkLoadError, shouldReloadForStaleChunk } from './stale-chunk'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('isChunkLoadError', () => {
  test.each([
    ['Safari', new TypeError('Importing a module script failed.')],
    ['Chrome', new TypeError('Failed to fetch dynamically imported module: https://x.app/_build/a.js')],
    ['Firefox', new TypeError('error loading dynamically imported module: https://x.app/_build/a.js')],
    ['Vite CSS preload', new Error('Unable to preload CSS for /_build/a.css')],
  ])('recognises a failed chunk load in %s', (_browser, error) => {
    expect(isChunkLoadError(error)).toBe(true)
  })

  test('ignores ordinary errors and non-errors', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false)
    expect(isChunkLoadError('Importing a module script failed.')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('shouldReloadForStaleChunk', () => {
  const chunkError = new TypeError('Importing a module script failed.')

  test('reloads once for a failed chunk load', () => {
    // Arrange
    const storage = memoryStorage()

    // Act
    const first = shouldReloadForStaleChunk(chunkError, storage, 1_000)
    const second = shouldReloadForStaleChunk(chunkError, storage, 1_000 + RELOAD_GUARD_MS - 1)

    // Assert
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  test('reloads again once the guard window has passed, for a later deploy', () => {
    // Arrange
    const storage = memoryStorage()
    shouldReloadForStaleChunk(chunkError, storage, 1_000)

    // Act
    const later = shouldReloadForStaleChunk(chunkError, storage, 1_000 + RELOAD_GUARD_MS)

    // Assert
    expect(later).toBe(true)
  })

  test('never reloads for other errors', () => {
    expect(shouldReloadForStaleChunk(new Error('boom'), memoryStorage(), 1_000)).toBe(false)
  })

  test('does not reload when storage is unavailable, since it could not stop a reload loop', () => {
    expect(shouldReloadForStaleChunk(chunkError, null, 1_000)).toBe(false)
  })
})
