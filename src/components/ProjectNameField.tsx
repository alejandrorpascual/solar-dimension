import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { renameCloseKey, type RenameClose } from '../lib/project-rename'
import { PROJECT_NAME_MAX } from '../lib/schema'

interface Props {
  /** The id the card is labelled by (aria-labelledby): the field stands in for the title while it is open. */
  id: string
  name: string
  /** Called with the field's text on every change: the name is saved as it is typed, like every other control. */
  onType: (raw: string) => void
  /**
   * Called once when the field is done with: Enter, Escape, or focus leaving it. Enter and Escape report it themselves:
   * React does not call onBlur for a focused input it removes, so no blur follows them.
   */
  onClose: (via: RenameClose) => void
}

/** The open project's name, edited in place on its card. Opens focused with the text selected, like a file rename. */
export function ProjectNameField({ id, name, onType, onClose }: Props) {
  const { t } = useLocale()
  // The field's own text, so it can be emptied while the project keeps a name (the placeholder shows which).
  const [draft, setDraft] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  // Not `autoFocus`: React focuses that while it commits, and when Rename comes from the ··· menu the page around the
  // menu is still `inert` then, so the call does nothing. react-aria lifts `inert` in the menu's effect cleanup, and
  // React runs every cleanup of a commit before any new effect, so here the field can take focus.
  useEffect(() => input.current?.focus(), [])
  return (
    <input
      ref={input}
      id={id}
      className="in pcard__name"
      type="text"
      aria-label={t.ui.projectName}
      value={draft}
      placeholder={t.ui.untitled}
      maxLength={PROJECT_NAME_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value)
        onType(e.target.value)
      }}
      onBlur={() => onClose('blur')}
      onKeyDown={(e) => {
        const via = renameCloseKey(e.key, e.nativeEvent.isComposing, e.keyCode)
        if (!via) return
        // Enter: focus moves to the card's title as the field closes; without this, Enter's keypress lands there and
        // presses it, reopening the rename. Escape: inside the phone sheet it would also close the sheet; here it only
        // drops the edit.
        if (via === 'enter') e.preventDefault()
        else e.stopPropagation()
        onClose(via)
      }}
    />
  )
}
