/**
 * A money amount typed in either convention. The last "." or "," followed by one or two digits is the decimal point;
 * every other separator is grouping.
 */
export function parseAmount(s: string): number | null {
  const kept = s.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(kept) || kept.startsWith('-')) return null
  const decimal = kept.match(/[.,](\d{1,2})$/)
  const whole = (decimal ? kept.slice(0, -decimal[0].length) : kept).replace(/[.,]/g, '')
  const n = Number(decimal ? `${whole}.${decimal[1]}` : whole)
  return Number.isFinite(n) ? n : null
}
