import type { CatalogItem } from '../lib/catalog'
import { fmtInt, fmtW } from '../lib/format'

interface Props { item: CatalogItem; qty: number; onInc: () => void; onDec: () => void; onRemove?: () => void }

export function ApplianceCard({ item, qty, onInc, onDec, onRemove }: Props) {
  const on = qty > 0
  return (
    <div className={`card${on ? ' card--on' : ''}`}>
      <div className="card__body">
        <div className="card__name">{item.name}</div>
        <div className="card__spec num">{fmtInt(item.watts)} W running · {fmtW(item.surge)} surge</div>
        {item.isCustom && <div className="card__spec">{item.note}</div>}
      </div>
      {onRemove && (
        <button type="button" className="x" aria-label={`Remove ${item.name}`} onClick={onRemove}>×</button>
      )}
      {on ? (
        <div className="stepper-qty">
          <button type="button" className="st" aria-label={`Remove one ${item.name}`} onClick={onDec}>−</button>
          <div className="num stepper-qty__n">{qty}</div>
          <button type="button" className="st" aria-label={`Add one ${item.name}`} onClick={onInc}>+</button>
        </div>
      ) : (
        <button type="button" className="add" aria-label={`Add ${item.name}`} onClick={onInc}>Add</button>
      )}
    </div>
  )
}
