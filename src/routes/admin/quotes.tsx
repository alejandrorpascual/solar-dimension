import { createFileRoute, notFound } from '@tanstack/react-router'
import '../../components/admin/admin.css'
import { checkAdmin } from '../../server/admin-catalog'
import { adminListFailedQuotes } from '../../server/admin-quotes'

export const Route = createFileRoute('/admin/quotes')({
  beforeLoad: async () => {
    if (!(await checkAdmin())) throw notFound()
  },
  loader: () => adminListFailedQuotes(),
  component: AdminQuotes,
})

/** UTC, to the minute: the same text on the server and in the browser, whatever their time zones. */
const utcMinute = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`

function AdminQuotes() {
  const reads = Route.useLoaderData()
  return (
    <main className="admin">
      <header className="admin__head">
        <h1>Failed quote reads</h1>
      </header>
      {reads.length === 0 ? (
        <p>No quote read has failed.</p>
      ) : (
        <div className="admin__box">
          <table className="admin__table">
            <thead><tr><th>File</th><th>Account</th><th>Project</th><th>Error</th><th>Time</th></tr></thead>
            <tbody>
              {reads.map((r) => (
                <tr key={r.id}>
                  <td>{r.fileName}</td>
                  <td>{r.email ?? '—'}</td>
                  <td>{r.project ?? '—'}</td>
                  <td>{r.error ?? '—'}</td>
                  <td><time dateTime={r.at}>{utcMinute(r.at)}</time></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
