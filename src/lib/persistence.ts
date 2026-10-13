import { z } from 'zod'
import { RequesterSchema, type Requester } from './requester'
import { StoredDraftSchema, isSameSlot, type DraftSlot, type StoredDraft } from './requester-draft'
import { SavedClientSchema, byRecent, type SavedClient } from './saved-clients'
import { StoreSchema, type Project, type Store } from './schema'
import { newestById } from './sync'

export const STORAGE_KEY = 'solar-dimension.projects.v1'
/** The id of the account the projects under STORAGE_KEY belong to. Absent: they are work done signed out. */
export const OWNER_KEY = 'solar-dimension.owner.v1'
/**
 * Written by releases before OWNER_KEY: the account this browser last synced with. Those releases kept it after a
 * sign-out and never marked an edit made signed out, so a copy under it may hold work its account never received.
 * It is only read, by loadOwner, which takes it over.
 */
export const LEGACY_SYNCED_KEY = 'solar-dimension.synced.v1'
/** Set from a save's start until the account holds it; still present at a load means a save failed or was cut off. */
export const PENDING_KEY = 'solar-dimension.pending.v1'
/**
 * Projects that never reached their account, set aside when that account's copy left this browser: one entry per
 * account id, read back and sent when that account next signs in here. Like saved clients, another account on a
 * shared browser never sees them.
 */
export const UNSENT_KEY_PREFIX = 'solar-dimension.unsent.v1:'
const unsentKey = (owner: string): string => `${UNSENT_KEY_PREFIX}${owner}`

type Reader = Pick<Storage, 'getItem'>
type Writer = Pick<Storage, 'setItem'>
type Remover = Pick<Storage, 'removeItem'>

function browserStorage(): Storage | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
}

export function loadStore(storage: Reader | null = browserStorage()): Store | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = StoreSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function saveStore(store: Store, storage: Writer | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Private mode or blocked storage: the in-memory store keeps working.
  }
}

export function hasPendingSave(storage: Reader | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    return storage.getItem(PENDING_KEY) === '1'
  } catch {
    return false
  }
}

export function markPendingSave(storage: Writer | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(PENDING_KEY, '1')
  } catch {
    // Without storage an interrupted save cannot be recovered, but nothing else breaks.
  }
}

export function clearPendingSave(storage: Remover | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(PENDING_KEY)
  } catch {
    // ignore
  }
}

/**
 * The account this browser's projects belong to, or null for work done signed out. A marker left by an earlier
 * release is taken over on the way: the copy becomes that account's with all of it still to send, since nothing says
 * which of it the account has.
 */
export function loadOwner(storage: (Reader & Writer & Remover) | null = browserStorage()): string | null {
  if (!storage) return null
  try {
    const owner = storage.getItem(OWNER_KEY)
    if (owner) return owner
    const legacy = storage.getItem(LEGACY_SYNCED_KEY)
    if (!legacy) return null
    takeOverLegacyMarker(legacy, storage)
    return legacy
  } catch {
    return null
  }
}

function takeOverLegacyMarker(legacy: string, storage: Writer & Remover): void {
  try {
    storage.setItem(OWNER_KEY, legacy)
    storage.setItem(PENDING_KEY, '1')
    storage.removeItem(LEGACY_SYNCED_KEY)
  } catch {
    // Storage that is full refuses the write. The marker is still there and still names the copy's account, so the
    // copy never reads as work done signed out; which of it is unsent can no longer be recorded.
  }
}

/** Marks this browser's projects as `owner`'s, from the moment that account signs in or edits them. */
export function saveOwner(owner: string, storage: Writer | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(OWNER_KEY, owner)
  } catch {
    // Without the marker the copy reads as work done signed out, as it did before the account signed in.
  }
}

/** Adds the account's projects to what is already set aside for it, the newer copy of each. Nothing when the account has them all. */
function setAsideUnsent(owner: string, storage: Reader & Writer): void {
  const raw = storage.getItem(STORAGE_KEY)
  if (!raw || storage.getItem(PENDING_KEY) !== '1') return
  const current = StoreSchema.safeParse(JSON.parse(raw))
  const earlier = loadUnsent(owner, storage)
  // A copy the schema no longer reads is kept as it is, unless that would replace one it does read.
  if (!current.success) return earlier.length ? undefined : storage.setItem(unsentKey(owner), raw)
  storage.setItem(unsentKey(owner), JSON.stringify({ ...current.data, projects: newestById([...earlier, ...current.data.projects]) }))
}

/**
 * Takes an account's projects off this browser: at sign-out, and when a page loads without that account's session.
 * If some of them never reached the account they are set aside for its next sign-in here; they are on no screen
 * meanwhile. Work done signed out belongs to no account and is left alone.
 *
 * The removal does not wait on the setting aside: if storage is full, what was unsent is lost and the projects still
 * leave. The caller must not read the projects back afterwards either way, since blocked storage can refuse a removal.
 * Projects that storage would not let go keep their owner's marker, so the next page load takes them off the screen
 * again instead of showing them as work done signed out.
 */
export function releaseAccountCopy(storage: (Reader & Writer & Remover) | null = browserStorage()): void {
  if (!storage) return
  const owner = loadOwner(storage)
  if (!owner) return
  try {
    setAsideUnsent(owner, storage)
  } catch (error) {
    console.error('[projects] unsent projects could not be set aside and are lost', { error })
  }
  if (!isRemoved(STORAGE_KEY, storage)) return
  for (const key of [OWNER_KEY, PENDING_KEY, LEGACY_SYNCED_KEY]) isRemoved(key, storage)
}

/** Removes `key` and says whether it is gone: blocked storage can refuse a removal. */
function isRemoved(key: string, storage: Reader & Remover): boolean {
  try {
    storage.removeItem(key)
    return storage.getItem(key) === null
  } catch {
    return false
  }
}

/** The projects set aside for `owner` by releaseAccountCopy, or none. */
export function loadUnsent(owner: string, storage: Reader | null = browserStorage()): Project[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(unsentKey(owner))
    if (!raw) return []
    const parsed = StoreSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.projects : []
  } catch {
    return []
  }
}

/**
 * Once the account holds them. An entry that cannot be read was never sent, so it is not the account's yet: it stays
 * where setAsideUnsent kept it, for a release that can read it.
 */
export function clearUnsent(owner: string, storage: (Reader & Remover) | null = browserStorage()): void {
  if (!storage) return
  try {
    const raw = storage.getItem(unsentKey(owner))
    if (raw === null || !StoreSchema.safeParse(JSON.parse(raw)).success) return
    storage.removeItem(unsentKey(owner))
  } catch {
    // ignore
  }
}

/**
 * The single requester the previous release remembered ("use these details in my other projects"), with its owner. It is
 * only read now, as that owner's first saved client, and retired the first time their list is written.
 */
export const REQUESTER_KEY = 'solar-dimension.requester.v1'
const LEGACY_CLIENT_ID = 'remembered'

const RememberedSchema = z.object({ owner: z.string().nullable(), requester: RequesterSchema })

function loadRemembered(storage: Reader, owner: string | null): Requester | null {
  const raw = storage.getItem(REQUESTER_KEY)
  if (!raw) return null
  const parsed = RememberedSchema.safeParse(JSON.parse(raw))
  return parsed.success && parsed.data.owner === owner ? parsed.data.requester : null
}

/**
 * Saved clients, in this browser only, one list per owner (an account id, or `guest` signed out) so another account on a
 * shared browser never sees them.
 */
export const CLIENTS_KEY_PREFIX = 'solar-dimension.clients.v1:'
const clientsKey = (owner: string | null): string => `${CLIENTS_KEY_PREFIX}${owner ?? 'guest'}`

export function loadSavedClients(owner: string | null, storage: Reader | null = browserStorage()): SavedClient[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(clientsKey(owner))
    if (raw === null) {
      const remembered = loadRemembered(storage, owner)
      return remembered ? [{ id: LEGACY_CLIENT_ID, requester: remembered, usedAt: 0 }] : []
    }
    const entries: unknown = JSON.parse(raw)
    if (!Array.isArray(entries)) return []
    // Entry by entry, so one client that no longer validates never takes the others with it.
    const valid = entries.flatMap((entry) => {
      const parsed = SavedClientSchema.safeParse(entry)
      return parsed.success ? [parsed.data] : []
    })
    return byRecent(valid)
  } catch {
    return []
  }
}

export function saveSavedClients(owner: string | null, clients: readonly SavedClient[], storage: (Reader & Writer & Remover) | null = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(clientsKey(owner), JSON.stringify(clients))
    if (loadRemembered(storage, owner)) storage.removeItem(REQUESTER_KEY)
  } catch {
    // Blocked storage: the project still keeps its own copy of the requester.
  }
}

/** The one unsaved requester form, kept until Save, Start over, Back or Delete. */
export const DRAFT_KEY = 'solar-dimension.requester-draft.v1'

export function loadRequesterDraft(storage: Reader | null = browserStorage()): StoredDraft | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = StoredDraftSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** True once the draft is stored. Blocked or full storage returns false, and the form then doesn't claim it was saved. */
export function saveRequesterDraft(draft: StoredDraft, storage: Writer | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

/** Removes the kept draft only when it is this form's; one written by another form (another tab, say) stays. */
export function clearRequesterDraft(slot: DraftSlot, storage: (Reader & Remover) | null = browserStorage()): void {
  if (!storage) return
  try {
    const stored = loadRequesterDraft(storage)
    if (stored && isSameSlot(stored, slot)) storage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}
