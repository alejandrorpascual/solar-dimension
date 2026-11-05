import { Minus, Plus, Trash2 } from 'lucide-react'
import { useState, type Ref } from 'react'
import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { clampQty, parseQty } from '../lib/store'

/** The count between − and +, typeable for large numbers (a condo's 40 cameras). Commits on blur or Enter. */
function QtyField({ qty, label, onSet }: { qty: number; label: string; onSet: (n: number) => void }) {
  const [draft, setDraft] = useState(String(qty))
  const [shown, setShown] = useState(qty)
  if (shown !== qty) {
    setShown(qty)
    setDraft(String(qty))
  }
  const commit = () => {
    const n = parseQty(draft)
    const next = n === null ? qty : clampQty(n)
    setDraft(String(next))
    if (next !== qty) onSet(next)
  }
  return (
    <input
      className="num stepper-qty__n"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
    />
  )
}

interface Props {
  name: string
  qty: number
  onSet: (n: number) => void
  size?: 'md' | 'sm'
  /** A bin in place of − at one, since the next tap removes the line. Off where − at one keeps its "Remove one" name. */
  hasBinAtOne?: boolean
  /** The + button, for a caller that moves focus onto it. */
  plusRef?: Ref<HTMLButtonElement>
}

/** − (a bin at one unless turned off), a typeable count, +. The one quantity stepper in the kit builder. */
export function QtyStepper({ name, qty, onSet, size = 'md', hasBinAtOne = true, plusRef }: Props) {
  const { t } = useLocale()
  const isBin = hasBinAtOne && qty <= 1
  const icon = size === 'sm' ? 14 : 16
  return (
    <div className={`qstep qstep--${size}`}>
      <button type="button" className="st qstep__b" aria-label={tr(t, isBin ? 'remove' : 'removeOne', { name })} onClick={() => onSet(qty - 1)}>
        {isBin ? <Trash2 size={icon} aria-hidden="true" /> : <Minus size={icon} aria-hidden="true" />}
      </button>
      <QtyField qty={qty} label={tr(t, 'qtyOf', { name })} onSet={onSet} />
      <button ref={plusRef} type="button" className="st qstep__b" aria-label={tr(t, 'addOne', { name })} onClick={() => onSet(qty + 1)}>
        <Plus size={icon} aria-hidden="true" />
      </button>
    </div>
  )
}
