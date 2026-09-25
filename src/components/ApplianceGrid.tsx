import { useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { applianceName, tr, type Dictionary } from '../i18n'
import { gridEntries } from '../lib/appliance-groups'
import { CATEGORIES, type CatalogItem, type Category, type CompressorType } from '../lib/catalog'
import type { Store } from '../lib/schema'
import { catalog } from '../lib/sizing'
import { currentProject, removeCustom, setQty } from '../lib/store'
import { ApplianceCard } from './ApplianceCard'

type Filter = 'All' | Category

const AC_HEADERS: Record<CompressorType, { title: 'acInverter' | 'acConventional'; help: 'acInverterHelp' | 'acConventionalHelp' }> = {
  inverter: { title: 'acInverter', help: 'acInverterHelp' },
  conventional: { title: 'acConventional', help: 'acConventionalHelp' },
}

function AcHeader({ acType, t }: { acType: CompressorType; t: Dictionary }) {
  const keys = AC_HEADERS[acType]
  return (
    <div className="grid__group">
      <h3 className="grid__group-title">{t.ui[keys.title]}</h3>
      <p className="muted grid__group-help">{t.ui[keys.help]}</p>
    </div>
  )
}

/** Inside an AC group the header names the compressor type, so the card only needs the size. */
const acSizeTitle = (t: Dictionary, tons: number) => tr(t, tons === 1 ? 'acSizeOne' : 'acSizeMany', { tons, btu: tons * 12 })

export function ApplianceGrid({ store, commit }: { store: Store; commit: (s: Store) => void }) {
  const { t } = useLocale()
  const [filter, setFilter] = useState<Filter>('All')
  const [query, setQuery] = useState('')
  const project = currentProject(store)
  const needle = query.trim().toLowerCase()
  const matches = (a: CatalogItem) =>
    !needle || a.name.toLowerCase().includes(needle) || applianceName(t, a).toLowerCase().includes(needle) || a.id.toLowerCase().includes(needle)
  const items = catalog(project.custom).filter((a) => (filter === 'All' || a.cat === filter) && matches(a))
  const filters: Filter[] = ['All', ...CATEGORIES]

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
      <div className="grid">
        {gridEntries(items, needle !== '').map((entry) => {
          if (entry.kind === 'acHeader') return <AcHeader key={`h-${entry.acType}`} acType={entry.acType} t={t} />
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
              onRemove={item.isCustom ? () => commit(removeCustom(store, item.id)) : undefined}
            />
          )
        })}
        {items.length === 0 && <p className="muted">{t.ui.nothingMatches}</p>}
      </div>
    </div>
  )
}
