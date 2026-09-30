import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { AccountMenu } from '../components/AccountMenu'
import { HeaderBar } from '../components/HeaderBar'
import { VerdictView } from '../components/quotes/VerdictView'
import { useProjectJobs, useQuoteJobs } from '../hooks/useQuoteJobs'
import { useRootData } from '../hooks/useRootData'
import { APP_NAME } from '../lib/brand'
import { getProjectQuotes } from '../server/quotes/api'
import { getSession } from '../server/session'

export const Route = createFileRoute('/projects/$projectId/quotes')({
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: '/login' })
  },
  loader: ({ params }) => getProjectQuotes({ data: { projectId: params.projectId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · ${APP_NAME}` : APP_NAME }] }),
  component: VerdictPage,
})

function VerdictPage() {
  const data = Route.useLoaderData()
  const { projectId } = Route.useParams()
  const { user } = useRootData()
  const router = useRouter()
  const jobs = useProjectJobs(projectId)
  const { markSeen } = useQuoteJobs()
  const reload = useCallback(() => router.invalidate({ filter: (m) => m.routeId === Route.id }), [router])
  // A quote finished while the page is open: reload its data. Every visit also marks the finished ones as seen.
  const doneKey = jobs ? `${jobs.done}/${jobs.total}` : ''
  const lastKey = useRef(doneKey)
  useEffect(() => {
    if (doneKey !== lastKey.current) {
      lastKey.current = doneKey
      void reload()
    }
    void markSeen(projectId)
  }, [doneKey, projectId, markSeen, reload])
  return (
    <main className="page">
      <HeaderBar account={<AccountMenu user={user} busy={false} />} />
      <VerdictView data={data} progress={jobs ? { done: jobs.done, total: jobs.total } : null} onReload={reload} />
    </main>
  )
}
