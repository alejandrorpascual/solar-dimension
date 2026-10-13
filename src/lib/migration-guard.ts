// With its `.ts`: scripts/migrate.ts loads this file with plain `node`, which resolves an import only as written.
import { endpointOf, PRODUCTION_DB_ENDPOINT } from './db-endpoint.ts'

type MigrationEnv = Partial<Record<'DATABASE_URL' | 'VERCEL_ENV', string>>

/** `endpoint` is the first label of the database host and nothing else of the URL, so a plan is safe to print. */
export type MigrationPlan =
  | { action: 'migrate'; endpoint: string }
  | { action: 'skip'; endpoint: string; reason: string }
  | { action: 'refuse'; reason: string }

/**
 * Whether `npm run db:migrate` may write to the database it was given. Vercel runs it in every build, and a branch's
 * Preview build is given the production DATABASE_URL unless Preview has a database of its own, so without this a
 * migration reached production at the first push of its branch, before review and before the code that needs it.
 *
 * - The production database is migrated only where VERCEL_ENV is `production`, which Vercel sets for the production
 *   build.
 * - A Preview build on the production database skips its migrations and goes on: the preview then runs on a schema
 *   without them, and production gets them when the branch is merged.
 * - Anywhere else (a laptop, CI, `vercel dev`) the production database is refused, and so is a DATABASE_URL that is
 *   missing or unreadable, in production too: a build must not ship without its migrations.
 * - Any other database is migrated.
 *
 * The caller reads VERCEL_ENV before loading any env file, since the file that holds the production URL could
 * otherwise also supply the word that allows migrating it. The word itself is taken as given: a shell that exports
 * VERCEL_ENV=production is the production build as far as this can tell. It keeps a migration from reaching production
 * by accident; only the credentials a build is given can keep one out on purpose.
 */
export function migrationPlan(env: MigrationEnv): MigrationPlan {
  const url = env.DATABASE_URL
  const endpoint = endpointOf(url)
  if (!url || !endpoint) return { action: 'refuse', reason: 'DATABASE_URL is missing or is not a URL.' }
  // A `host` parameter is dialed in place of the URL's host, so it is read the same way.
  const dialed = [endpoint, ...new URL(url).searchParams.getAll('host').map((host) => endpointOf(`postgresql://${host}`))]
  const isDialed = dialed.includes(PRODUCTION_DB_ENDPOINT)
  // Naming the endpoint anywhere else counts too, escaped or not: Neon reads it from `options=endpoint=…` behind a
  // proxy host. That also holds back a database whose password or application name merely contains it, on purpose:
  // a migration held back by mistake says why and costs a retry, and one let through by mistake is on production.
  const isNamed = [url, unescaped(url)].some((text) => text.toLowerCase().includes(PRODUCTION_DB_ENDPOINT))
  if (!(isDialed || isNamed) || env.VERCEL_ENV === 'production') return { action: 'migrate', endpoint }
  // So that a log tells a database held back for a mention from production itself.
  const mention = isDialed ? '' : ` The URL only names that endpoint (its host is ${endpoint}), and that is treated as production too.`
  if (env.VERCEL_ENV === 'preview') {
    return {
      action: 'skip',
      endpoint,
      reason: `this Preview build was given the production database (${PRODUCTION_DB_ENDPOINT}). Its migrations are not applied: production gets them when the branch is merged. Give Preview a database of its own to have them applied here.${mention}`,
    }
  }
  return {
    action: 'refuse',
    reason: `DATABASE_URL is the production database (${PRODUCTION_DB_ENDPOINT}), which only its own Vercel build migrates, and this is not it (VERCEL_ENV is ${env.VERCEL_ENV ? `"${env.VERCEL_ENV}"` : 'not set'}).${mention} For another database: DATABASE_URL=<its url> npm run db:migrate`,
  }
}

/** Percent-escapes turned back into what they stand for, once, as whatever reads the URL next does. A stray `%` stays as written: the driver takes one so too. */
function unescaped(text: string): string {
  return text.replace(/%([0-9a-f]{2})/gi, (_escape, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
}
