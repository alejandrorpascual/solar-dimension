/** How the name field on a project's card was closed. */
export type RenameClose = 'enter' | 'escape' | 'blur'

/** A rename in progress on the open project's card. */
export interface Renaming {
  id: string
  /** The name the project had when the rename started; Escape puts it back. */
  original: string
  /** True only for the rename a project opens with when it is created, not for any later rename of it. */
  isNew: boolean
}

export interface RenameOutcome {
  /** Put back the name the rename started with. The field saves on every keystroke, so dropping the edit is a write. */
  shouldRestore: boolean
  /** Move focus to the card's title, so the keyboard is not stranded where the field was. */
  shouldFocusTitle: boolean
  /** Tell the rail the person is done with the cards, which closes the phone's sheet. */
  shouldPick: boolean
}

/** What closing the name field does, by how it was closed. */
export function renameOutcome(renaming: Renaming, via: RenameClose): RenameOutcome {
  return {
    shouldRestore: via === 'escape',
    shouldFocusTitle: via !== 'blur',
    shouldPick: via === 'enter' && renaming.isNew,
  }
}
