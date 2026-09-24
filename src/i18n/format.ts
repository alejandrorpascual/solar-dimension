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
export function fmtHours(h: number, locale: Locale): string {
  return `${(Math.round(h * 10) / 10).toLocaleString(TAGS[locale])} h`
}
