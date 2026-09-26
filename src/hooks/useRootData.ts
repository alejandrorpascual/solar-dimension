import { useLoaderData } from '@tanstack/react-router'
import { DEFAULT_LOCALE, type Locale } from '../i18n'
import type { SessionUser } from '../server/session'

export interface RootData { locale: Locale; user: SessionUser | null; googleEnabled: boolean }

/** Locale, signed-in user and available sign-in methods, loaded once by the root route and cached until `router.invalidate()`. */
export function useRootData(): RootData {
  // Error and not-found screens can render before the root loader has data; they still need a language.
  const data = useLoaderData({ from: '__root__' }) as RootData | undefined
  return { locale: data?.locale ?? DEFAULT_LOCALE, user: data?.user ?? null, googleEnabled: data?.googleEnabled ?? false }
}
