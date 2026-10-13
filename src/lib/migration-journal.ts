import { z } from 'zod'

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

/** The journal's entries. Throws for a file of another shape: one that can't be read must not pass for an empty one. */
export function parseJournal(json: unknown): JournalEntry[] {
  const parsed = JournalSchema.safeParse(json)
  if (!parsed.success) throw new Error(`drizzle/meta/_journal.json is not a migration journal: ${parsed.error.issues[0]?.message ?? 'unreadable'}`)
  return parsed.data.entries
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
 * later than the newest row, so drizzle will never run them there. `pending` are later than it: the next migrate run
 * applies them, and after one there should be none. Rows the journal does not know (another branch's migration) only
 * count as the newest stamp.
 */
export function unappliedMigrations(
  entries: readonly JournalEntry[], appliedStamps: readonly number[],
): { skipped: JournalEntry[]; pending: JournalEntry[] } {
  const applied = new Set(appliedStamps)
  const newest = Math.max(-Infinity, ...appliedStamps)
  const unapplied = entries.filter((entry) => !applied.has(entry.when))
  return { skipped: unapplied.filter((entry) => entry.when <= newest), pending: unapplied.filter((entry) => entry.when > newest) }
}
