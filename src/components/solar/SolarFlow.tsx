import { Battery, Home, Sun } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { batteryCount, panelCount, tr } from '../../i18n'
import { fmtDecimal, fmtHours, fmtKw, fmtKwh, fmtW } from '../../i18n/format'
import { SOLAR } from '../../lib/solar'
import type { SizingResult } from '../../lib/sizing'

const AXIS_MIN_WH = 26_400
const AXIS_STEP_WH = 2_000
const PERCENT = 100

interface Props { result: SizingResult }

/** Sun → panels → bank → home on a clear day, and how much of a day's use the array covers. */
export function SolarFlow({ result: r }: Props) {
  const { t, locale } = useLocale()
  const s = r.solar
  if (!s || !r.battery) return null
  const axisWh = Math.max(AXIS_MIN_WH, Math.ceil(Math.max(s.dailyWh, s.dailyUseWh) / AXIS_STEP_WH) * AXIS_STEP_WH)
  const pct = (wh: number) => `${Math.min(PERCENT, Math.round((wh / axisWh) * PERCENT))}%`
  // A roof too small for a string that charges says why it has no panels instead of asking for a tap.
  const tooShort = r.warnings.find((w) => w.code === 'stringTooShort')
  const clearNote = tooShort ? t.warnings.stringTooShort(tooShort.params) : s.panels === 0
    ? t.ui.noPanelsYet
    : s.refillsInOneDay && s.refillHours !== null
      ? tr(t, 'refillSameDay', { hours: fmtHours(s.refillHours, locale), spare: fmtKwh(Math.max(0, s.dailyWh - r.battery.bankWh), locale) })
      : tr(t, 'refillDays', { days: fmtDecimal(s.refillDays ?? 0, 1, locale) })
  return (
    <div className="flow">
      <div className="lab">{t.ui.clearDay}</div>
      <div className="flow__strip">
        <div className="flow__node flow__node--sun"><Sun size={26} aria-hidden="true" /><span className="num flow__v">{`${fmtDecimal(s.sunHours, 1, locale)} h`}</span><span className="flow__s">{t.ui.flowSun}</span></div>
        <div className="flow__arrow" aria-hidden="true" />
        <div className="flow__node"><span className="flow__panel" aria-hidden="true" /><span className="num flow__v">{fmtKw(s.arrayW, locale)}</span><span className="flow__s num">{panelCount(t, s.panels)}</span></div>
        <div className="flow__arrow" aria-hidden="true"><span className="num flow__arrow-t">{fmtKwh(s.dailyWh, locale)}</span></div>
        <div className="flow__node flow__node--bank"><Battery size={26} aria-hidden="true" /><span className="num flow__v">{fmtKwh(r.battery.bankWh, locale)}</span><span className="flow__s">{tr(t, 'flowBank', { volts: r.volts, batteries: batteryCount(t, r.battery.count) })}</span></div>
        <div className="flow__arrow flow__arrow--ink" aria-hidden="true"><span className="num flow__arrow-t">{fmtKwh(s.dailyUseWh, locale)}</span></div>
        <div className="flow__node"><Home size={26} aria-hidden="true" /><span className="num flow__v">{fmtW(r.runningW, locale)}</span><span className="flow__s num">{tr(t, 'flowHome', { count: r.count, hours: r.hours })}</span></div>
      </div>
      <div className="cover">
        <div className="cover__head">
          <strong>{s.coverRatio >= 1 ? t.ui.coverFull : t.ui.coverPart}</strong>
          <span className="num cover__pct">{`${Math.round(s.coverRatio * PERCENT)}%`}</span>
        </div>
        <div className="cover__bar"><div className="cover__fill" style={{ width: pct(s.dailyWh) }} /><div className="cover__mark" style={{ left: pct(s.dailyUseWh) }} aria-hidden="true" /></div>
        <div className="muted cover__axis"><span>0</span><span className="num">{tr(t, 'coverAxis', { use: fmtKwh(s.dailyUseWh, locale) })}</span><span className="num">{fmtKwh(axisWh, locale)}</span></div>
        <div className="cover__notes">
          <div className="note-box note-box--sun"><strong>{t.ui.clearDay}</strong><br />{clearNote}</div>
          <div className="note-box"><strong>{t.ui.cloudyDay}</strong><br />{s.panels === 0 ? '—' : tr(t, 'cloudyNote', { wh: fmtKwh(s.cloudyWh, locale), pct: Math.round(s.coverRatio * PERCENT * SOLAR.CLOUDY_SHARE) })}</div>
        </div>
      </div>
      {s.panels > 0 && <p className="fine muted">{t.ui.solarAssumptions}</p>}
    </div>
  )
}
