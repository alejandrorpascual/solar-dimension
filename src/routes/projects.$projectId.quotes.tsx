import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { AccountMenu } from '../components/AccountMenu'
import { HeaderBar } from '../components/HeaderBar'
import { AddQuoteButton } from '../components/quotes/AddQuoteButton'
import { verdictClock } from '../components/quotes/verdict-clock'
import { VerdictView, type VerdictData } from '../components/quotes/VerdictView'
import { useConnectGoogle } from '../hooks/useConnectGoogle'
import { useLocale } from '../hooks/useLocale'
import { useProjectJobs, useQuoteJobs } from '../hooks/useQuoteJobs'
import { useRootData } from '../hooks/useRootData'
import { useSignOut } from '../hooks/useSignOut'
import { APP_NAME } from '../lib/brand'
import { finishedKey, verdictReload, type ReloadMark } from '../lib/quote-jobs'
import { getProjectQuotes } from '../server/quotes/api'
import { getSession } from '../server/session'

export const Route = createFileRoute('/projects/$projectId/quotes')({
  beforeLoad: async () => {
    if (!(await getSession())) throw redirect({ to: '/login' })
  },
  // The tick orders this read against the page's saves. Data read on the server predates every edit on the page: 0.
  // In the browser the account is the root's, cached since the page loaded: the one the header shows, which the server
  // checks the session against, so a tab left open after another account signed in never shows that account's quotes.
  // On the server both loaders read the same request's session, so the read does not wait for the root's.
  loader: async ({ params, parentMatchPromise }): Promise<VerdictData> => {
    const isServer = typeof window === 'undefined'
    const readAt = isServer ? 0 : verdictClock.tick()
    const account = isServer ? undefined : (await parentMatchPromise).loaderData?.user?.id
    return { ...(await getProjectQuotes({ data: { account, projectId: params.projectId } })), readAt }
  },
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.project.name} · ${APP_NAME}` : APP_NAME }] }),
  component: VerdictPage,
})

function VerdictPage() {
  const data = Route.useLoaderData()
  const { projectId } = Route.useParams()
  const { user } = useRootData()
  const { t } = useLocale()
  const { signOut, hasFailed: hasSignOutFailed } = useSignOut(user)
  const google = useConnectGoogle(user)
  const router = useRouter()
  const jobs = useProjectJobs(projectId)
  const { markSeen } = useQuoteJobs()
  const reload = useCallback(() => router.invalidate({ filter: (m) => m.routeId === Route.id }), [router])
  // A quote finished, or started again, while the page is open: reload its data. Every visit also marks the finished
  // ones as seen. The first poll after a fresh load, or after opening another project in place, matches what the
  // loader just read, so it must not reload: the reload would overwrite a change the user made in the meantime that has
  // not reached the server yet.
  const doneKey = jobs ? finishedKey(jobs.files) : ''
  const loaderKey = finishedKey(data.quotes)
  const lastRead = useRef<ReloadMark>({ projectId, key: loaderKey })
  useEffect(() => {
    const next = verdictReload(lastRead.current, projectId, loaderKey, doneKey)
    lastRead.current = next.mark
    if (next.reload) void reload()
  }, [doneKey, projectId, loaderKey, reload])
  useEffect(() => {
    void markSeen(projectId)
  }, [doneKey, projectId, markSeen])
  return (
    <main className="page">
      <HeaderBar account={<AccountMenu user={user} busy={false} onSignOut={signOut} google={google} />} />
      {hasSignOutFailed && <div className="error" role="alert">{t.ui.signOutFailed}</div>}
      {/* Only the menu's failure: the Connect Google button in the verdict says its own beside it. */}
      {google.hasFailed && <div className="error" role="alert">{t.quotes.connectGoogleFailed}</div>}
      {/* The router keeps this component when only the project changes; the key starts the verdict afresh, so edits
          still saving for one project never show on another's. */}
      <VerdictView key={projectId} data={data} progress={jobs ? { done: jobs.done, total: jobs.total } : null} onReload={reload}
        footerExtra={<AddQuoteButton projectId={projectId} projectName={data.project.name} />} />
    </main>
  )
}
