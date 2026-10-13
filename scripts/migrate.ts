// `npm run db:migrate`: applies drizzle/ migrations with drizzle-kit, but only to a database migrationPlan() allows,
// and then checks that none was skipped. The Vercel build and CI both run it. It exits 1 without starting drizzle-kit
// when the database is refused, the journal is out of order or an argument is not one it knows, and 0 without
// starting it when a Preview build was given the production database, so that build goes on.
//
// `npm run db:check` (this script with --check) only reads: the journal's order, and which of its migrations the
// database has no row for. It fails for one drizzle would skip and lists the ones a migrate run would still apply.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { config as loadEnv } from 'dotenv'
import { endpointOf } from '../src/lib/db-endpoint.ts'
import { migrationPlan } from '../src/lib/migration-guard.ts'
import {
  appliedReport, isUndefinedTable, JOURNAL_FILE, journalProblems, parseAppliedStamps, parseJournal, type JournalEntry,
} from '../src/lib/migration-journal.ts'

const CHECK_FLAG = '--check'
const args = process.argv.slice(2)
const isCheckOnly = args.includes(CHECK_FLAG)
const command = isCheckOnly ? 'db:check' : 'db:migrate'

function fail(message: string): never {
  console.error(`${command} failed: ${message}`)
  process.exit(1)
}

// No arguments means "migrate", so one this script does not know must not pass for none: a mistyped --check would
// write where a read was meant.
const unknownArgs = args.filter((arg) => arg !== CHECK_FLAG)
if (unknownArgs.length) fail(`unknown argument ${unknownArgs.join(' ')}, so nothing was run. The only one is ${CHECK_FLAG}, which reads and changes nothing.`)
// `npm run db:migrate --check`, without the `--` that hands an argument on, never shows here as one: npm takes the
// flag for a setting of its own and leaves it in the environment.
if (!isCheckOnly && process.env.npm_config_check !== undefined) fail(`npm kept ${CHECK_FLAG} for itself, so this run would have migrated and nothing was run. For the check: npm run db:check`)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function readJournal(): JournalEntry[] {
  try {
    return parseJournal(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')))
  } catch (error) {
    return fail(`could not read ${JOURNAL_FILE}: ${messageOf(error)}`)
  }
}

/**
 * The `created_at` of every row drizzle has written: the stamps of the migrations this database has run. A database
 * drizzle never migrated has no table of them yet, and so has run none.
 */
async function appliedStamps(url: string): Promise<number[]> {
  const rows = await neon(url)`select created_at from drizzle.__drizzle_migrations`.catch((error: unknown) => {
    if (isUndefinedTable(error)) return []
    throw error
  })
  return parseAppliedStamps(rows)
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
  if (run.status === null) fail(`drizzle-kit was stopped by ${run.signal ?? 'a signal'} before it ended.`)
  if (run.status !== 0) process.exit(run.status)
}

const stamps = await appliedStamps(url).catch((error: unknown) => {
  // A driver that rejects the URL quotes it back, password and all.
  fail(`could not read the applied migrations of ${endpoint}: ${messageOf(error).split(url).join('<DATABASE_URL>')}`)
})
const report = appliedReport(journal, stamps, { endpoint, hasMigrated: !isCheckOnly })
if (report.failed) fail(report.message)
console.log(`${command}: ${report.message}`)
