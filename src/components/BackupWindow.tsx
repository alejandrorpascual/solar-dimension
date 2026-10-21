import { useLocale } from '../hooks/useLocale'
import { tr } from '../i18n'
import { fmtKwh, fmtW } from '../i18n/format'
import { CHEMISTRIES, FEW_INVERTERS_VOLTAGE, VOLTAGES, type ChemistryId, type Voltage } from '../lib/catalog'
import { HOURS_MAX, HOURS_MIN, type Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { currentProject, patchCurrent, setElectricalIn } from '../lib/store'
import { CableConditions, StartsPicker } from './ElectricalSettings'

const PRESET_HOURS = [4, 8, 10, 12, 24, 48] as const

interface Props { store: Store; commit: (s: Store) => void; result: SizingResult }

export function BackupWindow({ store, commit, result }: Props) {
  const { t, locale } = useLocale()
  const p = currentProject(store)
  const setHours = (hours: number) => commit(patchCurrent(store, { hours }))
  const setElectrical = (patch: Parameters<typeof setElectricalIn>[2]) => commit(setElectricalIn(store, p.id, patch))
  const summary = result.empty
    ? t.ui.step2Empty
    : tr(t, 'step2Summary', {
        count: result.count, running: fmtW(result.runningW, locale), load: fmtKwh(result.loadWh, locale),
        hours: p.hours, need: fmtKwh(result.requiredWh, locale),
      })

  return (
    <div className="window">
      <p className="muted">{t.ui.q2Help}</p>
      <div className="window__cols">
        <div className="window__hours">
          <div className="window__hours-head">
            <label htmlFor="hours">{t.ui.hoursLabel}</label>
            <div className="hours-value num">{p.hours} h</div>
          </div>
          <input id="hours" type="range" min={HOURS_MIN} max={HOURS_MAX} step={1} value={p.hours} onChange={(e) => setHours(Number(e.target.value))} />
          <div className="hs presets">
            {PRESET_HOURS.map((h) => (
              <button key={h} type="button" className={`chip${h === p.hours ? ' chip--on' : ''}`} aria-pressed={h === p.hours} onClick={() => setHours(h)}>{h} h</button>
            ))}
          </div>
          <div className="note-box">{summary}</div>
        </div>
        <div className="window__options">
          <div className="window__label">{t.ui.batteryVoltage}</div>
          <div className="opt-grid">
            {VOLTAGES.map((v: Voltage) => (
              <button key={v} type="button" className={`opt${v === p.volts ? ' opt--on' : ''}`} aria-pressed={v === p.volts} onClick={() => commit(patchCurrent(store, { volts: v }))}>
                <span className="opt__t">{v} V</span><span className="opt__h">{t.voltageHints[v]}</span>
              </button>
            ))}
          </div>
          {p.volts === FEW_INVERTERS_VOLTAGE && <div className="note-box">{tr(t, 'fewInvertersNote', { volts: FEW_INVERTERS_VOLTAGE })}</div>}
          <div className="window__label">{t.ui.batteryChemistry}</div>
          <div className="opt-grid">
            {(Object.keys(CHEMISTRIES) as ChemistryId[]).map((k) => (
              <button key={k} type="button" className={`opt${k === p.chemistry ? ' opt--on' : ''}`} aria-pressed={k === p.chemistry} onClick={() => commit(patchCurrent(store, { chemistry: k }))}>
                <span className="opt__t">{t.chemistries[k]}</span><span className="opt__h">{tr(t, 'usableCapacity', { pct: Math.round(CHEMISTRIES[k].dod * 100) })}</span>
              </button>
            ))}
          </div>
          <StartsPicker electrical={p.electrical} onChange={setElectrical} />
        </div>
      </div>
      <CableConditions electrical={p.electrical} onChange={setElectrical} />
    </div>
  )
}
