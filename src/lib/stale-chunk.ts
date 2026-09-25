/**
 * Recovery for a page whose JavaScript chunks are gone: a tab opened before a deploy asks for chunk names the new
 * deploy does not have. Reloading fetches the new page and its chunks, so the reader never sees the error screen.
 */

/** Long enough to cover a reload and hydration; short enough that a later deploy in the same tab can recover too. */
export const RELOAD_GUARD_MS = 10_000
const RELOADED_AT_KEY = 'solar-dimension.chunk-reload-at.v1'

/** Each browser words a failed dynamic import differently; Vite adds its own for a stylesheet it could not preload. */
const CHUNK_LOAD_MESSAGES = [
  /Importing a module script failed/i, // Safari
  /Failed to fetch dynamically imported module/i, // Chrome, Edge
  /error loading dynamically imported module/i, // Firefox
  /Unable to preload CSS/i, // Vite
]

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_MESSAGES.some((re) => re.test(error.message))
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function browserSession(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/**
 * True when the page should reload to pick up the current deploy, and records that it did. A second chunk failure
 * inside the guard window means reloading did not help, so the error screen stays; without storage there is no
 * guard at all, so it never reloads.
 */
export function shouldReloadForStaleChunk(error: unknown, storage: Store | null = browserSession(), now = Date.now()): boolean {
  if (!storage || !isChunkLoadError(error)) return false
  try {
    const last = storage.getItem(RELOADED_AT_KEY)
    if (last !== null && now - Number(last) < RELOAD_GUARD_MS) return false
    storage.setItem(RELOADED_AT_KEY, String(now))
    return true
  } catch {
    return false
  }
}
