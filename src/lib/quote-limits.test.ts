import { describe, expect, test } from 'vitest'
import { checkBasics, cleanFileName, limitRejection, monthStart, QUOTE_LIMITS, sniffMime } from './quote-limits'

const bytes = (...b: number[]) => new Uint8Array([...b, ...new Array(16).fill(0)])

describe('checkBasics', () => {
  test('accepts the four types under the size limit', () => {
    for (const type of ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']) expect(checkBasics({ type, size: 1000 })).toBeNull()
  })
  test('rejects other types and oversize files with their size in MB', () => {
    expect(checkBasics({ type: 'text/plain', size: 10 })).toEqual({ code: 'type' })
    expect(checkBasics({ type: 'application/pdf', size: 5.2 * 1024 * 1024 })).toEqual({ code: 'size', mb: 5.2 })
    expect(checkBasics({ type: 'application/pdf', size: QUOTE_LIMITS.maxBytes })).toBeNull()
  })
})

describe('sniffMime', () => {
  test('reads the magic numbers', () => {
    expect(sniffMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe('application/pdf')
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffMime(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image/webp')
    expect(sniffMime(bytes(0x3c, 0x68, 0x74, 0x6d))).toBeNull()
  })
})

describe('limitRejection and monthStart', () => {
  test('refuses at the per-project and per-month limits', () => {
    expect(limitRejection({ project: 9, month: 19 })).toBeNull()
    expect(limitRejection({ project: 10, month: 0 })).toEqual({ code: 'project_limit' })
    expect(limitRejection({ project: 0, month: 20 })).toEqual({ code: 'month_limit' })
  })
  test('the month starts on the 1st at 00:00 UTC', () => {
    expect(monthStart(new Date('2026-09-29T18:30:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('cleanFileName', () => {
  test('drops folders and control characters, caps the length, never empty', () => {
    expect(cleanFileName('C:\\Users\\me\\quote.pdf')).toBe('quote.pdf')
    expect(cleanFileName('a\u0000b.pdf')).toBe('ab.pdf')
    expect(cleanFileName('x'.repeat(300))).toHaveLength(120)
    expect(cleanFileName('   ')).toBe('quote')
  })
})
