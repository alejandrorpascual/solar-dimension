import { useId } from 'react'
import { useLocale } from '../hooks/useLocale'
import type { BatteryOption } from '../lib/sizing'

interface Props {
  options: BatteryOption[]
  /** The unit in effect from the user's choice; null means the automatic pick. */
  selected: string | null
  onSelect: (id: string | null) => void
}

function UnitButton({ on, title, sub, onClick }: { on: boolean; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" className={`unit${on ? ' unit--on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="unit__t">{title}</span>
      <span className="unit__s num">{sub}</span>
    </button>
  )
}

/** Each option shows how many batteries it would take, so the trade-off is visible before choosing. */
export function BatteryPicker({ options, selected, onSelect }: Props) {
  const { t } = useLocale()
  const titleId = useId()
  const auto = options.find((o) => o.isAuto)
  if (options.length === 0) return null
  return (
    <section className="units">
      <div className="units__head">
        <h3 id={titleId} className="lab units__title">{t.ui.batterySize}</h3>
        <p className="muted units__help">{t.ui.batterySizeHelp}</p>
      </div>
      <div className="hs units__list" role="group" aria-labelledby={titleId}>
        <UnitButton
          on={selected === null}
          title={t.ui.batteryAuto}
          sub={auto ? `${auto.unitV} V · ${auto.unitAh} Ah` : ''}
          onClick={() => onSelect(null)}
        />
        {options.map((o) => (
          <UnitButton key={o.id} on={selected === o.id} title={`${o.unitAh} Ah`} sub={`${o.unitV} V · ×${o.count}`} onClick={() => onSelect(o.id)} />
        ))}
      </div>
    </section>
  )
}
