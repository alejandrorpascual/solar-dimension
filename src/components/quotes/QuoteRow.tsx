import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { entryKey, entryName, type RankedQuote, type Verdict } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { quoteSizing } from '../../lib/quote-sizing'
import { coverageMeta, deltaText, entrySubtitle, fitLabel, money, reasonLine } from '../../lib/quote-text'
import { AskBox } from './AskBox'
import { ChecksToggle } from './ChecksToggle'
import { ItemList } from './ItemList'
import { QuoteActions } from './QuoteActions'
import { SizingBars } from './SizingBars'

const PILL: Record<RankedQuote['fit'], string> = { fits: 'qpill qpill--ok', unclear: 'qpill qpill--unk', short: 'qpill qpill--warn' }

interface Props {
  r: RankedQuote; verdict: Verdict; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  /** Whether Read again is on offer (see UnrankedRow); it only shows for a quote that needs review. */
  retry: 'retry' | 'used_up' | 'none'
  onRetry: () => void; onDelete: () => void
}

/** A ranked quote as a stacked card: name and total on one line, then fit, the reason at full width, sizing and coverage. */
export function QuoteRow({ r, verdict, kit, error, retry, onOverride, onRetry, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const nameId = useId()
  const bodyId = useId()
  const isAsking = verdict.worthAsking.some((w) => entryKey(w) === entryKey(r))
  const delta = deltaText(t, r)
  const subtitle = entrySubtitle(t, r)
  const coverage = coverageMeta(t, r.items)
  // A quote with a typed total ranks even while its reading needs a check, so the way to read it again is on the card.
  const canReadAgain = r.quote.status === 'needs_review' && retry === 'retry'
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qhead__top">
        <div className="qhead__id">
          <h3 className="qrow__name qhead__name" id={nameId}>{r.name}</h3>
          {subtitle && <p className="qmeta qhead__sub">{subtitle}</p>}
        </div>
        <p className="qrow__total num">{money(t, r.total, r.currency)}</p>
      </div>
      <div className="qrow__fitline">
        <span className={PILL[r.fit]}>{fitLabel(t, r, verdict)}</span>
        {delta && <span className="qmeta num">{delta}</span>}
      </div>
      <p className="qrow__reason">{reasonLine(t, r, verdict, kit)}</p>
      <SizingBars sizing={quoteSizing(r.items, kit)} />
      {coverage && <p className="qmeta">{coverage}</p>}
      {canReadAgain && <div className="qrow__actions"><button type="button" className="qbtn" onClick={onRetry}>{t.quotes.readAgain}</button></div>}
      {isAsking && <AskBox r={r} verdict={verdict} />}
      <ChecksToggle name={entryName(r)} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="link" />
      {isOpen && (
        <div className="qrow__body" id={bodyId}>
          <ItemList items={r.items} kit={kit} currency={r.currency} onOverride={onOverride} />
          <QuoteActions quoteId={r.quote.id} optionCount={r.optionCount} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
