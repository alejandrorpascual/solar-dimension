import { useId } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { trq } from '../../i18n'
import type { RankedQuote, Verdict } from '../../lib/quote-compare'
import { plotScale } from '../../lib/quote-plot'
import { fitLabel, money } from '../../lib/quote-text'

const pointKind = (r: RankedQuote, v: Verdict): string => (v.best?.quote.id === r.quote.id ? 'best' : r.fit)

/** Price on a shared axis, one row per ranked quote; only quotes that fit get a filled dot. */
export function PricePlot({ verdict }: { verdict: Verdict }) {
  const { t } = useLocale()
  const titleId = useId()
  const rows = [...verdict.ranked].sort((a, b) => a.total - b.total)
  const currency = verdict.currency ?? 'USD'
  const scale = plotScale(rows.map((r) => r.total))
  const label = rows.map((r) => trq(t, 'plotPoint', { name: r.name, total: money(t, r.total, currency), fit: fitLabel(t, r, verdict) })).join('. ')
  return (
    <section className="qpanel" aria-labelledby={titleId}>
      <div>
        <h2 className="qpanel__title" id={titleId}>{t.quotes.priceAndFit}</h2>
        <p className="qmeta">{t.quotes.plotHelp}</p>
      </div>
      <div role="img" aria-label={label}>
        <div className="qplot__rows">
          {rows.map((r) => (
            <div className="qplot__row" key={r.quote.id}>
              <div className={pointKind(r, verdict) === 'best' ? 'qplot__name qplot__name--best' : 'qplot__name'}>
                <span>{r.name}</span>
                <span className="qmeta num">{money(t, r.total, currency)} · {fitLabel(t, r, verdict)}</span>
              </div>
              <div className="qplot__track">
                <span className={`qplot__pt qplot__pt--${pointKind(r, verdict)}`} style={{ left: `${scale.pos(r.total)}%` }} />
              </div>
            </div>
          ))}
          {verdict.best && (
            <div className="qplot__rulebox" aria-hidden="true">
              <span className="qplot__rule" style={{ left: `${scale.pos(verdict.best.total)}%` }} />
            </div>
          )}
        </div>
        <div className="qplot__axis" aria-hidden="true">
          {scale.ticks.map((v) => (
            <span key={v} className="qplot__tick num" style={{ left: `${scale.pos(v)}%` }}>{money(t, v, currency)}</span>
          ))}
        </div>
      </div>
      {verdict.best && <p className="qplot__legend qmeta"><span className="qplot__legend-rule" aria-hidden="true" />{t.quotes.plotRule}</p>}
    </section>
  )
}
