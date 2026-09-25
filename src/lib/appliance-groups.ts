import { CATEGORIES, type CatalogItem, type Category, type CompressorType } from './catalog'

export type GridEntry =
  | { kind: 'item'; item: CatalogItem; isGrouped: boolean }
  | { kind: 'acHeader'; acType: CompressorType }

/** One labeled block of the grid. `cat` is null for the flat search-results list. */
export interface GridSection { cat: Category | null; entries: GridEntry[] }

const AC_ORDER: readonly CompressorType[] = ['inverter', 'conventional']

const plain = (item: CatalogItem): GridEntry => ({ kind: 'item', item, isGrouped: false })

function acGroup(ac: readonly CatalogItem[], acType: CompressorType): GridEntry[] {
  const inGroup = ac.filter((i) => i.acType === acType).sort((a, b) => (a.tons ?? 0) - (b.tons ?? 0))
  if (inGroup.length === 0) return []
  return [{ kind: 'acHeader', acType }, ...inGroup.map((item): GridEntry => ({ kind: 'item', item, isGrouped: true }))]
}

/** Plain items first, then air conditioners split into an inverter group and a conventional group. */
function sectionEntries(items: readonly CatalogItem[]): GridEntry[] {
  const ac = items.filter((i) => i.acType)
  return [...items.filter((i) => !i.acType).map(plain), ...AC_ORDER.flatMap((t) => acGroup(ac, t))]
}

/**
 * Split the grid into one section per category, in catalog order, so every card sits under the header it belongs
 * to. While searching the list stays flat and unlabeled so every result keeps its full name.
 */
export function gridSections(items: readonly CatalogItem[], isSearching: boolean): GridSection[] {
  if (items.length === 0) return []
  if (isSearching) return [{ cat: null, entries: items.map(plain) }]
  return CATEGORIES
    .map((cat) => ({ cat, entries: sectionEntries(items.filter((i) => i.cat === cat)) }))
    .filter((s) => s.entries.length > 0)
}
