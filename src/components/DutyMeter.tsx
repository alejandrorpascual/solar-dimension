import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { averageDrawText, dutyPct, type DutyHint } from '../lib/load-kinds'
import type { SelectedItem } from '../lib/sizing'
import { DutyControl } from './DutyControl'

interface MeterProps {
  hint: DutyHint
  /** The appliance as sized for this project, for its duty in effect and its average. */
  item: SelectedItem
  name: string
  onDuty: (duty: number | null) => void
}

/** On an added card: how much of each hour it runs, as a bar, with the picker for cycling loads and the average draw. */
export function DutyMeter({ hint, item, name, onDuty }: MeterProps) {
  const { t, locale } = useLocale()
  const average = averageDrawText(item, t, locale)
  const isCycling = hint.kind === 'cycling'
  const fillPct = isCycling ? hint.pct : dutyPct(item.effectiveDuty)
  const typical = isCycling && hint.isOverridden ? ` · ${tr(t, 'dutyTypicalAt', { pct: hint.typicalPct })}` : ''
  return (
    <div className="duty">
      {isCycling ? (
        <DutyControl item={item} name={name} onDuty={onDuty} />
      ) : (
        <span className="qedit__duty"><span className="qedit__duty-label">{t.ui.runsLabel}</span><strong className="duty__burst">{tr(t, 'dutyBursts', { min: hint.minutesPerHour })}</strong></span>
      )}
      <div className="duty__bar" aria-hidden="true">
        <span className="duty__fill" style={{ width: `${fillPct}%` }} />
        {isCycling && hint.isOverridden && <span className="duty__typical" style={{ left: `${hint.typicalPct}%` }} />}
      </div>
      <div className="duty__avg num">{average}{typical}</div>
    </div>
  )
}
