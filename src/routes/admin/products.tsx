import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import '../../components/admin/admin.css'
import { checkAdmin } from '../../server/admin-catalog'
import { adminListProducts, adminVerifyProduct } from '../../server/admin-products'
import type { AdminProduct } from '../../server/product-repo'

export const Route = createFileRoute('/admin/products')({
  beforeLoad: async () => {
    if (!(await checkAdmin())) throw notFound()
  },
  loader: () => adminListProducts(),
  component: AdminProducts,
})

/** UTC, to the minute: the same text on the server and in the browser, whatever their time zones. */
const utcMinute = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

function AdminProducts() {
  const items = Route.useLoaderData()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const verify = async (p: AdminProduct) => {
    setError(null)
    try {
      await adminVerifyProduct({ data: { id: p.id, seenUpdatedAt: p.updatedAt } })
      await router.invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not verify the product')
    }
  }
  return (
    <main className="admin">
      <header className="admin__head">
        <h1>Products</h1>
      </header>
      <p className="admin__hint">A product written through the token API is unverified until you check it against its datasheet.</p>
      {error && <p role="alert" className="admin__error">{error}</p>}
      {items.length === 0 ? <p>No products yet.</p> : (
        <table className="admin__table" aria-label="Products">
          <thead><tr><th>Product</th><th>Kind</th><th>Datasheet</th><th>Status</th><th /></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={p.retired ? 'is-retired' : undefined}>
                <td>{p.brand} {p.model}</td>
                <td>{p.kind}</td>
                <td><a href={p.datasheetUrl} target="_blank" rel="noopener noreferrer">Datasheet</a></td>
                <td>
                  {p.verification.status === 'verified' ? (
                    <>Verified<br /><small>{p.verifiedByEmail ?? p.verification.by} · <time dateTime={p.verification.at}>{utcMinute(p.verification.at)}</time></small></>
                  ) : 'Unverified'}
                  {p.retired && <><br /><small>Retired: hidden from the token API list</small></>}
                </td>
                <td>
                  {p.verification.status === 'unverified' && (
                    <button type="button" onClick={() => verify(p)} aria-label={`Verify ${p.brand} ${p.model}`}>
                      Verify
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
