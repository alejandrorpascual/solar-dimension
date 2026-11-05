import { ChevronDown, ListChecks, Minus, Plus, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { applianceName, tr } from '../i18n'
import { fmtW } from '../i18n/format'
import { searchAppliances, searchTexts } from '../lib/appliance-search'
import { forPicker } from '../lib/catalog'
import { HOURS_MAX, HOURS_MIN, type Project } from '../lib/schema'
import { groupByKind } from '../lib/load-kinds'
import { catalog, type SizingResult } from '../lib/sizing'
import { QuickEditRow } from './QuickEditRow'

const NO_ROW = -1
/** How much of the list shows when it opens: its group label and first row. */
const PANEL_SHOWN_PX = 120
const rowsOf = (panel: HTMLElement | null): Element[] => [...(panel?.querySelectorAll('.qedit__row') ?? [])]

interface BarProps {
  project: Project
  result: SizingResult
  /** True once a quick edit changed the kit; shows "Saved" and Undo. */
  isDirty: boolean
  isOpen: boolean
  panelId: string
  onToggle: () => void
  onHours: (hours: number) => void
  onUndo: () => void
}

/** The kit's edit bar: the toggle for the appliance list, the backup window stepper, and Undo. */
export function KitQuickEditBar({ project, result, isDirty, isOpen, panelId, onToggle, onHours, onUndo }: BarProps) {
  const { t } = useLocale()
  const toggleRef = useRef<HTMLButtonElement>(null)
  // Undo takes its own button away: focus goes to the list it just put back.
  const undo = () => {
    toggleRef.current?.focus()
    onUndo()
  }
  return (
    <div className="qedit">
      <div className="qedit__bar">
        <button ref={toggleRef} type="button" className={`chip qedit__toggle${isOpen ? ' chip--on' : ''}`} aria-expanded={isOpen} aria-controls={panelId} onClick={onToggle}>
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
            <button type="button" className="qedit__undo" onClick={undo}>{t.ui.undo}</button>
          </div>
        )}
      </div>
    </div>
  )
}

interface PanelProps {
  id: string
  project: Project
  result: SizingResult
  onQty: (itemId: string, n: number) => void
  /** null puts the catalog duty back. */
  onDuty: (itemId: string, duty: number | null) => void
  onAllAppliances: () => void
}

/** The appliance list the bar opens. It sits under the kit's figures, so what an edit changes stays on screen. */
export function KitQuickEditPanel({ id, project, result, onQty, onDuty, onAllAppliances }: PanelProps) {
  const { t, locale } = useLocale()
  const appliances = useCatalog()
  const [query, setQuery] = useState('')
  const searchId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const nameOf = (item: { id: string; name: string; isCustom?: boolean }) => applianceName(t, item)
  const suggestions = searchAppliances(catalog(forPicker(appliances), project.custom), query, (a) => searchTexts(t, a), new Set(result.items.map((i) => i.id)))
  // A suggestion is gone once added: focus stays where the next one is typed.
  const add = (itemId: string) => {
    searchRef.current?.focus()
    onQty(itemId, 1)
    setQuery('')
  }
  // Which row was removed, by its place in the list, so focus can go to the one that takes its place.
  const removedRow = useRef(NO_ROW)
  const setQty = (itemId: string, n: number) => {
    if (n <= 0) removedRow.current = rowsOf(panelRef.current).findIndex((row) => row.contains(document.activeElement))
    onQty(itemId, n)
  }
  // Opened under the figures, the list can start right at the footer: bring its first row up, leaving the figures in view.
  useEffect(() => {
    const top = panelRef.current?.getBoundingClientRect().top ?? 0
    const footerTop = document.querySelector('.footer')?.getBoundingClientRect().top ?? window.innerHeight
    const hiddenPx = top + PANEL_SHOWN_PX - footerTop
    if (hiddenPx <= 0) return
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollBy({ top: hiddenPx, behavior: isReduced ? 'auto' : 'smooth' })
  }, [])
  const itemCount = result.items.length
  useEffect(() => {
    const index = removedRow.current
    removedRow.current = NO_ROW
    if (index === NO_ROW) return
    const next = rowsOf(panelRef.current)[index]?.querySelector('button') ?? searchRef.current
    next?.focus()
  }, [itemCount])

  return (
    <div ref={panelRef} id={id} className="qedit__panel">
      {groupByKind(result.items).map((g) => (
        <div key={g.kind} className="qedit__group">
          <span className="lab qedit__group-label">{t.kinds[g.kind]}</span>
          <ul className="qedit__list">
            {g.items.map((item) => (
              <QuickEditRow key={item.id} item={item} name={nameOf(item)} onQty={(n) => setQty(item.id, n)} onDuty={(duty) => onDuty(item.id, duty)} />
            ))}
          </ul>
        </div>
      ))}
      <div className="qedit__add">
        <label htmlFor={searchId} className="visually-hidden">{t.ui.addApplianceSearch}</label>
        <Search size={16} aria-hidden="true" className="qedit__search-icon" />
        <input ref={searchRef} id={searchId} className="in qedit__search" type="search" autoComplete="off" placeholder={t.ui.addApplianceSearch} value={query} onChange={(e) => setQuery(e.target.value)} />
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
  )
}
