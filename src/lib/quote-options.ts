import type { QuoteExtraction, QuoteLine } from './quote-schema'

/** Whether a quote offers several systems to choose from. normalizeExtraction keeps either none or two to five. */
export const hasOptions = (x: QuoteExtraction): boolean => x.options.length >= 2

/** An option's lines: its own, and the ones every option shares (option null). */
export const optionLines = (x: QuoteExtraction, id: string): QuoteLine[] => x.lines.filter((l) => l.option === id || l.option === null)

/** The quote as if it offered only this option, for the per-item checks. Returns a new object. */
export const optionExtraction = (x: QuoteExtraction, id: string): QuoteExtraction => ({ ...x, lines: optionLines(x, id) })
