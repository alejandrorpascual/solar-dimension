import { createLatest } from './latest-only'
import type { ProjectJobs } from './quote-jobs'

export interface PollerDeps {
  /** Loads the jobs of `userId`, the user the poller was set to. The server refuses it while another account is signed in. */
  load: (userId: string) => Promise<ProjectJobs[]>
  markSeen: (projectId: string, userId: string) => Promise<unknown>
  /** Applies a change to the list the tray shows. */
  update: (change: (jobs: ProjectJobs[]) => ProjectJobs[]) => void
  /** How a poll went: true when it loaded, false when it failed. */
  settle: (ok: boolean) => void
}

export interface QuotePoller {
  /** Whose jobs to load, or null when signed out. A change drops every request in flight. */
  setUser: (userId: string | null) => void
  /** Loads the jobs. Does nothing when signed out. */
  refresh: () => Promise<void>
  /** Hides "Verdict ready" for a project at once, saves that, then polls again. */
  markSeen: (projectId: string) => Promise<void>
}

/** A new list where the given projects' verdicts count as seen. */
function hideVerdicts(jobs: ProjectJobs[], projectIds: readonly string[]): ProjectJobs[] {
  if (projectIds.length === 0) return jobs
  return jobs.map((j) => (projectIds.includes(j.projectId) ? { ...j, unseen: false } : j))
}

/**
 * Loads the signed-in user's quote jobs and marks verdicts as seen. Only the newest poll may apply its answer. Sign-out
 * is a client-side navigation, so a poll or a mark still in flight could otherwise land after it: it would show the
 * previous user's quotes, or poll while signed out and show the tray as offline.
 */
export function createQuotePoller(deps: PollerDeps): QuotePoller {
  const latest = createLatest()
  let userId: string | null = null
  // Bumped on every sign-in, sign-out or switch of user, so a mark can tell whether the user changed while it saved.
  let session = 0
  // Projects with a mark still saving. A poll that reads the database before the mark commits still has their
  // verdicts as unseen; while the mark saves, they stay hidden whatever a poll says.
  let marking: readonly string[] = []

  const setUser = (next: string | null) => {
    if (next === userId) return
    userId = next
    session++
    latest.invalidate()
  }

  const refresh = async () => {
    if (userId === null) return
    const isCurrent = latest.begin()
    try {
      const next = await deps.load(userId)
      if (!isCurrent()) return
      deps.update(() => hideVerdicts(next, marking))
      deps.settle(true)
    } catch (error) {
      if (!isCurrent()) return
      console.error('[quotes] polling failed', error)
      deps.settle(false)
    }
  }

  const markSeen = async (projectId: string) => {
    if (userId === null) return
    const user = userId
    const mine = session
    // A poll in flight may predate the mark and would bring "Verdict ready" back, so it is dropped.
    latest.invalidate()
    marking = [...marking, projectId]
    deps.update((list) => hideVerdicts(list, [projectId]))
    try {
      await deps.markSeen(projectId, user)
    } catch (error) {
      console.error('[quotes] marking a verdict as seen failed', { projectId, error })
    } finally {
      const at = marking.indexOf(projectId)
      marking = [...marking.slice(0, at), ...marking.slice(at + 1)]
    }
    if (session !== mine) return
    // Polls that started while the mark saved may have read the database before it committed: they are dropped too.
    // The poll after the mark replaces them: without one, a dropped first load would leave the list empty and polling
    // stopped. After a failed mark, it shows the verdict as unseen again.
    latest.invalidate()
    await refresh()
  }

  return { setUser, refresh, markSeen }
}
