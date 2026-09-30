import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { AccountMenu } from '../components/AccountMenu'
import { HeaderBar } from '../components/HeaderBar'
import { AddQuoteButton } from '../components/quotes/AddQuoteButton'
import { VerdictView } from '../components/quotes/VerdictView'
import { useProjectJobs, useQuoteJobs } from '../hooks/useQuoteJobs'
import { useRootData } from '../hooks/useRootData'
import { APP_NAME } from '../lib/brand'
import { isPending } from '../lib/quote-schema'
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
  // The first poll after a fresh load matches what the loader just read, so it must not reload: the reload would
  // overwrite a change the user made in the meantime that has not reached the server yet.
  const doneKey = jobs ? `${jobs.done}/${jobs.total}` : ''
  const lastKey = useRef(`${data.quotes.filter((q) => !isPending(q.status)).length}/${data.quotes.length}`)
  useEffect(() => {
    if (doneKey && doneKey !== lastKey.current) {
      lastKey.current = doneKey
      void reload()
    }
    void markSeen(projectId)
  }, [doneKey, projectId, markSeen, reload])
  return (
    <main className="page">
      <HeaderBar account={<AccountMenu user={user} busy={false} />} />
      <VerdictView data={data} progress={jobs ? { done: jobs.done, total: jobs.total } : null} onReload={reload}
        footerExtra={<AddQuoteButton projectId={projectId} projectName={data.project.name} />} />
    </main>
  )
}
