import { useState } from 'react'
import { useCatalog } from '../hooks/useCatalog'
import { useLocale } from '../hooks/useLocale'
import { applianceName, tr, type Dictionary } from '../i18n'
import { gridSections, type GridEntry, type GridSection } from '../lib/appliance-groups'
import { CATEGORIES, forPicker, type CatalogItem, type Category, type CompressorType } from '../lib/catalog'
import type { Store } from '../lib/schema'
import { catalog } from '../lib/sizing'
import { currentProject, removeCustom, setQty } from '../lib/store'
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
  const project = currentProject(store)
  const needle = query.trim().toLowerCase()
  const matches = (a: CatalogItem) =>
    !needle || a.name.toLowerCase().includes(needle) || applianceName(t, a).toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle)
  const items = catalog(forPicker(appliances), project.custom).filter((a) => (filter === 'All' || a.cat === filter) && matches(a))
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
      />
    )
  }

  return (
    <div className="grid-block">
      <div className="toolbar">
        <p className="muted">{t.ui.q1Help}</p>
        <input className="in toolbar__search" type="search" aria-label={t.ui.search} placeholder={t.ui.search} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="hs">
        {filters.map((f) => (
          <button key={f} type="button" className={`chip${f === filter ? ' chip--on' : ''}`} onClick={() => setFilter(f)}>{t.categories[f]}</button>
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
