import { en } from './en'
import { es } from './es'
import type { Dictionary, Locale, UiKey } from './types'

export type { Dictionary, Locale, UiKey } from './types'
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

export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  const fromCookie = cookieValue(input.cookie, LOCALE_COOKIE)
  if (isLocale(fromCookie)) return fromCookie
  const first = (input.acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase().slice(0, 2)
  return isLocale(first) ? first : DEFAULT_LOCALE
}

/** Replace `{key}` placeholders in a ui string. */
export function tr(t: Dictionary, key: UiKey, params: Record<string, string | number> = {}): string {
  return t.ui[key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''))
}

export function applianceName(t: Dictionary, item: { id: string; name: string; isCustom?: boolean }): string {
  return item.isCustom ? item.name : (t.appliances[item.id]?.name ?? item.name)
}

export function applianceNote(t: Dictionary, item: { id: string; note: string; isCustom?: boolean }): string {
  return item.isCustom ? item.note : (t.appliances[item.id]?.note ?? item.note)
}
