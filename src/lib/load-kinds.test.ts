import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { averageWatts, groupByKind } from './load-kinds'
import { compute } from './sizing'

const kit = (qty: Record<string, number>) => compute({ qty, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)

describe('groupByKind', () => {
  test('orders always-on, cycling, then momentary, keeping catalog order inside each group', () => {
    const groups = groupByKind(kit({ barrier: 1, fridge: 1, lights: 1, freezer: 1, router: 1 }).items)
    expect(groups.map((g) => g.kind)).toEqual(['continuous', 'cycling', 'momentary'])
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['lights', 'router'], ['fridge', 'freezer'], ['barrier']])
  })

  test('drops kinds with nothing selected', () => {
    expect(groupByKind(kit({ lights: 1 }).items).map((g) => g.kind)).toEqual(['continuous'])
    expect(groupByKind([])).toEqual([])
  })
})

test('averageWatts scales the running watts by the duty in effect', () => {
  const fridge = kit({ fridge: 2 }).items[0]!
  expect(averageWatts(fridge)).toBe(Math.round(300 * 0.35))
  const full = compute({ qty: { fridge: 2 }, hours: 10, volts: 48, chemistry: 'lifepo4', dutyOverrides: { fridge: 1 } }, CATALOG_SNAPSHOT).items[0]!
  expect(averageWatts(full)).toBe(300)
})
