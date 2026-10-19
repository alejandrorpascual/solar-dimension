// Stands in for src/hooks/useRootData.ts in the QA harness: the locale comes from the page's ?lang=.
import type { RootData } from '@app/hooks/useRootData'

export function useRootData(): RootData {
  const lang = new URLSearchParams(window.location.search).get('lang') === 'es' ? 'es' : 'en'
  return { locale: lang, user: null, googleEnabled: false, catalog: [], quotePollMs: 3000 }
}
