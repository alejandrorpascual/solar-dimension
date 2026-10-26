import { describe, expect, test } from 'vitest'
import { checkExtraction, linesWithTax, optionPrices, priceOf } from './quote-checks'
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
    thread: 'PR #7, quote-checks.ts thread: option total with tax failed option_total_mismatch', fixedIn: 'b2c3922 (squashed into 00296f1)',
    actual: () => checkExtraction(extraction(twoKits, { options: [opt('a', 1160), opt('b', null)], subtotal: 1000, tax: 160 })),
    expected: [],
  },
  {
    name: "the document's flat tax amount never explains another option's total",
    thread: 'PR #7, quote-checks.ts thread: a flat tax from one option was accepted on another', fixedIn: '10ee1dd (squashed into 00296f1)',
    actual: () => checkExtraction(extraction(twoKits, { options: [opt('a', null), opt('b', 2160)], subtotal: 1000, tax: 160 })),
    expected: ['option_total_mismatch'],
  },
  {
    name: 'an option with its own tax and a tax-inclusive total, but no subtotal, passes and is priced',
    thread: 'PR #7, quote-checks.ts thread: option with own tax and no subtotal stayed unranked', fixedIn: 'd10b3fb (squashed into 00296f1)',
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
  name: `${word} is a tax line, counted once`, thread: '#55, tax words', fixedIn: 'cf86c0b (#205)',
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

  // Review R2 on #234: PR #7 (b2c3922) reads an option total at the document's rate as including tax, so it does here too.
  test("an option priced at the document's tax rate counts as taxed, so a cheaper option beside it that states no tax says so", () => {
    const x = extraction([...kitLines(1100, 'o1'), ...kitLines(1200, 'o2')], {
      subtotal: 6340, tax: 1141.2, total: 0, options: [opt('o1', 7481.2), opt('o2', 6440)],
    })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', x)])
    expect(v.best).toMatchObject({ optionId: 'o2', total: 6440, caveats: [{ id: 'tax_unstated' }] })
    expect(v.cleanFit).toMatchObject({ optionId: 'o1', total: 7481.2 })
  })

  // Review R5 on #234: at a document rate of 2% or less, both the bare lines and the lines at the rate fall within the
  // total tolerance. The option's total is read as whichever it is nearest, so one written at just its lines leaves tax out.
  describe('an option written at just its lines, in a quote whose document rate is 1%', () => {
    const lowRate = (): QuoteExtraction => extraction([...kitLines(1100, 'o1'), ...kitLines(1200, 'o2')], {
      subtotal: 6340, tax: 63.4, total: 0, options: [opt('o1', 6340), opt('o2', 6440)],
    })

    test('says it states no tax beside a quote at 7,953.20 that includes its tax', () => {
      const taxed = extraction(kitLines(1500), { subtotal: 6740, tax: 1213.2, total: 7953.2 })
      const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', lowRate()), view('b', taxed)])
      expect(v.best).toMatchObject({ optionId: 'o1', total: 6340, caveats: [{ id: 'tax_unstated' }] })
    })

    test('leaves a cheaper quote at 6,240 that states no tax without a caveat, and names no clean fit', () => {
      const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', lowRate()), view('c', extraction(kitLines(1000)))])
      expect({ best: v.best?.quote.id, total: v.best?.total, caveats: v.best?.caveats?.map((c) => c.id), cleanFit: v.cleanFit?.optionId ?? null })
        .toEqual({ best: 'c', total: 6240, caveats: [], cleanFit: null })
    })
  })

  test('an option total exactly halfway between its lines and its lines plus its written tax counts as taxed', () => {
    const halfway = extraction([...kitLines(1100, 'o1'), ...kitLines(1200, 'o2')], { total: 0, options: [opt('o1', 6370, 60), opt('o2', 6440)] })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', withTax()), view('b', halfway)])
    expect(v.best).toMatchObject({ optionId: 'o1', total: 6370, caveats: [] })
  })

  // QA #124 v4: the tie a real quote can write. A shared line the size of the option's own tax makes "own lines + tax"
  // and "own + shared lines" the same 6,440. Staging reads the option as stating tax; so does the branch.
  test('an option at 6,440 whose 100 tax equals the 100 shared line counts as taxed', () => {
    const x = extraction([...kitLines(1100, 'o1'), ...kitLines(1200, 'o2'), line('labor', 100)], { total: 0, options: [opt('o1', 6440, 100), opt('o2', 6540)] })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', withTax()), view('b', x)])
    expect(v.ranked.find((r) => r.quote.id === 'b' && r.optionId === 'o1')?.caveats?.map((c) => c.id)).toEqual([])
  })

  // QA #124 v4: a single-system quote keeps taxed-first (includedOf), as staging does. At a 1% rate a total of just its
  // lines is also within tolerance of lines plus tax, so it counts as stating its tax, and an untaxed quote beside it says so.
  test('a quote at 6,340 that states 63.40 tax (1%) counts as taxed, so one at 6,440 stating none beside it says so', () => {
    const lowRate = extraction(kitLines(1100), { subtotal: 6340, tax: 63.4, total: 6340 })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('a', lowRate), view('b', extraction(kitLines(1200)))])
    const caveats = (id: string) => v.ranked.find((r) => r.quote.id === id)?.caveats?.map((c) => c.id)
    expect({ best: v.best?.quote.id, a: caveats('a'), b: caveats('b') }).toEqual({ best: 'a', a: [], b: ['tax_unstated'] })
  })

  /** A quote at 7,953.20 that holds its tax, beside which an entry that holds none gets the tax caveat. */
  const taxedAt7953 = (): QuoteView => view('t', extraction(kitLines(1500), { subtotal: 6740, tax: 1213.2, total: 7953.2 }))
  const taxCaveat = (v: ReturnType<typeof compareQuotes>, id: string, optionId: string | null = null) =>
    v.ranked.find((r) => r.quote.id === id && r.optionId === optionId)?.caveats.some((c) => c.id === 'tax_unstated')

  // Review R6 on #234: at 1% the bare lines and the lines plus the written tax both fall within the total tolerance. A
  // tax the system writes itself reads as held whenever a taxed total matches, for an option as for a quote (staging).
  test('an option and a quote that each write a 60 tax and total 6,340 both hold it, beside one at 7,953.20', () => {
    const options = extraction([...kitLines(1100, 'o1'), ...kitLines(1200, 'o2')], { total: 0, options: [opt('o1', 6340, 60), opt('o2', 6500, 60)] })
    const single = extraction(kitLines(1100), { tax: 60, total: 6340 })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('o', options), view('s', single), taxedAt7953()])
    expect({ o1: taxCaveat(v, 'o', 'o1'), single: taxCaveat(v, 's') }).toEqual({ o1: false, single: false })
    expect(priceOf(options, 'o1')?.taxIncluded).toBe(priceOf(single, null)?.taxIncluded)
  })

  // Review R7 on #234: an option's written tax may be a line every option shares; a total that holds that line holds it.
  test('options that write a 1,000 tax listed once as a shared IVA line, totalled with it, hold their tax', () => {
    const x = extraction(
      [...kitLines(1000, 'o1'), ...kitLines(1100, 'o2'), line('labor', 200), taxLine(1000, 'IVA')],
      { total: 0, options: [opt('o1', 7440, 1000), opt('o2', 7540, 1000)] },
    )
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('b', x), taxedAt7953()])
    expect({ o1: taxCaveat(v, 'b', 'o1'), o2: taxCaveat(v, 'b', 'o2') }).toEqual({ o1: false, o2: false })
  })

  // Review R8 on #234: a quote offering one system ranks as a single-system quote, and that option's written tax is its
  // tax (#38, d14c0e0d) when the document writes none.
  test('a quote whose one option writes 1,141.20 tax in its 7,481.20 total holds it, so it is best fit with no caveat', () => {
    const x = extraction(kitLines(1100, 'o1'), { total: 7481.2, options: [opt('o1', 7481.2, 1141.2)] })
    const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [view('one', x), taxedAt7953()])
    expect({ best: v.best?.quote.id, caveats: v.best?.caveats.map((c) => c.id), cleanFit: v.cleanFit?.quote.id ?? null })
      .toEqual({ best: 'one', caveats: [], cleanFit: null })
  })

  // QA #124 v1: a total the user types replaces the one read, so whether the total holds the tax has to follow it.
  describe('a reading whose total was read without its tax, once the user types the total with it', () => {
    const misread = (): QuoteExtraction => extraction(kitLines(1100), { subtotal: 6340, tax: 1141.2, total: 6340 })
    const typed = (): QuoteView => ({ ...view('a', misread()), status: 'needs_review', totalOverride: 7481.2 })

    test('is not said to leave its tax out', () => {
      const taxed = extraction(kitLines(1100), { subtotal: 6340, tax: 1260, total: 7600 })
      const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [typed(), view('b', taxed)])
      expect(v.best).toMatchObject({ total: 7481.2 })
      expect(v.best?.caveats?.map((c) => c.id)).not.toContain('tax_unstated')
    })

    test('still marks a cheaper quote that states no tax beside it', () => {
      const untaxed = extraction([...kitLines(1500), taxLine(0, 'Precios no incluyen ITBIS')])
      const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, [typed(), view('c', untaxed)])
      expect({ best: v.best?.total, caveats: v.best?.caveats?.map((c) => c.id) }).toEqual({ best: 6740, caveats: ['tax_unstated'] })
    })
  })
})
