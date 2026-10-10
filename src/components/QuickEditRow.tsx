import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { fmtW } from '../i18n/format'
import { averageWatts } from '../lib/load-kinds'
import type { SelectedItem } from '../lib/sizing'
import { DutyControl } from './DutyControl'
import { QtyStepper } from './QtyStepper'

interface Props {
  item: SelectedItem
  name: string
  onQty: (n: number) => void
  onDuty: (duty: number | null) => void
}

/** One selected appliance in the quick-edit panel: its name, watts and average, its duty when it cycles, and the count. */
export function QuickEditRow({ item, name, onQty, onDuty }: Props) {
  const { t, locale } = useLocale()
  const average = item.kind === 'continuous' ? '' : ` · ${tr(t, 'averageDraw', { w: fmtW(averageWatts(item), locale) })}`
  return (
    <li className="qedit__row">
      <div className="qedit__name">
        <span className="qedit__title">{name}</span>
        <span className="num qedit__watts">{fmtW(item.totalWatts, locale)}{average}</span>
      </div>
      {/* A sibling of the name: on a phone the duty line then gets the row's width, not what the buttons leave of it. */}
      {item.kind === 'cycling' && <DutyControl item={item} name={name} onDuty={onDuty} />}
      <QtyStepper name={name} qty={item.qty} onSet={onQty} />
    </li>
  )
}
