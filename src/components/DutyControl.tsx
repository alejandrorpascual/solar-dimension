import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { dutyPct } from '../lib/load-kinds'
import { DUTY_PRESETS } from '../lib/schema'
import type { SelectedItem } from '../lib/sizing'

interface Props {
  item: SelectedItem
  /** The appliance's name in the user's language, for the control's label. */
  name: string
  /** null puts the catalog duty back. */
  onDuty: (duty: number | null) => void
}

/** The catalog duty plus the presets, one per percent, ascending. */
export function dutyOptions(item: SelectedItem): number[] {
  const seen = new Set<number>()
  return [item.duty, ...DUTY_PRESETS]
    .filter((d) => (seen.has(dutyPct(d)) ? false : (seen.add(dutyPct(d)), true)))
    .sort((a, b) => a - b)
}

/**
 * How much of each hour a cycling appliance runs, as a native select: a short list with nothing to compare. It sits
 * on an appliance card in step 1 and in the kit's quick-edit panel; both can be narrower than its longest option, so
 * the `.qedit__duty` rules let the label wrap and cap the select. Choosing the catalog value is the reset, so there is
 * no extra button.
 */
export function DutyControl({ item, name, onDuty }: Props) {
  const { t } = useLocale()
  const options = dutyOptions(item)
  const current = options.find((d) => dutyPct(d) === dutyPct(item.effectiveDuty)) ?? item.effectiveDuty
  const label = (d: number): string => {
    if (dutyPct(d) === dutyPct(item.duty)) return tr(t, 'dutyTypical', { pct: dutyPct(d) })
    return d >= 1 ? t.ui.dutyNonstop : tr(t, 'dutyOption', { pct: dutyPct(d) })
  }
  const choose = (value: string) => {
    const d = Number(value)
    onDuty(dutyPct(d) === dutyPct(item.duty) ? null : d)
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
