import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { catalog, compute } from './sizing'

const ESSENTIALS = { fridge: 1, lights: 1, router: 1, tv: 1, phone: 2, laptop: 1 }

describe('compute', () => {
  test('returns an empty result with no items selected', () => {
    const r = compute({ qty: {}, hours: 10, volts: 24, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.empty).toBe(true)
    expect(r.runningW).toBe(0)
    expect(r.averageW).toBe(0)
    expect(r.battery).not.toBeNull()
    expect(r.warnings).toEqual([])
  })

  test('sizes essentials at 48 V with the smallest 48 V inverter', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.runningW).toBe(465)
    expect(r.surgeW).toBe(1515)
    expect(r.largestSurgeName).toBe('Refrigerator')
    expect(r.loadWh).toBe(3675)
    expect(r.averageW).toBe(368)
    expect(r.requiredWh).toBe(4804)
    expect(r.inverter.w).toBe(3000)
    expect(r.inverter.voltsOk).toBe(true)
    expect(r.battery?.config).toBe('1S1P')
    expect(r.battery?.unitLabel).toBe('48 V 200 Ah LiFePO₄')
    expect(r.cable.gauge).toBe('8 AWG')
    expect(r.cable.fuseA).toBe(80)
    expect(r.warnings).toEqual([])
  })

  test('picks a 12 V inverter for the same load at 12 V', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.inverter.w).toBe(1000)
    expect(r.inverter.voltsOk).toBe(true)
    expect(r.battery?.config).toBe('1S2P')
    expect(r.battery?.unitLabel).toBe('12 V 300 Ah LiFePO₄')
    expect(r.cable.gauge).toBe('4 AWG')
    expect(r.cable.fuseA).toBe(125)
  })

  test('a conventional AC drives the surge and the inverter pick', () => {
    const r = compute({ qty: { fridge: 1, ac2c: 1, ac15i: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.runningW).toBe(4000)
    expect(r.surgeW).toBe(8400)
    expect(r.largestSurgeName).toBe('2 ton AC · conventional')
    expect(r.largestSurgeId).toBe('ac2c')
    expect(r.inverter.w).toBe(5000)
  })

  test('warns on a big load at 12 V with AGM and flags the dominant appliance', () => {
    const r = compute({ qty: { fridge: 1, ac1c: 1, well: 1, micro: 1, lights: 1 }, hours: 10, volts: 12, chemistry: 'agm' }, CATALOG_SNAPSHOT)
    expect(r.inverter.voltsOk).toBe(false)
    expect(r.cable.runs).toBe(2)
    const codes = r.warnings.map((w) => w.code)
    expect(codes).toEqual(['inverterVoltage', 'highCurrent', 'parallelStrings', 'dominantLoad'])
    expect(r.warnings[3]?.params.itemId).toBe('ac1c')
    expect(r.warnings[3]?.params.sharePct).toBeGreaterThan(50)
  })

  test('warns once about a split-phase inverter when a selected appliance draws 3 kW or more', () => {
    const r = compute({ qty: { wheater: 1, fridge: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.warnings.filter((w) => w.code === 'splitPhase')).toEqual([{ code: 'splitPhase', params: { itemId: 'wheater', itemName: 'Electric water heater' } }])
    const light = compute({ qty: { fridge: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(light.warnings.some((w) => w.code === 'splitPhase')).toBe(false)
  })

  test('clamps hours, run length and unknown voltage to safe values', () => {
    const r = compute({ qty: ESSENTIALS, hours: 500, volts: 99 as never, chemistry: 'nope' as never, runLengthM: 0 }, CATALOG_SNAPSHOT)
    expect(r.hours).toBe(72)
    expect(r.volts).toBe(48)
    expect(r.chemistry).toBe('lifepo4')
    expect(r.cable.mainLengthM).toBe(0.5)
  })

  test('includes custom loads as continuous items', () => {
    const custom = [{ id: 'custom1', name: 'Pool pump', watts: 1035, surge: 2500, note: 'Custom · 230 V × 4.5 A' }]
    const r = compute({ qty: { custom1: 1 }, custom, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.items[0]?.name).toBe('Pool pump')
    expect(r.items[0]?.wh).toBe(10350)
    expect(r.surgeW).toBe(2500)
  })

  test('catalog appends custom loads after the built-in list', () => {
    const list = catalog(CATALOG_SNAPSHOT, [{ id: 'custom1', name: 'X', watts: 10, surge: 10, note: 'Custom · 10 W' }])
    expect(list.at(-1)).toMatchObject({ id: 'custom1', cat: 'Custom', duty: 1, isCustom: true })
  })

  test('skips quantities for ids that are not in the catalog, and counts retired items', () => {
    const retired = CATALOG_SNAPSHOT.map((a) => (a.id === 'fridge' ? { ...a, retired: true } : a))
    const withGhost = compute({ qty: { fridge: 1, 'no-such-thing': 3 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, retired)
    expect(withGhost.items.map((i) => i.id)).toEqual(['fridge'])
  })

  test('says how many counted appliances the catalog could not resolve, even when nothing else is left', () => {
    const partial = compute({ qty: { fridge: 1, 'no-such-thing': 3, 'gone-too': 1, zeroed: 0 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(partial.warnings.filter((w) => w.code === 'missingAppliances')).toEqual([{ code: 'missingAppliances', params: { count: 2 } }])
    const onlyMissing = compute({ qty: { 'no-such-thing': 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(onlyMissing.empty).toBe(true)
    expect(onlyMissing.warnings).toEqual([{ code: 'missingAppliances', params: { count: 1 } }])
    const custom = [{ id: 'custom1', name: 'Pump', watts: 500, surge: 500, note: '' }]
    const withCustom = compute({ qty: { custom1: 1 }, custom, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(withCustom.warnings.some((w) => w.code === 'missingAppliances')).toBe(false)
  })
})

describe('battery unit choice', () => {
  test('lists every unit sold at the bank voltage, bank-voltage units first, with the count each needs', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.batteryOptions.map((o) => [o.id, o.count, o.isAuto])).toEqual([
      ['12-100', 5, false],
      ['12-200', 3, false],
      ['12-300', 2, true],
      ['12-400', 2, false],
    ])
    expect(r.batteryUnit).toBeNull()
    expect(r.battery?.unitLabel).toBe('12 V 300 Ah LiFePO₄')
  })

  test('orders 48 V units first at a 48 V bank, then 24 V, then 12 V', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.batteryOptions.map((o) => o.id)).toEqual([
      '48-50', '48-100', '48-200', '48-280', '48-300', '48-314', '24-100', '24-200', '12-100', '12-200', '12-300', '12-400',
    ])
    expect(r.batteryOptions.find((o) => o.isAuto)?.id).toBe('48-200')
  })

  test('each option carries its own runtime and string layout, and runtime grows with capacity at a fixed load', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    const at48 = r.batteryOptions.filter((o) => o.unitV === 48)
    const runtimes = at48.map((o) => o.hoursActual)
    expect(runtimes).toEqual([...runtimes].sort((a, b) => a - b))
    expect(at48[at48.length - 1]!.hoursActual).toBeGreaterThan(at48[0]!.hoursActual)
    for (const o of r.batteryOptions) expect(o.hoursActual / o.bankWh).toBeCloseTo(at48[0]!.hoursActual / at48[0]!.bankWh)
    const twelve = r.batteryOptions.find((o) => o.id === '12-100')
    expect(twelve?.series).toBe(4)
    expect(twelve?.parallel).toBe(twelve!.count / 4)
    const auto = r.batteryOptions.find((o) => o.isAuto)
    expect(auto?.hoursActual).toBeCloseTo(r.battery!.hoursActual)
  })

  test('a chosen unit drives the bank, interconnects, runtime and warnings', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 12, chemistry: 'lifepo4', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    expect(r.batteryUnit).toBe('12-100')
    expect(r.battery?.unitLabel).toBe('12 V 100 Ah LiFePO₄')
    expect(r.battery?.config).toBe('1S5P')
    expect(r.battery?.count).toBe(5)
    expect(r.cable.parallelLinks).toBe(8)
    expect(r.battery?.hoursActual).toBeGreaterThan(10)
    expect(r.warnings.map((w) => w.code)).toContain('parallelStrings')
  })

  test('a unit that is not sold for this voltage or chemistry falls back to the automatic pick', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'agm', batteryUnit: '12-300' }, CATALOG_SNAPSHOT)
    expect(r.batteryUnit).toBeNull()
    expect(r.battery?.unitLabel).toBe(r.batteryOptions.find((o) => o.isAuto)?.label)
    expect(compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: 'nonsense' }, CATALOG_SNAPSHOT).batteryUnit).toBeNull()
  })
})
