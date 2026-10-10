import { dbTarget } from '../db/client'
import { bearerToken, failureThrottle, isApiEnabled, tokenMatches } from '../lib/api-token'
import { setRetired } from './catalog-repo'

const FAILURE_LIMIT = 10
const FAILURE_WINDOW_MS = 10 * 60_000
const throttle = failureThrottle({ limit: FAILURE_LIMIT, windowMs: FAILURE_WINDOW_MS })

export const API_ACTOR = 'api-token'
/** A request may name the database it means to reach (an endpoint id from /api/catalog/database) in this header. */
export const EXPECT_DATABASE_HEADER = 'x-expect-database'
export const json = (body: unknown, status = 200): Response => Response.json(body, { status })

// Defense-in-depth behind a >=32-char token; relies on the host (Vercel) setting x-real-ip / x-forwarded-for.
const clientIp = (request: Request) =>
  request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

/**
 * Null when the request may proceed; otherwise the response to send. Unconfigured = the API does not exist.
 * A request that names a database is refused unless this server writes to it: the server on a port can change between
 * the question "which database?" and the write the user agreed to.
 */
export function authorize(request: Request): Response | null {
  const expected = process.env.CATALOG_API_TOKEN
  if (!isApiEnabled(expected)) return json({ error: 'Not found' }, 404)
  const ip = clientIp(request)
  if (throttle.isBlocked(ip)) return json({ error: 'Too many failed attempts; try again later' }, 429)
  if (!tokenMatches(bearerToken(request.headers.get('authorization')), expected)) {
    throttle.recordFailure(ip)
    console.warn('[catalog-api] rejected a request with a missing or wrong token', { ip, path: new URL(request.url).pathname })
    return json({ error: 'Unauthorized' }, 401)
  }
  const expectedDatabase = request.headers.get(EXPECT_DATABASE_HEADER)
  if (expectedDatabase !== null && expectedDatabase !== dbTarget?.endpoint) {
    return json({ error: 'This server writes to another database than the request expects; nothing was written', database: dbTarget ?? null }, 412)
  }
  return null
}

/** Tells a token holder which database this server writes to, so the research skills never confirm a write blind. */
export function databaseHandler({ request }: { request: Request }): Response {
  const denied = authorize(request)
  if (denied) return denied
  if (!dbTarget) {
    console.error('[catalog-api] DATABASE_URL has no readable host, so the database cannot be named')
    return json({ error: 'Could not tell which database this server uses' }, 500)
  }
  return json(dbTarget)
}

export function retiredHandler(retired: boolean) {
  return async ({ request, params }: { request: Request; params: { id: string } }): Promise<Response> => {
    const denied = authorize(request)
    if (denied) return denied
    const { id } = params
    try {
      return (await setRetired(id, retired, API_ACTOR)) ? json({ id, retired }) : json({ error: 'Not found' }, 404)
    } catch (error) {
      console.error('[catalog-api] retire/restore failed', { id, retired, error })
      return json({ error: 'Could not update the appliance' }, 500)
    }
  }
}
