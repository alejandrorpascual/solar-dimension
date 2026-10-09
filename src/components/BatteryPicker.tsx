import { Check, ChevronDown } from 'lucide-react'
import { Button, Header, Label, ListBox, ListBoxItem, ListBoxSection, Popover, Select, SelectValue, Text, type Key } from 'react-aria-components'
import { useLocale } from '../hooks/useLocale'
import { batteryCount, tr, type Dictionary, type Locale } from '../i18n'
import { fmtHours, fmtKwh } from '../i18n/format'
import type { BatteryOption } from '../lib/sizing'

interface Props {
  options: BatteryOption[]
  /** The unit in effect from the user's choice; null means the automatic pick. */
  selected: string | null
  onSelect: (id: string | null) => void
}

const AUTO_KEY = 'auto'

interface VoltageGroup { unitV: number; series: number; options: BatteryOption[] }

/** Options arrive bank-voltage first, then by capacity, so grouping keeps the engine's order. */
function groupByVoltage(options: readonly BatteryOption[]): VoltageGroup[] {
  return options.reduce<VoltageGroup[]>((groups, o) => {
    const last = groups[groups.length - 1]
    if (last?.unitV === o.unitV) return [...groups.slice(0, -1), { ...last, options: [...last.options, o] }]
    return [...groups, { unitV: o.unitV, series: o.series, options: [o] }]
  }, [])
}

const detail = (o: BatteryOption, locale: Locale) => `${fmtKwh(o.bankWh, locale)} · ~${fmtHours(o.hoursActual, locale)}`
const unitName = (o: BatteryOption) => `${o.unitV} V ${o.unitAh} Ah`

function groupTitle(t: Dictionary, g: VoltageGroup): string {
  const title = tr(t, 'batteryGroup', { v: g.unitV })
  return g.series > 1 ? `${title} · ${tr(t, 'batteryInSeries', { n: g.series })}` : title
}

function OptionRow({ id, title, sub, option, t }: { id: string; title: string; sub: string; option: BatteryOption; t: Dictionary }) {
  const isManyStrings = option.overMaxParallel
  return (
    <ListBoxItem id={id} textValue={title} className="bopt">
      <span className="bopt__mark" aria-hidden="true"><Check size={16} strokeWidth={2.5} /></span>
      <Text slot="label" className="bopt__t">{title}</Text>
      <Text slot="description" className="bopt__s num">
        {sub}
        <span className="visually-hidden"> · {batteryCount(t, option.count)}</span>
        {isManyStrings && <span className="bopt__tag">{t.ui.manyStrings}</span>}
      </Text>
      <span className="bopt__n num" aria-hidden="true">×{option.count}</span>
    </ListBoxItem>
  )
}

/** A grouped list of every unit sold at the bank voltage; each row shows the count, bank energy and runtime it gives. */
export function BatteryPicker({ options, selected, onSelect }: Props) {
  const { t, locale } = useLocale()
  const auto = options.find((o) => o.isAuto)
  if (options.length === 0 || !auto) return null
  const current = options.find((o) => o.id === selected) ?? auto
  const onChange = (key: Key | null) => onSelect(key === null || key === AUTO_KEY ? null : String(key))

  return (
    <Select className="bsel" value={selected ?? AUTO_KEY} onChange={onChange}>
      <Label className="lab bsel__label">{t.ui.batterySize}</Label>
      <Button className="bsel__trigger">
        <SelectValue className="bsel__value">
          {() => (
            <>
              <span className="bsel__unit">{selected === null ? `${t.ui.batteryAuto} · ${unitName(auto)}` : unitName(current)}</span>
              <span className="bsel__count num">{batteryCount(t, current.count)}</span>
            </>
          )}
        </SelectValue>
        <ChevronDown className="bsel__chev" size={18} aria-hidden="true" />
      </Button>
      <Popover className="bsel__pop" placement="bottom start" offset={6}>
        <div className="bsel__sheet-head">
          <span className="bsel__grab" aria-hidden="true" />
          <p className="bsel__sheet-title">{t.ui.batterySize}</p>
          <p className="muted bsel__sheet-help">{t.ui.batterySizeHelp}</p>
        </div>
        <ListBox className="bsel__list">
          <ListBoxSection className="bsel__section">
            <OptionRow id={AUTO_KEY} title={`${t.ui.batteryAuto} · ${t.ui.batteryRecommended}`} sub={`${unitName(auto)} · ${detail(auto, locale)}`} option={auto} t={t} />
          </ListBoxSection>
          {groupByVoltage(options).map((g) => (
            <ListBoxSection key={g.unitV} className="bsel__section">
              <Header className="lab bsel__header">{groupTitle(t, g)}</Header>
              {g.options.map((o) => (
                <OptionRow key={o.id} id={o.id} title={`${o.unitAh} Ah`} sub={detail(o, locale)} option={o} t={t} />
              ))}
            </ListBoxSection>
          ))}
        </ListBox>
      </Popover>
    </Select>
  )
}
