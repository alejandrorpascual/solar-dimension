import { hasOptions } from './quote-options'
import type { QuoteExtraction, QuoteLine } from './quote-schema'

export type CheckFailure = 'no_lines' | 'no_total' | 'bad_currency' | 'bad_qty' | 'line_mismatch' | 'total_mismatch'

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

/**
 * Each option's price: the total the document writes for it, else its own included lines plus the shared ones. An
 * option whose own lines carry no price has none: shared lines alone (installation, transport) don't price a system.
 */
export function optionPrices(x: QuoteExtraction): { id: string; total: number | null }[] {
  const shared = includedSum(x.lines.filter((l) => l.option === null))
  return x.options.map((o) => {
    if (hasTotal(o.total)) return { id: o.id, total: o.total }
    const own = includedSum(x.lines.filter((l) => l.option === o.id))
    return { id: o.id, total: own > 0 ? own + shared : null }
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
  if (x.lines.some((l) => l.unitPrice !== null && !near(l.qty * l.unitPrice, l.lineTotal, LINE_TOLERANCE))) {
    failures.push('line_mismatch')
  }
  // Alternatives don't add up to anything, so a quote with options skips the total check; each line is still checked.
  if (!isMulti && (x.subtotal !== null || x.tax !== null)) {
    const sum = includedSum(x.lines) + (x.tax ?? 0)
    if (!near(sum, x.total, TOTAL_TOLERANCE)) failures.push('total_mismatch')
  }
  return failures
}
