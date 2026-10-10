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

/** The keyCode browsers report for a key press an input method is handling. */
const IME_KEY_CODE = 229

/**
 * How a key pressed in the name field closes it, or null when it leaves the field open. A key an input method is using
 * (Enter to pick a Japanese or Chinese candidate, Escape to dismiss one) is the input method's, not the rename's:
 * acting on it would end the rename mid-word, and Escape would throw away everything typed before that candidate.
 * Safari ends the composition before the keydown of the Enter that confirmed it, and marks that key only by keyCode.
 */
export function renameCloseKey(key: string, isComposing: boolean, keyCode?: number): Extract<RenameClose, 'enter' | 'escape'> | null {
  if (isComposing || keyCode === IME_KEY_CODE) return null
  if (key === 'Enter') return 'enter'
  if (key === 'Escape') return 'escape'
  return null
}
