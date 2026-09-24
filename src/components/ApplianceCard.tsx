import { useLocale } from '../hooks/useLocale'
import { applianceName, applianceNote, tr } from '../i18n'
import { fmtInt, fmtW } from '../i18n/format'
import type { CatalogItem } from '../lib/catalog'

interface Props { item: CatalogItem; qty: number; onInc: () => void; onDec: () => void; onRemove?: () => void }

export function ApplianceCard({ item, qty, onInc, onDec, onRemove }: Props) {
  const { t, locale } = useLocale()
  const on = qty > 0
  const name = applianceName(t, item)
  return (
    <div className={`card${on ? ' card--on' : ''}`}>
      <div className="card__body">
        <div className="card__name">{name}</div>
        <div className="card__spec num">{tr(t, 'runningSurgeLine', { watts: fmtInt(item.watts, locale), surge: fmtW(item.surge, locale) })}</div>
        {item.isCustom && <div className="card__spec">{applianceNote(t, item)}</div>}
      </div>
      {onRemove && (
        <button type="button" className="x" aria-label={tr(t, 'remove', { name })} onClick={onRemove}>×</button>
      )}
      {on ? (
        <div className="stepper-qty">
          <button type="button" className="st" aria-label={tr(t, 'removeOne', { name })} onClick={onDec}>−</button>
          <div className="num stepper-qty__n">{qty}</div>
          <button type="button" className="st" aria-label={tr(t, 'addOne', { name })} onClick={onInc}>+</button>
        </div>
      ) : (
        <button type="button" className="add" aria-label={tr(t, 'addOne', { name })} onClick={onInc}>{t.ui.add}</button>
      )}
    </div>
  )
}
