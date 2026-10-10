import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import type { CatalogItem } from './catalog'
import { averageDrawText, averageWatts, dutyHint, dutyPct, groupByKind } from './load-kinds'
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

describe('averageDrawText', () => {
  const en = getDictionary('en')
  const es = getDictionary('es')

  test('prints the average alone for a single unit', () => {
    const fridge = kit({ fridge: 1 }).items[0]!
    expect(averageDrawText(fridge, en, 'en')).toBe('~53 W average')
    expect(averageDrawText(fridge, es, 'es')).toBe('~53 W de promedio')
  })

  test('says how many units the average adds up once there are several', () => {
    const fridges = kit({ fridge: 2 }).items[0]!
    expect(averageDrawText(fridges, en, 'en')).toBe('~105 W average for 2')
    expect(averageDrawText(fridges, es, 'es')).toBe('~105 W de promedio entre los 2')
  })
})

describe('dutyPct', () => {
  test('turns a duty into a whole percent', () => {
    expect(dutyPct(0.35)).toBe(35)
    expect(dutyPct(1)).toBe(100)
    expect(dutyPct(0)).toBe(0)
  })

  test('rounds to the nearest percent, so float error and fractions never show', () => {
    expect(dutyPct(0.29)).toBe(29)
    expect(dutyPct(0.033)).toBe(3)
    expect(dutyPct(0.125)).toBe(13)
  })
})

describe('dutyHint', () => {
  const base: CatalogItem = { id: 'x', name: 'X', cat: 'Utility', watts: 100, surge: 100, duty: 1, note: '' }
  const make = (over: Partial<CatalogItem>): CatalogItem => ({ ...base, ...over })

  test('says nothing for an always-on load', () => {
    expect(dutyHint(make({ duty: 1 }), {})).toBeNull()
  })

  test('gives a cycling load its share of each hour, the catalog share and whether it was changed', () => {
    expect(dutyHint(make({ duty: 0.35 }), {})).toEqual({ kind: 'cycling', pct: 35, typicalPct: 35, isOverridden: false })
    expect(dutyHint(make({ duty: 0.35 }), { x: 0.75 })).toEqual({ kind: 'cycling', pct: 75, typicalPct: 35, isOverridden: true })
  })

  test('gives a momentary load whole minutes per hour from its bursts, never below one', () => {
    const gate = make({ duty: 0.033, kind: 'momentary', burstSeconds: 20, cyclesPerHour: 6 })
    expect(dutyHint(gate, {})).toEqual({ kind: 'momentary', minutesPerHour: 2 })
    const blip = make({ duty: 0.001, kind: 'momentary', burstSeconds: 2, cyclesPerHour: 1 })
    expect(dutyHint(blip, {})).toEqual({ kind: 'momentary', minutesPerHour: 1 })
  })

  test('ignores an override on a momentary load', () => {
    const gate = make({ duty: 0.033, kind: 'momentary', burstSeconds: 20, cyclesPerHour: 6 })
    expect(dutyHint(gate, { x: 0.5 })).toEqual({ kind: 'momentary', minutesPerHour: 2 })
  })
})
