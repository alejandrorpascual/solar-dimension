import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, expect, test } from 'vitest'
import { PRODUCTION_DB_ENDPOINT } from './db-endpoint'
import { migrationPlan } from './migration-guard'
import { JOURNAL_FILE } from './migration-journal'

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

// The driver decodes a URL before it connects, so each of these reaches production without spelling its endpoint out.
const ESCAPED = PRODUCTION_DB_ENDPOINT.replace('e', '%65')
const LOOK_ALIKE = PRODUCTION_DB_ENDPOINT.replace('e', 'ｅ')
test.each([
  ['its host has a letter written as %65', urlOf(ESCAPED)],
  ['its host has a look-alike letter', urlOf(LOOK_ALIKE)],
  ['a host parameter names it over the host, escaped', `${BRANCH_URL}&host=${ESCAPED}-pooler.db.invalid`],
  ['a host parameter names it over the host, with a look-alike letter', `${BRANCH_URL}&host=${LOOK_ALIKE}-pooler.db.invalid`],
  ['the endpoint option behind another host is escaped', `postgresql://owner:not-a-real-password@proxy.db.invalid/neondb?options=endpoint%3D${ESCAPED}`],
])('the production database is production still when %s', (_how, url) => {
  expect(migrationPlan({ DATABASE_URL: url }).action).toBe('refuse')
  expect(migrationPlan({ DATABASE_URL: url, VERCEL_ENV: 'preview' }).action).toBe('skip')
})

test('a database whose URL only mentions the production endpoint is held back too, and the reason names its host', () => {
  const mentions = `${BRANCH_URL}&application_name=${PRODUCTION_DB_ENDPOINT}`

  const onLaptop = migrationPlan({ DATABASE_URL: mentions })
  const inPreview = migrationPlan({ DATABASE_URL: mentions, VERCEL_ENV: 'preview' })

  expect(onLaptop).toMatchObject({ action: 'refuse', reason: expect.stringContaining(`host is ${BRANCH_ENDPOINT}`) })
  expect(inPreview).toMatchObject({ action: 'skip', reason: expect.stringContaining(`host is ${BRANCH_ENDPOINT}`) })
  // Production itself gets no such note.
  expect(reasonOf({ DATABASE_URL: PRODUCTION_URL })).not.toContain('host is')
  expect(reasonOf({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'preview' })).not.toContain('host is')
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
    migrationPlan({ DATABASE_URL: `${BRANCH_URL}&application_name=${PRODUCTION_DB_ENDPOINT}` }),
    migrationPlan({ DATABASE_URL: `${BRANCH_URL}&application_name=${PRODUCTION_DB_ENDPOINT}`, VERCEL_ENV: 'preview' }),
  ]

  expect(JSON.stringify(plans)).not.toContain('not-a-real-password')
})

// The script is what the Vercel build and CI run (`npm run db:migrate`): its exit code is the guard. It runs in an empty
// folder: no .env.local of the developer's is read, and a guard that let a run through would stop at once on the
// missing journal instead of reaching for a database. A test that goes further gives the folder a journal and a
// stand-in drizzle-kit; that run ends at the database, which is at `.invalid` and answers nobody, unless the test
// gives the folder a stand-in for the database too.
const SCRIPT = resolve('scripts/migrate.ts')
const emptyFolders: string[] = []
afterAll(() => { for (const folder of emptyFolders) rmSync(folder, { recursive: true, force: true }) })

type ScriptSetup = { envFile?: string; drizzleKit?: string; journal?: unknown; database?: string; args?: string[] }

function runMigrateScript(env: Record<string, string>, setup: ScriptSetup = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'migrate-guard-'))
  emptyFolders.push(cwd)
  if (setup.envFile !== undefined) writeFileSync(join(cwd, '.env.local'), setup.envFile)
  if (setup.drizzleKit !== undefined) {
    mkdirSync(join(cwd, 'node_modules/drizzle-kit'), { recursive: true })
    writeFileSync(join(cwd, 'node_modules/drizzle-kit/bin.cjs'), setup.drizzleKit)
  }
  if (setup.journal !== undefined) {
    mkdirSync(join(cwd, dirname(JOURNAL_FILE)), { recursive: true })
    writeFileSync(join(cwd, JOURNAL_FILE), JSON.stringify(setup.journal))
  }
  if (setup.database !== undefined) writeFileSync(join(cwd, STAND_IN_DATABASE_FILE), setup.database)
  // Loaded into the script's own process before the script, which is where the driver finds its `fetch`.
  const standIn = setup.database === undefined ? [] : ['--import', pathToFileURL(join(cwd, STAND_IN_DATABASE_FILE)).href]
  return spawnSync(process.execPath, [...standIn, SCRIPT, ...(setup.args ?? [])], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
}
// A stand-in for drizzle-kit, put where the script looks for it: it says what it was asked to do and ends as told.
// The script reads the journal before it starts drizzle-kit, so a folder with the stand-in gets a journal too.
const journalOf = (...entries: [when: number, tag: string][]) => ({ entries: entries.map(([when, tag], idx) => ({ idx, when, tag })) })
const FIRST_STAMP = 1_791_586_271_729
const ONE_MIGRATION = journalOf([FIRST_STAMP, '0000_first'])
const EARLIER_STAMP = 1_791_650_000_000
const LATER_STAMP = 1_791_700_000_000
const TWO_MIGRATIONS = journalOf([EARLIER_STAMP, '0000_generated_earlier'], [LATER_STAMP, '0001_generated_later'])
const standInDrizzleKit = (ending: string) => `console.log('stand-in drizzle-kit: ' + process.argv.slice(2).join(' '))\n${ending}\n`

// A stand-in for the database, put where the driver looks for it: the `fetch` it sends its one query with. It gives
// every request the same answer, worded as Neon's HTTP endpoint words it; e2e/migration-check.spec.ts asks a real one.
const STAND_IN_DATABASE_FILE = 'stand-in-database.mjs'
/** Postgres's number for the type of `created_at`, a bigint, which the driver hands over as text. */
const BIGINT_TYPE_ID = 20
const standInDatabase = (status: number, reply: unknown) =>
  `globalThis.fetch = async () => new Response(${JSON.stringify(JSON.stringify(reply))}, { status: ${status} })\n`
const databaseWithRows = (...stamps: (number | null)[]) => standInDatabase(200, {
  fields: [{ name: 'created_at', dataTypeID: BIGINT_TYPE_ID }],
  rows: stamps.map((stamp) => [stamp === null ? null : String(stamp)]),
  command: 'SELECT',
  rowCount: stamps.length,
  rowAsArray: true,
})
const DATABASE_NEVER_MIGRATED = standInDatabase(400, { message: 'relation "drizzle.__drizzle_migrations" does not exist', code: '42P01' })
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

test('the migrate script refuses the production database written so that only the driver would know it', () => {
  const run = runMigrateScript({ DATABASE_URL: urlOf(ESCAPED) })

  expect(run.status).toBe(1)
  expect(run.stderr).toContain('db:migrate refused: DATABASE_URL is the production database')
  expect(run.stdout).toBe('')
})

test('an env file cannot say this is the production build: only the environment the script was started in can', () => {
  const run = runMigrateScript({}, { envFile: `DATABASE_URL="${PRODUCTION_URL}"\nVERCEL_ENV="production"\n` })

  expect(run.status).toBe(1)
  expect(run.stderr).toContain('db:migrate refused: DATABASE_URL is the production database')
  expect(run.stdout).toBe('')
})

test('when the migration succeeds the script goes on to ask the database what it recorded, and fails if it cannot', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: ONE_MIGRATION })

  expect(run.stdout).toContain(`db:migrate: migrating ${BRANCH_ENDPOINT}`)
  expect(run.stdout).toContain('stand-in drizzle-kit: migrate')
  // The database of these tests cannot be reached, which is as far as a run without one goes: CI's own
  // `npm run db:migrate` is the run that ends on "has all N migrations of the journal".
  expect(run.stderr).toContain(`db:migrate failed: could not read the applied migrations of ${BRANCH_ENDPOINT}`)
  expect(run.stderr).not.toContain('not-a-real-password')
  expect(run.status).toBe(1)
})

test('when the migration succeeds and the database has a row for each migration the script exits 0, so the build goes on', () => {
  const run = runMigrateScript(
    { DATABASE_URL: BRANCH_URL },
    { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: TWO_MIGRATIONS, database: databaseWithRows(EARLIER_STAMP, LATER_STAMP) },
  )

  expect(run.stdout).toContain('stand-in drizzle-kit: migrate')
  expect(run.stdout).toContain(`db:migrate: ${BRANCH_ENDPOINT} has all 2 migrations of the journal`)
  expect(run.status).toBe(0)
})

test.each([
  ['the migrate run, although drizzle-kit reported success, so the build stops', []],
  ['the check', ['--check']],
])('a migration the database skipped fails %s', (_run, args) => {
  const command = args.length ? 'db:check' : 'db:migrate'

  const run = runMigrateScript(
    { DATABASE_URL: BRANCH_URL },
    { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: TWO_MIGRATIONS, database: databaseWithRows(LATER_STAMP), args },
  )

  expect(run.stderr).toContain(`${command} failed: ${BRANCH_ENDPOINT} has no row for 0000_generated_earlier, and has a newer one`)
  expect(run.stdout).not.toContain('has all')
  expect(run.status).toBe(1)
})

test('a migration left without its row fails the migrate run: drizzle-kit said it had applied everything', () => {
  const run = runMigrateScript(
    { DATABASE_URL: BRANCH_URL },
    { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: TWO_MIGRATIONS, database: databaseWithRows(EARLIER_STAMP) },
  )

  expect(run.stderr).toContain(`db:migrate failed: ${BRANCH_ENDPOINT} has no row for 0001_generated_later although drizzle-kit reported success`)
  expect(run.status).toBe(1)
})

test('the check lists a migration still to apply and exits 0: the next migrate run applies it', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { journal: TWO_MIGRATIONS, database: databaseWithRows(EARLIER_STAMP), args: ['--check'] })

  expect(run.stdout).toContain(`db:check: ${BRANCH_ENDPOINT} has yet to run 0001_generated_later; the next migrate applies it`)
  expect(run.status).toBe(0)
})

test('on a database drizzle never migrated the check lists every migration, and a migrate run that leaves it so fails', () => {
  const setup = { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: TWO_MIGRATIONS, database: DATABASE_NEVER_MIGRATED }

  const check = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { ...setup, args: ['--check'] })
  const migrate = runMigrateScript({ DATABASE_URL: BRANCH_URL }, setup)

  expect(check.stdout).toContain('has yet to run 0000_generated_earlier, 0001_generated_later; the next migrate applies them')
  expect(check.status).toBe(0)
  expect(migrate.stderr).toContain('has no row for 0000_generated_earlier, 0001_generated_later although drizzle-kit reported success')
  expect(migrate.status).toBe(1)
})

test('a row whose stamp cannot be read fails the script: it cannot say what the database has', () => {
  const run = runMigrateScript(
    { DATABASE_URL: BRANCH_URL },
    { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: TWO_MIGRATIONS, database: databaseWithRows(EARLIER_STAMP, null) },
  )

  expect(run.stderr).toContain(`db:migrate failed: could not read the applied migrations of ${BRANCH_ENDPOINT}: drizzle.__drizzle_migrations has a row these checks cannot read`)
  expect(run.status).toBe(1)
})

test('a failed read that quotes the URL back is printed without it', () => {
  const quotesTheUrl = standInDatabase(400, { message: `no way in for ${BRANCH_URL}` })

  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { journal: ONE_MIGRATION, database: quotesTheUrl, args: ['--check'] })

  expect(run.stderr).toContain('no way in for <DATABASE_URL>')
  expect(run.stderr).not.toContain('not-a-real-password')
  expect(run.status).toBe(1)
})

test('a journal that is out of order stops the script before drizzle-kit starts', () => {
  const outOfOrder = journalOf([1_791_700_000_000, '0000_generated_later'], [1_791_650_000_000, '0001_generated_earlier'])

  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: outOfOrder })

  expect(run.stderr).toContain('db:migrate failed: drizzle/meta/_journal.json is out of order, so nothing was run')
  expect(run.stderr).toContain('0001_generated_earlier')
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})

test('when the migration fails the script exits with drizzle-kit\'s own code, so the build stops', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(3)'), journal: ONE_MIGRATION })

  expect(run.stdout).toContain('stand-in drizzle-kit: migrate')
  expect(run.status).toBe(3)
})

test('when drizzle-kit is killed before it ends the script fails all the same, and says what stopped it', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.kill(process.pid, \'SIGKILL\')'), journal: ONE_MIGRATION })

  expect(run.stdout).toContain('stand-in drizzle-kit: migrate')
  expect(run.stderr).toContain('db:migrate failed: drizzle-kit was stopped by SIGKILL')
  expect(run.status).toBe(1)
})

test('the production build\'s own VERCEL_ENV gets past the guard, to the migration itself', () => {
  const run = runMigrateScript(
    { DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'production' },
    { drizzleKit: standInDrizzleKit('process.exit(3)'), journal: ONE_MIGRATION },
  )

  expect(run.stderr).not.toContain('refused')
  expect(run.stdout).toContain(`db:migrate: migrating ${PRODUCTION_DB_ENDPOINT}`)
  expect(run.stdout).toContain('stand-in drizzle-kit: migrate')
  expect(run.status).toBe(3)
})

test('without a journal to read nothing is run, in the production build too', () => {
  const run = runMigrateScript({ DATABASE_URL: PRODUCTION_URL, VERCEL_ENV: 'production' }, { drizzleKit: standInDrizzleKit('process.exit(0)') })

  expect(run.stderr).toContain('db:migrate failed: could not read drizzle/meta/_journal.json')
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})

test('the check alone never asks the guard: it only reads, and stops at the missing journal the same way', () => {
  const run = runMigrateScript({ DATABASE_URL: PRODUCTION_URL }, { args: ['--check'] })

  expect(run.stderr).toContain('db:check failed: could not read drizzle/meta/_journal.json')
  expect(run.stderr).not.toContain('not-a-real-password')
  expect(run.status).toBe(1)
})

test('the check never starts drizzle-kit: with a journal to read it goes straight to the database', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: ONE_MIGRATION, args: ['--check'] })

  expect(run.stdout).toBe('')
  expect(run.stderr).toContain(`db:check failed: could not read the applied migrations of ${BRANCH_ENDPOINT}`)
  expect(run.status).toBe(1)
})

test.each([
  ['a mistyped --check', ['--chek']],
  ['a flag the script never had', ['--dry-run']],
  ['an unknown one beside --check', ['--check', '--verbose']],
])('%s stops the script before anything runs: no arguments means "migrate", so an unknown one must not pass for none', (_what, args) => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: ONE_MIGRATION, args })

  expect(run.stderr).toContain(`unknown argument ${args.at(-1)}`)
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})

// `npm run db:migrate --check`, without the `--` that hands an argument on: npm takes the flag for a setting of its
// own, starts the script with no arguments and leaves the flag in the environment.
const KEPT_BY_NPM = { npm_config_check: 'true' }

test('a --check that npm kept for itself is refused: the script, given no arguments, would have migrated', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL, ...KEPT_BY_NPM }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: ONE_MIGRATION })

  expect(run.stderr).toContain('db:migrate failed: npm kept --check for itself')
  expect(run.stderr).toContain('npm run db:check')
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})

test('the check itself runs whatever npm kept: it was asked for a read and does one', () => {
  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL, ...KEPT_BY_NPM }, { journal: ONE_MIGRATION, database: databaseWithRows(FIRST_STAMP), args: ['--check'] })

  expect(run.stdout).toContain(`db:check: ${BRANCH_ENDPOINT} has all 1 migrations of the journal`)
  expect(run.status).toBe(0)
})

test('a journal of another shape is refused with the file named once and the entry it tripped on', () => {
  const stampAsText = { entries: [{ idx: 0, when: '1791586271729', tag: '0000_first' }] }

  const run = runMigrateScript({ DATABASE_URL: BRANCH_URL }, { drizzleKit: standInDrizzleKit('process.exit(0)'), journal: stampAsText })

  expect(run.stderr).toContain('db:migrate failed: could not read drizzle/meta/_journal.json: not a migration journal: entries.0.when')
  expect(run.stdout).toBe('')
  expect(run.status).toBe(1)
})
