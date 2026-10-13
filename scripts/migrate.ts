// `npm run db:migrate`: applies drizzle/ migrations with drizzle-kit, but only to a database migrationPlan() allows,
// and then checks that none was skipped. The Vercel build and CI both run it. It exits 1 without starting drizzle-kit
// when the database is refused or the journal is out of order, and 0 without starting it when a Preview build was
// given the production database, so that build goes on.
//
// `npm run db:check` (this script with --check) only reads: the journal's order, and which of its migrations the
// database has no row for. It fails for one drizzle would skip and lists the ones a migrate run would still apply.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { config as loadEnv } from 'dotenv'
import { endpointOf } from '../src/lib/db-endpoint.ts'
import { migrationPlan } from '../src/lib/migration-guard.ts'
import { journalProblems, parseJournal, unappliedMigrations, type JournalEntry } from '../src/lib/migration-journal.ts'

const JOURNAL_FILE = 'drizzle/meta/_journal.json'
const SKIP_RULE = 'drizzle only applies a migration stamped later than the newest one a database has, and skips any other without an error (README, "A migration drizzle would skip")'
const isCheckOnly = process.argv.includes('--check')
const command = isCheckOnly ? 'db:check' : 'db:migrate'

function fail(message: string): never {
  console.error(`${command} failed: ${message}`)
  process.exit(1)
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const tagsOf = (entries: readonly JournalEntry[]): string => entries.map((entry) => entry.tag).join(', ')

function readJournal(): JournalEntry[] {
  try {
    return parseJournal(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')))
  } catch (error) {
    return fail(`could not read ${JOURNAL_FILE}: ${messageOf(error)}`)
  }
}

/** The `created_at` of every row drizzle has written: the stamps of the migrations this database has run. */
async function appliedStamps(url: string): Promise<number[]> {
  const rows = await neon(url)`select created_at from drizzle.__drizzle_migrations`
  return rows.map((row) => Number(row.created_at))
}

// Read before the env file is, so the file that holds the production URL cannot also say this is the production
// build. Whatever started this process still can: VERCEL_ENV is taken as given, the way Vercel sets it for a build.
const buildEnv = process.env.VERCEL_ENV
// As drizzle.config.ts does, and never over a variable that is already set: the plan is made for the URL drizzle-kit
// will use.
loadEnv({ path: '.env.local', quiet: true })

const url = process.env.DATABASE_URL
const endpoint = endpointOf(url)
if (!isCheckOnly) {
  const plan = migrationPlan({ DATABASE_URL: url, VERCEL_ENV: buildEnv })
  if (plan.action === 'refuse') {
    console.error(`db:migrate refused: ${plan.reason}`)
    process.exit(1)
  }
  if (plan.action === 'skip') {
    console.warn(`db:migrate skipped: ${plan.reason}`)
    process.exit(0)
  }
}
if (!url || !endpoint) fail('DATABASE_URL is missing or is not a URL.')

const journal = readJournal()
const problems = journalProblems(journal)
if (problems.length) fail(`${JOURNAL_FILE} is out of order, so nothing was run:\n  ${problems.join('\n  ')}`)

if (!isCheckOnly) {
  console.log(`db:migrate: migrating ${endpoint}`)
  const run = spawnSync(process.execPath, ['node_modules/drizzle-kit/bin.cjs', 'migrate'], { stdio: 'inherit' })
  if (run.error) fail(`could not start drizzle-kit: ${run.error.message}`)
  if (run.status !== 0) process.exit(run.status ?? 1)
}

const { skipped, pending } = unappliedMigrations(journal, await appliedStamps(url).catch((error: unknown) => {
  // A driver that rejects the URL quotes it back, password and all.
  fail(`could not read the applied migrations of ${endpoint}: ${messageOf(error).split(url).join('<DATABASE_URL>')}`)
}))
if (skipped.length) fail(`${endpoint} has no row for ${tagsOf(skipped)}, and has a newer one. ${SKIP_RULE}.`)
// After a migrate run nothing may be left; before one, a later stamp is simply a migration still to apply.
if (pending.length && !isCheckOnly) fail(`${endpoint} has no row for ${tagsOf(pending)} although drizzle-kit reported success.`)
if (pending.length) console.log(`db:check: ${endpoint} has yet to run ${tagsOf(pending)}; the next migrate applies ${pending.length === 1 ? 'it' : 'them'}`)
else console.log(`${command}: ${endpoint} has all ${journal.length} migrations of the journal`)
