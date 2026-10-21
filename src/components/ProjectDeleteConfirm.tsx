import { useEffect, useRef } from 'react'
import { useLocale } from '../hooks/useLocale'
import { deleteProjectText } from '../i18n'

interface Props {
  name: string
  /** How many quotes go with the project; 0 when it has none or they are not known yet. */
  quoteCount: number
  onDelete: () => void
  onCancel: () => void
}

/**
 * What the open project's card asks, in place, after Delete is chosen in its ··· menu: deleting also removes the
 * project's quotes and their files for good, so the question says how many go. Focus starts on Cancel, the safe answer.
 */
export function ProjectDeleteConfirm({ name, quoteCount, onDelete, onCancel }: Props) {
  const { t } = useLocale()
  const cancelRef = useRef<HTMLButtonElement>(null)
  // In an effect, not autoFocus: right after a ··· menu action the page around the menu is still `inert` while React
  // commits, and react-aria lifts that in the menu's cleanup, which runs before any new effect (see useTitleFocus).
  useEffect(() => { cancelRef.current?.focus() }, [])
  return (
    <div className="pcard__confirm">
      <p className="pcard__ask" role="alert">{deleteProjectText(t, name, quoteCount)}</p>
      <div className="pcard__answers">
        <button type="button" className="qbtn qbtn--danger" onClick={onDelete}>{t.ui.deleteProjectYes}</button>
        <button ref={cancelRef} type="button" className="qbtn" onClick={onCancel}>{t.quotes.cancel}</button>
      </div>
    </div>
  )
}
