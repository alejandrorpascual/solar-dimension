/** A currency written beside an amount: a symbol, letters and a symbol (RD$, US$), or a three-letter code (DOP). */
const CURRENCY = String.raw`(?:\p{L}{0,3}\p{Sc}|\p{L}{3})`
/**
 * Digits in groups split by one separator each, with one currency at most at either end. Anything else (a sum, a
 * percentage, a note in brackets, an exponent) is refused, not read as the digits it holds.
 */
const AMOUNT = new RegExp(String.raw`^(?:${CURRENCY}\s*)?(\d+(?:[.,\s]\d+)*)(?:\s*${CURRENCY})?$`, 'u')

/**
 * A money amount typed in either convention. The last "." or "," followed by one or two digits is the decimal point;
 * every other separator is grouping.
 */
export function parseAmount(s: string): number | null {
  const digits = AMOUNT.exec(s.trim())?.[1]
  if (digits === undefined) return null
  const decimal = digits.match(/[.,](\d{1,2})$/)
  const whole = (decimal ? digits.slice(0, -decimal[0].length) : digits).replace(/[.,\s]/g, '')
  const n = Number(decimal ? `${whole}.${decimal[1]}` : whole)
  return Number.isFinite(n) ? n : null
}
