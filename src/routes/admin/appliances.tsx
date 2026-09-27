import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { ApplianceForm } from '../../components/admin/ApplianceForm'
import '../../components/admin/admin.css'
import { APPLIANCE_CATEGORIES, type ApplianceRecord } from '../../lib/catalog-schema'
import { adminListAppliances, adminSetRetired, checkAdmin } from '../../server/admin-catalog'

export const Route = createFileRoute('/admin/appliances')({
  beforeLoad: async () => {
    if (!(await checkAdmin())) throw notFound()
  },
  loader: () => adminListAppliances(),
  component: AdminAppliances,
})

function AdminAppliances() {
  const items = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<ApplianceRecord | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
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
          initial={editing === 'new' ? null : editing}
          onSaved={async () => { setEditing(null); await refresh() }}
          onCancel={() => setEditing(null)}
        />
      )}
      <table className="admin__table">
        <thead><tr><th>Name</th><th>Watts</th><th>Surge</th><th>Duty</th><th>Status</th><th /></tr></thead>
        {APPLIANCE_CATEGORIES.map((cat) => (
          <tbody key={cat}>
            <tr><th colSpan={6} scope="rowgroup">{cat}</th></tr>
            {items.filter((r) => r.category === cat).map((r) => (
              <tr key={r.id} className={r.retired ? 'is-retired' : undefined}>
                <td>{r.labels.en.name}<br /><small>{r.labels.es.name} · {r.id}</small></td>
                <td>{r.watts}</td><td>{r.surge}</td><td>{r.duty}</td>
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
    </main>
  )
}
