import { describe, expect, test } from 'vitest'
import { APPLIANCES, CATEGORIES, CHEMISTRIES, GAUGES, INVERTERS, SIZING, VOLTAGES } from './catalog'

describe('catalog', () => {
  test('lists every tonnage twice, once per compressor type, with tonnage-based watts', () => {
    const ac = APPLIANCES.filter((a) => a.cat === 'Air conditioning')
    expect(ac).toHaveLength(12)
    const twoTonInverter = ac.find((a) => a.id === 'ac2i')
    const twoTonConventional = ac.find((a) => a.id === 'ac2c')
    expect(twoTonInverter?.name).toBe('2 ton AC · inverter')
    expect(twoTonInverter?.watts).toBe(2 * SIZING.WATTS_PER_TON)
    expect(twoTonInverter?.surge).toBe(Math.round(2200 * 1.3))
    expect(twoTonConventional?.surge).toBe(2200 * 3)
  })

  test('places air conditioning right after the climate items', () => {
    const ids = APPLIANCES.map((a) => a.id)
    expect(ids.indexOf('ac1i')).toBe(ids.indexOf('heater') + 1)
  })

  test('has unique ids and a known category on every item', () => {
    const ids = APPLIANCES.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of APPLIANCES) expect(CATEGORIES).toContain(a.cat)
  })

  test('every item has surge >= watts and a duty between 0 and 1', () => {
    for (const a of APPLIANCES) {
      expect(a.surge).toBeGreaterThanOrEqual(a.watts)
      expect(a.duty).toBeGreaterThan(0)
      expect(a.duty).toBeLessThanOrEqual(1)
    }
  })

  test('inverters, gauges and fuses are sorted ascending', () => {
    const w = INVERTERS.map((i) => i.w)
    expect(w).toEqual([...w].sort((a, b) => a - b))
    const amps = GAUGES.map((g) => g.amps)
    expect(amps).toEqual([...amps].sort((a, b) => a - b))
  })

  test('exposes 12, 24, 36 and 48 V and two chemistries', () => {
    expect(VOLTAGES).toEqual([12, 24, 36, 48])
    expect(CHEMISTRIES.lifepo4.dod).toBe(0.85)
    expect(CHEMISTRIES.agm.dod).toBe(0.5)
  })
})

test('Security lists a CCTV camera and two recorder sizes, all running continuously', () => {
  const security = APPLIANCES.filter((a) => a.cat === 'Security')
  expect(security.map((a) => [a.id, a.watts, a.surge, a.duty])).toEqual([
    ['cctv', 7, 7, 1], ['nvr16', 20, 20, 1], ['nvr32', 50, 50, 1],
  ])
  expect(CATEGORIES.indexOf('Security')).toBe(CATEGORIES.indexOf('Utility') + 1)
})
