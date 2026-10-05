import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import { deleteConfirmText } from '../../lib/quote-text'

interface Props { name: string; optionCount: number; onDelete: () => void }

/** A trash button that asks first, in place, since deleting also removes the file for good. */
export function ConfirmDelete({ name, optionCount, onDelete }: Props) {
  const { t } = useLocale()
  const [isConfirming, setConfirming] = useState(false)
  if (!isConfirming) {
    return (
      <button type="button" className="qicon" aria-label={trq(t, 'deleteFile', { name })} onClick={() => setConfirming(true)}>
        <Trash2 size={18} aria-hidden="true" />
      </button>
    )
  }
  return (
    <span className="qconfirm">
      <span className="qrow__confirm" role="alert">{deleteConfirmText(t, optionCount)}</span>
      <button type="button" className="qbtn qbtn--danger" onClick={onDelete}>{t.quotes.deleteYes}</button>
      <button type="button" className="qbtn" onClick={() => setConfirming(false)}>{t.quotes.cancel}</button>
    </span>
  )
}
