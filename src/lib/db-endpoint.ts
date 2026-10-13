/** Neon endpoint of the production database (an id, not a credential). No test run may use it, and a server on it says so. */
export const PRODUCTION_DB_ENDPOINT = 'ep-round-sea-auutoq9o'
/**
 * The variable that vouches for a test database. The e2e guard sets it to the endpoint it has checked: not production,
 * and outside CI also declared in .env.test.local and not .env.local's. Nothing else in the repo sets it and it is
 * never set by hand. A server calls its database a test one only when it is on that endpoint.
 */
export const TEST_DB_ENDPOINT_ENV = 'TEST_DB_ENDPOINT'

/**
 * The first label of the URL's host, without `-pooler`: for a Neon URL, its endpoint id ("ep-…"), which the pooled and
 * direct hosts share. The host is read as the driver reads it before it dials, as an http host: lower-cased, with `%65`
 * decoded and look-alike letters mapped to the plain ones. A `postgresql:` URL keeps all of those as written, and a
 * guard that read it so would not know a database the driver still reaches.
 */
export function endpointOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    // Without a host there is no endpoint, and as http the path would be taken for one (`postgresql:///neondb`).
    if (!new URL(url).hostname) return undefined
    const dialedHost = new URL(`http${url.slice(url.indexOf(':'))}`).hostname
    return dialedHost.split('.')[0].replace(/-pooler$/, '') || undefined
  } catch {
    return undefined
  }
}

export type DatabaseEnvironment = 'production' | 'test' | 'unknown'
/** The database a URL writes to, with nothing of the URL but that first host label, so it is safe to show. */
export type DatabaseTarget = { endpoint: string; environment: DatabaseEnvironment }

/**
 * `production` for the known production endpoint, `test` only for the endpoint that was vouched for, `unknown` for any
 * other: a database nobody checked is never called safe. If PRODUCTION_DB_ENDPOINT goes stale, a server on production
 * that nobody vouched for reads `unknown`, not `test`. Undefined when the URL is missing or can't be read: the caller
 * must not guess a database.
 */
export function databaseTarget(url: string | undefined, vouchedTestEndpoint: string | undefined): DatabaseTarget | undefined {
  const endpoint = endpointOf(url)
  if (!endpoint) return undefined
  if (endpoint === PRODUCTION_DB_ENDPOINT) return { endpoint, environment: 'production' }
  return { endpoint, environment: endpoint === vouchedTestEndpoint ? 'test' : 'unknown' }
}
