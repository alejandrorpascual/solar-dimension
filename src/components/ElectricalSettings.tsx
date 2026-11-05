import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { useLocale } from '../hooks/useLocale'
import { tr, type Dictionary } from '../i18n'
import { AMBIENTS, INSULATIONS, RUN_LENGTH, STARTS, type Electrical } from '../lib/schema'

interface Props {
  electrical: Electrical
  onChange: (patch: Partial<Electrical>) => void
}

const STARTS_COPY = {
  1: ['startsOne', 'startsOneHelp'],
  2: ['startsTwo', 'startsTwoHelp'],
  all: ['startsAll', 'startsAllHelp'],
} as const

/** The chosen start-up option's title, for the line that sums up a closed disclosure. */
export const startsTitle = (t: Dictionary, starts: Electrical['simultaneousStarts']): string => t.ui[STARTS_COPY[starts][0]]

/** How many motors may start in the same instant; it sets the start-up peak the inverter and the bank must ride. */
export function StartsPicker({ electrical, onChange }: Props) {
  const { t } = useLocale()
  const labelId = useId()
  return (
    <>
      <div id={labelId} className="window__label">{t.ui.startsLabel}</div>
      <div className="opt-grid opt-grid--3" role="group" aria-labelledby={labelId}>
        {STARTS.map((s) => {
          const [title, help] = STARTS_COPY[s]
          const isOn = s === electrical.simultaneousStarts
          return (
            <button key={String(s)} type="button" className={`opt${isOn ? ' opt--on' : ''}`} aria-pressed={isOn} onClick={() => onChange({ simultaneousStarts: s })}>
              <span className="opt__t">{t.ui[title]}</span><span className="opt__h">{t.ui[help]}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}

const PERCENT = 100

/** Where the battery cable runs. Closed by default; the summary line still states the values in effect. `bundleFactor` is the derating the engine gave the main cable; the help shows it only while the box is ticked, since an unbundled run always gets 1. */
export function CableConditions({ electrical: e, onChange, bundleFactor }: Props & { bundleFactor: number }) {
  const { t } = useLocale()
  const rangeId = useId()
  const summary = tr(t, 'cableSummary', { length: e.runLengthM, ambient: e.ambientC, insulation: e.insulationC, bundled: e.bundled ? t.ui.cableBundledShort : '' })
  return (
    <details className="elec">
      <summary className="elec__summary">
        <h2 className="elec__title">{t.ui.cableRun}</h2>
        <span className="num elec__values">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" className="elec__chev" />
      </summary>
      <div className="elec__grid">
        <div className="elec__field">
          <div className="elec__head"><label htmlFor={rangeId}>{t.ui.runLength}</label><span className="num elec__value">{e.runLengthM} m</span></div>
          <input id={rangeId} type="range" min={RUN_LENGTH.min} max={RUN_LENGTH.max} step={RUN_LENGTH.step} value={e.runLengthM} onChange={(ev) => onChange({ runLengthM: Number(ev.target.value) })} />
        </div>
        <div className="elec__field" role="group" aria-label={t.ui.ambientLabel}>
          <span className="elec__head">{t.ui.ambientLabel}</span>
          <div className="elec__chips">
            {AMBIENTS.map((a) => (
              <button key={a} type="button" className={`chip${a === e.ambientC ? ' chip--on' : ''}`} aria-pressed={a === e.ambientC} onClick={() => onChange({ ambientC: a })}>
                {t.ui[`ambient${a}`]}
              </button>
            ))}
          </div>
        </div>
        <div className="elec__field" role="group" aria-label={t.ui.insulationLabel}>
          <span className="elec__head">{t.ui.insulationLabel}</span>
          <div className="elec__segs">
            {INSULATIONS.map((c) => (
              <button key={c} type="button" className={`seg${c === e.insulationC ? ' seg--on' : ''}`} aria-pressed={c === e.insulationC} onClick={() => onChange({ insulationC: c })}>
                {t.ui[`insulation${c}`]}
              </button>
            ))}
          </div>
        </div>
        <label className="elec__check">
          <input type="checkbox" checked={e.bundled} onChange={(ev) => onChange({ bundled: ev.target.checked })} />
          <span><span className="elec__check-title">{t.ui.bundledLabel}</span>{e.bundled && <span className="muted elec__check-help">{tr(t, 'bundledHelp', { factor: Math.round(bundleFactor * PERCENT) })}</span>}</span>
        </label>
      </div>
    </details>
  )
}
