import { expect, test } from 'vitest'
import { PENDING_KEY, STORAGE_KEY, clearPendingSave, hasPendingSave, loadStore, markPendingSave, saveStore } from './persistence'
import { initialStore } from './store'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v },
    data,
  }
}

test('round-trips a store', () => {
  const mem = memoryStorage()
  const s = initialStore()
  saveStore(s, mem)
  expect(loadStore(mem)).toEqual(s)
})

test('returns null for missing, corrupt or invalid data', () => {
  expect(loadStore(memoryStorage())).toBeNull()
  expect(loadStore(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toBeNull()
  expect(loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, projects: [], currentId: 'x' }) }))).toBeNull()
})

test('swallows storage errors', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
  expect(loadStore(broken)).toBeNull()
  expect(() => saveStore(initialStore(), broken)).not.toThrow()
  expect(hasPendingSave(broken)).toBe(false)
  expect(() => markPendingSave(broken)).not.toThrow()
  expect(() => clearPendingSave(broken)).not.toThrow()
})

test('tracks an interrupted save with a pending marker', () => {
  const mem = memoryStorage()
  const storage = { ...mem, removeItem: (k: string) => { delete mem.data[k] } }
  expect(hasPendingSave(storage)).toBe(false)
  markPendingSave(storage)
  expect(mem.data[PENDING_KEY]).toBe('1')
  expect(hasPendingSave(storage)).toBe(true)
  clearPendingSave(storage)
  expect(hasPendingSave(storage)).toBe(false)
  expect(hasPendingSave(null)).toBe(false)
})
