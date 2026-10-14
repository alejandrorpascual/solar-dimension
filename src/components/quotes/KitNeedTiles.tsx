import { useLocale } from '../../hooks/useLocale'
import { fmtInverter, fmtKwh, fmtW } from '../../i18n/format'
import type { KitNeeds } from '../../lib/quote-items'

/**
 * What every quote is measured against: the kit's running load and the inverter its sheet lists for it, the usable
 * energy it needs when it stores any, and its solar array.
 */
export function KitNeedTiles({ kit }: { kit: KitNeeds }) {
  const { t } = useLocale()
  return (
    <section className="qneeds" aria-label={t.quotes.kitNeedsTitle}>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needInverter}</span>
        <span className="qneed__value num">{fmtW(kit.runningW, t.locale)}</span>
      </div>
      <div className="qneed">
        <span className="qmeta">{t.quotes.needSheetInverter}</span>
        <span className="qneed__value num">{fmtInverter(kit.sheetInverter, t.locale)}</span>
      </div>
      {kit.usableWh > 0 && (
        <div className="qneed">
          <span className="qmeta">{t.quotes.needBattery}</span>
          <span className="qneed__value num">{fmtKwh(kit.usableWh, t.locale)}</span>
        </div>
      )}
      {kit.arrayW > 0 && (
        <div className="qneed">
          <span className="qmeta">{t.quotes.needArray}</span>
          <span className="qneed__value num">{fmtW(kit.arrayW, t.locale)}</span>
        </div>
      )}
    </section>
  )
}
