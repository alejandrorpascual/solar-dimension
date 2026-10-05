import { Check, FileText, RotateCw, TriangleAlert } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import type { UploadItem } from '../../hooks/useQuoteUpload'
import { useRootData } from '../../hooks/useRootData'
import { retryOffer } from '../../lib/quote-guards'
import type { JobFile } from '../../lib/quote-jobs'
import { handoffRowMeta, handoffRowState } from '../../lib/quote-progress'
import { ConfirmDelete } from './ConfirmDelete'
import { Spinner } from './Spinner'

interface Props {
  item: UploadItem
  /** The quote in the jobs list; null until the list has it. */
  file: JobFile | null
  error: string | null
  onRetry: () => void
  onDelete: () => void
}

/**
 * One file in the hand-off dialog: a spinner while it is on its way, Retry and Delete when it couldn't be read. Retry
 * follows the verdict card's rule, so a quote whose retries are used up says so instead of offering it.
 */
export function HandoffRow({ item, file, error, onRetry, onDelete }: Props) {
  const { t } = useLocale()
  const { user } = useRootData()
  const status = file?.status ?? null
  const state = handoffRowState(item, status)
  const offer = file ? retryOffer(file, user?.canUseQuotes === true) : 'none'
  const meta = state === 'failed' && offer === 'used_up'
    ? t.quotes.retryLimit
    : handoffRowMeta(t, state, item.state === 'uploading' ? 'uploading' : status ?? 'queued', item.rejection)
  const Icon = state === 'done' ? Check : state === 'working' ? FileText : TriangleAlert
  return (
    <li className={`qhand__row qhand__row--${state}`}>
      <span className="qhand__icon"><Icon size={18} aria-hidden="true" /></span>
      <span className="qhand__id">
        <span className="qhand__name">{item.name}</span>
        {/* A refusal is news the user didn't see coming: announced, as the old list of refused files was. */}
        <span className="qhand__meta" role={state === 'rejected' ? 'alert' : undefined}>{meta}</span>
      </span>
      {state === 'working' && <span className="qhand__spin"><Spinner size={22} /></span>}
      {state === 'failed' && item.id !== null && (
        <span className="qhand__actions">
          {offer === 'retry' && (
            <button type="button" className="qbtn" onClick={onRetry}><RotateCw size={16} aria-hidden="true" />{t.quotes.retry}</button>
          )}
          <ConfirmDelete name={item.name} optionCount={0} onDelete={onDelete} />
        </span>
      )}
      {error && <p className="qerr qhand__err" role="alert">{error}</p>}
    </li>
  )
}
