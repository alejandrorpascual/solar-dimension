import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, expect, test } from 'vitest'
import { PRODUCTION_DB_ENDPOINT } from './db-endpoint'
import { migrationPlan } from './migration-guard'

const BRANCH_ENDPOINT = 'ep-made-up-branch-12345678'
// `.invalid` never resolves: if a guard ever let one of these through, nothing could be reached.
const urlOf = (endpoint: string) => `postgresql://owner:not-a-real-password@${endpoint}-pooler.db.invalid/neondb?sslmode=require`
const PRODUCTION_URL = urlOf(PRODUCTION_DB_ENDPOINT)
const BRANCH_URL = urlOf(BRANCH_ENDPOINT)

test('the production build migrates the production database', () => {
  const plan = migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'production' })

  expect(plan).toEqual({ action: 'migrate', endpoint: PRODUCTION_DB_ENDPOINT })
})

test('a preview build on the production database skips its migrations and says which database it was', () => {
  const plan = migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'preview' })

  expect(plan.action).toBe('skip')
  expect(plan).toMatchObject({ endpoint: PRODUCTION_DB_ENDPOINT })
})

test('a preview build on a database of its own migrates it', () => {
  const plan = migrationPlan({ DATABASE_URL: BRANCH_URL, VERCEL_ENV: 'preview' })

  expect(plan).toEqual({ action: 'migrate', endpoint: BRANCH_ENDPOINT })
})

test.each([
  ['a laptop or CI, where VERCEL_ENV is not set', undefined],
  ['`vercel dev`', 'development'],
  ['an empty VERCEL_ENV', ''],
  ['a VERCEL_ENV in another case', 'Production'],
])('refuses the production database from %s', (_where, vercelEnv) => {
  const plan = migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: vercelEnv })

  expect(plan.action).toBe('refuse')
})

test('migrates any other database from a laptop or CI', () => {
  const plan = migrationPlan({ DATABASE_URL: BRANCH_URL })

  expect(plan).toEqual({ action: 'migrate', endpoint: BRANCH_ENDPOINT })
})

test('the direct host of the production database is refused like the pooled one', () => {
  const direct = PRODUCTION_URL.replace('-pooler', '')

  expect(migrationPlan({ DATABASE_URL: direct }).action).toBe('refuse')
  expect(migrationPlan({ DATABASE_URL: direct, VERCEL_ENV: 'preview' }).action).toBe('skip')
})

test.each([
  ['missing', undefined],
  ['empty', ''],
  ['not a URL', 'neondb'],
])('refuses a DATABASE_URL that is %s, in production too, so a build never ships without its migrations', (_what, url) => {
  expect(migrationPlan({ DATABASE_URL: url }).action).toBe('refuse')
  expect(migrationPlan({ DATABASE_URL: url, VERCEL_ENV: 'production' }).action).toBe('refuse')
})

test('a URL that names the production endpoint behind another host is production too', () => {
  const proxied = `postgresql://owner:not-a-real-password@proxy.db.invalid/neondb?options=endpoint%3D${PRODUCTION_DB_ENDPOINT}`

  expect(migrationPlan({ DATABASE_URL: proxied }).action).toBe('refuse')
  expect(migrationPlan({ DATABASE_URL: proxied, VERCEL_ENV: 'preview' }).action).toBe('skip')
  expect(migrationPlan({ DATABASE_URL: proxied.toUpperCase().replace('POSTGRESQL', 'postgresql'), VERCEL_ENV: 'preview' }).action).toBe('skip')
})

test('a refusal says what VERCEL_ENV was, so a production build that was refused can be told from its log', () => {
  expect(migrationPlan({ DATABASE_URL: PRODUCTION_URL })).toMatchObject({ reason: expect.stringContaining('VERCEL_ENV is not set') })
  expect(migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'development' })).toMatchObject({ reason: expect.stringContaining('VERCEL_ENV is "development"') })
})

test('no message carries the password', () => {
  const plans = [
    migrationPlan({ DATABASE_URL: PRODUCTION_URL }),
    migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'preview' }),
    migrationPlan({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'production' }),
  ]

  expect(JSON.stringify(plans)).not.toContain('not-a-real-password')
})

// The script is what the Vercel build and CI run (`npm run db:migrate`): its exit code is the guard. It runs in an empty
// folder: no .env.local of the developer's is read, and a guard that let a run through would stop at once on the
// missing drizzle-kit instead of reaching for a database.
const SCRIPT = resolve('scripts/migrate.ts')
const emptyFolders: string[] = []
afterAll(() => { for (const folder of emptyFolders) rmSync(folder, { recursive: true, force: true }) })

function runMigrateScript(env: Record<string, string>, envFile?: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'migrate-guard-'))
  emptyFolders.push(cwd)
  if (envFile !== undefined) writeFileSync(join(cwd, '.env.local'), envFile)
  return spawnSync(process.execPath, [SCRIPT], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
}
const reasonOf = (env: Parameters<typeof migrationPlan>[0]): string => {
  const plan = migrationPlan(env)
  if (plan.action === 'migrate') throw new Error('this plan has no reason: it migrates')
  return plan.reason
}

test('the migrate script fails, and goes no further, for the production database outside its own build', () => {
  const run = runMigrateScript({ DATABASE_URL: PRODUCTION_URL })

  expect(run.status).toBe(1)
  expect(run.stderr).toContain(`db:migrate refused: ${reasonOf({ DATABASE_URL: PRODUCTION_URL })}`)
  // "migrating <endpoint>" and everything drizzle-kit prints go to stdout: none of it may be there.
  expect(run.stdout).toBe('')
  expect(run.stderr).not.toContain('not-a-real-password')
})

test('the migrate script lets a preview build on the production database go on, and goes no further itself', () => {
  const env = { DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'preview' }

  const run = runMigrateScript(env)

  expect(run.status).toBe(0)
  expect(run.stderr).toContain(`db:migrate skipped: ${reasonOf(env)}`)
  expect(run.stdout).toBe('')
  expect(run.stderr).not.toContain('not-a-real-password')
})

test('an env file cannot say this is the production build: only the build\'s own environment can', () => {
  const run = runMigrateScript({}, `DATABASE_URL="${PRODUCTION_URL}"\nVERCEL_ENV="production"\n`)

  expect(run.status).toBe(1)
  expect(run.stderr).toContain('db:migrate refused: DATABASE_URL is the production database')
  expect(run.stdout).toBe('')
})

test('the production build\'s own VERCEL_ENV gets past the guard, to the migration itself', () => {
  const run = runMigrateScript({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'production' })

  // In the empty folder there is nothing to migrate with, so the run stops there; what matters is that it was not refused.
  expect(run.stderr).not.toContain('refused')
  expect(run.stdout).toContain(`db:migrate: migrating ${PRODUCTION_DB_ENDPOINT}`)
  expect(run.status).not.toBe(0)
})
