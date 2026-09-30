import { useId, useState, type FormEvent } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { UnrankedQuote } from '../../lib/quote-compare'
import { parseAmount } from '../../lib/parse-amount'
import { fileStatusText } from '../../lib/quote-text'
import { QuoteActions } from './QuoteActions'

interface Props {
  u: UnrankedQuote; error: string | null
  onRetry: () => void; onDelete: () => void; onTotal: (total: number) => void
}

/** A quote that can't be ranked yet: still reading, needs a corrected total, couldn't be read, or in another currency. */
export function UnrankedRow({ u, error, onRetry, onDelete, onTotal }: Props) {
  const { t } = useLocale()
  const nameId = useId()
  const inputId = useId()
  const [total, setTotal] = useState(String(u.quote.extraction?.total ?? ''))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseAmount(total)
    if (n !== null && n > 0) onTotal(n)
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
            <input id={inputId} className="in num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
          </label>
          <button type="submit" className="qbtn">{t.quotes.save}</button>
        </form>
      )}
      {u.reason !== 'reading' && (
        <div className="qrow__actions">
          {u.reason === 'failed' && <button type="button" className="qbtn" onClick={onRetry}>{t.quotes.retry}</button>}
          <QuoteActions quoteId={u.quote.id} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
