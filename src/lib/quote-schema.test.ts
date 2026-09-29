import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from './quote-fixtures'
import { FINISHED, isPending, normalizeExtraction, QUOTE_STATUSES, QuoteExtractionSchema } from './quote-schema'

describe('QuoteExtractionSchema', () => {
  test('accepts every sample quote', () => {
    for (const q of Object.values(SAMPLE_QUOTES)) expect(QuoteExtractionSchema.safeParse(q).success).toBe(true)
  })
  test('rejects an unknown line kind', () => {
    const bad = { ...SAMPLE_QUOTES.solartec, lines: [{ ...SAMPLE_QUOTES.solartec.lines[0], kind: 'toaster' }] }
    expect(QuoteExtractionSchema.safeParse(bad).success).toBe(false)
  })
})

describe('normalizeExtraction', () => {
  test('trims long text, caps lists and upper-cases the currency', () => {
    const long = 'x'.repeat(500)
    const x = extraction([line('other', 10, { description: long, source: { page: 1, text: long } })], {
      currency: ' usd ', notes: Array.from({ length: 30 }, () => long), vendor: { name: long, contact: null },
    })
    const n = normalizeExtraction(x)
    expect(n.currency).toBe('USD')
    expect(n.lines[0]!.description).toHaveLength(300)
    expect(n.lines[0]!.source.text).toHaveLength(160)
    expect(n.notes).toHaveLength(20)
    expect(n.vendor.name).toHaveLength(120)
  })
  test('returns a new object and leaves the input alone', () => {
    const x = extraction([line('other', 10)], { currency: 'usd' })
    const n = normalizeExtraction(x)
    expect(n).not.toBe(x)
    expect(x.currency).toBe('usd')
  })
})

describe('FINISHED and isPending', () => {
  test('every status is either pending or finished, never both', () => {
    for (const s of QUOTE_STATUSES) expect(isPending(s)).toBe(!FINISHED.includes(s))
  })
  test('queued and processing are the pending ones', () => {
    expect(QUOTE_STATUSES.filter(isPending)).toEqual(['queued', 'processing'])
  })
})
