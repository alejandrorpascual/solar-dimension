/** How the name field on a project's card was closed. */
export type RenameClose = 'enter' | 'escape' | 'blur'

/** A rename in progress on the open project's card. */
export interface Renaming {
  id: string
  /** The name the project had when the rename started; Escape puts it back. */
  original: string
}

export interface RenameOutcome {
  /** Put back the name the rename started with. The field saves on every keystroke, so dropping the edit is a write. */
  shouldRestore: boolean
  /** Move focus to the card's title, so the keyboard is not stranded where the field was. */
  shouldFocusTitle: boolean
}

/** What closing the name field does, by how it was closed. */
export function renameOutcome(via: RenameClose): RenameOutcome {
  return { shouldRestore: via === 'escape', shouldFocusTitle: via !== 'blur' }
}
