import { describe, expect, test } from 'vitest'
import { gridSections } from './appliance-groups'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { CATEGORIES, type CatalogItem } from './catalog'

const ids = (entries: ReturnType<typeof gridSections>[number]['entries']) =>
  entries.map((e) => (e.kind === 'item' ? e.item.id : `#${e.acType}`))

const custom: CatalogItem = { id: 'c1', name: 'Pond pump', cat: 'Custom', watts: 60, surge: 60, duty: 1, note: '', isCustom: true }

describe('gridSections', () => {
  test('groups every item under its category, in catalog category order, skipping empty categories', () => {
    const sections = gridSections(CATALOG_SNAPSHOT, false)
    const cats = sections.map((s) => s.cat)
    expect(cats).toEqual(CATEGORIES.filter((c) => c !== 'Custom'))
    for (const s of sections) {
      expect(s.entries.every((e) => e.kind === 'acHeader' || e.item.cat === s.cat)).toBe(true)
    }
    const itemCount = sections.flatMap((s) => s.entries).filter((e) => e.kind === 'item').length
    expect(itemCount).toBe(CATALOG_SNAPSHOT.length)
  })

  test('the air conditioning section holds the inverter then the conventional group, each smallest first', () => {
    const ac = gridSections(CATALOG_SNAPSHOT, false).find((s) => s.cat === 'Air conditioning')
    expect(ids(ac?.entries ?? [])).toEqual([
      '#inverter', 'ac1i', 'ac15i', 'ac2i', 'ac3i', 'ac4i', 'ac5i',
      '#conventional', 'ac1c', 'ac15c', 'ac2c', 'ac3c', 'ac4c', 'ac5c',
    ])
  })

  test('items after the AC groups land in their own sections, not under "Conventional"', () => {
    const sections = gridSections(CATALOG_SNAPSHOT, false)
    const acIndex = sections.findIndex((s) => s.cat === 'Air conditioning')
    expect(sections[acIndex + 1]?.cat).toBe('Work')
    expect(ids(sections[acIndex + 1]?.entries ?? [])).toContain('router')
  })

  test('custom loads get their own section at the end', () => {
    const sections = gridSections([...CATALOG_SNAPSHOT, custom], false)
    expect(sections.at(-1)).toEqual({ cat: 'Custom', entries: [{ kind: 'item', item: custom, isGrouped: false }] })
  })

  test('a group with no matching items gets no header', () => {
    const onlyInverter = CATALOG_SNAPSHOT.filter((a) => a.acType === 'inverter')
    const [section] = gridSections(onlyInverter, false)
    expect(ids(section?.entries ?? [])).not.toContain('#conventional')
  })

  test('while searching, results stay in one flat, unlabeled list and AC items keep their full names', () => {
    const hits = CATALOG_SNAPSHOT.filter((a) => a.id.startsWith('ac2') || a.cat === 'Kitchen')
    const sections = gridSections(hits, true)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.cat).toBeNull()
    expect(sections[0]?.entries.every((x) => x.kind === 'item' && !x.isGrouped)).toBe(true)
  })

  test('no items means no sections', () => {
    expect(gridSections([], false)).toEqual([])
    expect(gridSections([], true)).toEqual([])
  })
})
