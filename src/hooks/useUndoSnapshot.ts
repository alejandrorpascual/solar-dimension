import { useState } from 'react'
import type { Project } from '../lib/schema'

/**
 * The project as it was before the first quick edit, so the kit can show what changed and offer Undo.
 * A new `resetKey` (another project, another step) forgets it.
 */
export function useUndoSnapshot(project: Project, resetKey: string) {
  const [snapshot, setSnapshot] = useState<Project | null>(null)
  const [key, setKey] = useState(resetKey)
  if (key !== resetKey) {
    setKey(resetKey)
    setSnapshot(null)
  }
  return {
    snapshot,
    /** Call before an edit: keeps the first version only. */
    remember: () => setSnapshot((s) => s ?? project),
    clear: () => setSnapshot(null),
  }
}
