import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { RankedQuote } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { markLabel, money } from '../../lib/quote-text'
import { ItemList } from './ItemList'
import { ItemMark } from './ItemMark'
import { QuoteActions } from './QuoteActions'

interface Props {
  best: RankedQuote; nextFit: RankedQuote | null; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  onDelete: () => void
}

export function BestCard({ best, nextFit, kit, error, onOverride, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const titleId = useId()
  const bodyId = useId()
  return (
    <section className="qpanel qpanel--best" aria-labelledby={titleId}>
      <div className="qbest__top">
        <span className="qpill qpill--best">{t.quotes.bestFit}</span>
        <span className="qmeta">{best.quote.fileName}</span>
      </div>
      <div>
        <h2 className="qpanel__title" id={titleId}>{best.name}</h2>
        <p className="qbest__total num">{money(t, best.total, best.currency)}</p>
        <p className="qmeta num">
          {nextFit ? trq(t, 'nextFitGap', { amount: money(t, nextFit.total - best.total, best.currency) }) : t.quotes.onlyFit}
        </p>
      </div>
      <ul className="qbest__items">
        {best.items.map((c) => (
          <li key={c.id}><ItemMark status={c.status} label={markLabel(t, c.status)} /><span>{t.quoteItems[c.id]}</span></li>
        ))}
      </ul>
      <button type="button" className="qlink" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setOpen(!isOpen)}>
        {trq(t, isOpen ? 'hideChecks' : 'showChecks', { name: best.name })}
      </button>
      {isOpen && <div id={bodyId}><ItemList items={best.items} kit={kit} currency={best.currency} onOverride={onOverride} /></div>}
      <QuoteActions quoteId={best.quote.id} onDelete={onDelete} />
      {error && <p className="qerr" role="alert">{error}</p>}
    </section>
  )
}
