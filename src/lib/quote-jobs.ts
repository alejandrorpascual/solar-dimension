import { compareQuotes, type QuoteView } from './quote-compare'
import type { KitNeeds, Musts } from './quote-items'
import { FINISHED, isPending, type QuoteStatus } from './quote-schema'

export interface JobQuote extends QuoteView {
  seenAt: number | null
  /** Retries used; the verdict hides Retry at MAX_RETRIES. */
  retries: number
}
export interface JobFile { id: string; name: string; status: QuoteStatus }
export interface ProjectJobs {
  projectId: string; projectName: string
  files: JobFile[]
  total: number; done: number; pending: number; failed: number; needsReview: number
  /** The kit has no appliances, so the quotes can't be compared yet. */
  kitEmpty: boolean
  /** A finished quote the user hasn't looked at yet: the tray shows "Verdict ready" until they do. Never true for an empty kit. */
  unseen: boolean
  best: { name: string; optionLabel: string | null; total: number; currency: string } | null
}

/** One project's quote jobs for the tray, the kit card and the project card. `kit` is null for an empty kit. */
export function summarizeProject(projectId: string, projectName: string, quotes: readonly JobQuote[], kit: KitNeeds | null, musts: Musts): ProjectJobs {
  const pending = quotes.filter((q) => isPending(q.status)).length
  const kitEmpty = kit === null
  const verdict = kit !== null && pending === 0 ? compareQuotes(kit, musts, quotes) : null
  const best = verdict?.best ? { name: verdict.best.name, optionLabel: verdict.best.optionLabel, total: verdict.best.total, currency: verdict.best.currency } : null
  return {
    projectId, projectName,
    files: [...quotes].sort((a, b) => a.createdAt - b.createdAt).map((q) => ({ id: q.id, name: q.fileName, status: q.status })),
    total: quotes.length,
    done: quotes.length - pending,
    pending,
    failed: quotes.filter((q) => q.status === 'failed').length,
    needsReview: quotes.filter((q) => q.status === 'needs_review' && q.totalOverride === null).length,
    kitEmpty,
    unseen: !kitEmpty && quotes.some((q) => FINISHED.includes(q.status) && q.status !== 'failed' && q.seenAt === null),
    best,
  }
}

export type TrayState = { mode: 'reading' | 'ready'; project: ProjectJobs } | null

/** What the tray shows; nothing on the verdict page of the project it would be about. */
export function pickTray(jobs: readonly ProjectJobs[], hiddenProjectId: string | null): TrayState {
  const visible = jobs.filter((j) => j.projectId !== hiddenProjectId)
  const reading = visible.find((j) => j.pending > 0)
  if (reading) return { mode: 'reading', project: reading }
  const ready = visible.find((j) => j.unseen)
  return ready ? { mode: 'ready', project: ready } : null
}

export const SECONDS_PER_QUOTE = 30

/** Seconds left, shown only once a first quote finished, so the estimate rests on something. */
export function etaSeconds(j: ProjectJobs): number | null {
  return j.done === 0 || j.pending === 0 ? null : j.pending * SECONDS_PER_QUOTE
}

export const POLL_MS = 3000
export const POLL_BACKOFF_MS = 10000

/** Milliseconds until the next status poll, or null to stop polling. */
export function nextPollDelay(jobs: readonly ProjectJobs[], failures: number): number | null {
  if (failures > 0) return POLL_BACKOFF_MS
  return jobs.some((j) => j.pending > 0) ? POLL_MS : null
}
