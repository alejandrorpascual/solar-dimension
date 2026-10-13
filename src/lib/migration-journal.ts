import { z } from 'zod'

/** Where drizzle keeps the journal, from the repository's root. */
export const JOURNAL_FILE = 'drizzle/meta/_journal.json'

/**
 * drizzle/meta/_journal.json, as far as the checks read it. drizzle applies a migration only when its `when` is later
 * than the newest `created_at` in drizzle.__drizzle_migrations, and records `when` there as that row's `created_at`.
 * It stores the file's hash too and never compares it, and a file edited after it ran no longer matches its row, so
 * these checks go by `when`, as drizzle does.
 */
const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), when: z.number().int(), tag: z.string().min(1) })),
})

export type JournalEntry = z.infer<typeof JournalSchema>['entries'][number]

/** The rows of drizzle.__drizzle_migrations, as far as the checks read them. The column is a bigint, which arrives as text. */
const AppliedRowsSchema = z.array(z.object({ created_at: z.coerce.number().int().positive() }))

/** The first thing a schema tripped on, after where in the value it was. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue ? [issue.path.join('.'), issue.message].filter(Boolean).join(': ') : 'unreadable'
}

/**
 * The journal's entries. Throws for a file of another shape: one that can't be read must not pass for an empty one.
 * The message leaves the file's name to the caller, which knows where it read it.
 */
export function parseJournal(json: unknown): JournalEntry[] {
  const parsed = JournalSchema.safeParse(json)
  if (!parsed.success) throw new Error(`not a migration journal: ${firstIssue(parsed.error)}`)
  return parsed.data.entries
}

/**
 * The stamps of the migrations a database has run, from the rows drizzle wrote for them. Throws for a stamp that is
 * not a whole number: with one unknown the newest row is unknown too, and then no migration could be called skipped.
 */
export function parseAppliedStamps(rows: unknown): number[] {
  const parsed = AppliedRowsSchema.safeParse(rows)
  if (!parsed.success) throw new Error(`drizzle.__drizzle_migrations has a row these checks cannot read: ${firstIssue(parsed.error)}`)
  return parsed.data.map((row) => row.created_at)
}

/** Postgres's code for a table that is not there. */
const UNDEFINED_TABLE = '42P01'

/**
 * Whether a read of drizzle.__drizzle_migrations failed only because the table is not there. drizzle makes it on its
 * first run, so that is a database it never migrated, with no rows, and not a read that went wrong.
 */
export function isUndefinedTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNDEFINED_TABLE
}

/**
 * What is wrong with the journal by itself, one line per migration: numbering that does not run 0, 1, 2…, and a stamp
 * that is not later than the one before it. A database that already has the earlier entry skips such a migration
 * without an error, which is what two branches merged out of the order they were generated in leave behind.
 */
export function journalProblems(entries: readonly JournalEntry[]): string[] {
  return entries.flatMap((entry, i) => {
    const prev = entries[i - 1]
    const expectedIdx = (prev?.idx ?? -1) + 1
    if (entry.idx !== expectedIdx) return [`${entry.tag} is numbered ${entry.idx} where ${expectedIdx} was expected.`]
    if (prev && entry.when <= prev.when) {
      return [`${entry.tag} is stamped ${entry.when}, not later than ${prev.tag} before it (${prev.when}): a database that already has ${prev.tag} skips it.`]
    }
    return []
  })
}

/**
 * The journal's migrations a database has no row for, given the `created_at` of its rows. `skipped` are stamped no
 * later than the newest row, so drizzle will never run them there. `pending` are the rest: the next migrate run
 * applies them, and after one there should be none. Rows the journal does not know (another branch's migration) only
 * count as the newest stamp.
 */
export function unappliedMigrations(
  entries: readonly JournalEntry[], appliedStamps: readonly number[],
): { skipped: JournalEntry[]; pending: JournalEntry[] } {
  const applied = new Set(appliedStamps)
  const newest = Math.max(-Infinity, ...appliedStamps)
  const unapplied = entries.filter((entry) => !applied.has(entry.when))
  // One question, and its opposite for the rest: asked "later?" and "no later?" apart, a migration beside a stamp that
  // compares with nothing would be in neither list, and so pass for applied.
  const isSkipped = (entry: JournalEntry) => entry.when <= newest
  return { skipped: unapplied.filter(isSkipped), pending: unapplied.filter((entry) => !isSkipped(entry)) }
}

const SKIP_RULE = 'drizzle only applies a migration stamped later than the newest one a database has, and skips any other without an error (README, "A migration drizzle would skip")'
const tagsOf = (entries: readonly JournalEntry[]): string => entries.map((entry) => entry.tag).join(', ')

/** How a run ends once the database's rows are read: the line to print, and whether the run has failed. */
export type AppliedReport = { failed: boolean; message: string }

/**
 * What a run says of a database, given the stamps of its rows. A skipped migration fails any run. A pending one fails
 * a run that has just migrated, since drizzle-kit said it had applied everything; before one it is simply a migration
 * still to apply, and a check lists it.
 */
export function appliedReport(
  entries: readonly JournalEntry[], appliedStamps: readonly number[], where: { endpoint: string; hasMigrated: boolean },
): AppliedReport {
  const { endpoint, hasMigrated } = where
  const { skipped, pending } = unappliedMigrations(entries, appliedStamps)
  if (skipped.length) return { failed: true, message: `${endpoint} has no row for ${tagsOf(skipped)}, and has a newer one. ${SKIP_RULE}.` }
  if (pending.length && hasMigrated) return { failed: true, message: `${endpoint} has no row for ${tagsOf(pending)} although drizzle-kit reported success.` }
  if (pending.length) return { failed: false, message: `${endpoint} has yet to run ${tagsOf(pending)}; the next migrate applies ${pending.length === 1 ? 'it' : 'them'}` }
  return { failed: false, message: `${endpoint} has all ${entries.length} migrations of the journal` }
}
