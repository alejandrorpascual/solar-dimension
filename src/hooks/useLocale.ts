import { getDictionary, type Dictionary, type Locale } from '../i18n'
import { useRootData } from './useRootData'

export function useLocale(): { locale: Locale; t: Dictionary } {
  const { locale } = useRootData()
  return { locale, t: getDictionary(locale) }
}
