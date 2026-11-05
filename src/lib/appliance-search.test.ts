import { describe, expect, test } from 'vitest'
import { en } from '../i18n/en'
import { es } from '../i18n/es'
import { matchesQuery, searchAppliances, searchTexts } from './appliance-search'
import type { CatalogItem } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { catalog } from './sizing'

const items = catalog(CATALOG_SNAPSHOT, [{ id: 'c1', name: 'Pool pump', watts: 1000, surge: 3000, note: '' }])
const spanish: Record<string, string> = { fridge: 'Refrigerador' }
const textsOf = (i: CatalogItem) => [spanish[i.id] ?? i.name, i.name, i.id, i.cat]
const ids = (list: CatalogItem[]) => list.map((i) => i.id)

describe('searchAppliances', () => {
  test('an empty query suggests nothing', () => {
    expect(searchAppliances(items, '  ', textsOf, new Set())).toEqual([])
  })

  test('matches the shown name, the catalog name, the id and the category, ignoring case', () => {
    expect(ids(searchAppliances(items, 'REFRIG', textsOf, new Set()))).toContain('fridge')
    expect(ids(searchAppliances(items, 'chest', textsOf, new Set()))).toContain('freezer')
    expect(ids(searchAppliances(items, 'nvr16', textsOf, new Set()))).toEqual(['nvr16'])
    expect(ids(searchAppliances(items, 'security', textsOf, new Set(), 10))).toEqual(expect.arrayContaining(['cctv', 'nvr16', 'nvr32']))
  })

  test('finds custom appliances too', () => {
    expect(ids(searchAppliances(items, 'pool', textsOf, new Set()))).toEqual(['c1'])
  })

  test('leaves out appliances already in the project and stops at the limit', () => {
    expect(ids(searchAppliances(items, 'refrig', textsOf, new Set(['fridge'])))).not.toContain('fridge')
    expect(searchAppliances(items, 'ac', textsOf, new Set(), 3)).toHaveLength(3)
  })
})

describe('matchesQuery', () => {
  test('every word typed must start a word of the texts', () => {
    expect(matchesQuery('air', ['Hair dryer'])).toBe(false)
    expect(matchesQuery('ac', ['Space heater'])).toBe(false)
    expect(matchesQuery('dry hair', ['Hair dryer'])).toBe(true)
    expect(matchesQuery('hair oven', ['Hair dryer'])).toBe(false)
  })

  test('ignores accents and an empty query matches', () => {
    expect(matchesQuery('calefaccion', ['Calefacción'])).toBe(true)
    expect(matchesQuery('  ', ['anything'])).toBe(true)
  })
})

describe('searchTexts', () => {
  const find = (query: string, t: typeof en) => items.filter((a) => matchesQuery(query, searchTexts(t, a)))
  const isAc = (a: CatalogItem) => a.acType !== undefined

  test.each([['air', en], ['air conditioner', en], ['ac', en], ['aire', es], ['aire acondicionado', es]] as const)('%s finds the air conditioners and nothing else', (query, t) => {
    const found = find(query, t)
    expect(found.filter(isAc).length).toBe(items.filter(isAc).length)
    expect(found.filter((a) => !isAc(a))).toEqual([])
  })
})
