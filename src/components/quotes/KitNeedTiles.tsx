import { useLocale } from '../../hooks/useLocale'
import { fmtKwh, fmtW } from '../../i18n/format'
import type { KitNeeds } from '../../lib/quote-items'

/** What every quote is measured against: the kit's running load and the usable energy it needs. */
export function KitNeedTiles({ kit }: { kit: KitNeeds }) {
  const { t } = useLocale()
  return (
    <section className="qneeds" aria-label={t.quotes.kitNeedsTitle}>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needInverter}</span>
        <span className="qneed__value num">{fmtW(kit.runningW, t.locale)}</span>
      </div>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needBattery}</span>
        <span className="qneed__value num">{fmtKwh(kit.usableWh, t.locale)}</span>
      </div>
    </section>
  )
}
