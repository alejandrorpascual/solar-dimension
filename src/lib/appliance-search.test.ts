import { describe, expect, test } from 'vitest'
import { searchAppliances } from './appliance-search'
import type { CatalogItem } from './catalog'
import { catalog } from './sizing'

const items = catalog([{ id: 'c1', name: 'Pool pump', watts: 1000, surge: 3000, note: '' }])
const spanish: Record<string, string> = { fridge: 'Refrigerador' }
const nameOf = (i: CatalogItem) => spanish[i.id] ?? i.name
const ids = (list: CatalogItem[]) => list.map((i) => i.id)

describe('searchAppliances', () => {
  test('an empty query suggests nothing', () => {
    expect(searchAppliances(items, '  ', nameOf, new Set())).toEqual([])
  })

  test('matches the shown name, the catalog name, the id and the category, ignoring case', () => {
    expect(ids(searchAppliances(items, 'REFRIG', nameOf, new Set()))).toContain('fridge')
    expect(ids(searchAppliances(items, 'chest', nameOf, new Set()))).toContain('freezer')
    expect(ids(searchAppliances(items, 'nvr16', nameOf, new Set()))).toEqual(['nvr16'])
    expect(ids(searchAppliances(items, 'security', nameOf, new Set(), 10))).toEqual(expect.arrayContaining(['cctv', 'nvr16', 'nvr32']))
  })

  test('finds custom appliances too', () => {
    expect(ids(searchAppliances(items, 'pool', nameOf, new Set()))).toEqual(['c1'])
  })

  test('leaves out appliances already in the project and stops at the limit', () => {
    expect(ids(searchAppliances(items, 'refrig', nameOf, new Set(['fridge'])))).not.toContain('fridge')
    expect(searchAppliances(items, 'ac', nameOf, new Set(), 3)).toHaveLength(3)
  })
})
