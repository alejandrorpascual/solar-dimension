import { useRef, useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { applianceName, tr, type Dictionary } from '../i18n'
import { gridSections, type GridEntry, type GridSection } from '../lib/appliance-groups'
import { CATEGORIES, forPicker, type CatalogItem, type Category, type CompressorType } from '../lib/catalog'
import type { Store } from '../lib/schema'
import { dutyHint } from '../lib/load-kinds'
import { catalog } from '../lib/sizing'
import { selectItems } from '../lib/sizing/loads'
import { clearAppliances, currentProject, isSampleList, removeCustom, setDutyIn, setQty } from '../lib/store'
import { ApplianceCard } from './ApplianceCard'

type Filter = 'All' | Category
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

export function ApplianceGrid({ store, commit }: { store: Store; commit: (s: Store) => void }) {
  const { t } = useLocale()
  const appliances = useCatalog()
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const noteRef = useRef<HTMLParagraphElement>(null)
  const project = currentProject(store)
  const isSample = isSampleList(project)
  // The button goes with the list, so focus moves to the line that says what to do next. Not the search: on a phone that opens the keyboard.
  const clearList = () => {
    noteRef.current?.focus()
    commit(clearAppliances(store))
  }
  const needle = query.trim().toLowerCase()
  const matches = (a: CatalogItem) =>
    !needle || a.name.toLowerCase().includes(needle) || applianceName(t, a).toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle)
  const items = catalog(forPicker(appliances), project.custom).filter((a) => (filter === 'All' || a.cat === filter) && matches(a))
  // The added appliances as the engine sizes them, so each card's duty bar shows the duty and average in effect.
  const selected = new Map(selectItems(items, project.qty, project.hours, project.dutyOverrides).map((i) => [i.id, i]))
  const filters: Filter[] = ['All', ...CATEGORIES]
  // A single-category filter already names the section, so its header would only repeat the chip.
  const hasSectionHeaders = filter === 'All'
  const subLevel: Heading = hasSectionHeaders ? 'h4' : 'h3'

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
          <p ref={noteRef} tabIndex={-1} className="muted toolbar__note">
            {isSample ? t.ui.sampleNote : t.ui.q1Help}
            {isSample && <button type="button" className="rq-linkbtn" onClick={clearList}>{t.ui.clearAll}</button>}
          </p>
          <p className="muted toolbar__more">{t.ui.q1HelpMore}</p>
        </div>
        <div className="toolbar__find">
          <input className="in toolbar__search" type="search" aria-label={t.ui.search} placeholder={t.ui.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          {/* Under 1024px, where the chips below would take three rows of a phone's first screen. */}
          <select className="in toolbar__filter" aria-label={t.ui.categoryFilter} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            {filters.map((f) => <option key={f} value={f}>{t.categories[f]}</option>)}
          </select>
        </div>
      </div>
      <div className="hs toolbar__chips">
        {filters.map((f) => (
          <button key={f} type="button" className={`chip${f === filter ? ' chip--on' : ''}`} aria-pressed={f === filter} onClick={() => setFilter(f)}>{t.categories[f]}</button>
        ))}
      </div>
      <div className="catalog">
        {gridSections(items, needle !== '').map((section) => {
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
