import { Check, FileText, RotateCw, TriangleAlert } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import type { UploadItem } from '../../hooks/useQuoteUpload'
import { handoffRowMeta, handoffRowState } from '../../lib/quote-progress'
import type { QuoteStatus } from '../../lib/quote-schema'
import { ConfirmDelete } from './ConfirmDelete'
import { Spinner } from './Spinner'

interface Props {
  item: UploadItem
  /** The quote's status from the jobs list; null until the list has it. */
  status: QuoteStatus | null
  error: string | null
  onRetry: () => void
  onDelete: () => void
}

/** One file in the hand-off dialog: a spinner while it is on its way, Retry and Delete when it couldn't be read. */
export function HandoffRow({ item, status, error, onRetry, onDelete }: Props) {
  const { t } = useLocale()
  const state = handoffRowState(item, status)
  const meta = handoffRowMeta(t, state, item.state === 'uploading' ? 'uploading' : status ?? 'queued', item.rejection)
  const Icon = state === 'done' ? Check : state === 'working' ? FileText : TriangleAlert
  return (
    <li className={`qhand__row qhand__row--${state}`}>
      <span className="qhand__icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="qhand__id">
        <span className="qhand__name">{item.name}</span>
        <span className="qhand__meta">{meta}</span>
      </span>
      {state === 'working' && <span className="qhand__spin"><Spinner size={22} /></span>}
      {state === 'failed' && item.id !== null && (
        <span className="qhand__actions">
          <button type="button" className="qbtn" onClick={onRetry}><RotateCw size={16} aria-hidden="true" />{t.quotes.retry}</button>
          <ConfirmDelete name={item.name} optionCount={0} onDelete={onDelete} />
        </span>
      )}
      {error && <p className="qerr qhand__err" role="alert">{error}</p>}
    </li>
  )
}
