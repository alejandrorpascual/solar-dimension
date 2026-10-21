import { trq, type Dictionary } from '../i18n'
import { fmtMoney, fmtNumber } from '../i18n/format'
import { optionLines } from './quote-options'
import type { QuoteExtraction } from './quote-schema'

/** One line of a reading as the opened card lists it, every figure already written out. */
export interface LineRow { description: string; qty: string; unitPrice: string; lineTotal: string }

const CENTS = 2
/** No unit price was read for the line. */
const NONE = '—'

/** A line's amount as the quote writes it: whole units, or with cents when it has them ("$45.50"). */
const lineMoney = (t: Dictionary, n: number, currency: string): string =>
  fmtMoney(n, currency, t.locale, Number.isInteger(n) ? 0 : CENTS)

/**
 * Every line read for an entry, in the order read: a single-system quote's lines, or an option's own and shared lines
 * (optionId), so the user can see what the checks were run on.
 */
export function lineRows(t: Dictionary, x: QuoteExtraction, optionId: string | null): LineRow[] {
  const lines = optionId === null ? x.lines : optionLines(x, optionId)
  return lines.map((l) => ({
    description: l.optional ? trq(t, 'lineOptional', { description: l.description }) : l.description,
    qty: fmtNumber(l.qty, t.locale),
    unitPrice: l.unitPrice === null ? NONE : lineMoney(t, l.unitPrice, x.currency),
    lineTotal: lineMoney(t, l.lineTotal, x.currency),
  }))
}
