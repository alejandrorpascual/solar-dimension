/**
 * An error whose message was written for whoever made the call ("Not found", a form's refusal): it reaches the browser
 * as it is. Anything else a server function throws is replaced on its way out (src/server/error-guard.ts), so what a
 * library says about a failure (a query and its parameters, a path, the name of a missing key) stays in the server log.
 */
export class PublicError extends Error {}

const UNEXPECTED = /^Server error \(ref ([0-9a-f]{8})\)$/

/** What the browser gets in place of an unexpected server error: nothing of it but the reference of its log line. */
export const unexpectedServerError = (ref: string): Error => new Error(`Server error (ref ${ref})`)

/**
 * The reference of an unexpected server error, or null for any other error (one of the page's own, or one written for
 * the caller). Read from the message, which is all of an error that crosses to the browser.
 */
export function serverErrorRef(error: unknown): string | null {
  return error instanceof Error ? (UNEXPECTED.exec(error.message)?.[1] ?? null) : null
}
