import { HTTPError, type H3Event } from 'nitro/h3'

/** Non-standard status nginx uses for "the client closed the connection before we answered". */
export const CLIENT_CLOSED_REQUEST = 499
const CLIENT_CLOSED_REQUEST_TEXT = 'Client Closed Request'

/** Cause chains are short in practice; the bound only guards against a self-referential `cause`. */
const MAX_CAUSE_DEPTH = 8

const clientClosedRequest = () => new HTTPError({ status: CLIENT_CLOSED_REQUEST, statusText: CLIENT_CLOSED_REQUEST_TEXT })

const isClientClosedRequest = (error: Error) => HTTPError.isError(error) && error.status === CLIENT_CLOSED_REQUEST

/**
 * A request abort can arrive bare (the `DOMException` srvx puts on `request.signal` when the socket closes), wrapped
 * (e.g. `TypeError: fetch failed` around it when the neon HTTP driver's fetch is cancelled), or as the 499 reason
 * that {@link answerWhenClientGone} relays.
 */
export function isClientAbort(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return false
    if (current.name === 'AbortError' || isClientClosedRequest(current)) return true
    current = current.cause
  }
  return false
}

/**
 * Gives the request a signal whose abort reason is a 499 `HTTPError` instead of the platform's `AbortError`.
 *
 * TanStack Start rethrows `request.signal.reason` verbatim whenever the client disconnects mid-request, no matter what
 * the route or any request middleware returned, and then hands it to h3's `toResponse` with no way to configure it
 * (TanStack/router#7991). h3 only checks the error's name: an `AbortError` becomes an unhandled 500 that is logged,
 * an `HTTPError` becomes a quiet response with its own status. Choosing the reason here, before Start reads the
 * signal, is the one lever an app has.
 *
 * This deliberately redefines `signal` on the incoming request rather than building a new `Request`: srvx's request
 * is not a native `Request`, so it cannot be cloned, and cloning would also drop the runtime fields it carries.
 */
export function answerWhenClientGone(request: Request): void {
  const relayed = new AbortController()
  const relay = () => relayed.abort(clientClosedRequest())
  if (request.signal.aborted) relay()
  else request.signal.addEventListener('abort', relay, { once: true })
  Object.defineProperty(request, 'signal', { get: () => relayed.signal, configurable: true })
}

/**
 * Global Nitro (h3) middleware that turns a client disconnect into a quiet, empty 499.
 *
 * Before the route runs it relays the request signal (see {@link answerWhenClientGone}), which is what keeps TanStack
 * Start's own handler from logging the disconnect as an unhandled 500. The catch is the backstop for any abort that
 * still escapes to Nitro; anything that is not an abort is rethrown untouched so the normal error logging applies.
 */
export default async function clientAbort(event: H3Event, next: () => unknown): Promise<unknown> {
  answerWhenClientGone(event.req)
  try {
    return await next()
  } catch (error) {
    if (!isClientAbort(error)) throw error
    return new Response(null, { status: CLIENT_CLOSED_REQUEST, statusText: CLIENT_CLOSED_REQUEST_TEXT })
  }
}
