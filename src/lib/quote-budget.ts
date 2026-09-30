import type { Rejection } from './quote-limits'

/**
 * Model reads admitted per UTC day across every account: the owner's kill switch on spend. Each admitted read (an
 * upload, or a retry) can cost up to 3 attempts, each a primary call and a fallback call, either one repeated once
 * right away on a transient error: at most 12 calls, each capped at MAX_OUTPUT_TOKENS (server/quotes/model.ts).
 */
export const DEFAULT_DAILY_READS = 100
/** The largest limit the `integer` column can count to. */
export const MAX_DAILY_READS = 2_147_483_647

export interface DailyBudget { reads: number; limit: number }

const POSITIVE_INTEGER = /^[1-9]\d*$/

/** QUOTES_DAILY_READS as a limit. Unset means the default; anything but a positive integer also does, flagged as invalid. */
export function parseDailyReads(raw: string | undefined): { limit: number; isInvalid: boolean } {
  const text = (raw ?? '').trim()
  if (text === '') return { limit: DEFAULT_DAILY_READS, isInvalid: false }
  const n = POSITIVE_INTEGER.test(text) ? Number(text) : NaN
  return n <= MAX_DAILY_READS ? { limit: n, isInvalid: false } : { limit: DEFAULT_DAILY_READS, isInvalid: true }
}

/** The UTC calendar day as a date string, the key of `quote_daily_usage`. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10)

export function dailyRejection(daily: DailyBudget): Rejection | null {
  return daily.reads >= daily.limit ? { code: 'daily_limit' } : null
}
