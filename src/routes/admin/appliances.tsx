import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ApplianceForm } from '../../components/admin/ApplianceForm'
import '../../components/admin/admin.css'
import { writtenFields } from '../../lib/catalog-diff'
import { APPLIANCE_CATEGORIES, type ApplianceRecord, type FigureSource } from '../../lib/catalog-schema'
import { adminListAppliances, adminRecentChanges, adminSetRetired, checkAdmin } from '../../server/admin-catalog'
import type { ApplianceChangeEntry } from '../../server/catalog-repo'

export const Route = createFileRoute('/admin/appliances')({
  beforeLoad: async () => {
    if (!(await checkAdmin())) throw notFound()
  },
  loader: async () => {
    const [items, changes] = await Promise.all([adminListAppliances(), adminRecentChanges()])
    return { items, changes }
  },
  component: AdminAppliances,
})

function AdminAppliances() {
  const { items, changes } = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<ApplianceRecord | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const existingIds = new Set(items.map((r) => r.id))
  // The root loader caches the catalog for the visit; invalidate so the picker sees the change.
  const refresh = () => router.invalidate()
  const toggleRetired = async (r: ApplianceRecord) => {
    setError(null)
    try {
      await adminSetRetired({ data: { id: r.id, retired: !r.retired } })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the appliance')
    }
  }
  return (
    <main className="admin">
      <header className="admin__head">
        <h1>Appliances</h1>
        <button type="button" onClick={() => setEditing('new')}>New appliance</button>
      </header>
      {error && <p role="alert" className="admin__error">{error}</p>}
      {editing && (
        <ApplianceForm
          // A new key per target remounts the form, so its draft never carries one appliance's values to another.
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          existingIds={existingIds}
          onSaved={async () => { setEditing(null); await refresh() }}
          onCancel={() => setEditing(null)}
        />
      )}
      <table className="admin__table" aria-label="Catalog">
        <thead><tr><th>Name</th><th>Watts</th><th>Surge</th><th>Duty</th><th>Kind</th><th>Status</th><th /></tr></thead>
        {APPLIANCE_CATEGORIES.map((cat) => (
          <tbody key={cat}>
            <tr><th colSpan={7} scope="rowgroup">{cat}</th></tr>
            {items.filter((r) => r.category === cat).map((r) => (
              <tr key={r.id} className={r.retired ? 'is-retired' : undefined}>
                <td>{r.labels.en.name}<br /><small>{r.labels.es.name} · {r.id}</small></td>
                <td>{r.watts}<Sources list={r.sources?.watts} /></td>
                <td>{r.surge}<Sources list={r.sources?.surge} /></td>
                <td>{r.duty}<Sources list={r.sources?.duty} /></td>
                <td>
                  {r.kind ?? 'auto'}{r.surgeClass ? ` · ${r.surgeClass}` : ''}{r.kind === 'momentary' ? ` · ${r.burstSeconds} s × ${r.cyclesPerHour}/h` : ''}
                  {/* Whatever the kind: a source kept after the item stopped being momentary still shows, so it can be cleared. */}
                  <Sources label="Burst" list={r.sources?.burstSeconds} />
                  <Sources label="Cycles" list={r.sources?.cyclesPerHour} />
                </td>
                <td>{r.retired ? 'Retired' : 'Active'}</td>
                <td>
                  <button type="button" onClick={() => setEditing(r)}>Edit</button>
                  <button type="button" onClick={() => toggleRetired(r)}>{r.retired ? 'Restore' : 'Retire'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <RecentChanges changes={changes} />
    </main>
  )
}

/** A figure's sources under it: each one's words as written, linking to the page they are on. Nothing when it has none. */
function Sources({ list, label }: { list: readonly FigureSource[] | undefined; label?: string }) {
  if (!list?.length) return null
  return (
    <ul className="admin__sources">
      {list.map((s, i) => (
        <li key={i}>
          {label && `${label}: `}<a href={s.source} target="_blank" rel="noopener noreferrer">“{s.asWritten}”</a>
        </li>
      ))}
    </ul>
  )
}

const asText = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))

function RecentChanges({ changes }: { changes: ApplianceChangeEntry[] }) {
  return (
    <section className="admin__changes" aria-labelledby="admin-changes">
      <h2 id="admin-changes">Recent changes</h2>
      {changes.length === 0 ? <p>No changes yet.</p> : (
        <table className="admin__table" aria-labelledby="admin-changes">
          <thead><tr><th>When (UTC)</th><th>Appliance</th><th>Who</th><th>What changed</th></tr></thead>
          <tbody>
            {changes.map((c) => (
              <tr key={c.id}>
                {/* UTC text, not toLocaleString: the server and the browser would render different times. */}
                <td>{c.changedAt.slice(0, 16).replace('T', ' ')}</td>
                <td>{c.after.labels.en.name}<br /><small>{c.after.id}</small></td>
                <td>{c.actorEmail ?? c.actor}</td>
                <td>
                  {c.before === null ? 'Created' : (
                    <ul className="admin__fields">
                      {writtenFields(c).map((f) => <li key={f.field}>{f.field}: {asText(f.from)} → {asText(f.to)}</li>)}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
