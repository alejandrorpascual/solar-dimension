/** The only names CI makes databases under: one per run and attempt, so runs that share the test branch never meet. */
const RUN_DATABASE = /^ci_fresh_\d+_\d+$/

/** An empty database next to the test branch's own, for one CI run: scripts/fresh-database.ts makes it and drops it. */
export type FreshDatabase = {
  name: string
  /** `DATABASE_URL` with the database swapped for this one: same server, user, password and options. */
  url: string
  createSql: string
  dropSql: string
}

/**
 * The statements and the URL for the database `name` on the server `testBranchUrl` points at. Throws for a name that
 * is not a run's own (`ci_fresh_<run id>_<attempt>`), which is what keeps this from creating or dropping `neondb`, or
 * from putting anything but a name between the quotes of a statement. The name is the only text made into SQL.
 */
export function freshDatabase(name: string | undefined, testBranchUrl: string | undefined): FreshDatabase {
  if (name === undefined || !RUN_DATABASE.test(name)) {
    throw new Error(`FRESH_DATABASE must be ci_fresh_<run id>_<attempt>, and is ${JSON.stringify(name)}.`)
  }
  return {
    name,
    url: urlOfDatabase(testBranchUrl, name),
    createSql: `CREATE DATABASE "${name}"`,
    // FORCE (Postgres 13+) ends connections still open to it: a pooled one can outlive the migration that used it.
    dropSql: `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`,
  }
}

function urlOfDatabase(url: string | undefined, name: string): string {
  try {
    const fresh = new URL(url ?? '')
    fresh.pathname = `/${name}`
    return fresh.href
  } catch {
    // Not the URL: it may hold a password.
    throw new Error('DATABASE_URL is missing or is not a URL.')
  }
}
