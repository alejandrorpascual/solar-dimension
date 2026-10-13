import { expect, test } from 'vitest'
import {
  CLIENTS_KEY_PREFIX, DRAFT_KEY, PENDING_KEY, REQUESTER_KEY, STORAGE_KEY, clearPendingSave, clearRequesterDraft, hasPendingSave,
  loadRequesterDraft, loadSavedClients, loadStore, markPendingSave, saveRequesterDraft, saveSavedClients, saveStore,
} from './persistence'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { compute } from './sizing'
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

test('a store already saved with a custom appliance the schema refuses loads again: every project is back, that appliance is not', () => {
  // What the form used to write: a pasted product title, 93 characters, in the third project.
  const long = { id: 'custom1', name: 'Samsung 21 cu. ft. Top Freezer Refrigerator with FlexZone and Ice Maker in Stainless RT21M6215SR', watts: 180, surge: 180, note: 'Custom · 180 W' }
  const base = initialStore().projects[0]!
  const broken = {
    version: 1, currentId: 'p3',
    projects: [base, { ...base, id: 'p2', name: 'Client kit 1' }, { ...base, id: 'p3', name: 'Client kit 2', qty: { ...base.qty, custom1: 1 }, custom: [long] }],
  }
  expect(long.name.length).toBeGreaterThan(80)
  const loaded = loadStore(memoryStorage({ [STORAGE_KEY]: JSON.stringify(broken) }))
  expect(loaded?.projects.map((p) => p.name)).toEqual([base.name, 'Client kit 1', 'Client kit 2'])
  expect(loaded?.currentId).toBe('p3')
  const recovered = loaded!.projects[2]!
  expect(recovered.custom).toEqual([])
  // Its count is still there, which is what makes the kit say one appliance could not be loaded.
  const kit = compute({ qty: recovered.qty, custom: recovered.custom, hours: recovered.hours, volts: recovered.volts, chemistry: recovered.chemistry }, CATALOG_SNAPSHOT)
  expect(kit.warnings.filter((w) => w.code === 'missingAppliances')).toEqual([{ code: 'missingAppliances', params: { count: 1 } }])
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

const lee = { id: 'c1', requester: ann, usedAt: 10 }
const ruiz = { id: 'c2', requester: { ...ann, name: 'Rosa Ruiz' }, usedAt: 20 }

test('saved clients round-trip per owner, most recently used first', () => {
  const mem = removableStorage()
  saveSavedClients('user-a', [lee, ruiz], mem)
  expect(loadSavedClients('user-a', mem)).toEqual([ruiz, lee])
  expect(loadSavedClients('user-b', mem)).toEqual([])
  expect(loadSavedClients(null, mem)).toEqual([])
  saveSavedClients(null, [lee], mem)
  expect(loadSavedClients(null, mem)).toEqual([lee])
  expect(mem.data[`${CLIENTS_KEY_PREFIX}guest`]).toBeDefined()
})

test('one invalid saved client is dropped, not the whole list', () => {
  const mem = memoryStorage({ [`${CLIENTS_KEY_PREFIX}guest`]: JSON.stringify([lee, { id: 'bad', requester: { ...ann, name: '' }, usedAt: 1 }, 'junk']) })
  expect(loadSavedClients(null, mem)).toEqual([lee])
  expect(loadSavedClients(null, memoryStorage({ [`${CLIENTS_KEY_PREFIX}guest`]: '{not json' }))).toEqual([])
})

test('the requester remembered by the previous release becomes its owner\'s first saved client', () => {
  const mem = removableStorage({ [REQUESTER_KEY]: JSON.stringify({ owner: 'user-a', requester: ann }) })
  expect(loadSavedClients('user-a', mem)).toEqual([{ id: 'remembered', requester: ann, usedAt: 0 }])
  expect(loadSavedClients('user-b', mem)).toEqual([])
  // The first release stored a bare requester with no owner: it is not handed to anyone.
  expect(loadSavedClients(null, memoryStorage({ [REQUESTER_KEY]: JSON.stringify(ann) }))).toEqual([])
})

test('writing the list retires its owner\'s remembered requester, and only theirs', () => {
  const mem = removableStorage({ [REQUESTER_KEY]: JSON.stringify({ owner: 'user-a', requester: ann }) })
  saveSavedClients('user-b', [ruiz], mem)
  expect(mem.data[REQUESTER_KEY]).toBeDefined()
  saveSavedClients('user-a', [], mem)
  expect(mem.data[REQUESTER_KEY]).toBeUndefined()
  expect(loadSavedClients('user-a', mem)).toEqual([])
})

test('keeps one unsaved form, reads it back, and clears it', () => {
  const mem = removableStorage()
  const slot = { owner: null, projectId: 'p1', target: 'new' as const }
  const draft = { ...slot, draft: { ...ann, name: 'Ann L' }, shouldRemember: false }
  expect(saveRequesterDraft(draft, mem)).toBe(true)
  expect(loadRequesterDraft(mem)).toEqual(draft)
  clearRequesterDraft(slot, mem)
  expect(loadRequesterDraft(mem)).toBeNull()
  expect(loadRequesterDraft(memoryStorage({ [DRAFT_KEY]: '{not json' }))).toBeNull()
  expect(loadRequesterDraft(memoryStorage({ [DRAFT_KEY]: JSON.stringify({ ...draft, target: 'all' }) }))).toBeNull()
})

test('clearing a draft leaves one written by another form, say in another tab', () => {
  const mem = removableStorage()
  const draft = { owner: null, projectId: 'p1', target: 'new' as const, draft: ann, shouldRemember: true }
  saveRequesterDraft(draft, mem)
  clearRequesterDraft({ owner: null, projectId: 'p1', target: 'project' }, mem)
  clearRequesterDraft({ owner: null, projectId: 'p2', target: 'new' }, mem)
  expect(loadRequesterDraft(mem)).toEqual(draft)
})

test('blocked or missing storage never throws', () => {
  const throwing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  expect(loadSavedClients(null, throwing)).toEqual([])
  expect(() => saveSavedClients(null, [lee], throwing)).not.toThrow()
  expect(loadRequesterDraft(throwing)).toBeNull()
  // A failed write says so, so the form never claims a draft it could not keep.
  expect(saveRequesterDraft({ owner: null, projectId: 'p1', target: 'new', draft: ann, shouldRemember: true }, throwing)).toBe(false)
  expect(saveRequesterDraft({ owner: null, projectId: 'p1', target: 'new', draft: ann, shouldRemember: true }, null)).toBe(false)
  expect(() => clearRequesterDraft({ owner: null, projectId: 'p1', target: 'new' }, throwing)).not.toThrow()
  expect(loadSavedClients(null, null)).toEqual([])
  expect(loadRequesterDraft(null)).toBeNull()
})
