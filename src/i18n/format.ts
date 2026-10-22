import type { Locale } from './types'

const TAGS: Record<Locale, string> = { en: 'en-US', es: 'es-419' }
const KW_THRESHOLD = 10000

export function fmtInt(n: number, locale: Locale): string {
  return Math.round(n).toLocaleString(TAGS[locale])
}
/** Watts as kilowatts with one decimal from 1 kW ("5.5 kW"), whole watts below it ("550 W"). For arrays sized in kW. */
export function fmtKw(w: number, locale: Locale): string {
  if (w < 1000) return `${fmtInt(w, locale)} W`
  return `${(w / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW`
}
export function fmtW(w: number, locale: Locale): string {
  return w >= KW_THRESHOLD ? `${(w / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kW` : `${fmtInt(w, locale)} W`
}
/** The kit's inverter by size: "8,000 W" for one unit, "2 × 12.0 kW" for units working in parallel. */
export function fmtInverter(inverter: { count: number; unitW: number }, locale: Locale): string {
  const unit = fmtW(inverter.unitW, locale)
  return inverter.count > 1 ? `${inverter.count} × ${unit}` : unit
}
export function fmtKwh(wh: number, locale: Locale): string {
  return `${(wh / 1000).toLocaleString(TAGS[locale], { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`
}
/** A count or a unit's rating as a datasheet writes it, with up to two decimals: "8", "5.12", "2.4". */
export function fmtNumber(n: number, locale: Locale): string {
  return n.toLocaleString(TAGS[locale], { maximumFractionDigits: 2 })
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

/**
 * A quote amount in its own currency, whole units unless `digits` asks for decimals ("$6,480", "$45.50"); an unknown code
 * falls back to "6,480 XYZ".
 */
export function fmtMoney(amount: number, currency: string, locale: Locale, digits = 0): string {
  try {
    return new Intl.NumberFormat(TAGS[locale], { style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(amount)
  } catch {
    return `${digits > 0 ? fmtDecimal(amount, digits, locale) : fmtInt(amount, locale)} ${currency}`
  }
}

/** "a and b", "a, b and c"; "a y b" in Spanish. */
export function fmtList(items: readonly string[], locale: Locale): string {
  return new Intl.ListFormat(TAGS[locale], { style: 'long', type: 'conjunction' }).format(items)
}
