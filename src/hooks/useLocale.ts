import { useRouteContext } from '@tanstack/react-router'
import { getDictionary, type Dictionary, type Locale } from '../i18n'

export function useLocale(): { locale: Locale; t: Dictionary } {
  const { locale } = useRouteContext({ from: '__root__' })
  return { locale, t: getDictionary(locale) }
}
