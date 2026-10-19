import { useId, useState, type FormEvent } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import { entryName, type UnrankedQuote } from '../../lib/quote-compare'
import { parseTotal } from '../../lib/quote-guards'
import { lineRows } from '../../lib/quote-line-text'
import { entrySubtitle, fileStatusText, misreadText, readTotalText, totalHelp } from '../../lib/quote-text'
import { ChecksToggle } from './ChecksToggle'
import { QuoteActions } from './QuoteActions'
import { QuoteFacts } from './QuoteFacts'
import { QuoteLines } from './QuoteLines'

interface Props {
  u: UnrankedQuote; error: string | null
  /** Read again for a quote to check, or nothing, for an account that may not start reads or a quote whose retries are used. */
  retry: 'retry' | 'used_up' | 'none'
  onRetry: () => void; onDelete: () => void; onTotal: (total: number) => void
}

/**
 * A read quote that can't be ranked yet: it needs a corrected total, needs reading again, has no price for an option, or
 * is in another currency. Show checks lists the lines that were read, so what failed can be seen. Quotes still reading or
 * that couldn't be read are ProgressCards.
 */
export function UnrankedRow({ u, error, retry, onRetry, onDelete, onTotal }: Props) {
  const { t } = useLocale()
  const nameId = useId()
  const inputId = useId()
  const errorId = useId()
  const bodyId = useId()
  const [isOpen, setOpen] = useState(false)
  // The field starts empty, beside the total that was read: saving the figure that failed the check takes typing it.
  const [total, setTotal] = useState('')
  const [isInvalid, setInvalid] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = parseTotal(total)
    setInvalid(n === null)
    if (n !== null) onTotal(n)
  }
  const waitsForTotal = u.reason === 'needs_review' || u.reason === 'no_total'
  const extraction = u.quote.extraction
  const readText = extraction === null ? null : readTotalText(t, extraction)
  // A typed total would belong to neither of a quote's systems, so a quote with options gets Read again instead of the form.
  const hasTotalForm = waitsForTotal && u.optionCount === 0
  const canReadAgain = u.quote.status === 'needs_review' && retry === 'retry'
  const pill = u.reason === 'other_currency'
    ? { cls: 'qpill qpill--unk', text: trq(t, 'otherCurrency', { currency: u.currency ?? '' }) }
    : u.reason === 'no_price'
      ? { cls: 'qpill qpill--warn', text: t.quotes.noPrice }
      : { cls: 'qpill qpill--warn', text: fileStatusText(t, u.quote.status) }
  const subtitle = entrySubtitle(t, u)
  const hasLines = extraction !== null && lineRows(t, extraction, u.optionId).length > 0
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qhead__top">
        <div className="qhead__id">
          <h3 className="qrow__name qhead__name" id={nameId}>{u.name}</h3>
          {subtitle && <p className="qmeta qhead__sub">{subtitle}</p>}
        </div>
        <span className={pill.cls}>{pill.text}</span>
      </div>
      {hasTotalForm && (
        <form className="qrow__form" onSubmit={submit}>
          <p className="qmeta" style={{ flexBasis: '100%' }}>{totalHelp(t, u)}</p>
          {readText && <p className="qmeta num" style={{ flexBasis: '100%' }}>{readText}</p>}
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
      {waitsForTotal && u.optionCount > 0 && <p className="qmeta">{trq(t, canReadAgain ? 'optionsReviewHelp' : 'optionsReviewHelpNoRetry', { count: u.optionCount })}</p>}
      {u.reason === 'misread' && extraction !== null && <p className="qmeta">{misreadText(t, extraction, u.quote.pages, canReadAgain)}</p>}
      <div className="qrow__actions">
        {canReadAgain && <button type="button" className="qbtn" onClick={onRetry}>{t.quotes.readAgain}</button>}
        <QuoteActions quoteId={u.quote.id} optionCount={u.optionCount} onDelete={onDelete} />
      </div>
      {hasLines && <ChecksToggle name={entryName(u)} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="link" />}
      {hasLines && isOpen && (
        <div className="qrow__body" id={bodyId}>
          <QuoteLines extraction={extraction} optionId={u.optionId} />
          <QuoteFacts extraction={extraction} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
