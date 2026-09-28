import { bearerToken, failureThrottle, isApiEnabled, tokenMatches } from '../lib/api-token'
import { setRetired } from './catalog-repo'

const FAILURE_LIMIT = 10
const FAILURE_WINDOW_MS = 10 * 60_000
const throttle = failureThrottle({ limit: FAILURE_LIMIT, windowMs: FAILURE_WINDOW_MS })

export const API_ACTOR = 'api-token'
export const json = (body: unknown, status = 200): Response => Response.json(body, { status })

// Defense-in-depth behind a >=32-char token; relies on the host (Vercel) setting x-real-ip / x-forwarded-for.
const clientIp = (request: Request) =>
  request.headers.get('x-real-ip')?.trim() || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

/** Null when the request may proceed; otherwise the response to send. Unconfigured = the API does not exist. */
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
  return null
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
