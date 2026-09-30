import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { RankedQuote, Verdict } from '../../lib/quote-compare'
import { STRIP_ITEMS, type ItemId, type KitNeeds, type Override } from '../../lib/quote-items'
import { deltaText, fitLabel, markLabel, money, reasonLine } from '../../lib/quote-text'
import { AskBox } from './AskBox'
import { ItemList } from './ItemList'
import { ItemMark } from './ItemMark'
import { QuoteActions } from './QuoteActions'

const PILL: Record<RankedQuote['fit'], string> = { fits: 'qpill qpill--ok', unclear: 'qpill qpill--unk', short: 'qpill qpill--warn' }

interface Props {
  r: RankedQuote; verdict: Verdict; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  onDelete: () => void
}

export function QuoteRow({ r, verdict, kit, error, onOverride, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const nameId = useId()
  const bodyId = useId()
  const isAsking = verdict.worthAsking.some((w) => w.quote.id === r.quote.id)
  const strip = STRIP_ITEMS.flatMap((id) => r.items.filter((c) => c.id === id))
  const delta = deltaText(t, r)
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qrow__head">
        <span className="qrank">{r.rank}</span>
        <div className="qrow__main">
          <div className="qrow__titleline">
            <h3 className="qrow__name" id={nameId}>{r.name}</h3>
            <span className={PILL[r.fit]}>{fitLabel(t, r, verdict)}</span>
          </div>
          <p className="qrow__reason">{reasonLine(t, r, verdict, kit)}</p>
        </div>
        <ul className="qrow__strip">
          {strip.map((c) => (
            <li key={c.id}><ItemMark status={c.status} label={`${t.quoteItems[c.id]}: ${markLabel(t, c.status)}`} /><span aria-hidden="true">{t.quoteItemsShort[c.id]}</span></li>
          ))}
        </ul>
        <div className="qrow__money">
          <div className="qrow__total num">{money(t, r.total, r.currency)}</div>
          {delta && <div className="qrow__delta num">{delta}</div>}
        </div>
        <button type="button" className="qrow__toggle" aria-expanded={isOpen} aria-controls={bodyId}
          aria-label={trq(t, isOpen ? 'hideChecks' : 'showChecks', { name: r.name })} onClick={() => setOpen(!isOpen)}>
          <ChevronDown size={18} aria-hidden="true" />
        </button>
      </div>
      {isAsking && <AskBox r={r} verdict={verdict} />}
      {isOpen && (
        <div className="qrow__body" id={bodyId}>
          <ItemList items={r.items} kit={kit} currency={r.currency} onOverride={onOverride} />
          <QuoteActions quoteId={r.quote.id} onDelete={onDelete} />
        </div>
      )}
      {error && <p className="qerr" role="alert">{error}</p>}
    </article>
  )
}
