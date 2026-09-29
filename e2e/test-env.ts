import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'dotenv'

/** The e2e database lives here (git-ignored): a Neon branch of its own, never the one dev or prod uses. */
export const TEST_ENV_FILE = '.env.test.local'
const DEV_ENV_FILE = '.env.local'

function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {}
}

/** Neon endpoint id ("ep-…"): the pooled and direct hosts of one database share it. */
function endpointOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
  } catch {
    return undefined
  }
}

/**
 * Loads the e2e environment: the shell (CI secrets) wins, then `.env.test.local`, then `.env.local` for everything
 * else (auth secret and so on). The webServer inherits it, and `node --env-file` / dotenv never override a variable
 * that is already set, so the test build talks to the test database too.
 *
 * Throws, so no test runs, when the database is not declared for tests or is the one `.env.local` points at: e2e runs
 * create users, projects and catalog rows, and they once filled the production catalog that way.
 */
export function loadTestEnv(): void {
  const testEnv = readEnvFile(TEST_ENV_FILE)
  const devEnv = readEnvFile(DEV_ENV_FILE)
  for (const [key, value] of Object.entries({ ...devEnv, ...testEnv })) process.env[key] ??= value

  const url = process.env.DATABASE_URL
  if (!url) throw new Error(`e2e needs DATABASE_URL: set it in ${TEST_ENV_FILE} (a Neon branch for tests) or, in CI, as a secret.`)
  if (!process.env.CI && !testEnv.DATABASE_URL) {
    throw new Error(`e2e refuses to run without ${TEST_ENV_FILE}: put the test branch's DATABASE_URL there, so tests never use ${DEV_ENV_FILE}'s database.`)
  }
  const endpoint = endpointOf(url)
  if (endpoint && endpoint === endpointOf(devEnv.DATABASE_URL)) {
    throw new Error(`e2e refuses to run: DATABASE_URL points at the same database as ${DEV_ENV_FILE} (${endpoint}). Use a separate Neon branch.`)
  }
}
