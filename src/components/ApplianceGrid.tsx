import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { tr, type Dictionary } from '../i18n'
import { matchesQuery, searchTexts } from '../lib/appliance-search'
import { gridSections, type GridEntry, type GridSection } from '../lib/appliance-groups'
import { CATEGORIES, forPicker, type CatalogItem, type Category, type CompressorType } from '../lib/catalog'
import type { Project, Store } from '../lib/schema'
import { dutyHint } from '../lib/load-kinds'
import { catalog } from '../lib/sizing'
import { selectItems } from '../lib/sizing/loads'
import { clearAppliances, currentProject, exampleItemsLeft, isSampleList, removeCustom, restoreProject, setDutyIn, setQty } from '../lib/store'
import { ApplianceCard } from './ApplianceCard'

type Filter = 'All' | 'Added' | Category
type Heading = 'h3' | 'h4'

const AC_HEADERS: Record<CompressorType, { title: 'acInverter' | 'acConventional'; help: 'acInverterHelp' | 'acConventionalHelp' }> = {
  inverter: { title: 'acInverter', help: 'acInverterHelp' },
  conventional: { title: 'acConventional', help: 'acConventionalHelp' },
}

function AcHeader({ acType, level: Tag, t }: { acType: CompressorType; level: Heading; t: Dictionary }) {
  const keys = AC_HEADERS[acType]
  return (
    <div className="grid__group">
      <Tag className="grid__group-title">{t.ui[keys.title]}</Tag>
      <p className="muted grid__group-help">{t.ui[keys.help]}</p>
    </div>
  )
}

function SectionHeader({ id, cat, added, t }: { id: string; cat: Category; added: number; t: Dictionary }) {
  return (
    <div className="catalog__head">
      <h3 id={id} className="catalog__title">{t.categories[cat]}</h3>
      {added > 0 && <span className="catalog__added">{tr(t, 'sectionAdded', { count: added })}</span>}
    </div>
  )
}

/** Inside an AC group the header names the compressor type, so the card only needs the size. */
const acSizeTitle = (t: Dictionary, tons: number) => tr(t, tons === 1 ? 'acSizeOne' : 'acSizeMany', { tons, btu: tons * 12 })

const addedIn = (section: GridSection, qty: Record<string, number>) =>
  section.entries.filter((e) => e.kind === 'item' && (qty[e.item.id] ?? 0) > 0).length

/** The line above the list: what it holds, and how to empty it or take that back. */
function ListNote({ store, commit, project, onCleared }: { store: Store; commit: (s: Store) => void; project: Project; onCleared: () => void }) {
  const { t } = useLocale()
  const noteRef = useRef<HTMLParagraphElement>(null)
  const [cleared, setCleared] = useState<Project | null>(null)
  const hasItems = Object.values(project.qty).some((n) => n > 0)
  if (cleared && hasItems) setCleared(null)
  const left = exampleItemsLeft(project)
  const text = isSampleList(project) ? t.ui.sampleNote : left > 0 ? tr(t, 'exampleLeft', { count: left }) : t.ui.q1Help
  // The button goes with the list, so focus moves to the line that says what to do next. Not the search: on a phone that opens the keyboard.
  const clearList = () => {
    noteRef.current?.focus()
    setCleared(project)
    onCleared()
    commit(clearAppliances(store))
  }
  const undo = () => {
    noteRef.current?.focus()
    if (cleared) commit(restoreProject(store, cleared))
    setCleared(null)
  }
  return (
    <p ref={noteRef} tabIndex={-1} className="muted toolbar__note">
      {text}
      {hasItems && <button type="button" className="rq-linkbtn" onClick={clearList}>{t.ui.clearAll}</button>}
      {cleared && !hasItems && <button type="button" className="rq-linkbtn" onClick={undo}>{t.ui.undo}</button>}
    </p>
  )
}

export function ApplianceGrid({ store, commit }: { store: Store; commit: (s: Store) => void }) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  // What the Added filter opened with: a card taken off stays until the filter changes, so nothing moves under the finger and it can go back on.
  const [addedShown, setAddedShown] = useState<ReadonlySet<string>>(new Set())
  const project = currentProject(store)
  const allItems = catalog(forPicker(appliances), project.custom)
  const isAdded = (a: CatalogItem) => (project.qty[a.id] ?? 0) > 0
  const addedCount = allItems.filter(isAdded).length
  const pickFilter = (next: Filter) => {
    if (next === 'Added') setAddedShown(new Set(allItems.filter(isAdded).map((a) => a.id)))
    setFilter(next)
  }
  const needle = query.trim()
  const inFilter = (a: CatalogItem) => filter === 'All' || (filter === 'Added' ? isAdded(a) || addedShown.has(a.id) : a.cat === filter)
  const items = allItems.filter((a) => inFilter(a) && matchesQuery(needle, searchTexts(t, a)))
  // The added appliances as the engine sizes them, so each card's duty bar shows the duty and average in effect.
  const selected = new Map(selectItems(items, project.qty, project.hours, project.dutyOverrides).map((i) => [i.id, i]))
  const filters: Filter[] = ['All', ...(addedCount > 0 || filter === 'Added' ? ['Added' as const] : []), ...CATEGORIES]
  const filterLabel = (f: Filter) => (f === 'Added' ? tr(t, 'filterAdded', { count: addedCount }) : t.categories[f])
  // A single-category filter already names the section, so its header would only repeat the chip.
  const hasSectionHeaders = filter === 'All'
  const subLevel: Heading = hasSectionHeaders ? 'h4' : 'h3'
  // The list can shrink under a search row stuck to the top of the screen: its results start right under that row.
  const findRef = useRef<HTMLDivElement>(null)
  const catalogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const top = catalogRef.current?.getBoundingClientRect().top ?? 0
    const rowHeight = findRef.current?.offsetHeight ?? 0
    if (top < rowHeight) window.scrollBy(0, top - rowHeight)
  }, [filter, needle])

  const renderEntry = (entry: GridEntry) => {
    if (entry.kind === 'acHeader') return <AcHeader key={`h-${entry.acType}`} acType={entry.acType} level={subLevel} t={t} />
    const { item } = entry
    const qty = project.qty[item.id] ?? 0
    return (
      <ApplianceCard
        key={item.id}
        item={item}
        title={entry.isGrouped && item.tons ? acSizeTitle(t, item.tons) : undefined}
        qty={qty}
        onInc={() => commit(setQty(store, item.id, qty + 1))}
        onDec={() => commit(setQty(store, item.id, qty - 1))}
        onSet={(n) => commit(setQty(store, item.id, n))}
        onRemove={item.isCustom ? () => commit(removeCustom(store, item.id)) : undefined}
        duty={dutyHint(item, project.dutyOverrides)}
        selected={selected.get(item.id)}
        onDuty={(d) => commit(setDutyIn(store, project.id, item.id, d))}
      />
    )
  }

  return (
    <div className="grid-block">
      <div className="toolbar">
        <div className="toolbar__intro">
          <ListNote store={store} commit={commit} project={project} onCleared={() => pickFilter('All')} />
          <p className="muted toolbar__more">{t.ui.q1HelpMore}</p>
        </div>
        <div ref={findRef} className="toolbar__find">
          <input className="in toolbar__search" type="search" aria-label={t.ui.search} placeholder={t.ui.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          {/* Under 1024px, where the chips below would take three rows of a phone's first screen. */}
          <select className="in toolbar__filter" aria-label={t.ui.categoryFilter} value={filter} onChange={(e) => pickFilter(e.target.value as Filter)}>
            {filters.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}
          </select>
        </div>
      </div>
      <div className="hs toolbar__chips">
        {filters.map((f) => (
          <button key={f} type="button" className={`chip${f === filter ? ' chip--on' : ''}`} aria-pressed={f === filter} onClick={() => pickFilter(f)}>{filterLabel(f)}</button>
        ))}
      </div>
      <div ref={catalogRef} className="catalog">
        {gridSections(items, needle !== '' || filter === 'Added').map((section) => {
          const labelCat = hasSectionHeaders ? section.cat : null
          const headingId = labelCat ? `cat-${labelCat.replace(/\s+/g, '-').toLowerCase()}` : undefined
          return (
            <section key={section.cat ?? 'results'} className="catalog__section" aria-labelledby={headingId}>
              {labelCat && headingId && <SectionHeader id={headingId} cat={labelCat} added={addedIn(section, project.qty)} t={t} />}
              <div className="grid">{section.entries.map(renderEntry)}</div>
            </section>
          )
        })}
        {items.length === 0 && <p className="muted">{t.ui.nothingMatches}</p>}
      </div>
    </div>
  )
}
