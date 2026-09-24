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
