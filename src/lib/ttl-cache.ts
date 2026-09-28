export interface TtlCache<T> { get(load: () => Promise<T>): Promise<T>; clear(): void }

/** One value kept for `ttlMs`. Per server instance: other instances refresh on their own clock. */
export function ttlCache<T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> {
  let entry: { value: T; at: number } | null = null
  let generation = 0
  return {
    async get(load) {
      if (entry && now() - entry.at < ttlMs) return entry.value
      const startedAtGeneration = generation
      const value = await load()
      // A clear() during this load means the value may already be stale; still return it, just don't cache it.
      if (generation === startedAtGeneration) entry = { value, at: now() }
      return value
    },
    clear() {
      generation++
      entry = null
    },
  }
}

export async function withFallback<T>(load: () => Promise<T>, fallback: T, onError: (e: unknown) => void): Promise<T> {
  try {
    return await load()
  } catch (error) {
    onError(error)
    return fallback
  }
}
