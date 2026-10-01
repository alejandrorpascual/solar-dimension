import { waitUntil } from '@vercel/functions'
import { defaultDeps } from './deps'
import { processQuote } from './process'

/**
 * Starts reading each quote after the response is sent. A failed run leaves the job for the next re-kick. Everything
 * runs inside the promise, so nothing here can throw into the request that kicked it.
 */
export function kickQuotes(ids: readonly string[]): void {
  for (const id of ids) {
    waitUntil(Promise.resolve()
      .then(() => processQuote(id, defaultDeps()))
      .catch((error) => console.error('[quotes] processing failed', { id, error })))
  }
}
