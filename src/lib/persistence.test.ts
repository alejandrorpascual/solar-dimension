import { expect, test, vi } from 'vitest'
import {
  CLIENTS_KEY_PREFIX, DRAFT_KEY, LEGACY_SYNCED_KEY, OWNER_KEY, PENDING_KEY, REQUESTER_KEY, STORAGE_KEY, UNSENT_KEY_PREFIX, clearPendingSave,
  clearRequesterDraft, clearUnsent, hasPendingSave, loadOwner, loadRequesterDraft, loadSavedClients, loadStore, loadUnsent, markPendingSave,
  releaseAccountCopy, saveOwner, saveRequesterDraft, saveSavedClients, saveStore,
} from './persistence'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { compute } from './sizing'
import { addProject, initialStore, patchProject } from './store'

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

const ANA = 'user-ana'
const BEA = 'user-bea'
const anaStore = () => addProject(initialStore(), 'Clinic')
/** A browser holding Ana's projects, as her account left them. */
function anaBrowser(extra: Record<string, string> = {}) {
  return removableStorage({ [STORAGE_KEY]: JSON.stringify(anaStore()), [OWNER_KEY]: ANA, ...extra })
}

test('the owner of the projects is the account that was marked, and nobody before that', () => {
  const storage = removableStorage()
  expect(loadOwner(storage)).toBeNull()

  saveOwner(ANA, storage)

  expect(loadOwner(storage)).toBe(ANA)
  expect(loadOwner(null)).toBeNull()
})

test("releasing takes an account's projects, its marker and the pending marker off the browser", () => {
  const storage = anaBrowser()

  releaseAccountCopy(storage)

  expect(Object.keys(storage.data)).toEqual([])
  expect(loadStore(storage)).toBeNull()
  expect(loadOwner(storage)).toBeNull()
})

test('releasing sets aside what never reached the account, for that account only', () => {
  const storage = anaBrowser({ [PENDING_KEY]: '1' })

  releaseAccountCopy(storage)

  expect(Object.keys(storage.data)).toEqual([`${UNSENT_KEY_PREFIX}${ANA}`])
  expect(loadUnsent(ANA, storage).map((p) => p.name)).toEqual(['Home', 'Clinic'])
  expect(loadUnsent(BEA, storage)).toEqual([])
})

test('work done signed out is nobody\'s to release', () => {
  const storage = removableStorage({ [STORAGE_KEY]: JSON.stringify(anaStore()), [PENDING_KEY]: '1' })

  releaseAccountCopy(storage)

  expect(loadStore(storage)?.projects.map((p) => p.name)).toEqual(['Home', 'Clinic'])
  expect(Object.keys(storage.data).sort()).toEqual([PENDING_KEY, STORAGE_KEY].sort())
})

test('what was set aside is gone once cleared, and unreadable entries read as none', () => {
  const storage = anaBrowser({ [PENDING_KEY]: '1', [`${UNSENT_KEY_PREFIX}${BEA}`]: '{not json' })
  releaseAccountCopy(storage)

  clearUnsent(ANA, storage)

  expect(loadUnsent(ANA, storage)).toEqual([])
  expect(loadUnsent(BEA, storage)).toEqual([])
  expect(loadUnsent(ANA, null)).toEqual([])
})

test('releasing and the owner marker swallow storage errors', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }

  expect(() => releaseAccountCopy(broken)).not.toThrow()
  expect(() => releaseAccountCopy(null)).not.toThrow()
  expect(() => saveOwner(ANA, broken)).not.toThrow()
  expect(() => saveOwner(ANA, null)).not.toThrow()
  expect(loadOwner(broken)).toBeNull()
  expect(loadUnsent(ANA, broken)).toEqual([])
  expect(() => clearUnsent(ANA, broken)).not.toThrow()
  expect(() => clearUnsent(ANA, null)).not.toThrow()
})

test('a marker left by an earlier release is taken over: the copy is that account\'s, with all of it still to send', () => {
  const storage = removableStorage({ [STORAGE_KEY]: JSON.stringify(anaStore()), [LEGACY_SYNCED_KEY]: ANA })

  expect(loadOwner(storage)).toBe(ANA)

  expect(storage.data[OWNER_KEY]).toBe(ANA)
  expect(hasPendingSave(storage)).toBe(true)
  expect(LEGACY_SYNCED_KEY in storage.data).toBe(false)
  expect(loadOwner(storage)).toBe(ANA)
})

test('releasing a copy left by an earlier release sets it aside, although that release never marked it', () => {
  const storage = removableStorage({ [STORAGE_KEY]: JSON.stringify(anaStore()), [LEGACY_SYNCED_KEY]: ANA })

  releaseAccountCopy(storage)

  expect(Object.keys(storage.data)).toEqual([`${UNSENT_KEY_PREFIX}${ANA}`])
  expect(loadUnsent(ANA, storage).map((p) => p.name)).toEqual(['Home', 'Clinic'])
})

test('releasing adds to what was already set aside for the account, the newer copy of each project', () => {
  const earlier = patchProject(anaStore(), 'p1', { hours: 24 })
  const now = addProject(initialStore(), 'Workshop')
  const storage = removableStorage({
    [STORAGE_KEY]: JSON.stringify(now), [OWNER_KEY]: ANA, [PENDING_KEY]: '1', [`${UNSENT_KEY_PREFIX}${ANA}`]: JSON.stringify(earlier),
  })

  releaseAccountCopy(storage)

  const setAside = loadUnsent(ANA, storage)
  expect(setAside.map((p) => p.name).sort()).toEqual(['Clinic', 'Home', 'Workshop'])
  // The earlier Home was edited; the one in the copy released now was never touched.
  expect(setAside.find((p) => p.id === 'p1')?.hours).toBe(24)
})

test('a copy the schema no longer reads is set aside as it is, but never over one that reads', () => {
  const unreadable = JSON.stringify({ version: 1, projects: [{ id: 'x' }], currentId: 'x' })
  const alone = removableStorage({ [STORAGE_KEY]: unreadable, [OWNER_KEY]: ANA, [PENDING_KEY]: '1' })
  const besideEarlier = removableStorage({
    [STORAGE_KEY]: unreadable, [OWNER_KEY]: ANA, [PENDING_KEY]: '1', [`${UNSENT_KEY_PREFIX}${ANA}`]: JSON.stringify(anaStore()),
  })

  releaseAccountCopy(alone)
  releaseAccountCopy(besideEarlier)

  expect(alone.data[`${UNSENT_KEY_PREFIX}${ANA}`]).toBe(unreadable)
  expect(loadUnsent(ANA, besideEarlier).map((p) => p.name)).toEqual(['Home', 'Clinic'])
  expect(STORAGE_KEY in alone.data || STORAGE_KEY in besideEarlier.data).toBe(false)
})

test('when storage is too full to set the unsent projects aside, they still leave the browser, and it is logged', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  const storage = anaBrowser({ [PENDING_KEY]: '1' })
  const full = { ...storage, setItem: () => { throw new Error('QuotaExceededError') } }

  releaseAccountCopy(full)

  expect(Object.keys(storage.data)).toEqual([])
  expect(logged).toHaveBeenCalledWith('[projects] unsent projects could not be set aside and are lost', expect.anything())
  logged.mockRestore()
})

test('a removal that storage refuses does not stop the others', () => {
  const storage = anaBrowser({ [PENDING_KEY]: '1' })
  const stubborn = { ...storage, removeItem: (key: string) => { if (key === STORAGE_KEY) throw new Error('blocked'); storage.removeItem(key) } }

  expect(() => releaseAccountCopy(stubborn)).not.toThrow()

  expect(OWNER_KEY in storage.data || PENDING_KEY in storage.data).toBe(false)
})
