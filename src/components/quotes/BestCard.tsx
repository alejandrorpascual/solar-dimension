import { Info } from 'lucide-react'
import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { entryName, type RankedQuote } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { quoteSizing, SIZED_IDS } from '../../lib/quote-sizing'
import { coverageLines, entrySubtitle, gaugeLegend, isTotalTyped, money, oversizeTip, type CoverageKind } from '../../lib/quote-text'
import { ChecksToggle } from './ChecksToggle'
import { ItemList } from './ItemList'
import { QuoteActions } from './QuoteActions'
import { SizingGauge } from './SizingGauge'

/** The words carry the meaning; the mark only repeats it at a glance. */
const MARK: Record<CoverageKind, string> = { ok: '✓', short: '!', missing: '!', unclear: '?', unknown: '?' }

interface Props {
  best: RankedQuote; kit: KitNeeds; error: string | null
  /** Whether Read again is on offer (see UnrankedRow); it only shows for a quote that needs review. */
  retry: 'retry' | 'used_up' | 'none'
  onOverride: (item: ItemId, value: Override | null) => void
  onRetry: () => void; onDelete: () => void
}

export function BestCard({ best, kit, error, retry, onOverride, onRetry, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const titleId = useId()
  const bodyId = useId()
  const sizing = quoteSizing(best.items, kit)
  const gauges = SIZED_IDS.flatMap((id) => {
    const s = sizing[id]
    return s ? [{ id, s }] : []
  })
  const subtitle = entrySubtitle(t, best)
  const tip = oversizeTip(t, kit, sizing)
  // A quote with a typed total ranks even while its reading needs a check, so the way to read it again is on the card.
  const canReadAgain = best.quote.status === 'needs_review' && retry === 'retry'
  return (
    <section className="qpanel qpanel--best" aria-labelledby={titleId}>
      <span className="qpill qpill--best qbest__pill">{t.quotes.bestFit}</span>
      <div className="qhead__top">
        <div className="qhead__id">
          <h2 className="qpanel__title qhead__name" id={titleId}>{best.name}</h2>
          {subtitle && <p className="qmeta qhead__sub">{subtitle}</p>}
        </div>
        <p className="qbest__total num">{money(t, best.total, best.currency)}</p>
      </div>
      {isTotalTyped(best) && <p className="qmeta">{t.quotes.totalTyped}</p>}
      {gauges.length > 0 && (
        <div className="qbest__gauges">
          {gauges.map(({ id, s }) => <SizingGauge key={id} id={id} s={s} />)}
          <p className="qmeta">{gaugeLegend(t)}</p>
        </div>
      )}
      {tip && <p className="qtip"><Info size={18} aria-hidden="true" /><span>{tip}</span></p>}
      <ul className="qcover">
        {coverageLines(t, best.items).map((l) => (
          <li key={l.kind} className={`qcover__line qcover__line--${l.kind}`}>
            <span className="qcover__mark" aria-hidden="true">{MARK[l.kind]}</span>{l.text}
          </li>
        ))}
      </ul>
      <div className="qbest__actions">
        <ChecksToggle name={entryName(best)} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="button" />
        {canReadAgain && <button type="button" className="qbtn" onClick={onRetry}>{t.quotes.readAgain}</button>}
        <QuoteActions quoteId={best.quote.id} optionCount={best.optionCount} onDelete={onDelete} />
      </div>
      {isOpen && <div id={bodyId}><ItemList items={best.items} kit={kit} currency={best.currency} onOverride={onOverride} /></div>}
      {error && <p className="qerr" role="alert">{error}</p>}
    </section>
  )
}
