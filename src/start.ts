import { createMiddleware, createStart } from '@tanstack/react-start'
import { errorForCaller } from './server/error-guard'

/**
 * Around every server function. What one throws that was not written for its caller is logged here, with the reference
 * the caller is given in its place (errorForCaller), so a report that quotes the reference leads to this line.
 *
 * A falsy throw never gets here (`throw undefined`, a promise rejected with no reason, null, '', 0, false). The
 * framework rethrows what a handler threw only when it is truthy (`if (result.error) throw result.error`, in
 * createServerFn.ts of @tanstack/start-client-core 1.170), so `next()` returns and the call is taken for one that
 * succeeded: no reference and no log line. Nothing of the failure reaches the browser that way; the log misses it.
 */
const errorGuard = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  try {
    return await next()
  } catch (thrown) {
    throw errorForCaller(thrown, (ref, error) => {
      console.error('[server] a server function failed', { ref, fn: serverFnMeta.name, file: serverFnMeta.filename, error })
    })
  }
})

export const startInstance = createStart(() => ({ functionMiddleware: [errorGuard] }))
