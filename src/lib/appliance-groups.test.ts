import { describe, expect, test } from 'vitest'
import { gridEntries } from './appliance-groups'
import { APPLIANCES } from './catalog'

const ids = (entries: ReturnType<typeof gridEntries>) => entries.map((e) => (e.kind === 'item' ? e.item.id : `#${e.acType}`))

describe('gridEntries', () => {
  test('puts inverter sizes under one header and conventional under another, ascending, where AC sat in the list', () => {
    const e = ids(gridEntries(APPLIANCES, false))
    const start = e.indexOf('#inverter')
    expect(e.slice(start, start + 14)).toEqual([
      '#inverter', 'ac1i', 'ac15i', 'ac2i', 'ac3i', 'ac4i', 'ac5i',
      '#conventional', 'ac1c', 'ac15c', 'ac2c', 'ac3c', 'ac4c', 'ac5c',
    ])
    expect(e[start - 1]).toBe('heater')
    expect(e.length).toBe(APPLIANCES.length + 2)
  })

  test('while searching, AC items keep their place and no headers appear', () => {
    const e = gridEntries(APPLIANCES.filter((a) => a.id.startsWith('ac2')), true)
    expect(e.every((x) => x.kind === 'item' && !x.isGrouped)).toBe(true)
  })

  test('lists without AC pass through unchanged', () => {
    const kitchen = APPLIANCES.filter((a) => a.cat === 'Kitchen')
    expect(ids(gridEntries(kitchen, false))).toEqual(kitchen.map((a) => a.id))
  })

  test('a group with no matching items gets no header', () => {
    const onlyInverter = APPLIANCES.filter((a) => a.acType === 'inverter')
    expect(ids(gridEntries(onlyInverter, false))).not.toContain('#conventional')
  })
})
