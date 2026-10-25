import { describe, expect, test } from 'vitest'
import { includesTax, priceOf, pricesOf } from './quote-checks'
import { extraction, line } from './quote-fixtures'
import type { QuoteOption } from './quote-schema'

const opt = (id: string, total: number | null, tax: number | null = null): QuoteOption => ({ id, label: id, total, tax })
const vat = line('other', 160, { description: 'IVA 16%', source: { page: 1, text: 'IVA 16%' } })
const kits = [line('inverter', 1000, { option: 'a' }), line('inverter', 2000, { option: 'b' }), line('labor', 300)]

describe('pricesOf: one price record per system', () => {
  test('a single system: base, written tax and a total that holds it', () => {
    expect(pricesOf(extraction([line('inverter', 1000)], { subtotal: 1000, tax: 160, total: 1160 })).quote).toEqual({
      base: 1000, tax: 160, total: 1160, taxIncluded: 'yes', from: { tax: 'written', total: 'written' }, isMismatch: false,
    })
  })
  test('a tax listed as a line is the tax, not part of the base', () => {
    expect(priceOf(extraction([line('inverter', 1000), vat], { tax: 160 }), null)).toMatchObject({ base: 1000, tax: 160, from: { tax: 'line' } })
  })
  test('a stated tax the total leaves out is not included; no tax stated is unknown', () => {
    expect(priceOf(extraction([line('inverter', 1000)], { tax: 160, total: 1000 }), null)).toMatchObject({ taxIncluded: 'no', isMismatch: true })
    expect(priceOf(extraction([line('inverter', 1000)], { total: 0 }), null)).toMatchObject({ tax: null, total: null, taxIncluded: 'unknown' })
  })
  test('an option priced from its lines and its own tax includes it', () => {
    expect(priceOf(extraction(kits, { options: [opt('a', null, 160), opt('b', null)] }), 'a')).toEqual({
      base: 1300, tax: 160, total: 1460, taxIncluded: 'yes', from: { tax: 'written', total: 'lines' }, isMismatch: false,
    })
  })
  test("an option total at the document's rate includes tax at that rate", () => {
    const p = priceOf(extraction(kits, { options: [opt('a', 1160), opt('b', null)], subtotal: 1000, tax: 160 }), 'a')!
    expect(p).toMatchObject({ taxIncluded: 'yes', from: { tax: 'rate', total: 'written' }, isMismatch: false })
    expect(p.tax).toBeCloseTo(160)
  })
  test('an option total that leaves out its written tax is not included, and no option is no price', () => {
    const x = extraction(kits, { options: [opt('a', 1300, 160), opt('b', null)] })
    expect(priceOf(x, 'a')).toMatchObject({ tax: 160, taxIncluded: 'no', isMismatch: false })
    expect([includesTax(priceOf(x, 'a')), priceOf(x, 'z')]).toEqual([false, null])
  })
})
