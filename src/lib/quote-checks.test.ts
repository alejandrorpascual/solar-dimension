import { describe, expect, test } from 'vitest'
import { checkExtraction } from './quote-checks'
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
  test('skips the total check when the quote has neither subtotal nor tax', () => {
    expect(checkExtraction(extraction([line('inverter', 1000)], { total: 5000 }))).toEqual([])
  })
})
