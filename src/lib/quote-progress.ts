import { trq, type Dictionary } from '../i18n'
import { MAX_RETRIES } from './quote-guards'
import { SECONDS_PER_QUOTE } from './quote-jobs'
import type { Rejection } from './quote-limits'
import type { QuoteStatus } from './quote-schema'
import { elapsedText, etaText, fileStatusText, rejectionText } from './quote-text'

/** How a file in the hand-off dialog is doing: still on its way, finished one of three ways, or refused at upload. */
export type HandoffRowState = 'working' | 'done' | 'review' | 'failed' | 'rejected'

/** A file's row state from its upload and, once it is a quote, the quote's status (null until the jobs list has it). */
export function handoffRowState(item: { state: 'uploading' | 'accepted' | 'rejected' }, status: QuoteStatus | null): HandoffRowState {
  if (item.state === 'rejected') return 'rejected'
  if (item.state === 'uploading' || status === null || status === 'queued' || status === 'processing') return 'working'
  if (status === 'ready') return 'done'
  return status === 'needs_review' ? 'review' : 'failed'
}

const SUMMARY_SEPARATOR = ' · '
const needsAttention = (s: HandoffRowState): boolean => s === 'failed' || s === 'rejected' || s === 'review'

/** One line under the dialog's files: how many are reading, need the user, and are read; empty groups are left out. */
export function handoffSummary(t: Dictionary, states: readonly HandoffRowState[]): string {
  const reading = states.filter((s) => s === 'working').length
  const attention = states.filter(needsAttention).length
  const read = states.filter((s) => s === 'done').length
  return [
    reading > 0 ? trq(t, 'sumReading', { count: reading }) : null,
    attention === 1 ? t.quotes.sumAttentionOne : attention > 1 ? trq(t, 'sumAttention', { count: attention }) : null,
    read === 1 ? t.quotes.sumReadOne : read > 1 ? trq(t, 'sumRead', { count: read }) : null,
  ].filter((part): part is string => part !== null).join(SUMMARY_SEPARATOR)
}

const aboutOneQuote = (t: Dictionary): string => trq(t, 'aboutEta', { eta: etaText(t, SECONDS_PER_QUOTE) })

/**
 * The second line of a file's row: what it is doing, about how long that takes and how long it has taken so far, how
 * it ended, or why it was refused.
 */
export function handoffRowMeta(
  t: Dictionary, state: HandoffRowState, status: QuoteStatus | 'uploading', rejection: Rejection | null, elapsed: number,
): string {
  if (state === 'rejected') return rejection ? rejectionText(t, rejection) : t.quotes.errUpload
  if (state === 'working') return [fileStatusText(t, status), aboutOneQuote(t), elapsedText(t, elapsed)].join(SUMMARY_SEPARATOR)
  return fileStatusText(t, status)
}

export type StepState = 'done' | 'active' | 'failed' | 'todo'
export interface ReadStep { id: 'uploaded' | 'read' | 'compared'; state: StepState }

/**
 * The steps a quote not yet compared has been through: uploaded, read, compared with the kit. A failed read stops
 * there, so its card shows no step it will never reach.
 */
export function readSteps(status: QuoteStatus): ReadStep[] {
  const uploaded: ReadStep = { id: 'uploaded', state: 'done' }
  if (status === 'failed') return [uploaded, { id: 'read', state: 'failed' }]
  return [uploaded, { id: 'read', state: 'active' }, { id: 'compared', state: 'todo' }]
}

/** A step's words. The read step reuses the file statuses, so it says Waiting or Reading, and Couldn't read it. */
export function stepLabel(t: Dictionary, step: ReadStep, status: QuoteStatus): string {
  if (step.id === 'uploaded') return t.quotes.stepUploaded
  if (step.id === 'compared') return t.quotes.stepCompared
  return fileStatusText(t, step.state === 'failed' ? 'failed' : status)
}

/** How many retries a failed quote has left; the server holds the same cap (MAX_RETRIES). */
export function triesLeftText(t: Dictionary, retries: number): string {
  const left = Math.max(0, MAX_RETRIES - retries)
  return left === 1 ? t.quotes.triesLeftOne : trq(t, 'triesLeft', { count: left })
}

/** About when a quote being read will be ready, and how long it has taken so far. */
export const readyInText = (t: Dictionary, elapsed: number): string =>
  `${trq(t, 'readyIn', { eta: etaText(t, SECONDS_PER_QUOTE) })}${SUMMARY_SEPARATOR}${elapsedText(t, elapsed)}`
