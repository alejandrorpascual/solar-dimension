import { en } from './en'
import { es } from './es'
import { fmtW } from './format'
import type { Dictionary, GlossaryEntry, Locale, QuoteKey, UiKey } from './types'
import { SIZING, type ApplianceLabels } from '../lib/catalog'
import { customNote } from '../lib/custom'

export type { Dictionary, GlossaryEntry, LegalPage, Locale, QuoteKey, RequesterKey, UiKey } from './types'
export const LOCALES: readonly Locale[] = ['en', 'es']
export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'lang'

const DICTIONARIES: Record<Locale, Dictionary> = { en, es }

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v)
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale]
}

function cookieValue(cookie: string | null | undefined, name: string): string | null {
  if (!cookie) return null
  const hit = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
}

/**
 * The best supported locale in an Accept-Language header, which browsers build from the device's language settings,
 * e.g. "pt-BR,pt;q=0.9,es;q=0.8". Entries are ranked by their q weight (default 1, ties keep header order);
 * q=0 means "not acceptable".
 */
function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  const ranked = (header ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { lang: tag.trim().slice(0, 2), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((e) => Number.isFinite(e.q) && e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  return ranked.map((e) => e.lang).find(isLocale) ?? null
}

/** A saved choice wins, then the device's language preferences, then English. */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  const fromCookie = cookieValue(input.cookie, LOCALE_COOKIE)
  if (isLocale(fromCookie)) return fromCookie
  return fromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE
}

const fill = (template: string, params: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))

export function tr(t: Dictionary, key: UiKey, params: Record<string, string | number> = {}): string {
  return fill(t.ui[key], params)
}

export function trq(t: Dictionary, key: QuoteKey, params: Record<string, string | number> = {}): string {
  return fill(t.quotes[key], params)
}

/** "1 battery" / "5 batteries" in the active language. */
export function batteryCount(t: Dictionary, count: number): string {
  return tr(t, count === 1 ? 'batteryCountOne' : 'batteryCountMany', { count })
}

/**
 * What the project card asks before it deletes `name`: how many quotes go with it when there are any, since their files
 * are removed for good too. With none it says nothing about quotes. While the count is not known yet (null) it says any
 * quotes go too: it never claims there are none.
 */
export function deleteProjectText(t: Dictionary, name: string, quoteCount: number | null): string {
  if (quoteCount === null) return tr(t, 'deleteProjectAny', { name })
  if (quoteCount <= 0) return tr(t, 'deleteProject', { name })
  return tr(t, quoteCount === 1 ? 'deleteProjectOne' : 'deleteProjectMany', { name, count: quoteCount })
}

/** "8,000 W inverter" / "2 × 8,000 W inverters" in the active language: one unit's size, and how many work in parallel. */
export function inverterSize(t: Dictionary, inverter: { count: number; unitW: number }, locale: Locale): string {
  return tr(t, inverter.count > 1 ? 'inverterSizeMany' : 'inverterSizeOne', { count: inverter.count, w: fmtW(inverter.unitW, locale) })
}

/** The kit glossary, with the hard and light day figures filled in from the runtime scenarios the engine sizes with. */
export function glossaryEntries(t: Dictionary): GlossaryEntry[] {
  const { optimistic, worst } = SIZING.SCENARIO
  const pct = (share: number) => Math.round(share * 100)
  const figures = { lightDuty: pct(optimistic.duty), lightEff: pct(optimistic.eff), hardDuty: pct(worst.duty), hardAc: pct(worst.acDuty), hardEff: pct(worst.eff) }
  return t.glossary.entries.map((e) => ({ term: e.term, body: fill(e.body, figures) }))
}

/** "1 panel" / "5 panels" in the active language. */
export function panelCount(t: Dictionary, count: number): string {
  return tr(t, count === 1 ? 'panelCountOne' : 'panelCountMany', { count })
}

type Labelled = { id: string; name?: string; isCustom?: boolean; labels?: ApplianceLabels }

export function applianceName(t: Dictionary, item: Labelled & { name: string }): string {
  return item.isCustom ? item.name : (item.labels?.[t.locale]?.name ?? item.name)
}

export function applianceNote(t: Dictionary, item: Labelled & { note: string }): string {
  return item.isCustom ? customNote(item.note, t.ui.customTag) : (item.labels?.[t.locale]?.note ?? item.note)
}
