import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createLatest } from '../lib/latest-only'
import { nextPollDelay, type ProjectJobs } from '../lib/quote-jobs'
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
  const [jobs, setJobs] = useState<ProjectJobs[]>([])
  const [failures, setFailures] = useState(0)
  // Only the newest poll may apply its answer. Sign-out is a client-side navigation, so without this a poll still in
  // flight could land after it and show the previous user's quotes, or restore a verdict just marked as seen.
  const [latest] = useState(createLatest)

  const refresh = useCallback(async () => {
    const isCurrent = latest.begin()
    try {
      const next = await getQuoteJobs()
      if (!isCurrent()) return
      setJobs(next)
      setFailures(0)
    } catch (error) {
      if (!isCurrent()) return
      console.error('[quotes] polling failed', error)
      setFailures((n) => n + 1)
    }
  }, [latest])

  useEffect(() => {
    latest.invalidate()
    if (user) {
      void refresh()
      return
    }
    setJobs([])
    setFailures(0)
  }, [user?.id, refresh, latest])

  useEffect(() => {
    if (!user) return
    const delay = nextPollDelay(jobs, failures)
    if (delay === null) return
    const timer = setTimeout(() => void refresh(), delay)
    return () => clearTimeout(timer)
  }, [user?.id, jobs, failures, refresh])

  const markSeen = useCallback(async (projectId: string) => {
    // A poll in flight may predate the mark and would bring "Verdict ready" back, so it is dropped. The poll after the
    // mark replaces it: without one, a dropped first load would leave the list empty and polling stopped.
    latest.invalidate()
    setJobs((list) => list.map((j) => (j.projectId === projectId ? { ...j, unseen: false } : j)))
    try {
      await markQuotesSeen({ data: { projectId } })
    } catch (error) {
      console.error('[quotes] marking a verdict as seen failed', { projectId, error })
    }
    await refresh()
  }, [latest, refresh])

  const value = useMemo(() => ({ jobs, offline: failures > 0, refresh, markSeen }), [jobs, failures, refresh, markSeen])
  return <QuoteJobsContext.Provider value={value}>{children}</QuoteJobsContext.Provider>
}

export const useQuoteJobs = (): QuoteJobsValue => useContext(QuoteJobsContext)

export function useProjectJobs(projectId: string): ProjectJobs | null {
  return useQuoteJobs().jobs.find((j) => j.projectId === projectId) ?? null
}
