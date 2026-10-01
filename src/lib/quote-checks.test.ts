import { describe, expect, test } from 'vitest'
import { checkExtraction, optionPrices } from './quote-checks'
import { extraction, line, SAMPLE_QUOTES } from './quote-fixtures'

describe('checkExtraction', () => {
  test('passes every sample quote', () => {
    for (const q of Object.values(SAMPLE_QUOTES)) expect(checkExtraction(q)).toEqual([])
  })
  test('flags a quote with no lines', () => {
    expect(checkExtraction(extraction([]))).toContain('no_lines')
  })
  test('flags a currency that is not ISO 4217', () => {
    expect(checkExtraction(extraction([line('other', 10)], { currency: 'XYZ' }))).toContain('bad_currency')
    expect(checkExtraction(extraction([line('other', 10)], { currency: 'usd' }))).toContain('bad_currency')
  })
  test('flags a quantity of zero', () => {
    expect(checkExtraction(extraction([line('other', 10, { qty: 0 })]))).toContain('bad_qty')
  })
  test('flags qty × unit price that is more than 1% off the line total', () => {
    expect(checkExtraction(extraction([line('battery', 300, { qty: 2, unitPrice: 100 })]))).toContain('line_mismatch')
    expect(checkExtraction(extraction([line('battery', 200, { qty: 2, unitPrice: 100 })]))).toEqual([])
  })
  test('with a subtotal or tax, lines plus tax must be within 2% of the total; optional lines do not count', () => {
    const lines = [line('inverter', 1000), line('monitoring', 120, { optional: true })]
    expect(checkExtraction(extraction(lines, { tax: 160, subtotal: 1000, total: 1160 }))).toEqual([])
    expect(checkExtraction(extraction(lines, { tax: 160, subtotal: 1000, total: 1400 }))).toContain('total_mismatch')
  })
  test('flags a total that is not a positive amount: the model writes 0 when the quote states none', () => {
    for (const total of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkExtraction(extraction([line('inverter', 1000)], { total })), String(total)).toContain('no_total')
    }
    expect(checkExtraction(extraction([line('inverter', 1000)], { total: 1000 }))).not.toContain('no_total')
  })
  test('skips the total check when the quote has neither subtotal nor tax', () => {
    expect(checkExtraction(extraction([line('inverter', 1000)], { total: 5000 }))).toEqual([])
  })
})

describe('optionPrices', () => {
  const opts = (a: number | null = null, b: number | null = null) => [{ id: 'a', label: 'A', total: a }, { id: 'b', label: 'B', total: b }]
  test('a written total wins over the lines', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })], { options: opts(999) })
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 999 }, { id: 'b', total: 200 }])
  })
  test('with prices only on lines, each option is its own lines plus the shared ones', () => {
    const x = extraction(
      [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' }), line('labor', 50), line('wiring', 30, { optional: true })],
      { options: opts() },
    )
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 150 }, { id: 'b', total: 250 }])
  })
  test('an option whose own lines carry no price has none, even when shared lines do', () => {
    const x = extraction([line('inverter', 100, { option: 'a' }), line('inverter', 0, { option: 'b' }), line('labor', 500)], { options: opts() })
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 600 }, { id: 'b', total: null }])
  })
  test('the SUNA quote prices its two kits', () => {
    expect(optionPrices(SAMPLE_QUOTES.suna)).toEqual([{ id: 'o1', total: 2600 }, { id: 'o2', total: 6200 }])
  })
})

describe('checkExtraction with options', () => {
  test('the SUNA quote passes: it states no total, but each option has a price', () => {
    expect(checkExtraction(SAMPLE_QUOTES.suna)).toEqual([])
  })
  test('no_total only when no option has a price', () => {
    const x = extraction([line('inverter', 0, { option: 'a' }), line('inverter', 0, { option: 'b' })], {
      total: 0, options: [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }],
    })
    expect(checkExtraction(x)).toContain('no_total')
  })
  test('options are never added up against a total, but each line still is checked', () => {
    const options = [{ id: 'a', label: 'A', total: null }, { id: 'b', label: 'B', total: null }]
    const lines = [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(lines, { options, subtotal: 300, tax: 0, total: 999 }))).toEqual([])
    const wrongLine = [line('inverter', 100, { option: 'a', qty: 2, unitPrice: 100 }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(wrongLine, { options }))).toContain('line_mismatch')
  })
})
