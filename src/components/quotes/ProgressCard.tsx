import { Check, ExternalLink, RotateCw, X } from 'lucide-react'
import { useId } from 'react'
import { useElapsedSeconds } from '../../hooks/useElapsedSeconds'
import { useLocale } from '../../hooks/useLocale'
import type { UnrankedQuote } from '../../lib/quote-compare'
import { readSteps, readyInText, stepLabel, triesLeftText, type ReadStep } from '../../lib/quote-progress'
import { ConfirmDelete } from './ConfirmDelete'
import { Spinner } from './Spinner'

interface Props {
  /** A quote still being read, or one the model gave up on. */
  u: UnrankedQuote
  retries: number
  retry: 'retry' | 'used_up' | 'none'
  error: string | null
  onRetry: () => void
  onDelete: () => void
}

function StepMark({ step }: { step: ReadStep }) {
  if (step.state === 'active') return <Spinner size={22} />
  if (step.state === 'done') return <span className="qstep__dot"><Check size={12} strokeWidth={3} aria-hidden="true" /></span>
  if (step.state === 'failed') return <span className="qstep__dot"><X size={12} strokeWidth={3} aria-hidden="true" /></span>
  return <span className="qstep__dot" />
}

/** A quote not compared yet, as the steps it has been through: uploaded, read (or not), compared with the kit. */
export function ProgressCard({ u, retries, retry, error, onRetry, onDelete }: Props) {
  const { t } = useLocale()
  const nameId = useId()
  const isFailed = u.reason === 'failed'
  const elapsed = useElapsedSeconds(!isFailed)
  const sub = !isFailed ? readyInText(t, elapsed) : retry === 'retry' ? triesLeftText(t, retries) : retry === 'used_up' ? t.quotes.retryLimit : null
  return (
    <article className={isFailed ? 'qrow qrow--failed' : 'qrow'} aria-labelledby={nameId}>
      <div className="qhead__id">
        <h3 className="qrow__name qhead__name" id={nameId}>{u.name}</h3>
        {sub && <p className="qmeta qhead__sub">{sub}</p>}
      </div>
      <ol className="qsteps">
        {readSteps(u.quote.status).map((s) => (
          <li key={s.id} className={`qstep qstep--${s.state}`}>
            <StepMark step={s} />
            <span className="qstep__text">
              <span className="qstep__label">{stepLabel(t, s, u.quote.status)}</span>
              {s.state === 'failed' && retry === 'retry' && <span className="qmeta">{t.quotes.failedHelp}</span>}
            </span>
          </li>
        ))}
      </ol>
      {isFailed && (
        <div className="qrow__actions">
          {retry === 'retry' && (
            <button type="button" className="qbtn qbtn--primary" onClick={onRetry}><RotateCw size={16} aria-hidden="true" />{t.quotes.retry}</button>
          )}
          <a className="qlink" href={`/api/quotes/${u.quote.id}/file`} target="_blank" rel="noopener noreferrer">
            {t.quotes.viewOriginal}<ExternalLink size={14} aria-hidden="true" />
          </a>
          <span className="qrow__spacer" />
          <ConfirmDelete name={u.name} optionCount={u.optionCount} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
