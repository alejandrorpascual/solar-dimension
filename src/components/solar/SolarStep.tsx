import { useLocale } from '../../hooks/useLocale'
import type { Project, Store } from '../../lib/schema'
import type { SizingResult } from '../../lib/sizing'
import { setSolarIn, withSolarPanels, withSolarRoof, withSolarSun } from '../../lib/store'
import { RoofPlanner } from './RoofPlanner'
import { SolarFlow } from './SolarFlow'

interface Props { store: Store; commit: (s: Store) => void; project: Project; result: SizingResult }

/** Step 3: panels or not, and if so how many, laid out on the roof. */
export function SolarStep({ store, commit, project, result }: Props) {
  const { t } = useLocale()
  const hasSolar = project.solar !== null
  const id = project.id
  return (
    <div className="solar">
      <p className="muted">{t.ui.q3Help}</p>
      <div className="opt-grid solar__choice">
        <button type="button" className={`opt${hasSolar ? '' : ' opt--on'}`} aria-pressed={!hasSolar} onClick={() => commit(setSolarIn(store, id, false))}>
          <span className="opt__t">{t.ui.solarNo}</span><span className="opt__h">{t.ui.solarNoHelp}</span>
        </button>
        <button type="button" className={`opt${hasSolar ? ' opt--on' : ''}`} aria-pressed={hasSolar} onClick={() => commit(setSolarIn(store, id, true))}>
          <span className="opt__t">{t.ui.solarYes}</span><span className="opt__h">{t.ui.solarYesHelp}</span>
        </button>
      </div>
      {!hasSolar && <div className="note-box solar__skipped">{t.ui.solarSkipped}</div>}
      {hasSolar && result.solar && project.solar && (
        <div className="solar__cols">
          <RoofPlanner
            solar={result.solar}
            volts={result.volts}
            onRoof={(m2) => commit(withSolarRoof(store, id, m2))}
            onPanels={(n) => commit(withSolarPanels(store, id, n))}
            onSun={(h) => commit(withSolarSun(store, id, h))}
          />
          <SolarFlow result={result} />
        </div>
      )}
    </div>
  )
}
