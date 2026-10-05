import { z } from 'zod'
import { RequesterSchema, type Requester } from './requester'
import { StoredDraftSchema, isSameSlot, type DraftSlot, type StoredDraft } from './requester-draft'
import { SavedClientSchema, byRecent, type SavedClient } from './saved-clients'
import { StoreSchema, type Store } from './schema'

export const STORAGE_KEY = 'solar-dimension.projects.v1'
export const SYNCED_KEY = 'solar-dimension.synced.v1'
/** Set while a save to the account is in flight; still present after a reload means the save was interrupted. */
export const PENDING_KEY = 'solar-dimension.pending.v1'

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
