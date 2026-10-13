import { createMiddleware, createStart } from '@tanstack/react-start'
import { errorForCaller } from './server/error-guard'

/**
 * Around every server function. Whatever one throws that was not written for its caller is logged here, with the
 * reference the caller is given in its place (errorForCaller), so a report that quotes the reference leads to this line.
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
