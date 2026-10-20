import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { CATEGORIES, CHEMISTRIES, forPicker, FUSES, GAUGES, INVERTERS, needsSplitPhase, SIZING, VOLTAGES } from './catalog'

describe('catalog', () => {
  test('lists every tonnage twice, once per compressor type, with tonnage-based watts', () => {
    const ac = CATALOG_SNAPSHOT.filter((a) => a.cat === 'Air conditioning')
    expect(ac).toHaveLength(12)
    const twoTonInverter = ac.find((a) => a.id === 'ac2i')
    const twoTonConventional = ac.find((a) => a.id === 'ac2c')
    expect(twoTonInverter?.name).toBe('2 ton AC · inverter')
    expect(twoTonInverter?.watts).toBe(2 * SIZING.WATTS_PER_TON)
    expect(twoTonInverter?.surge).toBe(Math.round(2200 * 1.3))
    expect(twoTonConventional?.surge).toBe(2200 * 3)
  })

  test('places air conditioning right after the climate items', () => {
    const ids = CATALOG_SNAPSHOT.map((a) => a.id)
    expect(ids.indexOf('ac1i')).toBe(ids.indexOf('heater') + 1)
  })

  test('has unique ids and a known category on every item', () => {
    const ids = CATALOG_SNAPSHOT.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of CATALOG_SNAPSHOT) expect(CATEGORIES).toContain(a.cat)
  })

  test('every item has surge >= watts and a duty between 0 and 1', () => {
    for (const a of CATALOG_SNAPSHOT) {
      expect(a.surge).toBeGreaterThanOrEqual(a.watts)
      expect(a.duty).toBeGreaterThan(0)
      expect(a.duty).toBeLessThanOrEqual(1)
    }
  })

  test('inverters, gauges and fuses are sorted ascending', () => {
    const w = INVERTERS.map((i) => i.w)
    expect(w).toEqual([...w].sort((a, b) => a - b))
    for (const col of ['amps75', 'amps90'] as const) {
      const amps = GAUGES.map((g) => g[col])
      expect(amps).toEqual([...amps].sort((a, b) => a - b))
    }
    const ratings = FUSES.map((f) => f.a)
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b))
  })

  test('every fuse is class T, 20 kA interrupting, listed for 125 V DC', () => {
    for (const f of FUSES) expect(f).toMatchObject({ class: 'T', aicA: 20000, maxVdc: 125 })
  })

  test('every battery unit states discharge limits its peak is above, and a parallel limit', () => {
    for (const chem of Object.values(CHEMISTRIES)) {
      for (const u of chem.units) {
        expect(u.peakA).toBeGreaterThanOrEqual(u.maxContinuousA)
        expect(u.peakSeconds).toBeGreaterThan(0)
        expect(u.maxParallel).toBeGreaterThanOrEqual(1)
      }
    }
    expect(CHEMISTRIES.lifepo4.peukertK).toBe(1)
    expect(CHEMISTRIES.agm.peukertK).toBeGreaterThan(1)
  })

  test('inverters hold their surge for a few seconds, longer on bigger units, and a 1.5× surge for 30 s from 3 kW up', () => {
    expect(INVERTERS.find((i) => i.w === 1000)).toMatchObject({ surgeSeconds: 3 })
    expect(INVERTERS.find((i) => i.w === 1000)?.surgeLong).toBeUndefined()
    expect(INVERTERS.find((i) => i.w === 3000)).toMatchObject({ surgeSeconds: 5, surgeLong: { w: 4500, seconds: 30 } })
    expect(INVERTERS.find((i) => i.w === 8000)).toMatchObject({ surgeSeconds: 10, surgeLong: { w: 12000, seconds: 30 } })
  })

  test('exposes 12, 24, 36 and 48 V and two chemistries', () => {
    expect(VOLTAGES).toEqual([12, 24, 36, 48])
    expect(CHEMISTRIES.lifepo4.dod).toBe(0.85)
    expect(CHEMISTRIES.agm.dod).toBe(0.5)
  })
})

test('Security lists a CCTV camera, two recorder sizes running continuously, and three momentary gate motors', () => {
  const security = CATALOG_SNAPSHOT.filter((a) => a.cat === 'Security')
  expect(security.map((a) => [a.id, a.watts, a.surge, a.duty])).toEqual([
    ['cctv', 7, 7, 1], ['nvr16', 20, 20, 1], ['nvr32', 50, 50, 1],
    ['gate-slide', 550, 1650, 0.033], ['gate-swing', 300, 900, 0.025], ['barrier', 150, 450, 0.033],
  ])
  expect(CATEGORIES.indexOf('Security')).toBe(CATEGORIES.indexOf('Utility') + 1)
})

test('forPicker hides retired items and keeps the rest in order', () => {
  const items = CATALOG_SNAPSHOT.map((a) => (a.id === 'tv' ? { ...a, retired: true } : a))
  const picked = forPicker(items)
  expect(picked.map((a) => a.id)).not.toContain('tv')
  expect(picked).toHaveLength(CATALOG_SNAPSHOT.length - 1)
})

test('needsSplitPhase starts at 3 kW', () => {
  expect(needsSplitPhase({ watts: 2999 })).toBe(false)
  expect(needsSplitPhase({ watts: 3000 })).toBe(true)
})

test('needsSplitPhase also takes an air conditioner of 1.5 tons or more, of either type, whatever its watts', () => {
  const byId = (id: string) => CATALOG_SNAPSHOT.find((a) => a.id === id)!
  for (const id of ['ac15i', 'ac15c', 'ac2i', 'ac2c', 'ac3i', 'ac3c']) expect(needsSplitPhase(byId(id)), id).toBe(true)
  for (const id of ['ac1i', 'ac1c', 'fridge']) expect(needsSplitPhase(byId(id)), id).toBe(false)
})
