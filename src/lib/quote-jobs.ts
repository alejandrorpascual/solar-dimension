import { compareQuotes, takesTypedTotal, type QuoteView } from './quote-compare'
import type { KitNeeds, Musts } from './quote-items'
import { FINISHED, isPending, type QuoteStatus } from './quote-schema'

export interface JobQuote extends QuoteView {
  seenAt: number | null
}
export interface JobFile { id: string; name: string; status: QuoteStatus; retries: number }
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
    files: [...quotes].sort((a, b) => a.createdAt - b.createdAt).map((q) => ({ id: q.id, name: q.fileName, status: q.status, retries: q.retries })),
    total: quotes.length,
    done: quotes.length - pending,
    pending,
    failed: quotes.filter((q) => q.status === 'failed').length,
    // A typed total settles a reading only when its total was what failed, or once it has been read again: the verdict's rule.
    needsReview: quotes.filter((q) => q.status === 'needs_review' && (q.totalOverride === null || !takesTypedTotal(q))).length,
    kitEmpty,
    unseen: !kitEmpty && quotes.some((q) => FINISHED.includes(q.status) && q.status !== 'failed' && q.seenAt === null),
    best,
  }
}

/**
 * Which quotes are still being read, how each finished one ended, and how many times each was read again. A page that
 * shows quotes reloads when this changes: unlike a count of finished quotes, it changes when a read starts and ends
 * between two looks at the jobs, such as a read again that answers at once.
 */
export function finishedKey(quotes: readonly { id: string; status: QuoteStatus; retries: number }[]): string {
  return quotes.map((q) => `${q.id}:${isPending(q.status) ? 'pending' : q.status}:${q.retries}`).sort().join(',')
}

/** The finishedKey a verdict page last read its project's data at. */
export interface ReloadMark { projectId: string; key: string }

/**
 * Whether the verdict page must read its data again, given the jobs' finishedKey (empty before they load). A project
 * opened in place starts from what its own loader just read: the previous project's key would differ, and read again.
 */
export function verdictReload(last: ReloadMark, projectId: string, loaderKey: string, jobsKey: string): { mark: ReloadMark; reload: boolean } {
  const mark = last.projectId === projectId ? last : { projectId, key: loaderKey }
  if (!jobsKey || jobsKey === mark.key) return { mark, reload: false }
  return { mark: { projectId, key: jobsKey }, reload: true }
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

/** How often the page asks about quotes being read, unless QUOTES_POLL_MS says otherwise: a read takes about 30 s. */
export const DEFAULT_POLL_MS = 3000
/**
 * The range of QUOTES_POLL_MS taken, so a mistyped value cannot have every open page ask without pause: below the
 * floor, or past the browser's longest timer, which then fires at once.
 */
export const MIN_POLL_MS = 100
export const MAX_POLL_MS = 60_000
export const POLL_BACKOFF_MS = 10000

const WHOLE_NUMBER = /^\d+$/

/**
 * QUOTES_POLL_MS as the poll interval. Unset means the default; a value outside MIN_POLL_MS to MAX_POLL_MS, or anything
 * but a whole number, also does, flagged as invalid. The E2E servers, whose stubbed reads take a moment, poll faster.
 */
export function parsePollMs(raw: string | undefined): { pollMs: number; isInvalid: boolean } {
  const text = (raw ?? '').trim()
  if (text === '') return { pollMs: DEFAULT_POLL_MS, isInvalid: false }
  const n = WHOLE_NUMBER.test(text) ? Number(text) : NaN
  const isInRange = n >= MIN_POLL_MS && n <= MAX_POLL_MS
  return isInRange ? { pollMs: n, isInvalid: false } : { pollMs: DEFAULT_POLL_MS, isInvalid: true }
}

/** Milliseconds until the next status poll, or null to stop polling. */
export function nextPollDelay(jobs: readonly ProjectJobs[], failures: number, pollMs: number): number | null {
  if (failures > 0) return POLL_BACKOFF_MS
  return jobs.some((j) => j.pending > 0) ? pollMs : null
}
