import { Trash2 } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import { deleteConfirmText } from '../../lib/quote-text'
import { InlineConfirm, useAskFirst } from '../InlineConfirm'

interface Props { name: string; optionCount: number; onDelete: () => void }

/** A trash button that asks first, in place, since deleting also removes the file for good. */
export function ConfirmDelete({ name, optionCount, onDelete }: Props) {
  const { t } = useLocale()
  const { isAsking, askerRef, ask, cancel } = useAskFirst()
  if (!isAsking) {
    return (
      <button ref={askerRef} type="button" className="qicon" aria-label={trq(t, 'deleteFile', { name })} onClick={ask}>
        <Trash2 size={18} aria-hidden="true" />
      </button>
    )
  }
  return (
    <span className="qconfirm">
      <InlineConfirm look="row" question={deleteConfirmText(t, optionCount)} yes={t.quotes.deleteYes} onYes={onDelete} onCancel={cancel} />
    </span>
  )
}
