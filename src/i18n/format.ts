import type { Locale } from './types'

const TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-419' }
const KW_THRESHOLD = 10000

export function fmtInt(n: number, locale: Locale): string {
  return Math.round(n).toLocaleString(TAGS[locale])
}
export function fmtW(w: number, locale: Locale): string {
  return w >= KW_THRESHOLD ? `${(w / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW` : `${fmtInt(w, locale)} W`
}
export function fmtKwh(wh: number, locale: Locale): string {
  return `${(wh / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`
}
/** A number with exactly `digits` decimals in the locale's notation: "3.1", "1.15". */
export function fmtDecimal(n: number, digits: number, locale: Locale): string {
  return n.toLocaleString(TAGS[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
export function fmtDate(d: Date, locale: Locale): string {
  return d.toLocaleDateString(TAGS[locale], { day: 'numeric', month: 'short', year: 'numeric' })
}
export function fmtHours(h: number, locale: Locale): string {
  return `${(Math.round(h * 10) / 10).toLocaleString(TAGS[locale])} h`
}

/** A quote amount in its own currency, whole units ("$6,480"); an unknown code falls back to "6,480 XYZ". */
export function fmtMoney(amount: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(TAGS[locale], { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(amount)
  } catch {
    return `${fmtInt(amount, locale)} ${currency}`
  }
}

/** "a and b", "a, b and c"; "a y b" in Spanish. */
export function fmtList(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(TAGS[locale], { style: 'long', type: 'conjunction' }).format(items)
}
