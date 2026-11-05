import { applianceName, type Dictionary } from '../i18n'
import type { CatalogItem } from './catalog'

const DEFAULT_LIMIT = 5

/** Lower case, without accents, split into words. */
const wordsOf = (text: string): string[] =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** Whether every word typed starts a word of `texts`, so "air" finds "Air conditioning" and not "Hair dryer". An empty query matches. */
export function matchesQuery(query: string, texts: readonly string[]): boolean {
  const words = texts.flatMap(wordsOf)
  return wordsOf(query).every((typed) => words.some((word) => word.startsWith(typed)))
}

/** Everything an appliance can be found by: the shown name, the catalog name, the id, the category, and for air conditioners the group titles and common words. */
export function searchTexts(t: Dictionary, a: CatalogItem): string[] {
  const texts = [applianceName(t, a), a.name, a.id, a.cat, t.categories[a.cat]]
  return a.acType ? [...texts, t.ui.acInverter, t.ui.acConventional, t.ui.acSearchTerms] : texts
}

/**
 * Appliances to offer in a quick "add" search: not already in the project, with `textsOf` matching the query. An empty
 * query offers nothing, so the list only opens while typing.
 */
export function searchAppliances(
  items: readonly CatalogItem[],
  query: string,
  textsOf: (item: CatalogItem) => readonly string[],
  excludeIds: ReadonlySet<string>,
  limit: number = DEFAULT_LIMIT,
): CatalogItem[] {
  if (!query.trim()) return []
  return items.filter((a) => !excludeIds.has(a.id) && matchesQuery(query, textsOf(a))).slice(0, limit)
}
