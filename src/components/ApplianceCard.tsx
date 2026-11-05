import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { applianceName, applianceNote, tr } from '../i18n'
import { fmtInt, fmtW } from '../i18n/format'
import { mayRunOn240V, needsSplitPhase, type CatalogItem } from '../lib/catalog'
import type { DutyHint } from '../lib/load-kinds'
import type { SelectedItem } from '../lib/sizing'
import { clampQty, parseQty } from '../lib/store'
import { DutyHintLine, DutyMeter } from './DutyMeter'

interface Props {
  item: CatalogItem; title?: string; qty: number
  onInc: () => void; onDec: () => void; onSet: (n: number) => void; onRemove?: () => void
  /** How much of each hour it runs; null for an always-on load, which shows nothing extra. */
  duty?: DutyHint | null
  /** The appliance as sized for this project, once added; the duty bar needs it. */
  selected?: SelectedItem
  onDuty?: (duty: number | null) => void
}

/** The count between − and +, typeable for large numbers (a condo's 40 cameras). Commits on blur or Enter. */
export function QtyField({ qty, label, onSet }: { qty: number; label: string; onSet: (n: number) => void }) {
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

export function ApplianceCard({ item, title, qty, onInc, onDec, onSet, onRemove, duty = null, selected, onDuty }: Props) {
  const { t, locale } = useLocale()
  const on = qty > 0
  const name = applianceName(t, item)
  const addRef = useRef<HTMLButtonElement>(null)
  const plusRef = useRef<HTMLButtonElement>(null)
  // Add and the quantity buttons replace each other, and a button that unmounts drops focus to the page.
  const isSwapping = useRef(false)
  useEffect(() => {
    if (!isSwapping.current) return
    isSwapping.current = false
    const isFocusLost = !document.activeElement || document.activeElement === document.body
    if (isFocusLost) (on ? plusRef : addRef).current?.focus()
  }, [on])
  const change = (run: () => void, swaps: boolean) => {
    isSwapping.current = swaps
    run()
  }
  /** Removing a custom appliance takes its card away: focus goes to the next card, or the form that makes them. */
  const remove = (from: HTMLElement) => {
    const card = from.closest('.card')
    const neighbour = card?.nextElementSibling ?? card?.previousElementSibling
    const next = neighbour?.querySelector('button') ?? document.querySelector<HTMLElement>('.custom input')
    next?.focus()
    onRemove?.()
  }
  return (
    <div className={`card${on ? ' card--on' : ''}`}>
      <div className="card__body">
        <div className="card__name">{title ?? name}</div>
        <div className="card__spec num">{tr(t, 'runningSurgeLine', { watts: fmtInt(item.watts, locale), surge: fmtW(item.surge, locale) })}</div>
        {needsSplitPhase(item) && <div className="card__spec card__spec--warn">{t.ui.splitPhase}</div>}
        {mayRunOn240V(item) && <div className="card__spec card__spec--warn">{t.ui.checkNameplate240}</div>}
        {item.isCustom && <div className="card__spec">{applianceNote(t, item)}</div>}
        {duty && !on && <DutyHintLine hint={duty} />}
      </div>
      {/* A sibling of the body: in the row layout the meter then gets the card's width, not what the buttons leave of it. */}
      {duty && on && selected && onDuty && <DutyMeter hint={duty} item={selected} name={name} onDuty={onDuty} />}
      {onRemove && (
        <button type="button" className="x" aria-label={tr(t, 'remove', { name })} onClick={(e) => remove(e.currentTarget)}>×</button>
      )}
      {on ? (
        <div className="stepper-qty">
          <button type="button" className="st" aria-label={tr(t, 'removeOne', { name })} onClick={() => change(onDec, qty <= 1)}>−</button>
          <QtyField qty={qty} label={tr(t, 'qtyOf', { name })} onSet={(n) => change(() => onSet(n), n === 0)} />
          <button ref={plusRef} type="button" className="st" aria-label={tr(t, 'addOne', { name })} onClick={onInc}>+</button>
        </div>
      ) : (
        <button ref={addRef} type="button" className="add" aria-label={tr(t, 'addOne', { name })} onClick={() => change(onInc, true)}>{t.ui.add}</button>
      )}
    </div>
  )
}
