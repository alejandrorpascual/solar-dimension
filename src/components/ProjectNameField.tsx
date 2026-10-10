import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { PROJECT_NAME_MAX } from '../lib/store'

interface Props {
  name: string
  /** Called once with the typed text when Enter or leaving the field saves it; `byKey` is true for Enter. */
  onSave: (raw: string, byKey: boolean) => void
  /** Called when Escape drops the edit. */
  onCancel: () => void
}

/** The open project's name, edited in place on its card. Opens focused with the text selected, like a file rename. */
export function ProjectNameField({ name, onSave, onCancel }: Props) {
  const { t } = useLocale()
  const [draft, setDraft] = useState(name)
  // Enter and Escape end the edit by blurring; these say which, so Escape's blur does not save.
  const isCancelling = useRef(false)
  const isSavingByKey = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  // Not `autoFocus`: React focuses that while it commits, and when Rename comes from the ··· menu the page around the
  // menu is still `inert` then, so the call does nothing. react-aria lifts `inert` in the menu's effect cleanup, and
  // React runs every cleanup of a commit before any new effect, so here the field can take focus.
  useEffect(() => input.current?.focus(), [])
  return (
    <input
      ref={input}
      className="in pcard__name"
      type="text"
      aria-label={t.ui.projectName}
      value={draft}
      placeholder={t.ui.untitled}
      maxLength={PROJECT_NAME_MAX}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => (isCancelling.current ? onCancel() : onSave(draft, isSavingByKey.current))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // Focus moves to the card's title as the field closes; without this, Enter's keypress lands there and
          // presses it, reopening the rename.
          e.preventDefault()
          isSavingByKey.current = true
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          // Inside the phone sheet, Escape would also close the sheet; here it only drops the edit.
          e.stopPropagation()
          isCancelling.current = true
          e.currentTarget.blur()
        }
      }}
    />
  )
}
