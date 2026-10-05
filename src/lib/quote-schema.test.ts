import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_QUOTES, warranty } from './quote-fixtures'
import { FINISHED, isPending, normalizeExtraction, QUOTE_STATUSES, QuoteExtractionSchema, MAX_OPTIONS, UNLISTED_OPTION, withOptionDefaults } from './quote-schema'

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

const opt = (id: string, label = id) => ({ id, label, total: null, tax: null })

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
  test('marks a line whose option was never listed, instead of sharing it with every option', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('labor', 50, { option: 'zz' })], { options: [opt('a'), opt('b')] })
    expect(normalizeExtraction(x).lines.map((l) => l.option)).toEqual(['o1', UNLISTED_OPTION])
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

describe('normalizeExtraction of warranty options', () => {
  test('maps each warranty through the same split as the lines', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f']
    const x = extraction([line('inverter', 100, { option: 'a' })], {
      options: ids.map((id) => opt(id)),
      warranties: [
        warranty('battery', 10, ' b '), warranty('inverter', 5), warranty('panel', 25, 'zz'), warranty('labor', 1, 'f'),
      ],
    })
    expect(normalizeExtraction(x).warranties).toEqual([
      warranty('battery', 10, 'o2'), warranty('inverter', 5), warranty('panel', 25, UNLISTED_OPTION),
    ])
  })
  test('one system has shared warranties only', () => {
    const x = extraction([line('inverter', 100)], { options: [opt('a')], warranties: [warranty('battery', 10, 'a')] })
    expect(normalizeExtraction(x).warranties).toEqual([warranty('battery', 10)])
  })
})

describe('withOptionDefaults', () => {
  test("an option stored before options had a tax gets none", () => {
    const x = extraction([line('inverter', 100, { option: 'o1' })], { options: [opt('o1'), opt('o2')] })
    const stored = { ...x, options: x.options.map(({ tax: _t, ...o }) => o) }
    expect(withOptionDefaults(stored).options.map((o) => o.tax)).toEqual([null, null])
  })
  test('a reading stored before options gets none, and every line is shared', () => {
    const { options: _o, ...old } = extraction([line('inverter', 100)])
    const stored = { ...old, lines: old.lines.map(({ option: _l, ...l }) => l) }
    const x = withOptionDefaults(stored)
    expect(x.options).toEqual([])
    expect(x.lines[0]!.option).toBeNull()
  })
  test('a warranty stored before options is shared by every option', () => {
    const { options: _o, ...old } = extraction([line('inverter', 100)], { warranties: [warranty('battery', 10)] })
    const stored = { ...old, lines: old.lines, warranties: old.warranties.map(({ option: _w, ...w }) => w) }
    expect(withOptionDefaults(stored).warranties).toEqual([warranty('battery', 10)])
  })
  test('a reading with options is kept as it is', () => {
    const x = extraction([line('inverter', 100, { option: 'a' })], { options: [opt('a'), opt('b')] })
    expect(withOptionDefaults(x)).toEqual(x)
  })
})
