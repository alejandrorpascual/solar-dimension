import { hasOptions } from './quote-options'
import { UNLISTED_OPTION, type QuoteExtraction, type QuoteLine, type QuoteOption } from './quote-schema'

export type CheckFailure = 'no_lines' | 'no_total' | 'bad_currency' | 'bad_qty' | 'line_mismatch' | 'total_mismatch' | 'option_total_mismatch' | 'unknown_option'

const LINE_TOLERANCE = 0.01
const TOTAL_TOLERANCE = 0.02
/** Rounding in a document is allowed one whole currency unit, however small the amount. */
const MIN_ABSOLUTE_TOLERANCE = 1
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

const near = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= Math.max(MIN_ABSOLUTE_TOLERANCE, Math.abs(b) * tolerance)

/** A total a quote can be ranked by: a positive, finite amount. */
export const hasTotal = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

const includedSum = (lines: readonly QuoteLine[]): number => lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0)

/** What a single-system quote's included lines and stated tax add up to: the figure its total is checked against. */
export const linesWithTax = (x: QuoteExtraction): number => includedSum(x.lines) + (x.tax ?? 0)

/**
 * Each option's price: the total the document writes for it, else its own included lines plus the shared ones, plus
 * the tax written for that option, so an option stated as "subtotal + tax" ranks at what it costs. The document's own
 * tax is not spread over options: which option it belongs to is unknown, and options are compared as written. An
 * option whose own lines carry no price has none: shared lines or tax alone don't price a system.
 */
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

/** Words a tax line is written with ("IVA", "I.V.A.", "VAT", "sales tax", "impuesto"), once accents and dots are dropped. */
const TAX_WORDS = /\b(iva|vat|tax(es)?|impuestos?)\b/
const DIACRITICS = /\p{Diacritic}/gu
const namesTax = (text: string): boolean => TAX_WORDS.test(text.normalize('NFD').replace(DIACRITICS, '').replace(/\./g, '').toLowerCase())

/**
 * Whether an option's tax is already one of its own included lines, which adding it again would count twice. A VAT
 * line can only be read as kind `other`; it has to say it is a tax and be for the same amount, so a separate charge
 * that happens to cost the same (freight, say) still leaves the tax to add.
 */
const isTaxListed = (lines: readonly QuoteLine[], tax: number): boolean =>
  lines.some((l) =>
    !l.optional && l.kind === 'other' && near(l.lineTotal, tax, LINE_TOLERANCE) && (namesTax(l.description) || namesTax(l.source.text)))

/**
 * The totals an option priced at `base` may be written as: the base itself, with the tax written for that option, or
 * with tax at the rate the document states (its tax over its subtotal). The document's tax amount is never added flat:
 * it belongs to one subtotal, so on another option it would explain a wrong price. Tax with no subtotal to make a rate
 * from, and not written for the option, explains nothing.
 */
function taxedTotals(base: number, x: QuoteExtraction, option: QuoteOption): number[] {
  const tax = x.tax ?? 0
  return [
    base,
    ...(hasTotal(option.tax) ? [base + option.tax] : []),
    ...(tax > 0 && hasTotal(x.subtotal) ? [base * (1 + tax / x.subtotal)] : []),
  ]
}

/**
 * Whether an option's written total disagrees with its lines: it should match the option's own included lines, or those
 * plus the shared ones, with or without the stated tax. An option whose own lines carry no price has nothing to check
 * against.
 */
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

/** Why an extraction can't be trusted as is; an empty list means it passed. */
export function checkExtraction(x: QuoteExtraction): CheckFailure[] {
  const failures: CheckFailure[] = []
  if (x.lines.length === 0) failures.push('no_lines')
  // The schema needs a number, so a quote that states no total comes back as 0: it waits for the user's total. A quote
  // offering several systems has no total of its own; it needs a price for at least one of them.
  const isMulti = hasOptions(x)
  const isPriced = isMulti ? optionPrices(x).some((p) => p.total !== null) : hasTotal(x.total)
  if (!isPriced) failures.push('no_total')
  if (!/^[A-Z]{3}$/.test(x.currency) || !CURRENCIES.has(x.currency)) failures.push('bad_currency')
  if (x.lines.some((l) => !(l.qty > 0))) failures.push('bad_qty')
  // Such a line or warranty is in no option, so the reading can't be trusted to price, size or cover any of them.
  if ([...x.lines, ...x.warranties].some((i) => i.option === UNLISTED_OPTION)) failures.push('unknown_option')
  if (x.lines.some((l) => l.unitPrice !== null && !near(l.qty * l.unitPrice, l.lineTotal, LINE_TOLERANCE))) {
    failures.push('line_mismatch')
  }
  // Alternatives don't add up to anything, so a quote with options skips the total check; each line is still checked,
  // and so is each option's own written total.
  if (isMulti && hasOptionTotalMismatch(x)) failures.push('option_total_mismatch')
  if (!isMulti && hasTotalMismatch(x)) failures.push('total_mismatch')
  return failures
}

/**
 * With a subtotal or tax stated, the lines plus tax must make the total. With neither, the total may be above the lines
 * (tax or freight the quote doesn't itemise), never below them: that is a misread total, a dropped digit or a decimal
 * point read as a thousands one, and as the lowest price it would win.
 */
function hasTotalMismatch(x: QuoteExtraction): boolean {
  const sum = linesWithTax(x)
  if (x.subtotal !== null || x.tax !== null) return !near(sum, x.total, TOTAL_TOLERANCE)
  return hasTotal(x.total) && x.total < sum && !near(sum, x.total, TOTAL_TOLERANCE)
}

/** The failures a total the user types settles: the total itself was missing or disagreed with the lines. */
const TOTAL_FAILURES: ReadonlySet<CheckFailure> = new Set(['no_total', 'total_mismatch'])

/**
 * Whether a reading that failed its checks can be ranked once the user types its total. A wrong line amount, quantity,
 * currency or option is a reading to redo: a typed total would rank it with that error in it.
 */
export const isFixedByTotal = (x: QuoteExtraction): boolean => checkExtraction(x).every((f) => TOTAL_FAILURES.has(f))
