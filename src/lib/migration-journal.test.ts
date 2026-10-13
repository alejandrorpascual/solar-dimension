import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { journalProblems, parseJournal, unappliedMigrations, type JournalEntry } from './migration-journal'

const entry = (idx: number, when: number, tag: string): JournalEntry => ({ idx, when, tag })
const PRODUCTS = entry(0, 1_791_586_271_729, '0014_products')
/** Generated later, built first: its stamp is the newest one in the database. */
const BRANCH_B = entry(1, 1_791_700_000_000, '0015_branch_b')
/** Generated earlier, merged later: drizzle only applies a stamp later than the newest applied one, so it never runs. */
const BRANCH_A = entry(2, 1_791_650_000_000, '0016_branch_a')

const realJournal = () => parseJournal(JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')))

test("the repository's journal is in order: drizzle would skip none of its migrations", () => {
  expect(journalProblems(realJournal())).toEqual([])
})

test('every migration file is in the journal and every journal entry has its file', () => {
  const files = readdirSync('drizzle').filter((name) => name.endsWith('.sql')).map((name) => name.replace(/\.sql$/, '')).sort()

  expect(realJournal().map((e) => e.tag).sort()).toEqual(files)
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

const tags = (entries: readonly JournalEntry[]) => entries.map((e) => e.tag)

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

test.each([
  ['not an object', 'entries'],
  ['no entries', { version: '7' }],
  ['an entry without its stamp', { entries: [{ idx: 0, tag: '0000_x' }] }],
  ['a stamp that is not a number', { entries: [{ idx: 0, when: '1790280554263', tag: '0000_x' }] }],
])('a journal that is %s is refused, never read as empty', (_what, json) => {
  expect(() => parseJournal(json)).toThrow(/_journal\.json/)
})
