import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { JOURNAL_FILE, parseJournal, type JournalEntry } from '../src/lib/migration-journal'

// `npm run db:check` on this run's database: the script itself, reading what the build's `db:migrate` reads when it
// ends. Unit tests hold the rules; only a database that answers shows the script failing for what it finds there.
// It reads one table and writes nothing.
const SCRIPT = resolve('scripts/migrate.ts')
const CHECK_TIMEOUT_MS = 20_000
/** Later than the stamp of any migration this database will be given: the year 2100. */
const LATER_THAN_ANY_ROW = Date.UTC(2100, 0, 1)

const folders: string[] = []
test.afterAll(() => { for (const folder of folders) rmSync(folder, { recursive: true, force: true }) })

const repositoryJournal = () => parseJournal(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')))

/** The journal with one more migration at `position`, numbered as drizzle-kit would have numbered it. */
function withMigration(journal: readonly JournalEntry[], position: number, added: Pick<JournalEntry, 'when' | 'tag'>): JournalEntry[] {
  return [...journal.slice(0, position), added, ...journal.slice(position)].map((entry, idx) => ({ ...entry, idx }))
}

/** Runs the check in a folder that holds `journal` and nothing else, so no .env.local of the developer's is read. */
function runCheck(journal: readonly JournalEntry[]) {
  const cwd = mkdtempSync(join(tmpdir(), 'migration-check-'))
  folders.push(cwd)
  mkdirSync(join(cwd, dirname(JOURNAL_FILE)), { recursive: true })
  writeFileSync(join(cwd, JOURNAL_FILE), JSON.stringify({ entries: journal }))
  const env = { PATH: process.env.PATH ?? '', DATABASE_URL: process.env.DATABASE_URL ?? '' }
  return spawnSync(process.execPath, [SCRIPT, '--check'], { cwd, env, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS })
}

test("the check passes the repository's journal on this run's database", () => {
  const run = runCheck(repositoryJournal())

  // "yet to run" on a laptop whose test database is a migration behind; neither is a failure.
  expect(run.stdout).toMatch(/has all \d+ migrations of the journal|has yet to run/)
  expect(run.status).toBe(0)
})

test('the check fails for a migration this database never ran and never will: one stamped earlier than its newest row', () => {
  const journal = repositoryJournal()
  const neverApplied = { when: journal[0].when + 1, tag: '0001_never_applied' }

  const run = runCheck(withMigration(journal, 1, neverApplied))

  expect(run.stderr).toContain('has no row for 0001_never_applied, and has a newer one')
  expect(run.status).toBe(1)
})

test('the check lists a migration stamped later than every row, and does not fail for it', () => {
  const journal = repositoryJournal()
  const notYetApplied = { when: LATER_THAN_ANY_ROW, tag: '9999_not_yet_applied' }

  const run = runCheck(withMigration(journal, journal.length, notYetApplied))

  expect(run.stdout).toContain('9999_not_yet_applied; the next migrate applies')
  expect(run.status).toBe(0)
})
