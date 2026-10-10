import { useEffect, useRef, useState, type RefObject } from 'react'
import { renameOutcome, type RenameClose, type Renaming } from '../lib/project-rename'
import type { Store } from '../lib/schema'
import { addProject, currentProject, deleteProject, duplicateProject, renameProject } from '../lib/store'
import { useLocale } from './useLocale'

/** What only the open project's card can do: rename in place and the ··· menu. */
export interface CurrentActions {
  isRenaming: boolean
  /** Goes on the title button, so focus can be put there (see useTitleFocus). */
  titleRef: RefObject<HTMLButtonElement | null>
  canDelete: boolean
  onRename: () => void
  /** The name field's text after each change; it is saved straight away. */
  onRenameType: (raw: string) => void
  onRenameClose: (via: RenameClose) => void
  onDuplicate: () => void
  onDelete: () => void
}

interface Args {
  store: Store
  commit: (s: Store) => void
  /** Called after Enter in the name field of a project that was just created; see ProjectCards. */
  onPicked?: () => void
}

/**
 * Puts focus on the open project's title after the next commit, so the keyboard is not stranded when the control that
 * had focus goes away: the name field on Enter or Escape, the ··· menu's button after Duplicate or Delete.
 */
function useTitleFocus() {
  const titleRef = useRef<HTMLButtonElement>(null)
  const [isRequested, setRequested] = useState(false)
  // In an effect, not while React commits: after a ··· menu action the page around the menu is still `inert` then, so
  // focus() would do nothing. react-aria lifts `inert` in the menu's effect cleanup, and React runs every cleanup of a
  // commit before any new effect.
  useEffect(() => {
    if (!isRequested) return
    titleRef.current?.focus()
    setRequested(false)
  }, [isRequested])
  return { titleRef, focusTitle: () => setRequested(true) }
}

/** Renaming on the open project's card: which rename is in progress, where focus goes after it, and the card's actions. */
export function useProjectRename({ store, commit, onPicked }: Args) {
  const { t } = useLocale()
  const [renaming, setRenaming] = useState<Renaming | null>(null)
  const { titleRef, focusTitle } = useTitleFocus()
  const open = currentProject(store)
  // Called from handlers of the latest render only, never from a cleanup: `commit` replaces the whole store, so an
  // older `store` here would undo whatever changed since. A blank name is stored as the fallback straight away.
  const rename = (id: string, raw: string) => {
    const next = renameProject(store, id, raw, t.ui.untitled)
    if (next !== store) commit(next)
  }
  // A new project opens on top already renaming, and the sheet stays open so its name field shows. Enter in that field
  // calls onPicked, which closes the sheet on phones; leaving the field or pressing Escape keeps the sheet open.
  const createProject = () => {
    const next = addProject(store)
    const created = currentProject(next)
    commit(next)
    setRenaming({ id: created.id, original: created.name, isNew: true })
  }
  const closeRename = (via: RenameClose) => {
    if (!renaming) return
    const outcome = renameOutcome(renaming, via)
    if (outcome.shouldRestore) rename(renaming.id, renaming.original)
    setRenaming(null)
    if (outcome.shouldFocusTitle) focusTitle()
    if (outcome.shouldPick) onPicked?.()
  }
  // Duplicate and Delete open another project. The ··· button that had focus was on the card of the one that was open,
  // so the title of the one now open takes it.
  const openInstead = (next: Store) => {
    commit(next)
    focusTitle()
  }
  const currentActions: CurrentActions = {
    isRenaming: renaming?.id === open.id,
    titleRef,
    canDelete: store.projects.length > 1,
    onRename: () => setRenaming({ id: open.id, original: open.name, isNew: false }),
    onRenameType: (raw) => rename(open.id, raw),
    onRenameClose: closeRename,
    onDuplicate: () => openInstead(duplicateProject(store)),
    onDelete: () => openInstead(deleteProject(store)),
  }
  return { createProject, currentActions }
}
