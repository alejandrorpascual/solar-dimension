import { isNotFound, isRedirect } from '@tanstack/react-router'
import { PublicError, unexpectedServerError } from '../lib/server-error'

const REF_LENGTH = 8
const newRef = (): string => globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, REF_LENGTH)

/**
 * What the caller of a server function gets for something it threw. A redirect and a not-found are the router's own
 * and pass, and so does an error written for the caller (PublicError). Everything else is handed to `report` with a
 * new reference and replaced by an error that carries only that reference: a server function's error is serialized to
 * the browser, message and all, and a failed query's message is the SQL and its parameters.
 */
export function errorForCaller(thrown: unknown, report: (ref: string, thrown: unknown) => void, makeRef: () => string = newRef): unknown {
  if (isRedirect(thrown) || isNotFound(thrown) || thrown instanceof PublicError) return thrown
  const ref = makeRef()
  report(ref, thrown)
  return unexpectedServerError(ref)
}
