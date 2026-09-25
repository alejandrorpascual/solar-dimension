import type { CatalogItem } from './catalog'

const DEFAULT_LIMIT = 5

/**
 * Appliances to offer in a quick "add" search: not already in the project, matching the shown (translated) name,
 * the catalog name, the id or the category. An empty query offers nothing, so the list only opens while typing.
 */
export function searchAppliances(
  items: readonly CatalogItem[],
  query: string,
  nameOf: (item: CatalogItem) => string,
  excludeIds: ReadonlySet<string>,
  limit: number = DEFAULT_LIMIT,
): CatalogItem[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const matches = (a: CatalogItem) =>
    [nameOf(a), a.name, a.id, a.cat].some((text) => text.toLowerCase().includes(needle))
  return items.filter((a) => !excludeIds.has(a.id) && matches(a)).slice(0, limit)
}
