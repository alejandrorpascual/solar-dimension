import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES } from './quote-fixtures'
import { FINISHED, isPending, normalizeExtraction, QUOTE_STATUSES, QuoteExtractionSchema, MAX_OPTIONS, withOptionDefaults } from './quote-schema'

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

const opt = (id: string, label = id) => ({ id, label, total: null })

describe('normalizeExtraction with options', () => {
  test('caps options at 5, cuts labels to 60 characters and drops the lines of options past the cap', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const x = extraction(ids.map((id) => line('inverter', 100, { option: id })), {
      options: ids.map((id) => opt(id, 'x'.repeat(80))),
    })
    const n = normalizeExtraction(x)
    expect(n.options.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5'])
    expect(MAX_OPTIONS).toBe(5)
    expect(n.options[0]!.label).toHaveLength(60)
    expect(n.lines.map((l) => l.option)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5'])
  })
  test('nulls a line whose option was never listed', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('labor', 50, { option: 'zz' })], { options: [opt('a'), opt('b')] })
    expect(normalizeExtraction(x).lines.map((l) => l.option)).toEqual(['o1', null])
  })
  test('one option is one system: no options, and every line shared', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a')] })
    const n = normalizeExtraction(x)
    expect(n.options).toEqual([])
    expect(n.lines[0]!.option).toBeNull()
  })
  test('a repeated option id keeps the first, so no two cards share a key', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a', 'First'), opt('a', 'Again'), opt('b')] })
    expect(normalizeExtraction(x).options.map((o) => o.label)).toEqual(['First', 'b'])
  })
  test('a duplicate that leaves fewer than two options is one system: no options, and every line shared', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('labor', 50, { option: 'b' })], { options: [opt('a'), opt(' a ')] })
    const n = normalizeExtraction(x)
    expect(n.options).toEqual([])
    expect(n.lines.map((l) => l.option)).toEqual([null, null])
  })
  test('ids that share a long prefix stay two options, and their lines follow', () => {
    const x = extraction(
      [line('inverter', 100, { option: 'alternativa-1' }), line('inverter', 200, { option: 'alternativa-2' })],
      { options: [opt('alternativa-1'), opt('alternativa-2')] },
    )
    const n = normalizeExtraction(x)
    expect(n.options.map((o) => o.id)).toEqual(['o1', 'o2'])
    expect(n.lines.map((l) => l.option)).toEqual(['o1', 'o2'])
  })
  test('renames the kept options to o1..oN, on the options and on the lines alike', () => {
    const x = extraction(
      [line('inverter', 100, { option: 'Kit B' }), line('inverter', 200, { option: ' Kit A ' }), line('labor', 50)],
      { options: [opt('Kit A'), opt('Kit B'), opt('Kit C')] },
    )
    const n = normalizeExtraction(x)
    expect(n.options.map((o) => o.id)).toEqual(['o1', 'o2', 'o3'])
    expect(n.lines.map((l) => l.option)).toEqual(['o2', 'o1', null])
  })
})

describe('withOptionDefaults', () => {
  test('a reading stored before options gets none, and every line is shared', () => {
    const { options: _o, ...old } = extraction([line('inverter', 100)])
    const stored = { ...old, lines: old.lines.map(({ option: _l, ...l }) => l) }
    const x = withOptionDefaults(stored)
    expect(x.options).toEqual([])
    expect(x.lines[0]!.option).toBeNull()
  })
  test('a reading with options is kept as it is', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a'), opt('b')] })
    expect(withOptionDefaults(x)).toEqual(x)
  })
})
