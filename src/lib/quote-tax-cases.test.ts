import { describe, expect, test } from 'vitest'
import { checkExtraction, linesWithTax, optionPrices } from './quote-checks'
import { compareQuotes, type QuoteView } from './quote-compare'
import { extraction, line, SAMPLE_KIT } from './quote-fixtures'
import { DEFAULT_MUSTS } from './quote-items'
import type { QuoteExtraction, QuoteLine, QuoteOption } from './quote-schema'

/**
 * Every tax shape that once mis-priced or mis-checked a quote (issue #124), kept as one table. Each case goes through
 * the public checks and ranking only, so it runs unchanged on the commit before its fix, where it fails for the reason
 * its thread names. `thread` is that review thread or audit finding; `fixedIn` the commit that fixed it.
 */
interface TaxCase { name: string; thread: string; fixedIn: string; actual: () => unknown; expected: unknown }

const opt = (id: string, total: number | null, tax: number | null = null): QuoteOption => ({ id, label: id.toUpperCase(), total, tax })
const twoKits = [line('inverter', 1000, { option: 'a' }), line('inverter', 2000, { option: 'b' }), line('labor', 300)]
const taxLine = (amount: number, text: string, option: string | null = null): QuoteLine =>
  line('other', amount, { option, description: text, source: { page: 1, text } })

let created = 0
const view = (id: string, x: QuoteExtraction): QuoteView => ({
  id, fileName: `${id}.pdf`, label: id, status: 'ready', extraction: x, overrides: {}, totalOverride: null, createdAt: created++, retries: 0, pages: null,
})
/** The lines of a system that meets every must-have of the sample kit, with `labor` setting its price. */
const kitLines = (labor: number, option: string | null = null): QuoteLine[] => [
  line('inverter', 2000, { option, specs: { watts: 5000, surgeWatts: 10000, hasCharger: true } }),
  line('battery', 3000, { option, qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }),
  line('wiring', 150, { option, specs: { awg: '2/0' } }), line('fuse', 90, { option, specs: { fuseAmps: 175, fuseClass: 'T' } }),
  line('labor', labor, { option }),
]
const withTax = (): QuoteExtraction => extraction(kitLines(1100), { subtotal: 6340, tax: 1141.2, total: 7481.2 })

const PRIOR_CASES: TaxCase[] = [
  {
    name: "an option total that includes the document's tax rate passes the option total check",
    thread: 'PR #7, quote-checks.ts thread: option total with tax failed option_total_mismatch', fixedIn: 'b2c3922',
    actual: () => checkExtraction(extraction(twoKits, { options: [opt('a', 1160), opt('b', null)], subtotal: 1000, tax: 160 })),
    expected: [],
  },
  {
    name: "the document's flat tax amount never explains another option's total",
    thread: 'PR #7, quote-checks.ts thread: a flat tax from one option was accepted on another', fixedIn: '10ee1dd',
    actual: () => checkExtraction(extraction(twoKits, { options: [opt('a', null), opt('b', 2160)], subtotal: 1000, tax: 160 })),
    expected: ['option_total_mismatch'],
  },
  {
    name: 'an option with its own tax and a tax-inclusive total, but no subtotal, passes and is priced',
    thread: 'PR #7, quote-checks.ts thread: option with own tax and no subtotal stayed unranked', fixedIn: 'd10b3fb',
    actual: () => {
      const x = extraction(twoKits, { options: [opt('a', 1160, 160), opt('b', null)] })
      return { failures: checkExtraction(x), prices: optionPrices(x) }
    },
    expected: { failures: [], prices: [{ id: 'a', total: 1160 }, { id: 'b', total: 2300 }] },
  },
  {
    name: "an option's VAT read both as a line and as its tax is counted once",
    thread: "PR #11, quote-checks.ts thread: an option's VAT counted twice", fixedIn: '4c4a468 (squashed into 3b4e08b)',
    actual: () => optionPrices(extraction(
      [line('inverter', 1000, { option: 'a' }), taxLine(160, 'IVA 16 %', 'a'), line('inverter', 1100, { option: 'b' })],
      { options: [opt('a', null, 160), opt('b', null)] },
    )),
    expected: [{ id: 'a', total: 1160 }, { id: 'b', total: 1100 }],
  },
  {
    name: 'a freight line the same size as the tax is not taken for the tax',
    thread: 'PR #11, quote-checks.ts thread: freight the size of the tax hid it', fixedIn: '8c901b1 (squashed into 3b4e08b)',
    actual: () => optionPrices(extraction(
      [line('inverter', 1000, { option: 'a' }), taxLine(160, 'Flete a Valencia', 'a'), line('inverter', 1100, { option: 'b' })],
      { options: [opt('a', null, 160), opt('b', null)] },
    )),
    expected: [{ id: 'a', total: 1320 }, { id: 'b', total: 1100 }],
  },
  {
    name: 'a quote at 7,481 with tax beside one at 6,740 with tax left out: the cheaper one says its tax is not included',
    thread: 'Audit AI-04: a quote leaving tax out ranked on its written total against taxed ones', fixedIn: 'b105845 (#38)',
    actual: () => {
      const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [
        view('a', withTax()), view('b', extraction([...kitLines(1500), taxLine(0, 'Precios no incluyen ITBIS')])),
      ])
      return { best: v.best?.quote.id, caveats: v.best?.caveats?.map((c) => c.id) }
    },
    expected: { best: 'b', caveats: ['tax_unstated'] },
  },
]

/** The tax words from #55: each is a tax line, so a quote that also writes the amount as its tax counts it once. */
const TAX_WORD_CASES: TaxCase[] = ['ITBMS 7%', 'IGV 18%', 'GST 5%', 'IVU 11.5%'].map((word) => ({
  name: `${word} is a tax line, counted once`, thread: '#55, tax words', fixedIn: 'AI-22',
  actual: () => {
    const x = extraction([line('battery', 1000), taxLine(70, word)], { tax: 70, total: 1070 })
    return { sum: linesWithTax(x), failures: checkExtraction(x) }
  },
  expected: { sum: 1070, failures: [] },
}))

describe('tax shapes that once mis-priced or mis-checked a quote', () => {
  // A loop, not test.each: test.each cuts an interpolated name at 40 characters, and each name says what the case keeps.
  for (const c of [...PRIOR_CASES, ...TAX_WORD_CASES]) {
    test(`${c.name} (${c.thread}; fixed in ${c.fixedIn})`, () => expect(c.actual()).toEqual(c.expected))
  }

  test('an option at 6,740 that writes 741 tax and leaves it out of its total says so beside one at 7,481 with tax', () => {
    const leftOut = extraction([...kitLines(1500, 'o1'), ...kitLines(1600, 'o2')], { total: 0, options: [opt('o1', 6740, 741), opt('o2', 6840, 752)] })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', withTax()), view('b', leftOut)])
    expect(v.best).toMatchObject({ optionId: 'o1', total: 6740, caveats: [{ id: 'tax_unstated' }] })
    expect(v.cleanFit?.quote.id).toBe('a')
  })
})
