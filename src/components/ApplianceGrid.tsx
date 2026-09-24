import { useState } from 'react'
import { useLocale } from '../hooks/useLocale'
import { applianceName } from '../i18n'
import { CATEGORIES, type CatalogItem, type Category } from '../lib/catalog'
import type { Store } from '../lib/schema'
import { catalog } from '../lib/sizing'
import { currentProject, removeCustom, setQty } from '../lib/store'
import { ApplianceCard } from './ApplianceCard'

type Filter = 'All' | Category

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
        {items.map((item) => {
          const qty = project.qty[item.id] ?? 0
          return (
            <ApplianceCard
              key={item.id}
              item={item}
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
