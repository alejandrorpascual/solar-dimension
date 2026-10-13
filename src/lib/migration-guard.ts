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
 * - The production database is migrated by the production build only (VERCEL_ENV=production, which Vercel sets).
 * - A Preview build on the production database skips its migrations and goes on: the preview then runs on a schema
 *   without them, and production gets them when the branch is merged.
 * - Anywhere else (a laptop, CI, `vercel dev`) the production database is refused, and so is a DATABASE_URL that is
 *   missing or unreadable, in production too: a build must not ship without its migrations.
 * - Any other database is migrated.
 *
 * VERCEL_ENV must be the build's own: the caller reads it before loading any env file, since the file that holds the
 * production URL could otherwise also supply the word that allows migrating it.
 */
export function migrationPlan(env: MigrationEnv): MigrationPlan {
  const url = env.DATABASE_URL
  const endpoint = endpointOf(url)
  if (!url || !endpoint) return { action: 'refuse', reason: 'DATABASE_URL is missing or is not a URL.' }
  // Also a URL that names the endpoint anywhere else (Neon reads it from `options=endpoint=…` behind a proxy host).
  const isProduction = endpoint === PRODUCTION_DB_ENDPOINT || url.toLowerCase().includes(PRODUCTION_DB_ENDPOINT)
  if (!isProduction || env.VERCEL_ENV === 'production') return { action: 'migrate', endpoint }
  if (env.VERCEL_ENV === 'preview') {
    return {
      action: 'skip',
      endpoint,
      reason: `this Preview build was given the production database (${PRODUCTION_DB_ENDPOINT}). Its migrations are not applied: production gets them when the branch is merged. Give Preview a database of its own to have them applied here.`,
    }
  }
  return {
    action: 'refuse',
    reason: `DATABASE_URL is the production database (${PRODUCTION_DB_ENDPOINT}), which only its own Vercel build migrates, and this is not it (VERCEL_ENV is ${env.VERCEL_ENV ? `"${env.VERCEL_ENV}"` : 'not set'}). For another database: DATABASE_URL=<its url> npm run db:migrate`,
  }
}
