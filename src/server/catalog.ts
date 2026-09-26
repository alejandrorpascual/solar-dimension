import { createServerFn } from '@tanstack/react-start'
import type { CatalogItem } from '../lib/catalog'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { withFallback } from '../lib/ttl-cache'
import { catalogCache, queryCatalog } from './catalog-repo'

/** The appliance catalog for the page; the bundled snapshot when the database cannot be read. */
export const getCatalog = createServerFn({ method: 'GET' }).handler(async (): Promise<CatalogItem[]> =>
  withFallback(() => catalogCache.get(queryCatalog), [...CATALOG_SNAPSHOT], (error) =>
    console.error('[getCatalog] catalog query failed; serving the bundled snapshot', error),
  ),
)
