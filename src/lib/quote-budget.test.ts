import { describe, expect, test } from 'vitest'
import { DEFAULT_DAILY_READS, dailyRejection, MAX_DAILY_READS, parseDailyReads, utcDay } from './quote-budget'

describe('parseDailyReads', () => {
  test('unset or blank uses the default of 100, and is not an error', () => {
    expect(DEFAULT_DAILY_READS).toBe(100)
    expect(parseDailyReads(undefined)).toEqual({ limit: 100, isInvalid: false })
    expect(parseDailyReads('')).toEqual({ limit: 100, isInvalid: false })
    expect(parseDailyReads('  ')).toEqual({ limit: 100, isInvalid: false })
  })
  test('a whole number is the limit, spaces trimmed', () => {
    expect(parseDailyReads('250')).toEqual({ limit: 250, isInvalid: false })
    expect(parseDailyReads(' 1 ')).toEqual({ limit: 1, isInvalid: false })
    expect(parseDailyReads(String(MAX_DAILY_READS))).toEqual({ limit: MAX_DAILY_READS, isInvalid: false })
  })
  test('0 is a valid limit: it pauses reading', () => {
    expect(parseDailyReads('0')).toEqual({ limit: 0, isInvalid: false })
    expect(parseDailyReads(' 0 ')).toEqual({ limit: 0, isInvalid: false })
    expect(dailyRejection({ reads: 0, limit: 0 })).toEqual({ code: 'daily_limit' })
  })
  test('anything else falls back to the default and says so', () => {
    for (const raw of ['00', '-0', '-5', '2.5', '1e3', 'abc', '10 reads', '0x10', String(MAX_DAILY_READS + 1)]) {
      expect(parseDailyReads(raw), raw).toEqual({ limit: DEFAULT_DAILY_READS, isInvalid: true })
    }
  })
})

describe('utcDay', () => {
  test('is the UTC calendar day, whatever the local time', () => {
    expect(utcDay(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-30')
    expect(utcDay(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01')
    expect(utcDay(new Date('2026-09-30T21:00:00-05:00'))).toBe('2026-10-01')
  })
})

describe('dailyRejection', () => {
  test('refuses once today’s reads reach the limit', () => {
    expect(dailyRejection({ reads: 0, limit: 100 })).toBeNull()
    expect(dailyRejection({ reads: 99, limit: 100 })).toBeNull()
    expect(dailyRejection({ reads: 100, limit: 100 })).toEqual({ code: 'daily_limit' })
    expect(dailyRejection({ reads: 150, limit: 100 })).toEqual({ code: 'daily_limit' })
  })
})
