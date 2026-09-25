import { describe, expect, test } from 'vitest'
import { hasDeltas, kitDeltas } from './kit-deltas'
import { compute } from './sizing'

const kit = (qty: Record<string, number>, hours = 10) => compute({ qty, hours, volts: 48, chemistry: 'lifepo4' })

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

  test('compares runtime in whole hours, as the tile shows it', () => {
    const before = kit({ fridge: 1, tv: 1 })
    const after = kit({ fridge: 1, tv: 2 })
    const expected = Math.round(after.battery!.hoursActual) - Math.round(before.battery!.hoursActual)
    expect(kitDeltas(before, after).runtimeH).toBe(expected)
  })

  test('an empty kit counts as zero runtime', () => {
    const before = kit({ tv: 1 })
    const d = kitDeltas(before, kit({}))
    expect(d.runtimeH).toBe(-Math.round(before.battery!.hoursActual))
    expect(d.runningW).toBe(-before.runningW)
  })
})
