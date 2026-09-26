import type { CatalogItem } from '../lib/catalog'
import { useRootData } from './useRootData'

/** The appliance catalog loaded once with the page; retired items included (filter with `forPicker` for pickers). */
export function useCatalog(): readonly CatalogItem[] {
  return useRootData().catalog
}
