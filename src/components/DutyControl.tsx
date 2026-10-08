import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { DUTY_PRESETS } from '../lib/schema'
import type { SelectedItem } from '../lib/sizing'

interface Props {
  item: SelectedItem
  /** The appliance's name in the user's language, for the control's label. */
  name: string
  /** null puts the catalog duty back. */
  onDuty: (duty: number | null) => void
}

const pct = (duty: number): number => Math.round(duty * 100)

/** The catalog duty plus the presets, one per percent, ascending. */
export function dutyOptions(item: SelectedItem): number[] {
  const seen = new Set<number>()
  return [item.duty, ...DUTY_PRESETS]
    .filter((d) => (seen.has(pct(d)) ? false : (seen.add(pct(d)), true)))
    .sort((a, b) => a - b)
}

/**
 * How much of each hour a cycling appliance runs, as a native select: a short list with nothing to compare, inside a
 * panel that may itself sit in a sheet. Choosing the catalog value is the reset, so there is no extra button.
 */
export function DutyControl({ item, name, onDuty }: Props) {
  const { t } = useLocale()
  const options = dutyOptions(item)
  const current = options.find((d) => pct(d) === pct(item.effectiveDuty)) ?? item.effectiveDuty
  const label = (d: number): string => {
    if (pct(d) === pct(item.duty)) return tr(t, 'dutyTypical', { pct: pct(d) })
    return d >= 1 ? t.ui.dutyNonstop : tr(t, 'dutyOption', { pct: pct(d) })
  }
  const choose = (value: string) => {
    const d = Number(value)
    onDuty(pct(d) === pct(item.duty) ? null : d)
  }
  return (
    <span className={`qedit__duty${item.overridden ? ' qedit__duty--on' : ''}`}>
      <span className="qedit__duty-label">{t.ui.runsLabel}</span>
      <select className="qedit__duty-select" aria-label={tr(t, 'dutyOf', { name })} value={String(current)} onChange={(e) => choose(e.target.value)}>
        {!options.includes(current) && <option value={String(current)}>{label(current)}</option>}
        {options.map((d) => <option key={d} value={String(d)}>{label(d)}</option>)}
      </select>
    </span>
  )
}
