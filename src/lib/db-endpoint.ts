/** Neon endpoint of the production database (an id, not a credential). No test run may ever use it. */
export const PRODUCTION_DB_ENDPOINT = 'ep-round-sea-auutoq9o'

/** Neon endpoint id ("ep-…"): the pooled and direct hosts of one database share it, in any letter case. */
export function endpointOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    // URL keeps the case of a postgres:// host as written, and a host reaches the same database in any case.
    return new URL(url).hostname.toLowerCase().split('.')[0].replace(/-pooler$/, '') || undefined
  } catch {
    return undefined
  }
}

/** The database a URL writes to, with nothing of the URL but its endpoint id, so it is safe to show. */
export type DatabaseTarget = { endpoint: string; production: boolean }

/** Undefined when the URL is missing or can't be read: the caller must not guess a database. */
export function databaseTarget(url: string | undefined): DatabaseTarget | undefined {
  const endpoint = endpointOf(url)
  return endpoint ? { endpoint, production: endpoint === PRODUCTION_DB_ENDPOINT } : undefined
}
