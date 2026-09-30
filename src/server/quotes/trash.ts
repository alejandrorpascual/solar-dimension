import { isQuotePath, type QuoteStorage } from './storage'

/** The most trash rows one sweep tries to empty, oldest first. */
export const TRASH_BATCH = 50

/**
 * `quote_file_trash`: the files of deleted quotes that still have to leave storage. A row is written in the same
 * transaction that deletes the quote, so a file is never forgotten, and cleared only once the file is gone.
 */
export interface TrashRepo {
  oldest(limit: number): Promise<string[]>
  clear(paths: readonly string[]): Promise<void>
}
export interface TrashResult { removed: string[]; kept: string[] }
interface Failure { path: string; error: unknown }

const EMPTY: TrashResult = { removed: [], kept: [] }

/** Removes the files in one call; if that fails, one by one, so a single bad file doesn't hold back the rest. */
async function removeFiles(storage: QuoteStorage, paths: readonly string[]): Promise<{ removed: string[]; failures: Failure[] }> {
  if (paths.length === 0) return { removed: [], failures: [] }
  try {
    await storage.remove(paths)
    return { removed: [...paths], failures: [] }
  } catch {
    // The batch error is not logged on its own: each file's own error is, below.
    const settled = await Promise.all(paths.map(async (path) => {
      try {
        await storage.remove([path])
        return { path, error: null }
      } catch (error) {
        return { path, error }
      }
    }))
    return {
      removed: settled.filter((s) => s.error === null).map((s) => s.path),
      failures: settled.filter((s) => s.error !== null),
    }
  }
}

async function takeOldest(trash: TrashRepo): Promise<string[]> {
  try {
    return await trash.oldest(TRASH_BATCH)
  } catch (error) {
    console.error('[quotes] reading the quote trash failed', { error })
    return []
  }
}

/**
 * Removes trashed files from storage and clears the rows of those that are gone: `paths` when given (right after a
 * delete), otherwise the oldest rows (the sweep). A file that can't be removed keeps its row for the next sweep.
 * Never throws: the rows were deleted already, so a storage or database problem is logged instead.
 */
export async function emptyTrash(deps: { storage: QuoteStorage; trash: TrashRepo }, paths?: readonly string[]): Promise<TrashResult> {
  const all = paths ?? (await takeOldest(deps.trash))
  if (all.length === 0) return EMPTY
  // A path storage would refuse names no file this app stored (seeded test rows), so no sweep could ever clear it.
  const foreign = all.filter((p) => !isQuotePath(p))
  if (foreign.length) console.warn('[quotes] dropped trash rows that name no quote file', { paths: foreign })
  const { removed, failures } = await removeFiles(deps.storage, all.filter(isQuotePath))
  if (failures.length) console.error('[quotes] removing quote files failed; they stay in the trash', { failures })
  const cleared = [...foreign, ...removed]
  if (cleared.length) {
    try {
      await deps.trash.clear(cleared)
    } catch (error) {
      console.error('[quotes] clearing the quote trash failed', { paths: cleared, error })
    }
  }
  return { removed: cleared, kept: failures.map((f) => f.path) }
}
