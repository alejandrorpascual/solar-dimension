import { useId, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { quoteSubtitle, type RankedQuote, type Verdict } from '../../lib/quote-compare'
import type { ItemId, KitNeeds, Override } from '../../lib/quote-items'
import { quoteSizing } from '../../lib/quote-sizing'
import { coverageLines, deltaText, fitLabel, money, reasonLine } from '../../lib/quote-text'
import { AskBox } from './AskBox'
import { ChecksToggle } from './ChecksToggle'
import { ItemList } from './ItemList'
import { QuoteActions } from './QuoteActions'
import { SizingBars } from './SizingBars'

const PILL: Record<RankedQuote['fit'], string> = { fits: 'qpill qpill--ok', unclear: 'qpill qpill--unk', short: 'qpill qpill--warn' }
const COVERAGE_SEPARATOR = ' · '

interface Props {
  r: RankedQuote; verdict: Verdict; kit: KitNeeds; error: string | null
  onOverride: (item: ItemId, value: Override | null) => void
  onDelete: () => void
}

/** A ranked quote as a stacked card: name and total on one line, then fit, the reason at full width, sizing and coverage. */
export function QuoteRow({ r, verdict, kit, error, onOverride, onDelete }: Props) {
  const { t } = useLocale()
  const [isOpen, setOpen] = useState(false)
  const nameId = useId()
  const bodyId = useId()
  const isAsking = verdict.worthAsking.some((w) => w.quote.id === r.quote.id)
  const delta = deltaText(t, r)
  const subtitle = quoteSubtitle(r.quote)
  const coverage = coverageLines(t, r.items).map((l) => l.text).join(COVERAGE_SEPARATOR)
  return (
    <article className="qrow" aria-labelledby={nameId}>
      <div className="qcard__top">
        <div className="qcard__id">
          <h3 className="qrow__name qcard__name" id={nameId}>{r.name}</h3>
          {subtitle && <p className="qmeta qcard__sub">{subtitle}</p>}
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
      {isAsking && <AskBox r={r} verdict={verdict} />}
      <ChecksToggle name={r.name} isOpen={isOpen} controls={bodyId} onToggle={() => setOpen(!isOpen)} variant="link" />
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
