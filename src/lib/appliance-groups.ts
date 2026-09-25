import type { CatalogItem, CompressorType } from './catalog'

export type GridEntry =
  | { kind: 'item'; item: CatalogItem; isGrouped: boolean }
  | { kind: 'acHeader'; acType: CompressorType }

const AC_ORDER: readonly CompressorType[] = ['inverter', 'conventional']

const plain = (item: CatalogItem): GridEntry => ({ kind: 'item', item, isGrouped: false })

function acGroup(ac: readonly CatalogItem[], acType: CompressorType): GridEntry[] {
  const inGroup = ac.filter((i) => i.acType === acType).sort((a, b) => (a.tons ?? 0) - (b.tons ?? 0))
  if (inGroup.length === 0) return []
  return [{ kind: 'acHeader', acType }, ...inGroup.map((item): GridEntry => ({ kind: 'item', item, isGrouped: true }))]
}

/**
 * Replace the air conditioners with an inverter group then a conventional group, each smallest first, placed
 * where the first AC appeared. While searching the list stays flat so every result keeps its full name.
 */
export function gridEntries(items: readonly CatalogItem[], isSearching: boolean): GridEntry[] {
  const at = items.findIndex((i) => i.acType)
  if (isSearching || at < 0) return items.map(plain)
  const ac = items.filter((i) => i.acType)
  const rest = items.filter((i) => !i.acType)
  return [...rest.slice(0, at).map(plain), ...AC_ORDER.flatMap((t) => acGroup(ac, t)), ...rest.slice(at).map(plain)]
}
