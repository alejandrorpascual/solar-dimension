import type { QuoteModel } from './model'
import type { QuoteStorage } from './storage'

/** Builds the value on first use and keeps it. A build that throws keeps nothing, so the next call tries again. */
function once<T>(build: () => T): () => T {
  let value: T | undefined
  return () => (value ??= build())
}

/**
 * Storage built inside each (async) call, so a missing setting rejects that call instead of throwing synchronously:
 * callers already handle a rejected put, get or remove.
 */
export function lazyStorage(build: () => QuoteStorage): QuoteStorage {
  const storage = once(build)
  return {
    put: async (pathname, bytes, contentType) => storage().put(pathname, bytes, contentType),
    get: async (pathname) => storage().get(pathname),
    remove: async (pathnames) => storage().remove(pathnames),
  }
}

/** A model built on the first extraction, so a missing key fails the claimed job (which can be retried), not the request. */
export function lazyModel(build: () => QuoteModel): QuoteModel {
  const model = once(build)
  return { extract: async (input, name) => model().extract(input, name) }
}
