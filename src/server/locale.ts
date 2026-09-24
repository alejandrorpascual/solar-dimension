import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, resolveLocale, type Locale } from '../i18n'

const ONE_YEAR_S = 31536000

export const getLocale = createServerFn({ method: 'GET' }).handler(async (): Promise<Locale> => {
  return resolveLocale({ cookie: getRequestHeader('cookie'), acceptLanguage: getRequestHeader('accept-language') })
})

export const setLocale = createServerFn({ method: 'POST' })
  .validator((data: unknown): { locale: Locale } => {
    const locale = (data as { locale?: unknown })?.locale
    return { locale: isLocale(locale) ? locale : DEFAULT_LOCALE }
  })
  .handler(async ({ data }) => {
    setResponseHeader('Set-Cookie', `${LOCALE_COOKIE}=${data.locale}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`)
    return data.locale
  })
