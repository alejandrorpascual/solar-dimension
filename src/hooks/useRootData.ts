import { useLoaderData } from '@tanstack/react-router'
import { DEFAULT_LOCALE, type Locale } from '../i18n'
import { SIGNED_OUT, type AccountSession } from '../lib/account-session'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import type { CatalogItem } from '../lib/catalog'
import { DEFAULT_POLL_MS } from '../lib/quote-jobs'

export interface RootData {
  locale: Locale; session: AccountSession; googleEnabled: boolean; catalog: CatalogItem[]; quotePollMs: number
  /** Where the app is served from, no trailing slash: the head names its preview image by it. */
  siteOrigin: string
}

/**
 * Locale, who is signed in, available sign-in methods, the appliance catalog and how often to ask about quotes being
 * read, loaded once by the root route and cached until `router.invalidate()`.
 */
export function useRootData(): RootData {
  // Error and not-found screens can render before the root loader has data; they still need a language.
  const data = useLoaderData({ from: '__root__' }) as RootData | undefined
  return {
    locale: data?.locale ?? DEFAULT_LOCALE,
    session: data?.session ?? SIGNED_OUT,
    googleEnabled: data?.googleEnabled ?? false,
    catalog: data?.catalog ?? [...CATALOG_SNAPSHOT],
    quotePollMs: data?.quotePollMs ?? DEFAULT_POLL_MS,
    siteOrigin: data?.siteOrigin ?? '',
  }
}
