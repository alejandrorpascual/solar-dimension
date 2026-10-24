/** The ISO 4217 currency codes, in capitals. */
export const CURRENCY_CODES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'))

/** A currency written beside an amount: a symbol, letters and a symbol (RD$, US$), or three letters checked as a code. */
const CURRENCY = String.raw`(\p{L}{0,3}\p{Sc}|\p{L}{3})`
/**
 * Digits in groups of three after the first, split by one separator each, or digits with no separator; then one or two
 * decimals; with one currency at most at either end. Anything else (a sum, a percentage, a note in brackets, an
 * exponent, "6485 18") is refused, not read as the digits it holds.
 */
const AMOUNT = new RegExp(
  String.raw`^(?:${CURRENCY}\s*)?(\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?:\s*${CURRENCY})?$`,
  'u',
)

/** No mark, a symbol, or three letters that are a currency code in any case: "650 mil" is 650 thousand, not 650. */
const isAllowedMark = (mark: string | undefined): boolean =>
  mark === undefined || /\p{Sc}/u.test(mark) || CURRENCY_CODES.has(mark.toUpperCase())

/**
 * A money amount typed in either convention. A last "." or "," followed by one or two digits is the decimal point;
 * every other separator is grouping.
 */
export function parseAmount(s: string): number | null {
  const match = AMOUNT.exec(s.trim())
  if (match === null) return null
  const [, before, whole, decimals, after] = match
  if (!isAllowedMark(before) || !isAllowedMark(after)) return null
  const digits = whole.replace(/[.,\s]/g, '')
  const n = Number(decimals === undefined ? digits : `${digits}.${decimals}`)
  return Number.isFinite(n) ? n : null
}
