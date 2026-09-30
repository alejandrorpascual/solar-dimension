import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import type { CatalogItem } from '../lib/catalog'
import { CATALOG_SNAPSHOT } from '../lib/catalog-snapshot'
import { withFallback } from '../lib/ttl-cache'
import { catalogCache, queryCatalog } from './catalog-repo'

/** The catalog on the server: the database, or the bundled snapshot when it can't be read. */
export const loadCatalog = createServerOnlyFn((): Promise<CatalogItem[]> =>
  withFallback(() => catalogCache.get(queryCatalog), [...CATALOG_SNAPSHOT], (error) =>
    console.error('[getCatalog] catalog query failed; serving the bundled snapshot', error),
  ),
)

/** The appliance catalog for the page; the bundled snapshot when the database cannot be read. */
export const getCatalog = createServerFn({ method: 'GET' }).handler(async (): Promise<CatalogItem[]> => loadCatalog())
