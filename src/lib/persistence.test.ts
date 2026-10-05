import { expect, test } from 'vitest'
import { PENDING_KEY, REQUESTER_KEY, STORAGE_KEY, clearPendingSave, forgetRequester, hasPendingSave, loadRememberedRequester, loadStore, markPendingSave, rememberRequester, saveStore } from './persistence'
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

const ann = { kind: 'person', country: 'US', name: 'Ann Lee', contact: '', docPrefix: '', doc: '', phone: '+1 305 555 0100', email: '', address: '' } as const

function removableStorage(initial: Record<string, string> = {}) {
  const mem = memoryStorage(initial)
  return { ...mem, removeItem: (k: string) => { delete mem.data[k] } }
}

test('remembers a requester for its owner, reads it back, and forgets it', () => {
  const mem = removableStorage()
  rememberRequester(ann, 'user-a', mem)
  expect(loadRememberedRequester('user-a', mem)).toEqual(ann)
  forgetRequester(mem)
  expect(loadRememberedRequester('user-a', mem)).toBeNull()
})

test('another account, or a signed-out visitor, on the same browser never gets the remembered requester', () => {
  const mem = removableStorage()
  rememberRequester(ann, 'user-a', mem)
  expect(loadRememberedRequester('user-b', mem)).toBeNull()
  expect(loadRememberedRequester(null, mem)).toBeNull()
  rememberRequester(ann, null, mem)
  expect(loadRememberedRequester(null, mem)).toEqual(ann)
  expect(loadRememberedRequester('user-a', mem)).toBeNull()
})

test('a missing, corrupt, ownerless or invalid remembered requester reads as none', () => {
  expect(loadRememberedRequester(null, memoryStorage())).toBeNull()
  expect(loadRememberedRequester(null, memoryStorage({ [REQUESTER_KEY]: '{not json' }))).toBeNull()
  // The first release stored the bare requester, with no owner: it is not handed to anyone.
  expect(loadRememberedRequester(null, memoryStorage({ [REQUESTER_KEY]: JSON.stringify(ann) }))).toBeNull()
  expect(loadRememberedRequester(null, memoryStorage({ [REQUESTER_KEY]: JSON.stringify({ owner: null, requester: { ...ann, name: '' } }) }))).toBeNull()
})

test('blocked or missing storage never throws', () => {
  const throwing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  expect(loadRememberedRequester(null, throwing)).toBeNull()
  expect(() => rememberRequester(ann, null, throwing)).not.toThrow()
  expect(() => forgetRequester(throwing)).not.toThrow()
  expect(loadRememberedRequester(null, null)).toBeNull()
})
