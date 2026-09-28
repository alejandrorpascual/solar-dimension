import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_TOKEN_LENGTH = 32
const digest = (s: string) => createHash('sha256').update(s).digest()

export const isApiEnabled = (expected: string | undefined): boolean => !!expected && expected.length >= MIN_TOKEN_LENGTH

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? '')
  return match ? match[1]!.trim() : null
}

/** Compares fixed-length digests so the check takes the same time whatever the input. */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !isApiEnabled(expected)) return false
  return timingSafeEqual(digest(given), digest(expected!))
}

const MAX_TRACKED_KEYS = 10_000

export function failureThrottle(opts: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }) {
  const now = opts.now ?? Date.now
  const maxKeys = opts.maxKeys ?? MAX_TRACKED_KEYS
  let hits = new Map<string, readonly number[]>()
  const recent = (key: string) => (hits.get(key) ?? []).filter((t) => now() - t < opts.windowMs)
  return {
    isBlocked: (key: string): boolean => recent(key).length >= opts.limit,
    // Only this key is trimmed; stale keys are harmless (isBlocked filters by time) and the cap bounds memory,
    // so a failure never has to scan every tracked key.
    recordFailure: (key: string): void => {
      const next = new Map(hits)
      next.delete(key)
      if (next.size >= maxKeys) next.delete(next.keys().next().value!)
      hits = next.set(key, [...recent(key), now()])
    },
  }
}
