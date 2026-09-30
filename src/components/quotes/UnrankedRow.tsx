import { useId, useState, type FormEvent } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { UnrankedQuote } from '../../lib/quote-compare'
import { parseTotal } from '../../lib/quote-guards'
import { fileStatusText } from '../../lib/quote-text'
import { QuoteActions } from './QuoteActions'

interface Props {
  u: UnrankedQuote; error: string | null
  /** False once the quote has used its retries: the row says so instead of offering Retry. */
  canRetry: boolean
  onRetry: () => void; onDelete: () => void; onTotal: (total: number) => void
}

/** A quote that can't be ranked yet: still reading, needs a corrected total, couldn't be read, or in another currency. */
export function UnrankedRow({ u, error, canRetry, onRetry, onDelete, onTotal }: Props) {
  const { t } = useLocale()
  const nameId = useId()
  const inputId = useId()
  const errorId = useId()
  const [total, setTotal] = useState(String(u.quote.extraction?.total ?? ''))
  const [isInvalid, setInvalid] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseTotal(total)
    setInvalid(n === null)
    if (n !== null) onTotal(n)
  }
  const pill = u.reason === 'reading'
    ? { cls: 'qpill qpill--run', text: fileStatusText(t, u.quote.status) }
    : u.reason === 'other_currency'
      ? { cls: 'qpill qpill--unk', text: trq(t, 'otherCurrency', { currency: u.currency ?? '' }) }
      : { cls: 'qpill qpill--warn', text: fileStatusText(t, u.quote.status) }
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qrow__titleline">
        <h3 className="qrow__name" id={nameId}>{u.name}</h3>
        <span className={pill.cls}>{pill.text}</span>
      </div>
      {u.reason === 'needs_review' && (
        <form className="qrow__form" onSubmit={submit}>
          <p className="qmeta" style={{ flexBasis: '100%' }}>{t.quotes.checkNumbersHelp}</p>
          <label htmlFor={inputId}>{t.quotes.totalInQuote}
            <input id={inputId} className="in num" inputMode="decimal" value={total} aria-invalid={isInvalid || undefined}
              aria-describedby={isInvalid ? errorId : undefined}
              onChange={(e) => {
                setTotal(e.target.value)
                setInvalid(false)
              }} />
          </label>
          <button type="submit" className="qbtn">{t.quotes.save}</button>
          {isInvalid && <p className="qerr" id={errorId} role="alert" style={{ flexBasis: '100%' }}>{t.quotes.totalInvalid}</p>}
        </form>
      )}
      {u.reason !== 'reading' && (
        <div className="qrow__actions">
          {u.reason === 'failed' && (canRetry
            ? <button type="button" className="qbtn" onClick={onRetry}>{t.quotes.retry}</button>
            : <p className="qmeta">{t.quotes.retryLimit}</p>)}
          <QuoteActions quoteId={u.quote.id} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
