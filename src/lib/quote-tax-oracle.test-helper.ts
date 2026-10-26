/**
 * A frozen copy of staging's tax rules at cfdba2b (src/lib/quote-checks.ts, quote-compare.ts, quote-caveats.ts), the
 * code issue #124 replaced with one price record (pricesOf). It is kept only as the oracle of
 * quote-tax-differential.test.ts and is never imported by app code. Do not edit it to follow the app: a change here
 * changes what the differential test calls "as before".
 */
import type { QuoteExtraction, QuoteLine, QuoteOption } from './quote-schema'

const LINE_TOLERANCE = 0.01
const TOTAL_TOLERANCE = 0.02
const MIN_ABSOLUTE_TOLERANCE = 1

const near = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= Math.max(MIN_ABSOLUTE_TOLERANCE, Math.abs(b) * tolerance)

const hasTotal = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const includedSum = (lines: readonly QuoteLine[]): number => lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)

const hasOptions = (x: QuoteExtraction): boolean => x.options.length >= 2
const optionLines = (x: QuoteExtraction, id: string): QuoteLine[] => x.lines.filter((l) => l.option === id || l.option === null)

const TAX_WORDS = /\b(iva|itbis|itbms|igv|ivu|vat|gst|tax(es)?|impuestos?)\b/
const DIACRITICS = /\p{Diacritic}/gu
const namesTax = (text: string): boolean => TAX_WORDS.test(text.normalize('NFD').replace(DIACRITICS, '').replace(/\./g, '').toLowerCase())

const isTaxListed = (lines: readonly QuoteLine[], tax: number): boolean =>
  lines.some((l) =>
    !l.optional && l.kind === 'other' && near(l.lineTotal, tax, LINE_TOLERANCE) && (namesTax(l.description) || namesTax(l.source.text)))

export function linesWithTax(x: QuoteExtraction): number {
  const tax = x.tax ?? 0
  return includedSum(x.lines) + (isTaxListed(x.lines, tax) ? 0 : tax)
}

export function optionPrices(x: QuoteExtraction): { id: string; total: number | null }[] {
  const shared = includedSum(x.lines.filter((l) => l.option === null))
  return x.options.map((o) => {
    if (hasTotal(o.total)) return { id: o.id, total: o.total }
    const ownLines = x.lines.filter((l) => l.option === o.id)
    const own = includedSum(ownLines)
    const tax = hasTotal(o.tax) && !isTaxListed(ownLines, o.tax) ? o.tax : 0
    return { id: o.id, total: own > 0 ? own + shared + tax : null }
  })
}

/** An included line that names a tax and charges one: what statesTax counts as a tax line. */
export const isTaxLine = (l: QuoteLine): boolean =>
  !l.optional && l.kind === 'other' && hasTotal(l.lineTotal) && (namesTax(l.description) || namesTax(l.source.text))

/** Whether a quote (optionId null), or one option of it, states tax: what decided the tax caveat on staging. */
export function statesTax(x: QuoteExtraction, optionId: string | null): boolean {
  const taxes = optionId === null ? [x.tax, ...x.options.map((o) => o.tax)] : [x.options.find((o) => o.id === optionId)?.tax]
  const lines = optionId === null ? x.lines : optionLines(x, optionId)
  return taxes.some(hasTotal) ||
    lines.some(isTaxLine)
}

function taxedTotals(base: number, x: QuoteExtraction, option: QuoteOption): number[] {
  const tax = x.tax ?? 0
  return [
    base,
    ...(hasTotal(option.tax) ? [base + option.tax] : []),
    ...(tax > 0 && hasTotal(x.subtotal) ? [base * (1 + tax / x.subtotal)] : []),
  ]
}

function hasOptionTotalMismatch(x: QuoteExtraction): boolean {
  const shared = includedSum(x.lines.filter((l) => l.option === null))
  return x.options.some((o) => {
    const written = o.total
    if (!hasTotal(written)) return false
    const own = includedSum(x.lines.filter((l) => l.option === o.id))
    const accepted = [own, own + shared].flatMap((base) => taxedTotals(base, x, o))
    return own > 0 && !accepted.some((total) => near(written, total, TOTAL_TOLERANCE))
  })
}

function hasTotalMismatch(x: QuoteExtraction): boolean {
  const sum = linesWithTax(x)
  if (x.subtotal !== null || x.tax !== null) return !near(sum, x.total, TOTAL_TOLERANCE)
  return hasTotal(x.total) && x.total < sum && !near(sum, x.total, TOTAL_TOLERANCE)
}

/** The failures of staging's checkExtraction that its tax rules decided, in its order. The other checks did not change. */
export function totalFailures(x: QuoteExtraction): string[] {
  const isMulti = hasOptions(x)
  const isPriced = isMulti ? optionPrices(x).some((p) => p.total !== null) : hasTotal(x.total)
  return [
    ...(isPriced ? [] : ['no_total']),
    ...(isMulti && hasOptionTotalMismatch(x) ? ['option_total_mismatch'] : []),
    ...(!isMulti && hasTotalMismatch(x) ? ['total_mismatch'] : []),
  ]
}

/** staging's quote-compare.ts totalOf: the total a single-system quote ranks by, the user's, else the one read. */
export const rankTotal = (x: QuoteExtraction, totalOverride: number | null): number | null => totalOverride ?? x.total

/** One ranked entry, as staging's compareQuotes saw it for the tax caveat. */
export interface OracleEntry { key: string; extraction: QuoteExtraction; optionId: string | null }

/**
 * staging's compareQuotes and caveatsOf: an entry gets the tax caveat when another entry ranked beside it states tax and
 * it states none. Returns the keys of the entries that get it.
 */
export function taxCaveatKeys(ranked: readonly OracleEntry[]): Set<string> {
  const taxed = ranked.filter((e) => statesTax(e.extraction, e.optionId)).map((e) => e.key)
  return new Set(ranked.filter((e) => taxed.some((k) => k !== e.key) && !statesTax(e.extraction, e.optionId)).map((e) => e.key))
}
