// Stands in for src/hooks/useLocale.ts, which reads the router's root data.
import { getDictionary, type Dictionary, type Locale } from '@app/i18n'

export function useLocale(): { locale: Locale; t: Dictionary } {
  const locale = (window as unknown as { __cfg: { locale: Locale } }).__cfg.locale
  return { locale, t: getDictionary(locale) }
}
