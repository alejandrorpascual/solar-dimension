import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { hasDeltas, kitDeltas } from './kit-deltas'
import { compute } from './sizing'

const kit = (qty: Record<string, number>, hours = 10) => compute({ qty, hours, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)

describe('kitDeltas', () => {
  test('is all zero when nothing changed', () => {
    const d = kitDeltas(kit({ fridge: 1 }), kit({ fridge: 1 }))
    expect(d).toEqual({ runningW: 0, surgeW: 0, requiredWh: 0, runtimeH: 0 })
    expect(hasDeltas(d)).toBe(false)
  })

  test('reports the extra load of a second appliance', () => {
    const before = kit({ fridge: 1 })
    const after = kit({ fridge: 1, tv: 1 })
    const d = kitDeltas(before, after)
    expect(d.runningW).toBe(after.runningW - before.runningW)
    expect(d.runningW).toBeGreaterThan(0)
    expect(d.requiredWh).toBeGreaterThan(0)
    expect(hasDeltas(d)).toBe(true)
  })

  test('compares runtime in tenths of an hour, as the tile shows it', () => {
    const before = kit({ fridge: 1, tv: 1 })
    const after = kit({ fridge: 1, tv: 2 })
    const tenths = (h: number) => Math.round(h * 10)
    const expected = (tenths(after.battery!.hoursActual) - tenths(before.battery!.hoursActual)) / 10
    const d = kitDeltas(before, after)
    expect(d.runtimeH).toBe(expected)
    expect(Number.isInteger(d.runtimeH * 10)).toBe(true)
  })

  test('a change too small to show on the tile is no change', () => {
    const base = kit({ fridge: 1, tv: 1 }, 10)
    const at = (hoursActual: number) => ({ ...base, battery: { ...base.battery!, hoursActual } })
    expect(kitDeltas(at(10.41), at(10.44)).runtimeH).toBe(0)
    expect(kitDeltas(at(10.4), at(10.6)).runtimeH).toBe(0.2)
  })

  test('an empty kit counts as zero runtime', () => {
    const before = kit({ tv: 1 })
    const d = kitDeltas(before, kit({}))
    expect(d.runtimeH).toBe(-Math.round(before.battery!.hoursActual * 10) / 10)
    expect(d.runningW).toBe(-before.runningW)
  })
})
