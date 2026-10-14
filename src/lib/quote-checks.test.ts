import { describe, expect, test } from 'vitest'
import { checkExtraction, isFixedByTotal, linesWithTax, optionPrices } from './quote-checks'
import { optionLines } from './quote-options'
import { extraction, line, SAMPLE_QUOTES, warranty } from './quote-fixtures'
import { UNLISTED_OPTION, type QuoteExtraction } from './quote-schema'

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
  test('with neither subtotal nor tax, a total above the lines passes: tax or freight may be left out of them', () => {
    expect(checkExtraction(extraction([line('inverter', 1000)], { total: 5000 }))).toEqual([])
  })
  test('with neither subtotal nor tax, a total below the lines is a misread total (AI-07)', () => {
    // The audit's probe E7: lines of 6,340 and a total read as 634, a dropped digit, which would win as the cheapest.
    const lines = [line('inverter', 2000), line('battery', 3000), line('wiring', 250), line('fuse', 90), line('labor', 1000)]
    expect(checkExtraction(extraction(lines, { total: 634 }))).toEqual(['total_mismatch'])
    expect(checkExtraction(extraction(lines, { total: 6340 * 0.99 }))).toEqual([])
    // An optional extra is not in the total, so it is not in the sum either.
    expect(checkExtraction(extraction([line('inverter', 1000), line('monitoring', 500, { optional: true })], { total: 1000 }))).toEqual([])
  })
  test('a quote with no total is flagged once, as no total, whatever its lines add up to', () => {
    expect(checkExtraction(extraction([line('inverter', 1000)], { total: 0 }))).toEqual(['no_total'])
  })
})

describe('isFixedByTotal and linesWithTax', () => {
  test('a typed total settles a missing or mismatched total, nothing else', () => {
    expect(isFixedByTotal(extraction([line('inverter', 1000)], { total: 0 }))).toBe(true)
    expect(isFixedByTotal(extraction([line('inverter', 1000)], { total: 100 }))).toBe(true)
    expect(isFixedByTotal(SAMPLE_QUOTES.solartec)).toBe(true)
    expect(isFixedByTotal(extraction([line('battery', 300, { qty: 2, unitPrice: 100 })]))).toBe(false)
    expect(isFixedByTotal(extraction([line('other', 10, { qty: 0 })]))).toBe(false)
    expect(isFixedByTotal(extraction([line('other', 10)], { currency: 'RD$' }))).toBe(false)
  })
  test('lines with tax counts the included lines and the stated tax', () => {
    expect(linesWithTax(extraction([line('inverter', 1000), line('monitoring', 120, { optional: true })], { tax: 180 }))).toBe(1180)
  })
  test('a tax the quote also lists as one of its lines is counted once', () => {
    // Read both as a line and as the quote's tax, "IVA 16%" added twice would fail a total that is right, and the empty
    // total field would then say its lines and tax add up to 1,320.
    const vat = extraction([line('battery', 1000), line('other', 160, { description: 'IVA 16%' })], { tax: 160, total: 1160 })
    expect(linesWithTax(vat)).toBe(1160)
    expect(checkExtraction(vat)).toEqual([])
  })
})

describe('optionPrices', () => {
  const opts = (a: number | null = null, b: number | null = null) => [{ id: 'a', label: 'A', total: a, tax: null }, { id: 'b', label: 'B', total: b, tax: null }]
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
  describe('tax written for an option', () => {
    const lines = [line('inverter', 1000, { option: 'a' }), line('inverter', 1100, { option: 'b' }), line('labor', 100)]
    test('with no written total, the option is priced with its tax, so it ranks at what it costs', () => {
      const x = extraction(lines, { options: [{ id: 'a', label: 'A', total: null, tax: 176 }, { id: 'b', label: 'B', total: 1200, tax: null }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1276 }, { id: 'b', total: 1200 }])
    })
    test('a written total already holds it: the tax is not added twice', () => {
      const x = extraction(lines, { options: [{ id: 'a', label: 'A', total: 1276, tax: 176 }, { id: 'b', label: 'B', total: null, tax: null }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1276 }, { id: 'b', total: 1200 }])
    })
    test("the document's own tax is not spread over options: which one it belongs to is unknown", () => {
      const x = extraction(lines, { options: opts(), subtotal: 1100, tax: 176 })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1100 }, { id: 'b', total: 1200 }])
    })
    const vat = { option: 'a', description: 'IVA 16 %', source: { page: 1, text: 'I.V.A. (16%) 160,00' } }
    test("a tax the option already lists as one of its own included lines is not added again", () => {
      const withVatLine = [line('inverter', 1000, { option: 'a' }), line('other', 160, vat), line('inverter', 1100, { option: 'b' })]
      const x = extraction(withVatLine, { options: [{ id: 'a', label: 'A', total: null, tax: 160 }, { id: 'b', label: 'B', total: null, tax: null }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1160 }, { id: 'b', total: 1100 }])
    })
    test('a separate charge that only costs the same as the tax, such as freight, still leaves the tax to add', () => {
      const freight = { option: 'a', description: 'Flete a Valencia', source: { page: 1, text: 'Flete a Valencia 160,00' } }
      const withFreight = [line('inverter', 1000, { option: 'a' }), line('other', 160, freight), line('inverter', 1100, { option: 'b' })]
      const x = extraction(withFreight, { options: [{ id: 'a', label: 'A', total: null, tax: 160 }, { id: 'b', label: 'B', total: null, tax: null }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1320 }, { id: 'b', total: 1100 }])
    })
    test('a tax line in English, or written without accents or dots, is recognised too', () => {
      for (const text of ['VAT 16%', 'Sales tax', 'Impuesto al valor agregado', 'IVA', 'ITBIS 18%']) {
        const lines = [line('inverter', 1000, { option: 'a' }), line('other', 160, { option: 'a', description: text, source: { page: 1, text } })]
        const x = extraction(lines, { options: [{ id: 'a', label: 'A', total: null, tax: 160 }, { id: 'b', label: 'B', total: 900, tax: null }] })
        expect(optionPrices(x)[0], text).toEqual({ id: 'a', total: 1160 })
      }
    })
    test('a line of another kind that only costs the same as the tax still leaves the tax to add', () => {
      const sameAmount = [line('inverter', 1000, { option: 'a' }), line('wiring', 160, { option: 'a' }), line('inverter', 1100, { option: 'b' })]
      const x = extraction(sameAmount, { options: [{ id: 'a', label: 'A', total: null, tax: 160 }, { id: 'b', label: 'B', total: null, tax: null }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1320 }, { id: 'b', total: 1100 }])
    })
    test('tax alone never prices an option whose own lines carry no price', () => {
      const unpriced = [line('inverter', 1000, { option: 'a' }), line('inverter', 0, { option: 'b' })]
      const x = extraction(unpriced, { options: [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total: null, tax: 160 }] })
      expect(optionPrices(x)).toEqual([{ id: 'a', total: 1000 }, { id: 'b', total: null }])
    })
  })
})

describe('checkExtraction with options', () => {
  test('the SUNA quote passes: it states no total, but each option has a price', () => {
    expect(checkExtraction(SAMPLE_QUOTES.suna)).toEqual([])
  })
  test('no_total only when no option has a price', () => {
    const x = extraction([line('inverter', 0, { option: 'a' }), line('inverter', 0, { option: 'b' })], {
      total: 0, options: [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total: null, tax: null }],
    })
    expect(checkExtraction(x)).toContain('no_total')
  })
  test('options are never added up against a total, but each line still is checked', () => {
    const options = [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total: null, tax: null }]
    const lines = [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(lines, { options, subtotal: 300, tax: 0, total: 999 }))).toEqual([])
    const wrongLine = [line('inverter', 100, { option: 'a', qty: 2, unitPrice: 100 }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(wrongLine, { options }))).toContain('line_mismatch')
  })
  test('a line naming an option the model never listed fails unknown_option and is in no option', () => {
    const options = [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total: null, tax: null }]
    const x = extraction([line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' }), line('labor', 50, { option: UNLISTED_OPTION })], { options })
    expect(checkExtraction(x)).toContain('unknown_option')
    expect(optionLines(x, 'a').map((l) => l.lineTotal)).toEqual([100])
    expect(optionPrices(x)).toEqual([{ id: 'a', total: 100 }, { id: 'b', total: 200 }])
  })
  test('a warranty naming an option the model never listed fails unknown_option too', () => {
    const options = [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total: null, tax: null }]
    const lines = [line('inverter', 100, { option: 'a' }), line('inverter', 200, { option: 'b' })]
    expect(checkExtraction(extraction(lines, { options, warranties: [warranty('battery', 10, UNLISTED_OPTION)] }))).toContain('unknown_option')
    expect(checkExtraction(extraction(lines, { options, warranties: [warranty('battery', 10, 'a')] }))).toEqual([])
  })
  test('the SUNA quote has no unknown option', () => {
    expect(checkExtraction(SAMPLE_QUOTES.suna)).not.toContain('unknown_option')
  })
  describe('a written option total', () => {
    const lines = [line('inverter', 1000, { option: 'a' }), line('inverter', 2000, { option: 'b' }), line('labor', 300)]
    const withTotal = (a: number | null) => extraction(lines, { options: [{ id: 'a', label: 'A', total: a, tax: null }, { id: 'b', label: 'B', total: null, tax: null }] })
    test('matching the own lines passes', () => {
      expect(checkExtraction(withTotal(1000))).toEqual([])
    })
    test('matching the own lines plus the shared ones passes', () => {
      expect(checkExtraction(withTotal(1300))).toEqual([])
    })
    test('disagreeing with both fails option_total_mismatch, once', () => {
      const x = extraction(lines, { options: [{ id: 'a', label: 'A', total: 5000, tax: null }, { id: 'b', label: 'B', total: 9000, tax: null }] })
      expect(checkExtraction(x).filter((f) => f === 'option_total_mismatch')).toHaveLength(1)
      expect(checkExtraction(withTotal(5000))).toContain('option_total_mismatch')
    })
    const taxed = (a: number, over: Partial<QuoteExtraction>) =>
      extraction(lines, { options: [{ id: 'a', label: 'A', total: a, tax: null }, { id: 'b', label: 'B', total: null, tax: null }], ...over })
    test('a total that includes tax at the rate the document states (tax over subtotal) passes', () => {
      expect(checkExtraction(taxed(1160, { subtotal: 1000, tax: 160 }))).toEqual([])
      expect(checkExtraction(taxed(1508, { subtotal: 1000, tax: 160 }))).toEqual([])
    })
    test("the stated tax amount is never added flat to another option's lines", () => {
      const b = (total: number) => extraction(lines, {
        options: [{ id: 'a', label: 'A', total: null, tax: null }, { id: 'b', label: 'B', total, tax: null }], subtotal: 1000, tax: 160,
      })
      expect(checkExtraction(b(2160))).toContain('option_total_mismatch')
      expect(checkExtraction(b(2320))).toEqual([])
    })
    test('a total that includes the tax written for that option passes, with no subtotal', () => {
      const x = extraction(lines, {
        options: [{ id: 'a', label: 'A', total: 1160, tax: 160 }, { id: 'b', label: 'B', total: null, tax: null }],
      })
      expect(checkExtraction(x)).toEqual([])
    })
    test("the tax written for one option never explains another option's total", () => {
      const x = extraction(lines, {
        options: [{ id: 'a', label: 'A', total: 1160, tax: 160 }, { id: 'b', label: 'B', total: 2160, tax: null }],
      })
      expect(checkExtraction(x)).toContain('option_total_mismatch')
    })
    test('a document-wide tax with no subtotal to make a rate from, or no tax at all, does not explain a higher total', () => {
      expect(checkExtraction(withTotal(1160))).toContain('option_total_mismatch')
      expect(checkExtraction(taxed(1160, { tax: 160 }))).toContain('option_total_mismatch')
    })
    test('an option whose own lines carry no price is not checked', () => {
      const x = extraction([line('inverter', 0, { option: 'a' }), line('inverter', 2000, { option: 'b' })], {
        options: [{ id: 'a', label: 'A', total: 3500, tax: null }, { id: 'b', label: 'B', total: null, tax: null }],
      })
      expect(checkExtraction(x)).toEqual([])
    })
  })
})
