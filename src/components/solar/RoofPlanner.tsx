import { useId } from 'react'
import { useLocale } from '../../hooks/useLocale'
import { panelCount, tr } from '../../i18n'
import { fmtDecimal, fmtKw } from '../../i18n/format'
import type { Voltage } from '../../lib/catalog'
import { panelsBelow, SOLAR, type SolarPick } from '../../lib/solar'

interface Props {
  solar: SolarPick
  volts: Voltage
  onRoof: (m2: number) => void
  onPanels: (n: number | null) => void
  onSun: (hours: number) => void
}

/** Roof area in, tiles out: one tile per panel the roof holds, the recommended ones pre-filled, tap to override. */
export function RoofPlanner({ solar: s, volts, onRoof, onPanels, onSun }: Props) {
  const { t, locale } = useLocale()
  const roofId = useId()
  const sunId = useId()
  const tiles = Array.from({ length: s.fit }, (_, i) => i)
  return (
    <div className="planner">
      <div className="planner__roof">
        <label className="lab" htmlFor={roofId}>{t.ui.roofSpace}</label>
        <div className="planner__roof-row">
          <div className="planner__stepper">
            <button type="button" className="planner__step" aria-label={t.ui.roofLess} disabled={s.roofM2 <= SOLAR.ROOF_RANGE[0]} onClick={() => onRoof(s.roofM2 - SOLAR.ROOF_STEP)}>−</button>
            <output id={roofId} className="in num planner__roof-value" aria-live="polite">{`${s.roofM2} m²`}</output>
            <button type="button" className="planner__step" aria-label={t.ui.roofMore} disabled={s.roofM2 >= SOLAR.ROOF_RANGE[1]} onClick={() => onRoof(s.roofM2 + SOLAR.ROOF_STEP)}>+</button>
          </div>
          <p className="planner__fits">
            <span className="planner__fits-line">{tr(t, s.fit === 1 ? 'roofFitsOne' : 'roofFitsMany', { panels: panelCount(t, s.fit) })}</span>
            <span className="muted planner__fits-hint">{t.ui.roofHint}</span>
          </p>
        </div>
      </div>
      <div className="planner__head">
        <span className="lab">{t.ui.plannerLabel}</span>
        <span className="muted num">{tr(t, 'plannerTile', { w: `${SOLAR.PANEL_W} W` })}</span>
      </div>
      <div className="planner__grid" role="group" aria-label={t.ui.plannerLabel}>
        {tiles.map((i) => {
          const on = i < s.panels
          return (
            <button key={i} type="button" className={`tile${on ? ' tile--on' : ''}`} aria-pressed={on}
              aria-label={tr(t, on ? 'removePanel' : 'addPanel', { n: i + 1 })} onClick={() => onPanels(on ? panelsBelow(i + 1, volts) : i + 1)} />
          )
        })}
      </div>
      <div className="planner__count">
        <span className="num planner__big">{tr(t, 'panelsLine', { panels: panelCount(t, s.panels), kw: fmtKw(s.arrayW, locale) })}</span>
        {!s.isTooShort && (s.isRecommended
          ? <span className="planner__pill">{s.isRoofLimited ? t.ui.recommendedPillLimited : t.ui.recommendedPill}</span>
          : <button type="button" className="chip" onClick={() => onPanels(null)}>{tr(t, 'backToRecommended', { n: s.recommended })}</button>)}
      </div>
      <div className="planner__sun">
        <div className="planner__sun-head">
          <label htmlFor={sunId}>{t.ui.sunHours}</label>
          <span className="num planner__sun-value">{`${fmtDecimal(s.sunHours, 1, locale)} h`}</span>
        </div>
        <input id={sunId} type="range" min={SOLAR.SUN_RANGE[0]} max={SOLAR.SUN_RANGE[1]} step={SOLAR.SUN_STEP} value={s.sunHours} onChange={(e) => onSun(Number(e.target.value))} />
        <span className="muted planner__hint">{t.ui.sunHint}</span>
      </div>
    </div>
  )
}
