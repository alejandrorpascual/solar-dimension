import type { QuoteExtraction } from './quote-schema'

export type CheckFailure = 'no_lines' | 'bad_currency' | 'bad_qty' | 'line_mismatch' | 'total_mismatch'

const LINE_TOLERANCE = 0.01
const TOTAL_TOLERANCE = 0.02
/** Rounding in a document is allowed one whole currency unit, however small the amount. */
const MIN_ABSOLUTE_TOLERANCE = 1
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'))

const near = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= Math.max(MIN_ABSOLUTE_TOLERANCE, Math.abs(b) * tolerance)

/** Why an extraction can't be trusted as is; an empty list means it passed. */
export function checkExtraction(x: QuoteExtraction): CheckFailure[] {
  const failures: CheckFailure[] = []
  if (x.lines.length === 0) failures.push('no_lines')
  if (!/^[A-Z]{3}$/.test(x.currency) || !CURRENCIES.has(x.currency)) failures.push('bad_currency')
  if (x.lines.some((l) => !(l.qty > 0))) failures.push('bad_qty')
  if (x.lines.some((l) => l.unitPrice !== null && !near(l.qty * l.unitPrice, l.lineTotal, LINE_TOLERANCE))) {
    failures.push('line_mismatch')
  }
  if (x.subtotal !== null || x.tax !== null) {
    const sum = x.lines.filter((l) => !l.optional).reduce((a, l) => a + l.lineTotal, 0) + (x.tax ?? 0)
    if (!near(sum, x.total, TOTAL_TOLERANCE)) failures.push('total_mismatch')
  }
  return failures
}
