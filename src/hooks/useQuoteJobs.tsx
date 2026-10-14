import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { nextPollDelay, type ProjectJobs } from '../lib/quote-jobs'
import { createQuotePoller } from '../lib/quote-poller'
import { getQuoteJobs, markQuotesSeen } from '../server/quotes/api'
import { useRootData } from './useRootData'

interface QuoteJobsValue {
  jobs: ProjectJobs[]
  /** The last poll failed; the tray says so and polls again after a longer wait. */
  offline: boolean
  refresh: () => Promise<void>
  markSeen: (projectId: string) => Promise<void>
}

const QuoteJobsContext = createContext<QuoteJobsValue>({ jobs: [], offline: false, refresh: async () => {}, markSeen: async () => {} })

/** Loads the signed-in user's quote jobs once, then polls only while one is being read. */
export function QuoteJobsProvider({ children }: { children: ReactNode }) {
  const { user } = useRootData()
  const userId = user?.id ?? null
  const [jobs, setJobs] = useState<ProjectJobs[]>([])
  const [failures, setFailures] = useState(0)
  const [poller] = useState(() => createQuotePoller({
    load: (account) => getQuoteJobs({ data: { account } }),
    markSeen: (projectId, account) => markQuotesSeen({ data: { account, projectId } }),
    update: setJobs,
    settle: (ok) => setFailures((n) => (ok ? 0 : n + 1)),
  }))

  // A layout effect runs before every page's effects, so a page that marks its verdict as seen on mount already
  // finds the poller signed in.
  useLayoutEffect(() => {
    poller.setUser(userId)
    if (userId) {
      void poller.refresh()
      return
    }
    setJobs([])
    setFailures(0)
  }, [userId, poller])

  useEffect(() => {
    if (!userId) return
    const delay = nextPollDelay(jobs, failures)
    if (delay === null) return
    const timer = setTimeout(() => void poller.refresh(), delay)
    return () => clearTimeout(timer)
  }, [userId, jobs, failures, poller])

  const value = useMemo(
    () => ({ jobs, offline: failures > 0, refresh: poller.refresh, markSeen: poller.markSeen }),
    [jobs, failures, poller],
  )
  return <QuoteJobsContext.Provider value={value}>{children}</QuoteJobsContext.Provider>
}

export const useQuoteJobs = (): QuoteJobsValue => useContext(QuoteJobsContext)

export function useProjectJobs(projectId: string): ProjectJobs | null {
  return useQuoteJobs().jobs.find((j) => j.projectId === projectId) ?? null
}
