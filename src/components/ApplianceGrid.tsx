import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useHeightProperty } from '../hooks/useHeightProperty'
import { useLocale } from '../hooks/useLocale'
import { tr, type Dictionary } from '../i18n'
import { matchesQuery, searchTexts } from '../lib/appliance-search'
import { gridSections, type GridEntry, type GridSection } from '../lib/appliance-groups'
import { CATEGORIES, forPicker, type CatalogItem, type Category, type CompressorType } from '../lib/catalog'
import type { Project, Store } from '../lib/schema'
import { dutyHint } from '../lib/load-kinds'
import { summarizeProjects } from '../lib/project-summary'
import { catalog } from '../lib/sizing'
import { selectItems } from '../lib/sizing/loads'
import { clearAppliances, currentProject, exampleItemsLeft, isSampleList, removeCustom, restoreProject, setDutyIn, setQty } from '../lib/store'
import { ApplianceCard } from './ApplianceCard'
import { heaviestLine } from './heaviest-line'

type Filter = 'All' | 'Added' | Category
type Heading = 'h2' | 'h3'

/** Read by components.css, which keeps focus clear of the search row stuck to the top; its chips wrap, so its height varies. */
const FIND_HEIGHT_PROPERTY = '--find-h'

/** Twelve near-identical cards, so the All view folds them behind one row. */
const FOLDED_CATEGORY: Category = 'Air conditioning'

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
      <h2 id={id} className="catalog__title">{t.categories[cat]}</h2>
      {added > 0 && <span className="catalog__added">{tr(t, 'sectionAdded', { count: added })}</span>}
    </div>
  )
}

/** Inside an AC group the header names the compressor type, so the card only needs the size. */
const acSizeTitle = (t: Dictionary, tons: number) => tr(t, tons === 1 ? 'acSizeOne' : 'acSizeMany', { tons, btu: tons * 12 })

const addedIn = (section: GridSection, qty: Record<string, number>) =>
  section.entries.filter((e) => e.kind === 'item' && (qty[e.item.id] ?? 0) > 0).length

interface ListNoteProps {
  store: Store
  commit: (s: Store) => void
  project: Project
  isAddedShown: boolean
  /** Between the Added filter and the whole catalog. */
  onToggleAdded: () => void
  onCleared: () => void
}

/** The line above the list: what it holds, how to see just that, and how to empty it or take that back. */
function ListNote({ store, commit, project, isAddedShown, onToggleAdded, onCleared }: ListNoteProps) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const noteRef = useRef<HTMLParagraphElement>(null)
  const [cleared, setCleared] = useState<Project | null>(null)
  const hasItems = Object.values(project.qty).some((n) => n > 0)
  if (cleared && hasItems) setCleared(null)
  const left = exampleItemsLeft(project)
  const sample = isSampleList(project) ? summarizeProjects([project], appliances)[0] : undefined
  const text = sample ? tr(t, 'sampleNote', { list: heaviestLine(sample, t) }) : left > 0 ? tr(t, 'exampleLeft', { count: left }) : t.ui.q1Help
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
      {(hasItems || isAddedShown) && <button type="button" className="linkbtn" onClick={onToggleAdded}>{isAddedShown ? t.ui.seeAllAppliances : t.ui.seeList}</button>}
      {hasItems && <button type="button" className="linkbtn" onClick={clearList}>{t.ui.clearAll}</button>}
      {cleared && !hasItems && <button type="button" className="linkbtn" onClick={undo}>{t.ui.undo}</button>}
    </p>
  )
}

export function ApplianceGrid({ store, commit, onAnnounce }: { store: Store; commit: (s: Store) => void; onAnnounce: (message: string) => void }) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  // What the Added filter opened with: a card taken off stays until the filter changes, so nothing moves under the finger and it can go back on.
  const [addedShown, setAddedShown] = useState<ReadonlySet<string>>(new Set())
  const [isFoldOpen, setFoldOpen] = useState(false)
  const project = currentProject(store)
  const allItems = catalog(forPicker(appliances), project.custom)
  const isAdded = (a: CatalogItem) => (project.qty[a.id] ?? 0) > 0
  const addedIds = allItems.filter(isAdded).map((a) => a.id)
  const addedCount = addedIds.length
  // Every card added since this list opened stays out of the fold: one taken off stays until the page changes, so it can go back on.
  const [keptOut, setKeptOut] = useState<ReadonlySet<string>>(new Set(addedIds))
  if (addedIds.some((id) => !keptOut.has(id))) setKeptOut(new Set([...keptOut, ...addedIds]))
  // A filter picked over a typed word replaces it: the two never narrow each other unseen.
  const pickFilter = (next: Filter) => {
    if (next === 'Added') setAddedShown(new Set(addedIds))
    setFilter(next)
    setQuery('')
  }
  const needle = query.trim()
  // A typed word looks through the whole catalog, whatever the filter; clearing it brings the filter back.
  const shownFilter: Filter = needle === '' ? filter : 'All'
  const inFilter = (a: CatalogItem) => shownFilter === 'All' || (shownFilter === 'Added' ? isAdded(a) || addedShown.has(a.id) : a.cat === shownFilter)
  const items = allItems.filter((a) => inFilter(a) && matchesQuery(needle, searchTexts(t, a)))
  // The added appliances as the engine sizes them, so each card's duty bar shows the duty and average in effect.
  const selected = new Map(selectItems(items, project.qty, project.hours, project.dutyOverrides).map((i) => [i.id, i]))
  const filters: Filter[] = ['All', ...(addedCount > 0 || filter === 'Added' ? ['Added' as const] : []), ...CATEGORIES]
  const filterLabel = (f: Filter) => (f === 'Added' ? tr(t, 'filterAdded', { count: addedCount }) : t.categories[f])
  // A single-category filter already names the section, so its header would only repeat the chip.
  const hasSectionHeaders = shownFilter === 'All'
  const subLevel: Heading = hasSectionHeaders ? 'h3' : 'h2'
  // The list can shrink under a search row stuck to the top of the screen: its results start right under that row.
  const findRef = useRef<HTMLDivElement>(null)
  const catalogRef = useRef<HTMLDivElement>(null)
  useHeightProperty(findRef, FIND_HEIGHT_PROPERTY)
  useEffect(() => {
    const top = catalogRef.current?.getBoundingClientRect().top ?? 0
    const find = findRef.current
    const rowHeight = find && getComputedStyle(find).position === 'sticky' ? find.offsetHeight : 0
    if (top < rowHeight) window.scrollBy(0, top - rowHeight)
  }, [filter, needle])
  const emptyText = shownFilter === 'Custom' ? t.ui.customEmpty : t.ui.nothingMatches
  const isEmpty = items.length === 0
  useEffect(() => {
    if (isEmpty) onAnnounce(emptyText)
  }, [isEmpty, emptyText, onAnnounce])

  const renderSection = (section: GridSection) => {
    const labelCat = hasSectionHeaders ? section.cat : null
    const headingId = labelCat ? `cat-${labelCat.replace(/\s+/g, '-').toLowerCase()}` : undefined
    const canFold = labelCat === FOLDED_CATEGORY
    const entries = canFold && !isFoldOpen
      ? section.entries.flatMap((e): GridEntry[] => (e.kind === 'item' && keptOut.has(e.item.id) ? [{ ...e, isGrouped: false }] : []))
      : section.entries
    const sizes = section.entries.filter((e) => e.kind === 'item').length
    return (
      <section key={section.cat ?? 'results'} className="catalog__section" aria-labelledby={headingId}>
        {labelCat && headingId && <SectionHeader id={headingId} cat={labelCat} added={addedIn(section, project.qty)} t={t} />}
        {canFold && (
          <button type="button" className="catalog__fold" aria-expanded={isFoldOpen} onClick={() => setFoldOpen(!isFoldOpen)}>
            {isFoldOpen ? t.ui.hideAcSizes : tr(t, 'showAcSizes', { count: sizes })}
            <ChevronDown size={16} aria-hidden="true" className="catalog__chev" />
          </button>
        )}
        {entries.length > 0 && <div className="grid">{entries.map(renderEntry)}</div>}
      </section>
    )
  }

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
          <ListNote store={store} commit={commit} project={project} isAddedShown={shownFilter === 'Added'} onToggleAdded={() => pickFilter(shownFilter === 'Added' ? 'All' : 'Added')} onCleared={() => pickFilter('All')} />
          <p className="muted toolbar__more">{t.ui.q1HelpMore}</p>
        </div>
        <div ref={findRef} className="toolbar__find">
          <input className="in toolbar__search" type="search" aria-label={t.ui.search} placeholder={t.ui.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          {/* Under 1024px, where the chips beside it would take three rows of a phone's first screen. */}
          <select className="in toolbar__filter" aria-label={t.ui.categoryFilter} value={shownFilter} onChange={(e) => pickFilter(e.target.value as Filter)}>
            {filters.map((f) => <option key={f} value={f}>{filterLabel(f)}</option>)}
          </select>
          {/* From 1024px, in the search's row: beside it where there is room, so the first cards show above the footer. */}
          <div className="hs toolbar__chips">
            {filters.map((f) => (
              <button key={f} type="button" className={`chip${f === shownFilter ? ' chip--on' : ''}`} aria-pressed={f === shownFilter} onClick={() => pickFilter(f)}>{filterLabel(f)}</button>
            ))}
          </div>
        </div>
      </div>
      {addedCount > 0 && <button type="button" className="btn skip-link" onClick={() => document.querySelector<HTMLElement>('.footer .btn--primary')?.focus()}>{t.ui.skipList}</button>}
      <div ref={catalogRef} className="catalog">
        {gridSections(items, needle !== '' || shownFilter === 'Added').map(renderSection)}
        {isEmpty && (
          <p className="muted toolbar__note">
            {emptyText}
            <button type="button" className="linkbtn" onClick={() => document.querySelector<HTMLElement>('.custom input')?.focus()}>{t.ui.customAddLink}</button>
          </p>
        )}
      </div>
    </div>
  )
}
