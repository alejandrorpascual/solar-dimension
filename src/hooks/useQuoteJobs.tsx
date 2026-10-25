import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { signedInUser } from '../lib/account-session'
import { nextPollDelay, type ProjectJobs } from '../lib/quote-jobs'
import { createQuotePoller } from '../lib/quote-poller'
import { getQuoteJobs, markQuotesSeen } from '../server/quotes/api'
import { useRootData } from './useRootData'

interface QuoteJobsValue {
  jobs: ProjectJobs[]
  /**
   * The jobs are the account's: read at least once since it signed in, or nobody is signed in. Until then a project
   * missing from `jobs` may still have quotes.
   */
  loaded: boolean
  /** The last poll failed; the tray says so and polls again after a longer wait. */
  offline: boolean
  refresh: () => Promise<void>
  markSeen: (projectId: string) => Promise<void>
}

const QuoteJobsContext = createContext<QuoteJobsValue>({ jobs: [], loaded: false, offline: false, refresh: async () => {}, markSeen: async () => {} })

/** Loads the signed-in user's quote jobs once, then polls only while one is being read. */
export function QuoteJobsProvider({ children }: { children: ReactNode }) {
  const { session, quotePollMs } = useRootData()
  const userId = signedInUser(session)?.id ?? null
  const [jobs, setJobs] = useState<ProjectJobs[]>([])
  const [failures, setFailures] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [poller] = useState(() => createQuotePoller({
    load: (account) => getQuoteJobs({ data: { account } }),
    markSeen: (projectId, account) => markQuotesSeen({ data: { account, projectId } }),
    update: setJobs,
    settle: (ok) => {
      setFailures((n) => (ok ? 0 : n + 1))
      if (ok) setLoaded(true)
    },
  }))

  // A layout effect runs before every page's effects, so a page that marks its verdict as seen on mount already
  // finds the poller signed in.
  useLayoutEffect(() => {
    poller.setUser(userId)
    // What was read before belongs to whoever was signed in then; the poller drops a read still in flight for them.
    setLoaded(false)
    if (userId) {
      void poller.refresh()
      return
    }
    setJobs([])
    setFailures(0)
  }, [userId, poller])

  useEffect(() => {
    if (!userId) return
    const delay = nextPollDelay(jobs, failures, quotePollMs)
    if (delay === null) return
    const timer = setTimeout(() => void poller.refresh(), delay)
    return () => clearTimeout(timer)
  }, [userId, jobs, failures, poller, quotePollMs])

  const value = useMemo(
    () => ({ jobs, loaded: userId === null || loaded, offline: failures > 0, refresh: poller.refresh, markSeen: poller.markSeen }),
    [jobs, userId, loaded, failures, poller],
  )
  return <QuoteJobsContext.Provider value={value}>{children}</QuoteJobsContext.Provider>
}

export const useQuoteJobs = (): QuoteJobsValue => useContext(QuoteJobsContext)

export function useProjectJobs(projectId: string): ProjectJobs | null {
  return useQuoteJobs().jobs.find((j) => j.projectId === projectId) ?? null
}

/** How many quotes a project has: 0 when it has none, null while the signed-in account's jobs have not been read yet. */
export function useProjectQuoteCount(projectId: string): number | null {
  const { loaded } = useQuoteJobs()
  const jobs = useProjectJobs(projectId)
  return loaded ? (jobs?.total ?? 0) : null
}
