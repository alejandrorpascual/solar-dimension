import { describe, expect, test } from 'vitest'
import { checkExtraction, hasTotal, linesWithTax, optionPrices, pricesOf } from './quote-checks'
import { compareQuotes, entryKey, type QuoteView, type RankedQuote } from './quote-compare'
import { extraction, line, SAMPLE_KIT } from './quote-fixtures'
import { DEFAULT_MUSTS } from './quote-items'
import { optionLines } from './quote-options'
import type { QuoteExtraction, QuoteLine, QuoteOption } from './quote-schema'
import * as staging from './quote-tax-oracle.test-helper'

/**
 * Issue #124 replaced staging's tax rules with one price record. This test runs staging's rules (the frozen oracle in
 * quote-tax-oracle.test-helper.ts) beside the record on seeded, generated readings: QA's staging-shaped and
 * rate-shaped readings (docs/super-board/runs/issue-124-qa-v2, -v3, -v4), plus options writing their own tax, tax lines
 * shared by every option, single-option quotes, typed totals and totals read as 0, and QA v5's edges: a total only the
 * tie rule decides, a tax line near the 1% line tolerance, and options with no lines of their own. Prices, checks and rank totals must
 * match staging on every reading. The tax caveat must match too, except where the reading falls in one of the classes
 * the issue and its review decided to change (`leavesTaxOut`, `taxedAtDocumentRate`). Any other divergence fails with
 * the reading printed.
 */

const SEED = 124
const READINGS = 2400
/** One reading in this many is also ranked, alone or beside two others. */
const COMPARE_EVERY = 2

// mulberry32: a small seeded generator, so every run draws the same readings.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = seeded(SEED)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const cents = (n: number): number => Math.round(n * 100) / 100

const AMOUNTS = [0, 100, 160, 300, 1000, 1160, 1300, 1460, 2000, 2160, 2300]
const TEXTS = ['IVA 16%', 'Flete a Valencia', 'ITBIS no incluido', 'GST 5%', 'I.V.A.', 'Impuestos']
/** Tax rates suppliers write, from 1% (where the bare lines and the lines with tax both fall within the 2% total tolerance) to 18%. */
const RATES = [0.01, 0.015, 0.02, 0.07, 0.11, 0.16, 0.18, 1141.2 / 6340]

/** The lines of a system that meets every must-have of the sample kit, with `labor` setting its price. */
const kitLines = (labor: number, option: string | null): QuoteLine[] => [
  line('inverter', 2000, { option, specs: { watts: 5000, surgeWatts: 10000, hasCharger: true } }),
  line('battery', 3000, { option, qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }),
  line('wiring', 150, { option, specs: { awg: '2/0' } }), line('fuse', 90, { option, specs: { fuseAmps: 175, fuseClass: 'T' } }),
  line('labor', labor, { option }),
]
const textLine = (amount: number, text: string, option: string | null): QuoteLine =>
  line('other', amount, { option, description: text, source: { page: 1, text } })
const sumOf = (ls: readonly QuoteLine[]): number => ls.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)
const ownSum = (x: QuoteExtraction, id: string): number => sumOf(x.lines.filter((l) => l.option === id))

/** QA v2's generator: any mix of kit lines, loose lines, tax-named lines, document and option taxes and totals. */
function stagingShaped(): QuoteExtraction {
  const ids = pick([[], [], ['a'], ['a', 'b']])
  const optOf = () => (ids.length === 0 ? null : pick([null, ...ids]))
  const lines: QuoteLine[] = []
  if (rnd() < 0.4) for (const o of ids.length === 0 ? [null] : ids) lines.push(...kitLines(pick([1000, 1100, 1500]), o))
  const n = Math.floor(rnd() * 4)
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.5) lines.push(line(pick(['inverter', 'labor', 'battery'] as const), pick(AMOUNTS), { option: optOf(), optional: rnd() < 0.1 }))
    else lines.push(textLine(pick(AMOUNTS), pick(TEXTS), optOf()))
  }
  const sum = sumOf(lines)
  const tax = pick([null, null, 0, 160, 741, sum * 0.16])
  const options: QuoteOption[] = ids.map((id) => ({ id, label: id, total: pick([null, ...AMOUNTS, 6740, 7481.2]), tax: pick([null, null, 160, 741]) }))
  return extraction(lines, { options, tax, subtotal: pick([null, sum, 1000, 6340]), total: pick([sum, sum + (tax ?? 0), 0, 1160, 6740, 7481.2]) })
}

/** QA v3's generator: options priced at the document's rate (its tax over its subtotal), at their bare lines, or off both. */
function rateShaped(): QuoteExtraction {
  const ids = pick([['a', 'b'], ['a', 'b'], ['a', 'b', 'c']])
  const lines: QuoteLine[] = ids.flatMap((id) => kitLines(pick([1000, 1100, 1200, 1500]), id))
  if (rnd() < 0.4) lines.push(line('labor', pick([100, 300]), { option: null }))
  if (rnd() < 0.15) lines.push(textLine(pick([0, 160]), pick(TEXTS), pick([null, ...ids])))
  const rate = pick(RATES)
  const subtotal = pick([6340, 1000, sumOf(lines.filter((l) => l.option === ids[0] || l.option === null))])
  const tax = cents(subtotal * rate)
  const shaped = { lines } as QuoteExtraction
  const options: QuoteOption[] = ids.map((id) => {
    const own = ownSum(shaped, id)
    const withShared = sumOf(optionLines(shaped, id))
    const total = pick([own * (1 + rate), withShared * (1 + rate), Math.round(own * (1 + rate)), own, withShared, own + 100, null])
    return { id, label: id, total: total === null ? null : cents(total), tax: pick([null, null, null, null, Math.round(own * rate)]) }
  })
  return extraction(lines, { options, subtotal, tax, total: pick([0, 0, sumOf(lines)]) })
}

/**
 * Options that write their own tax (review R6), a tax line every option shares the size of that tax (R7), and quotes
 * offering a single option, which rank as one system (R8). Totals at the lines, the lines plus the tax, or neither.
 */
function ownTaxShaped(): QuoteExtraction {
  const ids = pick([['a'], ['a'], ['a', 'b']])
  const lines: QuoteLine[] = ids.flatMap((id) => kitLines(pick([1000, 1100, 1500]), id))
  if (rnd() < 0.4) lines.push(line('labor', 200, { option: null }))
  const rate = pick(RATES)
  const ownTax = cents(ownSum({ lines } as QuoteExtraction, ids[0]!) * rate)
  const sharedTax = rnd() < 0.35
  if (sharedTax) lines.push(textLine(ownTax, pick(['IVA', 'I.V.A. 16%', 'VAT']), null))
  else if (rnd() < 0.15) lines.push(textLine(ownTax, 'IVA', ids[0]!))
  const shaped = { lines } as QuoteExtraction
  const options: QuoteOption[] = ids.map((id) => {
    const tax = pick([ownTax, ownTax, null])
    const withShared = sumOf(optionLines(shaped, id))
    const total = pick([ownSum(shaped, id), withShared, withShared + (tax ?? ownTax), ownSum(shaped, id) + (tax ?? ownTax), null])
    return { id, label: id, total: total === null ? null : cents(total), tax }
  })
  const lone = ids.length === 1 ? options[0]!.total : null
  return extraction(lines, { options, tax: pick([null, null, null, ownTax]), total: pick([lone ?? 0, lone ?? 0, sumOf(lines), 0]) })
}

/** A single-system quote stating its tax, at any rate, with a total at its lines, its lines plus tax, or read as 0. */
function singleTaxShaped(): QuoteExtraction {
  const lines = kitLines(pick([1000, 1100, 1500]), null)
  const base = sumOf(lines)
  const tax = cents(base * pick(RATES))
  if (rnd() < 0.25) lines.push(textLine(pick([tax, 160]), pick(['IVA', 'ITBIS 18%', 'Flete']), null))
  return extraction(lines, { subtotal: pick([null, base]), tax: pick([tax, tax, null]), total: pick([base, base + tax, sumOf(lines), 0]) })
}

/**
 * An option whose total is exactly both its own lines at the document's rate and its own lines plus a shared non-tax
 * line of the same size (1,000 × 1.16 = 1,000 + 160), so only the tie rule decides it (QA v5).
 */
function tieShaped(): QuoteExtraction {
  const own = pick([1000, 2000, 6340])
  const rate = pick([0.02, 0.1, 0.16, 0.18])
  const extra = cents(own * rate)
  const lines = [line('inverter', own, { option: 'a' }), line('labor', extra, { option: null }), line('inverter', pick([own, own + 500]), { option: 'b' })]
  const total = pick([own + extra, cents(own * (1 + rate))])
  const options: QuoteOption[] = [{ id: 'a', label: 'a', total, tax: null }, { id: 'b', label: 'b', total: pick([null, own + 500]), tax: null }]
  return extraction(lines, { options, subtotal: own, tax: extra, total: 0 })
}

/**
 * A tax line just inside or just outside the 1% that makes it the same tax as the one written, or a different tax beside a
 * low written one, where the bare lines and the lines with the written tax both fall within the total tolerance (QA v5).
 */
function nearTaxLineShaped(): QuoteExtraction {
  const lines = kitLines(pick([1000, 1100, 1500]), null)
  const base = sumOf(lines)
  const tax = cents(base * pick([0.01, 0.015, 0.07, 0.16, 0.18]))
  const listed = cents(tax * pick([0.97, 0.985, 0.995, 1, 1.005, 1.015, 1.03, 5]))
  lines.push(textLine(listed, pick(['IVA', 'ITBIS 18%']), null))
  return extraction(lines, { subtotal: pick([null, base]), tax, total: pick([base, base + tax, base + listed, base + tax + listed, 0]) })
}

/** An option with no lines of its own, so no price to check, that writes a total and maybe a tax (QA v5). */
function unpricedOptionShaped(): QuoteExtraction {
  const shared = pick([300, 1000])
  const lines = [...kitLines(pick([1000, 1500]), 'a'), line('labor', shared, { option: null })]
  const options: QuoteOption[] = [
    { id: 'a', label: 'a', total: null, tax: pick([null, 160]) },
    { id: 'b', label: 'b', total: pick([300, 1000, shared + 160, cents(shared * 1.16)]), tax: pick([null, 160]) },
  ]
  return extraction(lines, { options, subtotal: pick([null, 1000]), tax: pick([null, 160]), total: 0 })
}

const anyReading = (): QuoteExtraction =>
  pick([stagingShaped, rateShaped, ownTaxShaped, singleTaxShaped, stagingShaped, rateShaped, ownTaxShaped, singleTaxShaped, tieShaped, nearTaxLineShaped, unpricedOptionShaped])()

let created = 0
/**
 * A quote as it is stored: ready when it passes its checks, else needing review. Some carry a total the user typed, and
 * some have been read again, which lets a typed total rank a reading whose lines don't hold.
 */
function view(x: QuoteExtraction): QuoteView {
  const id = `q${created}`
  const status = checkExtraction(x).length === 0 ? 'ready' : 'needs_review'
  const base: QuoteView = {
    id, fileName: `${id}.pdf`, label: id, status, extraction: x, overrides: {}, totalOverride: null, createdAt: created++, retries: 0, pages: null,
  }
  if (rnd() < 0.6) return base
  const lines = sumOf(x.lines)
  const untaxed = sumOf(x.lines.filter((l) => !staging.isTaxLine(l)))
  const typed = pick([lines, lines + (x.tax ?? 0), untaxed + (x.tax ?? 0), cents(lines * 1.16), cents(lines * 1.01), 6340, 7481.2])
  return { ...base, totalOverride: typed, retries: pick([0, 1]) }
}
/** A quote at 7,481.20 that holds its tax, so an entry ranked beside it that holds none gets the caveat. */
const taxedAnchor = (): QuoteView => view(extraction(kitLines(1100, null), { subtotal: 6340, tax: 1141.2, total: 7481.2 }))

const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.02)

interface Reading { x: QuoteExtraction; optionId: string | null; total: number }

/** The bases an entry's total may be written at: a quote's included lines, or an option's own lines, alone or with the shared ones. */
const basesOf = ({ x, optionId }: Reading): number[] => optionId === null ? [sumOf(x.lines)] : [ownSum(x, optionId), sumOf(optionLines(x, optionId))]
const linesOf = ({ x, optionId }: Reading): QuoteLine[] => (optionId === null ? x.lines : optionLines(x, optionId))
/** Whether an option's own lines carry a price: one whose don't ranks at the total written for it, unchecked and unread for tax. */
const isPriced = (x: QuoteExtraction, optionId: string): boolean => ownSum(x, optionId) > 0
const documentRate = (x: QuoteExtraction): number | null => (hasTotal(x.tax) && hasTotal(x.subtotal) ? x.tax / x.subtotal : null)

/**
 * AC4 (and f41d4cc for a typed total): the entry states its tax (staging said so) and the total it ranks by is its lines
 * without that tax, matching no total that holds it. Staging gave it no caveat; it now says its tax is left out.
 * - A quote: its total is its included lines less every tax line, and not its lines when they list a tax, nor its lines,
 *   with or without the tax lines, plus a tax written for it (the document's, or its one option's).
 * - An option: its own lines carry a price, it lists no tax line, and its total is its own lines, alone or with the shared ones, and not those plus
 *   the tax written for it, nor those at the document's rate.
 */
function leavesTaxOut(r: Reading): boolean {
  const { x, optionId, total } = r
  const taxLines = linesOf(r).filter(staging.isTaxLine)
  if (optionId === null) {
    const lines = sumOf(x.lines)
    const untaxed = lines - sumOf(taxLines)
    const written = [x.tax, ...x.options.map((o) => o.tax)].filter(hasTotal)
    const taxed = [...(taxLines.length > 0 ? [lines] : []), ...written.flatMap((t) => [untaxed + t, lines + t])]
    return (written.length > 0 || taxLines.length > 0) && near(total, untaxed) && !taxed.some((t) => near(total, t))
  }
  const written = x.options.find((o) => o.id === optionId)?.tax
  const rate = documentRate(x)
  const bases = basesOf(r)
  const taxed = bases.flatMap((b) => [...(hasTotal(written) ? [b + written] : []), ...(rate === null ? [] : [b * (1 + rate)])])
  return hasTotal(written) && taxLines.length === 0 && isPriced(x, optionId) && bases.some((b) => near(total, b)) && !taxed.some((t) => near(total, t))
}

/**
 * Review R2 on #234 (PR #7, b2c3922): an option that writes no tax, lists no tax line and whose own lines carry a price, whose total is nearest its
 * lines at the document's rate (a tie counts as taxed), holds tax. Staging said it states none. Only a total written for the option: one priced
 * from its lines is those lines, whatever rate they happen to match.
 */
function taxedAtDocumentRate(r: Reading): boolean {
  const { x, optionId, total } = r
  const option = x.options.find((o) => o.id === optionId)
  const rate = documentRate(x)
  if (optionId === null || rate === null || !hasTotal(option?.total) || hasTotal(option?.tax) || linesOf(r).some(staging.isTaxLine) || !isPriced(x, optionId)) return false
  const gaps = (ts: number[]) => ts.filter((t) => near(total, t)).map((t) => Math.abs(total - t))
  const bases = basesOf(r)
  const atRate = gaps(bases.map((b) => b * (1 + rate)))
  return atRate.length > 0 && Math.min(...atRate) <= Math.min(Infinity, ...gaps(bases))
}

const show = (v: unknown): string => JSON.stringify(v, (_k, val: unknown) => (typeof val === 'number' ? cents(val) : val))
const brief = (x: QuoteExtraction) => ({
  subtotal: x.subtotal, tax: x.tax, total: x.total, options: x.options.map((o) => [o.id, o.total, o.tax]),
  lines: x.lines.map((l) => [l.option, l.kind, l.lineTotal, l.description, l.optional || undefined]),
})

/** Divergences of one reading's prices, checks and rank total from staging's. */
function priceDivergences(x: QuoteExtraction, typed: number | null): string[] {
  const out: string[] = []
  if (Math.abs(linesWithTax(x) - staging.linesWithTax(x)) > 1e-6) out.push(`linesWithTax ${linesWithTax(x)} vs ${staging.linesWithTax(x)}`)
  if (show(optionPrices(x)) !== show(staging.optionPrices(x))) out.push(`optionPrices ${show(optionPrices(x))} vs ${show(staging.optionPrices(x))}`)
  const failures = checkExtraction(x).filter((f) => f === 'no_total' || f === 'total_mismatch' || f === 'option_total_mismatch')
  if (show(failures) !== show(staging.totalFailures(x))) out.push(`checkExtraction ${show(failures)} vs ${show(staging.totalFailures(x))}`)
  const rankBy = (n: number | null) => (hasTotal(n) ? n : null)
  const now = rankBy(typed ?? pricesOf(x, typed).quote.total)
  if (now !== rankBy(staging.rankTotal(x, typed))) out.push(`rank total ${now} vs ${rankBy(staging.rankTotal(x, typed))}`)
  return out
}

const readingOf = (r: RankedQuote): Reading => ({ x: r.quote.extraction!, optionId: r.optionId, total: r.total })

/** How often each class the issue changed moved an entry off staging's reading, so a generator change can't leave one untested. */
interface Moved { leavesTaxOut: number; taxedAtDocumentRate: number; caveats: number }

/** Whether an entry holds tax, as staging read it, moved only by the two classes the issue changed. */
function holdsTax(r: RankedQuote, moved: Moved): boolean {
  const reading = readingOf(r)
  const was = staging.statesTax(reading.x, r.optionId)
  if (was && leavesTaxOut(reading)) return (moved.leavesTaxOut++, false)
  if (!was && taxedAtDocumentRate(reading)) return (moved.taxedAtDocumentRate++, true)
  return was
}

/** Divergences of a verdict from staging's: each ranked entry's total, and its tax caveat outside the classes the issue changed. */
function verdictDivergences(quotes: readonly QuoteView[], moved: Moved): string[] {
  const v = compareQuotes(SAMPLE_KIT, DEFAULT_MUSTS, quotes)
  const out: string[] = []
  for (const r of v.ranked) {
    const x = r.quote.extraction!
    const want = r.optionId === null ? staging.rankTotal(x, r.quote.totalOverride) : staging.optionPrices(x).find((p) => p.id === r.optionId)?.total
    if (r.total !== want) out.push(`${entryKey(r)} ranks at ${r.total}, staging ${want}`)
  }
  const taxed = v.ranked.filter((r) => holdsTax(r, moved)).map(entryKey)
  const plain = staging.taxCaveatKeys(v.ranked.map((r) => ({ key: entryKey(r), extraction: r.quote.extraction!, optionId: r.optionId })))
  for (const r of v.ranked) {
    const key = entryKey(r)
    const want = taxed.some((k) => k !== key) && !taxed.includes(key)
    const has = r.caveats.some((c) => c.id === 'tax_unstated')
    if (has !== plain.has(key)) moved.caveats++
    if (has !== want) out.push(`${key} ${has ? 'gets' : 'lacks'} tax_unstated (staging: ${plain.has(key) ? 'gets' : 'lacks'})`)
  }
  return out
}

describe("the price record against staging's tax rules", () => {
  test(`agrees on ${READINGS} generated readings (seed ${SEED}), outside the classes #124 changed`, () => {
    const divergences: string[] = []
    const moved: Moved = { leavesTaxOut: 0, taxedAtDocumentRate: 0, caveats: 0 }
    for (let i = 0; i < READINGS; i++) {
      const q = view(anyReading())
      for (const d of priceDivergences(q.extraction!, q.totalOverride)) {
        divergences.push(`${d}\n  reading ${show(brief(q.extraction!))} typed ${q.totalOverride}`)
      }
      if (i % COMPARE_EVERY !== 0) continue
      const quotes = pick([[q], [q, taxedAnchor()], [q, view(anyReading()), view(anyReading())]])
      const found = verdictDivergences(quotes, moved)
      if (found.length > 0) {
        const readings = quotes.map((v) => ({ id: v.id, typed: v.totalOverride, status: v.status, retries: v.retries, ...brief(v.extraction!) }))
        divergences.push(`${found.join('; ')}\n  quotes ${show(readings)}`)
      }
    }
    expect(divergences.slice(0, 5).join('\n\n'), `${divergences.length} divergences`).toBe('')
    // Each class the issue changed has to come up, or the generators no longer test it.
    expect(moved.leavesTaxOut, 'readings that leave a stated tax out').toBeGreaterThan(0)
    expect(moved.taxedAtDocumentRate, "options taxed at the document's rate").toBeGreaterThan(0)
    expect(moved.caveats, 'tax caveats that moved off staging').toBeGreaterThan(0)
  })
})
