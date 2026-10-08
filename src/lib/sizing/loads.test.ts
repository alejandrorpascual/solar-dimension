import { describe, expect, test } from 'vitest'
import type { CatalogItem } from '../catalog'
import { effectiveDuty, loadKindOf, selectItems, surgeClassOf, surgeProfile } from './loads'

const base: CatalogItem = { id: 'x', name: 'X', cat: 'Utility', watts: 100, surge: 100, duty: 1, note: '' }
const make = (over: Partial<CatalogItem>): CatalogItem => ({ ...base, ...over })

describe('loadKindOf', () => {
  test('reads the stated kind, else duty 1 is continuous and anything less cycles', () => {
    expect(loadKindOf(make({ duty: 1 }))).toBe('continuous')
    expect(loadKindOf(make({ duty: 0.35 }))).toBe('cycling')
    expect(loadKindOf(make({ duty: 0.03, kind: 'momentary' }))).toBe('momentary')
    expect(loadKindOf(make({ duty: 0.5, kind: 'continuous' }))).toBe('continuous')
  })
})

describe('surgeClassOf', () => {
  test('is null without a surge and follows the stated class first', () => {
    expect(surgeClassOf(make({ surge: 100 }))).toBeNull()
    expect(surgeClassOf(make({ surge: 300, surgeClass: 'inrush' }))).toBe('inrush')
  })
  test('derives compressor for conventional AC and big kitchen surges, motor for inverter AC and 2× surges, else inrush', () => {
    expect(surgeClassOf(make({ cat: 'Air conditioning', acType: 'conventional', surge: 300 }))).toBe('compressor')
    expect(surgeClassOf(make({ cat: 'Air conditioning', acType: 'inverter', surge: 130 }))).toBe('motor')
    expect(surgeClassOf(make({ cat: 'Kitchen', surge: 800 }))).toBe('compressor')
    expect(surgeClassOf(make({ cat: 'Kitchen', surge: 250 }))).toBe('motor')
    expect(surgeClassOf(make({ cat: 'Utility', surge: 200 }))).toBe('motor')
    expect(surgeClassOf(make({ cat: 'Work', surge: 150 }))).toBe('inrush')
  })
})

describe('effectiveDuty', () => {
  test('prefers a finite override, clamped, then the momentary burst math, then the catalog duty', () => {
    expect(effectiveDuty(make({ duty: 0.35 }), { x: 0.6 })).toEqual({ duty: 0.6, overridden: true })
    expect(effectiveDuty(make({ duty: 0.35 }), { x: 5 })).toEqual({ duty: 1, overridden: true })
    expect(effectiveDuty(make({ duty: 0.35 }), { x: Number.NaN })).toEqual({ duty: 0.35, overridden: false })
    const gate = make({ duty: 0.5, kind: 'momentary', burstSeconds: 20, cyclesPerHour: 6 })
    expect(effectiveDuty(gate, {})).toEqual({ duty: 120 / 3600, overridden: false })
    const halfGate = make({ duty: 0.5, kind: 'momentary' })
    expect(effectiveDuty(halfGate, {})).toEqual({ duty: 0.5, overridden: false })
  })
})

describe('surgeProfile', () => {
  const fridge = make({ id: 'fridge', name: 'Fridge', cat: 'Kitchen', watts: 150, surge: 1200, duty: 0.35 })
  const pump = make({ id: 'pump', name: 'Pump', watts: 1000, surge: 3000, duty: 0.2 })
  const gate = make({ id: 'gate', name: 'Gate', watts: 500, surge: 1500, duty: 0.03, kind: 'momentary', burstSeconds: 20, cyclesPerHour: 6 })
  const items = selectItems([fridge, pump, gate], { fridge: 2, pump: 1, gate: 1 }, 10, {})
  const running = 150 * 2 + 1000 + 500

  test('with one starter the largest surge alone rides on the running load', () => {
    const p = surgeProfile(items, running, 1)
    expect(p.surgeW).toBe(running + 2000)
    expect(p.starters.map((s) => s.itemId)).toEqual(['pump'])
    expect(p.seconds).toBe(1)
  })

  test('more starters add the next largest, counting each unit of a quantity, skipping momentary loads', () => {
    expect(surgeProfile(items, running, 2).starters.map((s) => s.itemId)).toEqual(['pump', 'fridge'])
    expect(surgeProfile(items, running, 3).starters.map((s) => s.itemId)).toEqual(['pump', 'fridge', 'fridge'])
    expect(surgeProfile(items, running, 9).starters.map((s) => s.itemId)).toEqual(['pump', 'fridge', 'fridge'])
    expect(surgeProfile(items, running, 2).seconds).toBe(3)
  })

  test('"all" starts every unit, momentary ones included', () => {
    const p = surgeProfile(items, running, 'all')
    expect(p.starters.map((s) => s.itemId)).toEqual(['pump', 'fridge', 'fridge', 'gate'])
    expect(p.surgeW).toBe(running + 2000 + 2 * 1050 + 1000)
  })

  test('a momentary load that is the largest surge still counts first', () => {
    const only = selectItems([gate, fridge], { gate: 1, fridge: 1 }, 10, {})
    expect(surgeProfile(only, 650, 1).starters[0]?.itemId).toBe('fridge')
    const bigGate = selectItems([make({ ...gate, surge: 5000 }), fridge], { gate: 1, fridge: 1 }, 10, {})
    expect(surgeProfile(bigGate, 650, 1).starters[0]?.itemId).toBe('gate')
  })

  test('no surging item means the running load is the peak', () => {
    const flat = selectItems([make({ id: 'led', watts: 10, surge: 10 })], { led: 1 }, 10, {})
    expect(surgeProfile(flat, 10, 'all')).toEqual({ surgeW: 10, seconds: 0, starters: [] })
  })
})
