import { CHEMISTRIES, VOLTAGES, VOLTAGE_HINTS, type ChemistryId, type Voltage } from '../lib/catalog'
import { fmtKwh, fmtW } from '../lib/format'
import type { Store } from '../lib/schema'
import type { SizingResult } from '../lib/sizing'
import { currentProject, patchCurrent } from '../lib/store'

const PRESET_HOURS = [4, 8, 10, 12, 24, 48] as const
const HOURS_MIN = 1
const HOURS_MAX = 48

interface Props { store: Store; commit: (s: Store) => void; result: SizingResult }

export function BackupWindow({ store, commit, result }: Props) {
  const p = currentProject(store)
  const setHours = (hours: number) => commit(patchCurrent(store, { hours }))
  const summary = result.empty
    ? 'Go back and add at least one appliance.'
    : `Your ${result.count} appliances draw ${fmtW(result.runningW)} and use about ${fmtKwh(result.loadWh)} over ${p.hours} hours. We size the bank to ${fmtKwh(result.requiredWh)} after inverter losses and depth of discharge.`

  return (
    <div className="window">
      <p className="muted">The bank is sized for this many hours of your selected load, at the voltage you pick.</p>
      <div className="window__cols">
        <div className="window__hours">
          <div className="window__hours-head">
            <label htmlFor="hours">Hours without the grid</label>
            <div className="hours-value num">{p.hours} h</div>
          </div>
          <input id="hours" type="range" min={HOURS_MIN} max={HOURS_MAX} step={1} value={p.hours} onChange={(e) => setHours(Number(e.target.value))} />
          <div className="hs presets">
            {PRESET_HOURS.map((h) => (
              <button key={h} type="button" className={`chip${h === p.hours ? ' chip--on' : ''}`} onClick={() => setHours(h)}>{h} h</button>
            ))}
          </div>
          <div className="note-box">{summary}</div>
        </div>
        <div className="window__options">
          <div className="window__label">Battery voltage</div>
          <div className="opt-grid">
            {VOLTAGES.map((v: Voltage) => (
              <button key={v} type="button" className={`opt${v === p.volts ? ' opt--on' : ''}`} onClick={() => commit(patchCurrent(store, { volts: v }))}>
                <span className="opt__t">{v} V</span><span className="opt__h">{VOLTAGE_HINTS[v]}</span>
              </button>
            ))}
          </div>
          <div className="window__label">Battery chemistry</div>
          <div className="opt-grid">
            {(Object.keys(CHEMISTRIES) as ChemistryId[]).map((k) => (
              <button key={k} type="button" className={`opt${k === p.chemistry ? ' opt--on' : ''}`} onClick={() => commit(patchCurrent(store, { chemistry: k }))}>
                <span className="opt__t">{CHEMISTRIES[k].label}</span><span className="opt__h">{Math.round(CHEMISTRIES[k].dod * 100)}% usable capacity</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
