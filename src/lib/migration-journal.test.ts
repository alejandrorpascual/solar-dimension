import { readdirSync, readFileSync } from 'node:fs'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, test } from 'vitest'
import {
  appliedReport, isUndefinedTable, JOURNAL_FILE, journalProblems, parseAppliedStamps, parseJournal, unappliedMigrations,
  type JournalEntry,
} from './migration-journal'

const entry = (idx: number, when: number, tag: string): JournalEntry => ({ idx, when, tag })
const PRODUCTS = entry(0, 1_791_586_271_729, '0014_products')
/** Generated later, built first: its stamp is the newest one in the database. */
const BRANCH_B = entry(1, 1_791_700_000_000, '0015_branch_b')
/** Generated earlier, merged later: drizzle only applies a stamp later than the newest applied one, so it never runs. */
const BRANCH_A = entry(2, 1_791_650_000_000, '0016_branch_a')

const realJournal = () => parseJournal(JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')))
const tags = (entries: readonly JournalEntry[]) => entries.map(({ tag }) => tag)

test("the repository's journal is in order: drizzle would skip none of its migrations", () => {
  expect(journalProblems(realJournal())).toEqual([])
})

test('every migration file is in the journal and every journal entry has its file', () => {
  const files = readdirSync('drizzle').filter((name) => name.endsWith('.sql')).map((name) => name.replace(/\.sql$/, '')).sort()

  expect(tags(realJournal()).sort()).toEqual(files)
})

test('a migration stamped earlier than the one before it is reported by name', () => {
  const problems = journalProblems([PRODUCTS, BRANCH_B, BRANCH_A])

  expect(problems).toHaveLength(1)
  expect(problems[0]).toContain('0016_branch_a')
  expect(problems[0]).toContain('0015_branch_b')
})

test('two migrations with the same stamp are reported: drizzle would apply only the first', () => {
  const problems = journalProblems([PRODUCTS, { ...BRANCH_B, when: PRODUCTS.when }])

  expect(problems).toHaveLength(1)
  expect(problems[0]).toContain('0015_branch_b')
})

test.each([
  ['a gap', [entry(0, 1, 'a'), entry(2, 2, 'c')]],
  ['a repeat', [entry(0, 1, 'a'), entry(0, 2, 'b')]],
  ['a start other than 0', [entry(1, 1, 'a')]],
])('%s in the numbering is reported', (_what, entries) => {
  expect(journalProblems(entries)).toHaveLength(1)
})

test('an empty journal has no problems', () => {
  expect(journalProblems([])).toEqual([])
})

test('a migration the database skipped is found although the journal reads in order', () => {
  // The merge put A before B by stamp, so the journal is in order; the database already had B.
  const journal = [PRODUCTS, { ...BRANCH_A, idx: 1 }, { ...BRANCH_B, idx: 2 }]

  const { skipped, pending } = unappliedMigrations(journal, [PRODUCTS.when, BRANCH_B.when])

  expect(journalProblems(journal)).toEqual([])
  expect(tags(skipped)).toEqual(['0016_branch_a'])
  expect(pending).toEqual([])
})

test('a migration stamped later than everything the database has is pending, not skipped', () => {
  const { skipped, pending } = unappliedMigrations([PRODUCTS, BRANCH_B], [PRODUCTS.when])

  expect(skipped).toEqual([])
  expect(tags(pending)).toEqual(['0015_branch_b'])
})

test("a row the journal does not know, from another branch, makes an earlier migration one the database would skip", () => {
  const stampOfAnotherBranch = BRANCH_B.when + 1

  const { skipped, pending } = unappliedMigrations([PRODUCTS, BRANCH_B], [PRODUCTS.when, stampOfAnotherBranch])

  expect(tags(skipped)).toEqual(['0015_branch_b'])
  expect(pending).toEqual([])
})

test('a database with every journal migration has none unapplied, whatever else it holds', () => {
  const stampOfAnotherBranch = 1_791_800_000_000

  expect(unappliedMigrations([PRODUCTS, BRANCH_B], [BRANCH_B.when, stampOfAnotherBranch, PRODUCTS.when])).toEqual({ skipped: [], pending: [] })
})

test('an empty database has every migration pending, in journal order', () => {
  const { skipped, pending } = unappliedMigrations([PRODUCTS, BRANCH_B], [])

  expect(skipped).toEqual([])
  expect(tags(pending)).toEqual(['0014_products', '0015_branch_b'])
})

test('a migration with no row is in one list or the other, even beside a stamp nothing can be compared with', () => {
  // Later than NaN and no later than NaN are both false: asked both ways, the migration would be in neither list.
  const { skipped, pending } = unappliedMigrations([PRODUCTS, BRANCH_B], [PRODUCTS.when, Number.NaN])

  expect([...tags(skipped), ...tags(pending)]).toEqual(['0015_branch_b'])
})

/**
 * The installed migrator, run over `journal` on a stand-in for a database whose rows have `appliedStamps`: the tags it
 * applies. It asks the database one thing, the newest row, and the stand-in refuses any other question: a drizzle
 * that decides another way is one these checks no longer describe.
 */
async function tagsDrizzleApplies(journal: readonly JournalEntry[], appliedStamps: readonly number[]): Promise<string[]> {
  const dialect = new PgDialect()
  const textOf = (query: SQL) => dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim()
  const appliedTags: string[] = []
  const transaction = {
    execute: async (query: SQL) => {
      const [hash] = dialect.sqlToQuery(query).params
      if (textOf(query).startsWith('insert into "drizzle"."__drizzle_migrations"')) appliedTags.push(String(hash))
    },
  }
  const database = {
    execute: async () => {},
    all: async (query: SQL) => {
      expect(textOf(query)).toContain('from "drizzle"."__drizzle_migrations" order by created_at desc limit 1')
      // As the driver hands a bigint over: as text.
      return appliedStamps.length ? [{ id: 1, hash: 'of the newest row', created_at: String(Math.max(...appliedStamps)) }] : []
    },
    transaction: async (run: (tx: typeof transaction) => Promise<void>) => run(transaction),
  }
  // Each migration carries its tag as its hash, which is what the stand-in sees in the row drizzle writes for it.
  const migrations = journal.map(({ tag, when }) => ({ sql: [`select '${tag}'`], bps: true, folderMillis: when, hash: tag }))

  await dialect.migrate(migrations, database as unknown as Parameters<PgDialect['migrate']>[1], 'drizzle')
  return appliedTags
}

const BRANCH_A_IN_ORDER = [PRODUCTS, { ...BRANCH_A, idx: 1 }, { ...BRANCH_B, idx: 2 }]
const NEWER_STILL = entry(3, 1_791_800_000_000, '0017_newer_still')

test.each<[string, JournalEntry[], number[]]>([
  ['skips one stamped earlier than the newest row', BRANCH_A_IN_ORDER, [PRODUCTS.when, BRANCH_B.when]],
  ['applies one stamped later than the newest row', [PRODUCTS, BRANCH_B], [PRODUCTS.when]],
  ['applies the later one and still skips the earlier one', [...BRANCH_A_IN_ORDER, NEWER_STILL], [PRODUCTS.when, BRANCH_B.when]],
  ['does not run again the one whose stamp is the newest row', [PRODUCTS, BRANCH_B], [PRODUCTS.when, BRANCH_B.when]],
  ['skips everything behind a row from another branch', [PRODUCTS, BRANCH_B], [PRODUCTS.when, BRANCH_B.when + 1]],
  ['applies everything to an empty database', [PRODUCTS, BRANCH_B], []],
])('the installed drizzle %s, as the check says it will', async (_what, journal, appliedStamps) => {
  const { skipped, pending } = unappliedMigrations(journal, appliedStamps)

  const appliedByDrizzle = await tagsDrizzleApplies(journal, appliedStamps)

  expect(appliedByDrizzle).toEqual(tags(pending))
  // Of the migrations the database had no row for, the ones drizzle left that way are the ones the check calls skipped.
  const hadNoRow = journal.filter(({ when }) => !appliedStamps.includes(when))
  expect(tags(hadNoRow).filter((tag) => !appliedByDrizzle.includes(tag))).toEqual(tags(skipped))
})

test.each([
  ['not an object', 'entries'],
  ['no entries', { version: '7' }],
  ['an entry without its stamp', { entries: [{ idx: 0, tag: '0000_x' }] }],
  ['a stamp that is not a number', { entries: [{ idx: 0, when: '1790280554263', tag: '0000_x' }] }],
])('a journal that is %s is refused, never read as empty', (_what, json) => {
  expect(() => parseJournal(json)).toThrow(/not a migration journal/)
})

test('a journal that is refused says which entry it tripped on', () => {
  const secondEntryHasNoStamp = { entries: [{ idx: 0, when: 1, tag: '0000_x' }, { idx: 1, tag: '0001_y' }] }

  expect(() => parseJournal(secondEntryHasNoStamp)).toThrow(/entries\.1\.when/)
})

test('the stamps come out of the rows as numbers, though a bigint column arrives as text', () => {
  expect(parseAppliedStamps([{ created_at: '1791586271729' }, { created_at: 1_791_501_597_655 }])).toEqual([1_791_586_271_729, 1_791_501_597_655])
})

test('a database with the table and no rows has no stamps', () => {
  expect(parseAppliedStamps([])).toEqual([])
})

test.each([
  ['not rows', 'created_at'],
  ['a row without its stamp', [{ hash: 'abc' }]],
  ['a row whose stamp is null', [{ created_at: null }]],
  ['a stamp that is not a number', [{ created_at: 'yesterday' }]],
  ['a stamp that is not a whole number', [{ created_at: '1791586271729.5' }]],
])('%s is refused: with one stamp unknown, the newest row is unknown too', (_what, rows) => {
  expect(() => parseAppliedStamps(rows)).toThrow(/__drizzle_migrations/)
})

test('a table that does not exist is told from any other failed read', () => {
  const noSuchTable = Object.assign(new Error('relation "drizzle.__drizzle_migrations" does not exist'), { code: '42P01' })
  const wrongPassword = Object.assign(new Error('password authentication failed'), { code: '28P01' })

  expect(isUndefinedTable(noSuchTable)).toBe(true)
  expect(isUndefinedTable(wrongPassword)).toBe(false)
  expect(isUndefinedTable(new Error('fetch failed'))).toBe(false)
  expect(isUndefinedTable('42P01')).toBe(false)
  expect(isUndefinedTable(null)).toBe(false)
})

const ENDPOINT = 'ep-made-up-branch-12345678'
const AFTER_MIGRATING = { endpoint: ENDPOINT, hasMigrated: true }
const CHECK_ONLY = { endpoint: ENDPOINT, hasMigrated: false }

test.each([
  ['a run that has just migrated', AFTER_MIGRATING],
  ['a check', CHECK_ONLY],
])('a skipped migration fails %s, by name and with the rule that skips it', (_run, where) => {
  const report = appliedReport(BRANCH_A_IN_ORDER, [PRODUCTS.when, BRANCH_B.when], where)

  expect(report.failed).toBe(true)
  expect(report.message).toContain(`${ENDPOINT} has no row for 0016_branch_a, and has a newer one`)
  expect(report.message).toContain('A migration drizzle would skip')
})

test('a migration still without its row after migrating fails the run: drizzle-kit said it had applied everything', () => {
  const report = appliedReport([PRODUCTS, BRANCH_B], [PRODUCTS.when], AFTER_MIGRATING)

  expect(report).toEqual({ failed: true, message: `${ENDPOINT} has no row for 0015_branch_b although drizzle-kit reported success.` })
})

test.each([
  ['one', [PRODUCTS.when], '0015_branch_b; the next migrate applies it'],
  ['several', [], '0014_products, 0015_branch_b; the next migrate applies them'],
])('a check lists %s still to apply and does not fail for it', (_howMany, appliedStamps, listed) => {
  const report = appliedReport([PRODUCTS, BRANCH_B], appliedStamps, CHECK_ONLY)

  expect(report).toEqual({ failed: false, message: `${ENDPOINT} has yet to run ${listed}` })
})

test('a skipped migration fails a check that also has one still to apply', () => {
  const report = appliedReport([...BRANCH_A_IN_ORDER, NEWER_STILL], [PRODUCTS.when, BRANCH_B.when], CHECK_ONLY)

  expect(report.failed).toBe(true)
  expect(report.message).toContain('0016_branch_a')
  expect(report.message).not.toContain('0017_newer_still')
})

test.each([
  ['a run that has just migrated', AFTER_MIGRATING],
  ['a check', CHECK_ONLY],
])('a database with every migration of the journal passes %s, and the line says how many', (_run, where) => {
  const report = appliedReport([PRODUCTS, BRANCH_B], [PRODUCTS.when, BRANCH_B.when], where)

  expect(report).toEqual({ failed: false, message: `${ENDPOINT} has all 2 migrations of the journal` })
})
