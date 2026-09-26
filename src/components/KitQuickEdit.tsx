import { ChevronDown, ListChecks, Minus, Plus, Search } from 'lucide-react'
import { useId, useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { applianceName, tr } from '../i18n'
import { fmtW } from '../i18n/format'
import { searchAppliances } from '../lib/appliance-search'
import { forPicker } from '../lib/catalog'
import { HOURS_MAX, HOURS_MIN, type Project } from '../lib/schema'
import { catalog, type SizingResult } from '../lib/sizing'
import { QtyStepper } from './QtyStepper'

interface Props {
  project: Project
  result: SizingResult
  /** True once a quick edit changed the kit; shows "Saved" and Undo. */
  isDirty: boolean
  onQty: (itemId: string, n: number) => void
  onHours: (hours: number) => void
  onUndo: () => void
  onAllAppliances: () => void
}

/** The kit's edit bar: an appliance list that opens in place, the backup window stepper, and Undo. */
export function KitQuickEdit({ project, result, isDirty, onQty, onHours, onUndo, onAllAppliances }: Props) {
  const { t, locale } = useLocale()
  const appliances = useCatalog()
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelId = useId()
  const searchId = useId()
  const nameOf = (item: { id: string; name: string; isCustom?: boolean }) => applianceName(t, item)
  const suggestions = searchAppliances(catalog(forPicker(appliances), project.custom), query, nameOf, new Set(result.items.map((i) => i.id)))
  const add = (id: string) => {
    onQty(id, 1)
    setQuery('')
  }

  return (
    <div className="qedit">
      <div className="qedit__bar">
        <button type="button" className={`chip qedit__toggle${isOpen ? ' chip--on' : ''}`} aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(!isOpen)}>
          <ListChecks size={16} aria-hidden="true" />
          {tr(t, 'appliancesCount', { count: result.items.length })}
          <ChevronDown size={14} aria-hidden="true" className="qedit__chev" />
        </button>
        <div className="qedit__window" role="group" aria-label={t.ui.windowLabel}>
          <span className="qedit__window-label">{t.ui.windowLabel}</span>
          <button type="button" className="qedit__hour" aria-label={t.ui.hourLess} disabled={project.hours <= HOURS_MIN} onClick={() => onHours(project.hours - 1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <output className="num qedit__hours" aria-live="polite">{tr(t, 'hoursShort', { hours: project.hours })}</output>
          <button type="button" className="qedit__hour" aria-label={t.ui.hourMore} disabled={project.hours >= HOURS_MAX} onClick={() => onHours(project.hours + 1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {isDirty && (
          <div className="qedit__status" role="status">
            <span className="qedit__dot" aria-hidden="true" />{t.ui.saved}
            <button type="button" className="qedit__undo" onClick={onUndo}>{t.ui.undo}</button>
          </div>
        )}
      </div>

      {isOpen && (
        <div id={panelId} className="qedit__panel">
          {result.items.length > 0 && (
            <ul className="qedit__list">
              {result.items.map((item) => (
                <li key={item.id} className="qedit__row">
                  <div className="qedit__name">
                    <span className="qedit__title">{nameOf(item)}</span>
                    <span className="num qedit__watts">{fmtW(item.totalWatts, locale)}</span>
                  </div>
                  <QtyStepper name={nameOf(item)} qty={item.qty} onSet={(n) => onQty(item.id, n)} />
                </li>
              ))}
            </ul>
          )}
          <div className="qedit__add">
            <label htmlFor={searchId} className="visually-hidden">{t.ui.addApplianceSearch}</label>
            <Search size={16} aria-hidden="true" className="qedit__search-icon" />
            <input id={searchId} className="in qedit__search" type="search" autoComplete="off" placeholder={t.ui.addApplianceSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query.trim() !== '' && (
              <div className="qedit__sugs">
                {suggestions.map((a) => (
                  <button key={a.id} type="button" className="qedit__sug" onClick={() => add(a.id)}>
                    <span className="qedit__sug-name">{nameOf(a)}</span>
                    <span className="num muted">{fmtW(a.watts, locale)}</span>
                    <span className="qedit__sug-add">{t.ui.add}</span>
                  </button>
                ))}
                {suggestions.length === 0 && <p className="muted qedit__none">{t.ui.noSearchMatch}</p>}
              </div>
            )}
          </div>
          <button type="button" className="qedit__all" onClick={onAllAppliances}>{t.ui.allAppliances}</button>
        </div>
      )}
    </div>
  )
}
