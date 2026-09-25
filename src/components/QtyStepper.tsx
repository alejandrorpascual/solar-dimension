import { Minus, Plus, Trash2 } from 'lucide-react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { QtyField } from './ApplianceCard'

interface Props { name: string; qty: number; onSet: (n: number) => void; size?: 'md' | 'sm' }

/** − (a bin at one, since the next tap removes the line), a typeable count, +. */
export function QtyStepper({ name, qty, onSet, size = 'md' }: Props) {
  const { t } = useLocale()
  const isLast = qty <= 1
  const icon = size === 'sm' ? 14 : 16
  return (
    <div className={`qstep qstep--${size}`}>
      <button type="button" className="st qstep__b" aria-label={tr(t, isLast ? 'remove' : 'removeOne', { name })} onClick={() => onSet(qty - 1)}>
        {isLast ? <Trash2 size={icon} aria-hidden="true" /> : <Minus size={icon} aria-hidden="true" />}
      </button>
      <QtyField qty={qty} label={tr(t, 'qtyOf', { name })} onSet={onSet} />
      <button type="button" className="st qstep__b" aria-label={tr(t, 'addOne', { name })} onClick={() => onSet(qty + 1)}>
        <Plus size={icon} aria-hidden="true" />
      </button>
    </div>
  )
}
