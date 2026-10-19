import { describe, expect, test } from 'vitest'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { DEFAULT_HARDWARE } from './catalog'
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
    // NEC: 69 A × 1.25 = 87 A design current; 4 AWG carries 85 A at the 75 °C lugs, so 2 AWG, and a 100 A class T fuse.
    expect(r.cable.gauge).toBe('2 AWG')
    expect(r.cable.designA).toBe(87)
    expect(r.cable.ampacity).toBe(115)
    expect(r.cable.fuseA).toBe(100)
    expect(r.fuse).toEqual({ a: 100, class: 'T', aicA: 20000, maxVdc: 125, count: 1 })
    expect(r.cable.string).toBeNull()
    expect(r.parallelNotes).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test('picks a 12 V inverter for the same load at 12 V', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.inverter.w).toBe(1000)
    expect(r.inverter.voltsOk).toBe(true)
    expect(r.battery?.config).toBe('1S2P')
    expect(r.battery?.unitLabel).toBe('12 V 300 Ah LiFePO₄')
    expect(r.cable.gauge).toBe('1 AWG')
    expect(r.cable.fuseA).toBe(125)
    // Two strings: each gets its own short lead and fuse, and the sheet gets the parallel-bank notes.
    expect(r.cable.string).toMatchObject({ leads: 4, gauge: '6 AWG', lengthM: 0.3, fuse: { a: 60, count: 2 } })
    expect(r.cable.links).toBeNull()
    expect(r.parallelNotes).toEqual(['sameModelAge', 'equalLeadsOrBusbar', 'stringFuses'])
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
    expect(r.cable.runs).toBe(3)
    const codes = r.warnings.map((w) => w.code)
    // Nine AGM strings can short at 21.6 kA, past a class T fuse's 20 kA.
    expect(codes).toEqual(['inverterVoltage', 'highCurrent', 'parallelStrings', 'dominantLoad', 'fuseInterrupt'])
    expect(r.warnings[2]?.params).toMatchObject({ strings: 9, maxParallel: 4 })
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
    const c = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', cable: { runLengthM: 99, ambientC: 500, insulationC: 60 as never }, simultaneousStarts: 0 }, CATALOG_SNAPSHOT)
    expect(c.cable.mainLengthM).toBe(10)
    expect(c.cable.ambientC).toBe(80)
    expect(c.cable.insulationC).toBe(90)
    expect(c.simultaneousStarts).toBe(1)
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

  test('a chosen unit drives the bank, its wiring, runtime and warnings', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 12, chemistry: 'lifepo4', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    expect(r.batteryUnit).toBe('12-100')
    expect(r.battery?.unitLabel).toBe('12 V 100 Ah LiFePO₄')
    expect(r.battery?.config).toBe('1S5P')
    expect(r.battery?.count).toBe(5)
    // Five strings to the bus bars: a lead pair each and nothing in series to link.
    expect(r.cable.string).toMatchObject({ leads: 10, fuse: { count: 5 } })
    expect(r.cable.links).toBeNull()
    expect(r.battery?.hoursActual).toBeGreaterThan(10)
    expect(r.warnings.map((w) => w.code)).toContain('parallelStrings')
  })

  test('a unit that is not sold for this voltage or chemistry falls back to the automatic pick', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'agm', batteryUnit: '12-300' }, CATALOG_SNAPSHOT)
    expect(r.batteryUnit).toBeNull()
    expect(r.battery?.unitLabel).toBe(r.batteryOptions.find((o) => o.isAuto)?.label)
    expect(compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: 'nonsense' }, CATALOG_SNAPSHOT).batteryUnit).toBeNull()
  })

  test('has no solar side unless the project chose panels', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.solar).toBeNull()
  })

  test('sizes the solar side from the bank it picked and the average draw', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    // 48 V 200 Ah × 1 = 9,600 Wh bank → 9,600 / (550 × 5 × 0.75) = 4.65 → 5 panels
    expect(r.battery?.bankWh).toBe(9600)
    expect(r.solar?.panels).toBe(5)
    expect(r.solar?.dailyUseWh).toBe(r.averageW * 24)
    expect(r.warnings.some((w) => w.code === 'roofLimited')).toBe(false)
  })

  test('warns when the roof cannot hold the panels that refill the bank', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 6, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(r.solar?.panels).toBe(2)
    expect(r.warnings).toContainEqual({ code: 'roofLimited', params: { fit: 2, need: 5 } })
  })

  test('a 48 V roof that holds 11 panels but wires 10 says it holds the 10', () => {
    const r = compute({ qty: ESSENTIALS, hours: 24, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 35, panels: null, sunHours: 3 } }, CATALOG_SNAPSHOT)
    expect([r.solar?.fit, r.solar?.panels, r.warnings.find((w) => w.code === 'roofLimited')?.params]).toEqual([11, 10, { fit: 10, need: 11 }])
  })

  test('a 48 V roof that holds one panel lists no panels and says the string is too short', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 5, panels: null, sunHours: 4.8 } }, CATALOG_SNAPSHOT)
    expect([r.solar?.panels, r.solar?.dailyWh]).toEqual([0, 0])
    expect(r.warnings).toContainEqual({ code: 'stringTooShort', params: { volts: 48, count: 2, fit: 1 } })
    // No "it still refills over more days": with no panels it does not.
    expect(r.warnings.some((w) => w.code === 'roofLimited')).toBe(false)
  })

  test('a 24 V roof that holds one panel keeps it and warns only that the roof is small', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 24, chemistry: 'lifepo4', solar: { roofM2: 5, panels: null, sunHours: 4.8 } }, CATALOG_SNAPSHOT)
    expect([r.solar?.panels, r.solar?.dailyWh]).toEqual([1, 1980])
    expect(r.warnings.map((w) => w.code).filter((c) => c === 'stringTooShort' || c === 'roofLimited')).toEqual(['roofLimited'])
  })

  test('a 48 V roof with every panel tapped off is not called too short', () => {
    // Removing panel 2 of 2 at 48 V asks for 0: the roof holds 13, so the string is not the reason there are none.
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: 0, sunHours: 4.8 } }, CATALOG_SNAPSHOT)
    expect([r.solar?.panels, r.solar?.isTooShort, r.warnings.some((w) => w.code === 'stringTooShort')]).toEqual([0, false, false])
  })

  test('an empty project with panels sizes nothing and warns nothing', () => {
    const r = compute({ qty: {}, hours: 10, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 5 } }, CATALOG_SNAPSHOT)
    expect(r.solar?.panels).toBe(0)
    expect(r.warnings).toEqual([])
  })
})

describe('inverter against the running load', () => {
  const kit = (watts: number, volts: 12 | 24 | 36 | 48 = 48) =>
    compute({ custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], qty: { x: 1 }, hours: 2, volts, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  const undersized = (r: ReturnType<typeof compute>) => r.warnings.filter((w) => w.code === 'inverterUndersized')

  test('9,600 W is the last load one inverter carries with its 25% headroom', () => {
    const r = kit(9600)
    expect(r.inverter).toMatchObject({ count: 1, w: 12000, runningOk: true, headroomOk: true })
    expect(undersized(r)).toEqual([])
  })

  test.each([[9601, 2, 8000], [12000, 2, 8000], [12001, 2, 8000], [15000, 2, 10000], [19200, 2, 12000], [19201, 3, 10000], [28800, 3, 12000]])(
    '%i W is past one inverter: %i × %i W in parallel carry it with the headroom kept',
    (watts, count, unitW) => {
      const r = kit(watts)
      expect(r.inverter).toMatchObject({ count, unitW, w: count * unitW, voltsOk: true, runningOk: true, headroomOk: true, surgeOk: true })
      expect(undersized(r)).toEqual([])
    },
  )

  test('28,800 W is the last load three 12 kW units carry with headroom: one watt more and the kit says how much is left', () => {
    const r = kit(28801)
    expect(r.inverter).toMatchObject({ count: 3, unitW: 12000, w: 36000, runningOk: true, headroomOk: false })
    expect(undersized(r)).toEqual([{ code: 'inverterUndersized', params: { inverterW: 36000, inverters: 3, unitW: 12000, runningW: 28801, headroomPct: 24, needPct: 25 } }])
  })

  test('a load equal to the largest set has no headroom at all', () => {
    expect(undersized(kit(36000))).toEqual([{ code: 'inverterUndersized', params: { inverterW: 36000, inverters: 3, unitW: 12000, runningW: 36000, headroomPct: 0, needPct: 25 } }])
  })

  test('past the largest set the inverters cannot carry the load: runningOk is false and the headroom reads 0', () => {
    for (const watts of [36001, 50000]) {
      const r = kit(watts)
      expect(r.inverter).toMatchObject({ count: 3, w: 36000, runningOk: false, headroomOk: false, surgeOk: true })
      expect(undersized(r)).toEqual([{ code: 'inverterUndersized', params: { inverterW: 36000, inverters: 3, unitW: 12000, runningW: watts, headroomPct: 0, needPct: 25 } }])
    }
  })

  test('a list whose units work alone still falls back to its largest one, flagged as a single inverter', () => {
    const hardware = { ...DEFAULT_HARDWARE, inverters: DEFAULT_HARDWARE.inverters.map(({ maxParallel: _maxParallel, ...unit }) => unit) }
    const alone = (watts: number) =>
      compute({ custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], qty: { x: 1 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(undersized(alone(9601))).toEqual([{ code: 'inverterUndersized', params: { inverterW: 12000, inverters: 1, unitW: 12000, runningW: 9601, headroomPct: 24, needPct: 25 } }])
    expect(alone(15000).inverter).toMatchObject({ count: 1, w: 12000, runningOk: false })
  })

  test.each([[12, 2400, 3000, 4000], [24, 4000, 5000, 6000], [36, 4000, 5000, 6000]] as const)(
    'at %i V the limit is %i W: past it the engine reaches for a bigger inverter built for another voltage, still with headroom',
    (volts, limitW, atLimitW, pastLimitW) => {
      const at = kit(limitW, volts)
      expect(at.inverter).toMatchObject({ w: atLimitW, voltsOk: true, headroomOk: true })
      expect(at.warnings.map((w) => w.code)).not.toContain('inverterVoltage')
      const past = kit(limitW + 1, volts)
      expect(past.inverter).toMatchObject({ w: pastLimitW, voltsOk: false, headroomOk: true })
      expect(past.warnings.map((w) => w.code)).toContain('inverterVoltage')
      expect(undersized(past)).toEqual([])
    },
  )

  test('three water heaters at 48 V: 13.5 kW gets two 10 kW inverters and no inverter warning', () => {
    const r = compute({ qty: { wheater: 3 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect([r.runningW, r.inverter.count, r.inverter.unitW]).toEqual([13500, 2, 10000])
    expect(r.warnings.map((w) => w.code)).toEqual(['dominantLoad', 'splitPhase'])
  })

  test('a 24 V bank past one inverter is pointed at 48 V units, as it is for a single one', () => {
    const r = kit(11000, 24)
    expect(r.inverter).toMatchObject({ count: 2, unitW: 8000, voltsOk: false, headroomOk: true })
    expect(r.warnings).toContainEqual({ code: 'inverterVoltage', params: { unitW: 8000, voltsList: '48' } })
  })

  test('an empty project warns about nothing', () => {
    const r = compute({ qty: {}, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.inverter).toMatchObject({ runningOk: true, headroomOk: true })
    expect(r.warnings).toEqual([])
  })
})

describe('inverters in parallel', () => {
  // One model only, so the pick does not depend on how sets are ranked: 8 kW at 48 V, up to four as one.
  const eight = { w: 8000, surge: 16000, volts: [48] as const, surgeSeconds: 10, surgeLong: { w: 12000, seconds: 30 }, maxParallel: 4 }
  const hardware = { ...DEFAULT_HARDWARE, inverters: [eight] }
  const kit = (watts: number, surge = watts) =>
    compute({ custom: [{ id: 'x', name: 'Load', watts, surge, note: '' }], qty: { x: 1 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
  const codes = (r: ReturnType<typeof compute>) => r.warnings.map((w) => w.code)

  test('a load one unit cannot carry gets identical units in parallel, with no inverter warning', () => {
    const r = kit(12000)
    expect(r.inverter).toMatchObject({ count: 2, unitW: 8000, w: 16000, surge: 32000, voltsOk: true, runningOk: true, headroomOk: true, surgeOk: true })
    expect(codes(r)).not.toContain('inverterUndersized')
    expect(r.inverterNotes).toEqual(['builtForParallel', 'ownRunAndFuse'])
  })

  test('one inverter that carries the load stays one, with nothing to say about parallel units', () => {
    const r = kit(6000)
    expect(r.inverter).toMatchObject({ count: 1, unitW: 8000, w: 8000 })
    expect(r.inverterNotes).toEqual([])
  })

  test('the bank feeds the whole set, and each inverter gets the runs and fuses it would get alone', () => {
    const alone = kit(6000)
    const pair = kit(12000)
    expect(pair.inverter.continuousA).toBeCloseTo(2 * alone.inverter.continuousA)
    expect([alone.cable.amps, pair.cable.amps]).toEqual([185, 370])
    expect([alone.cable.runs, pair.cable.runs]).toEqual([2, 4])
    expect([alone.cable.mainCount, pair.cable.mainCount]).toEqual([4, 8])
    expect([alone.fuse.count, pair.fuse.count]).toEqual([2, 4])
    expect(pair.cable).toMatchObject({ gauge: alone.cable.gauge, perRun: alone.cable.perRun, fuseA: alone.cable.fuseA })
    expect(pair.fuse.a).toBe(alone.fuse.a)
    // Every cable in the kit: eight main cables of 1.5 m, and a lead pair of 30 cm for each string.
    expect(pair.cable.totalLengthM).toBe(8 * 1.5 + pair.cable.string!.leads * 0.3)
  })

  test('the bank counts its strings for the whole set\'s current, not one inverter\'s', () => {
    // 100 A units: 370 A needs four of them where one inverter's 185 A would need two.
    const r = compute({ custom: [{ id: 'x', name: 'Load', watts: 12000, surge: 12000, note: '' }], qty: { x: 1 }, hours: 1, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-100' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter).toMatchObject({ count: 2, unitW: 8000 })
    expect(r.battery!.unit.maxContinuousA).toBe(100)
    expect(r.battery!.parallelFor.continuous).toBe(4)
    expect(r.battery).toMatchObject({ parallel: 4, dischargeOk: true })
  })

  test('each string lead and its fuse carry the set\'s current split between the strings', () => {
    const r = compute({ custom: [{ id: 'x', name: 'Load', watts: 12000, surge: 12000, note: '' }], qty: { x: 1 }, hours: 1, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-100' }, CATALOG_SNAPSHOT, hardware)
    const stringA = r.inverter.continuousA / r.battery!.parallel
    expect(stringA).toBeCloseTo(92.6, 1)
    expect(r.cable.string).toMatchObject({ amps: 93, designA: 116, leads: 8, fuse: { count: 4 } })
    expect(r.cable.string!.fuse.a).toBeGreaterThanOrEqual(stringA * 1.25)
    expect(r.cable.string!.ampacity).toBeGreaterThanOrEqual(stringA * 1.25)
  })

  test('at 48 V the high-current note is about what one inverter draws: no higher bank voltage would carry the set on less', () => {
    // 370 A reach the bus bars, 185 A each inverter: no main cable or main fuse sees more than a lone 8 kW unit's would.
    expect(codes(kit(12000))).not.toContain('highCurrent')
  })

  test('below 48 V the whole DC side counts, so the note does not go away when a second inverter is added', () => {
    const at36 = (watts: number) =>
      compute({ custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], qty: { x: 1 }, hours: 2, volts: 36, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    const high = (r: ReturnType<typeof compute>) => r.warnings.find((w) => w.code === 'highCurrent')?.params
    // One 12 kW unit draws 370 A at 36 V. A watt more and two 8 kW units draw 494 A between them, 247 A each.
    expect([at36(9600).inverter.count, at36(9601).inverter.count]).toEqual([1, 2])
    expect(high(at36(9600))).toEqual({ amps: 370, volts: 36, nextVolts: 48 })
    expect(high(at36(9601))).toEqual({ amps: 494, volts: 36, nextVolts: 48 })
  })

  test('a start-up one unit cannot hold is shared by the set, however many units that takes', () => {
    // 5 kW running fits one unit. A 30 kW start takes the 32 kW two hold; a 40 kW start takes the 48 kW of three.
    expect(kit(5000, 30000).inverter).toMatchObject({ count: 2, surgeRatedW: 32000, surgeOk: true })
    const r = kit(5000, 40000)
    expect(r.inverter).toMatchObject({ count: 3, surgeRatedW: 48000, surgeOk: true, headroomOk: true })
    expect(codes(r)).not.toContain('surgeDuration')
  })

  test('past what the maker allows in parallel the largest set is listed and flagged, with its size', () => {
    const tight = kit(30000)
    expect(tight.inverter).toMatchObject({ count: 4, w: 32000, runningOk: true, headroomOk: false })
    expect(tight.warnings).toContainEqual({ code: 'inverterUndersized', params: { inverterW: 32000, inverters: 4, unitW: 8000, runningW: 30000, headroomPct: 6, needPct: 25 } })
    const over = kit(40000)
    expect(over.inverter).toMatchObject({ count: 4, runningOk: false })
    expect(over.warnings).toContainEqual({ code: 'inverterUndersized', params: { inverterW: 32000, inverters: 4, unitW: 8000, runningW: 40000, headroomPct: 0, needPct: 25 } })
  })

  test('a set sold for another voltage is named by its unit in the voltage note', () => {
    const r = compute({ custom: [{ id: 'x', name: 'Load', watts: 12000, surge: 12000, note: '' }], qty: { x: 1 }, hours: 2, volts: 24, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter).toMatchObject({ count: 2, voltsOk: false })
    expect(r.warnings).toContainEqual({ code: 'inverterVoltage', params: { unitW: 8000, voltsList: '48' } })
  })
})

describe('bank wiring', () => {
  const load = (watts: number) => ({ custom: [{ id: 'x', name: 'Load', watts, surge: watts, note: '' }], qty: { x: 1 } })

  test('a one-string bank links its batteries with the main cable\'s copper', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT)
    expect(r.battery?.config).toBe('4S1P')
    expect(r.cable.links).toEqual({ positions: 3, perPosition: 1, count: 3, gauge: r.cable.gauge, mm2: r.cable.mm2, designA: 87, ampacity: 115, lengthM: 0.3 })
    expect(r.cable.string).toBeNull()
    expect(r.cable.totalLengthM).toBe(3.9)
  })

  test('two inverters on a one-string bank: each series link is one jumper per inverter, so the string carries both', () => {
    // 4 kW needs 5 kW: two 3 kW units, 69 A each; four 12 V batteries in series carry the 139 A of both.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 3000, surge: 6000, volts: [48] as const, surgeSeconds: 5, maxParallel: 3 }] }
    const r = compute({ ...load(4000), hours: 1, volts: 48, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter).toMatchObject({ count: 2, unitW: 3000 })
    expect(r.battery?.config).toBe('4S1P')
    expect(r.cable).toMatchObject({ runs: 2, perRun: 69, mainCount: 4 })
    expect(r.cable.links).toMatchObject({ positions: 3, perPosition: 2, count: 6, gauge: r.cable.gauge, designA: 87 })
    expect(r.cable.links!.perPosition * r.cable.links!.ampacity).toBeGreaterThanOrEqual(r.inverter.continuousA * 1.25)
    expect(r.warnings.map((w) => w.code)).not.toContain('cableUndersized')
  })

  test('when the main cable splits in two runs, each series link is two jumpers, so 185 A never rides on one 130 A cable', () => {
    const r = compute({ ...load(3000), hours: 1, volts: 24, chemistry: 'lifepo4', batteryUnit: '12-200' }, CATALOG_SNAPSHOT)
    expect(r.battery?.config).toBe('2S1P')
    expect(r.inverter.continuousA).toBeCloseTo(185.2, 1)
    expect(r.cable).toMatchObject({ runs: 2, gauge: '1 AWG', ampacity: 130 })
    expect(r.cable.links).toMatchObject({ positions: 1, perPosition: 2, count: 2, gauge: '1 AWG', designA: 116, ampacity: 130 })
    expect(r.cable.designPerRunA).toBe(116)
    expect(r.cable.totalLengthM).toBe(6.6)
    expect(r.warnings.map((w) => w.code)).not.toContain('cableUndersized')
  })

  test('a run of the main cable and the jumper that copies it state one design current, rounded once', () => {
    // 4,801 W at 36 V: 308.6 A over two runs is 154.3 A each. Rounding the total first and then the half would print 155.
    const r = compute({ ...load(4801), hours: 2, volts: 36, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect([r.battery?.config, r.cable.runs]).toEqual(['3S1P', 2])
    expect(r.cable.designA).toBe(309)
    expect(r.cable.designPerRunA).toBe(154)
    expect(r.cable.links?.designA).toBe(154)
  })

  test('with strings in parallel a link carries one string, so it takes the string lead\'s gauge, not the main cable\'s', () => {
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    expect(r.battery?.config).toBe('4S2P')
    expect(r.cable.gauge).toBe('2 AWG')
    expect(r.cable.string).toMatchObject({ gauge: '6 AWG', designA: 43, ampacity: 65, leads: 4, fuse: { a: 60, count: 2 } })
    expect(r.cable.links).toMatchObject({ positions: 6, perPosition: 1, count: 6, gauge: '6 AWG', designA: 43, ampacity: 65 })
    // Two 1.5 m main leads, six links and four string leads of 30 cm.
    expect(r.cable.totalLengthM).toBe(6)
  })

  test('a bank takes another string rather than ask one lead for more than it carries', () => {
    // 3 kW at 12 V draws 278 A. In 50 °C air on 75 °C cable one lead backs 120 A, so two strings of 139 A become three of 93 A.
    const hot = compute({ ...load(2400), hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 50, insulationC: 75 } }, CATALOG_SNAPSHOT)
    expect(hot.battery).toMatchObject({ config: '1S3P', parallelFor: { continuous: 3, lead: 3 } })
    expect(hot.cable.string).toMatchObject({ amps: 93, fuse: { count: 3 } })
    expect(hot.warnings.map((w) => w.code)).not.toContain('cableUndersized')
    // Two 8 kW inverters draw 370 A: two 200 A units could feed them, but 185 A is more than one 4/0 lead and its fuse carry.
    const pair = compute({ qty: { ac5c: 2 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(pair.inverter).toMatchObject({ count: 2, unitW: 8000 })
    expect(pair.battery).toMatchObject({ config: '1S3P', parallelFor: { continuous: 2, lead: 3 } })
    expect(pair.cable.string).toMatchObject({ amps: 123, designA: 154, fuse: { count: 3 } })
    expect(pair.warnings.map((w) => w.code)).toEqual(['dominantLoad', 'splitPhase'])
  })

  test('a battery picked by hand that cannot take the string its leads need is left as it was, and flagged', () => {
    // Two 5 ton ACs for 2 h on 314 Ah units: a third string would fit the leads but put 23,550 A into a fault,
    // past the fuses' 20,000 A. The bank keeps two strings; the fuse and cable checks say the leads are short.
    const picked = compute({ qty: { ac5c: 2 }, hours: 2, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-314' }, CATALOG_SNAPSHOT)
    expect(picked.battery).toMatchObject({ config: '1S2P', leadOk: false, interruptOk: true })
    expect(picked.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['fuseAboveCable', 'cableUndersized']))
    expect(picked.warnings.map((w) => w.code)).not.toContain('fuseInterrupt')
    // Left to itself the engine takes the unit whose strings fit both.
    const auto = compute({ qty: { ac5c: 2 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(auto.battery).toMatchObject({ unitLabel: '48 V 200 Ah LiFePO₄', config: '1S3P', leadOk: true, interruptOk: true })
  })

  const cannotInterrupt = (r: ReturnType<typeof compute>): boolean => r.warnings.some((w) => w.code === 'fuseInterrupt')
  /** The stock fuses with one rating changed: a list whose fuses do not all interrupt the same fault. */
  const fusesWhere = (isChanged: (a: number) => boolean, aicA: number) =>
    ({ ...DEFAULT_HARDWARE, fuses: DEFAULT_HARDWARE.fuses.map((f) => (isChanged(f.a) ? { ...f, aicA } : f)) })

  test('a bank is read against the fuses its kit is given, not the best rating in the list', () => {
    // Arrange: only the 400 A fuse interrupts 50 kA. A 6 kW kit gets 20 kA fuses, and three 280 Ah units put 21,000 A into a fault.
    const hardware = fusesWhere((a) => a === 400, 50000)
    const input = { ...load(6000), hours: 4, volts: 48 as const, chemistry: 'lifepo4' as const }

    // Act
    const auto = compute(input, CATALOG_SNAPSHOT, hardware)
    const byHand = compute({ ...input, batteryUnit: '48-280' }, CATALOG_SNAPSHOT, hardware)

    // Assert
    expect(auto.fuse.aicA).toBe(20000)
    expect(auto.batteryOptions.find((o) => o.id === '48-280')).toMatchObject({ count: 3, interruptOk: false })
    expect(auto.battery).toMatchObject({ unitLabel: '48 V 200 Ah LiFePO₄', config: '1S4P', bankShortCircuitA: 20000, interruptOk: true })
    expect(cannotInterrupt(auto)).toBe(false)
    expect(byHand.battery).toMatchObject({ config: '1S3P', bankShortCircuitA: 21000, interruptOk: false })
    expect(cannotInterrupt(byHand)).toBe(true)
  })

  test('with strings in parallel, each string\'s fuse has to interrupt one battery as well', () => {
    // Arrange: fuses up to 150 A that interrupt 4,000 A. A 6 kW inverter gets a 175 A main fuse, two strings a 100 A fuse each.
    const hardware = fusesWhere((a) => a <= 150, 4000)
    const input = { ...load(4800), hours: 2, volts: 48 as const, chemistry: 'lifepo4' as const }

    // Act
    const auto = compute(input, CATALOG_SNAPSHOT, hardware)
    const byHand = compute({ ...input, batteryUnit: '48-200' }, CATALOG_SNAPSHOT, hardware)

    // Assert: the main fuse interrupts the two 200 Ah units together, but each can put 5,000 A through its own string fuse.
    expect(byHand.fuse).toMatchObject({ a: 175, aicA: 20000 })
    expect(byHand.cable.string?.fuse).toMatchObject({ a: 100, aicA: 4000 })
    expect(byHand.battery).toMatchObject({ config: '1S2P', bankShortCircuitA: 10000, interruptOk: false })
    expect(cannotInterrupt(byHand)).toBe(true)
    // The automatic pick takes a bank whose fuses do interrupt it.
    expect(auto.battery?.interruptOk).toBe(true)
    expect(cannotInterrupt(auto)).toBe(false)
  })

  test('a bank is marked as one the fuses can interrupt exactly when its kit\'s fuse check agrees, whatever the fuse list', () => {
    // The third list leaves a 6 kW inverter (4,800 W here) a main fuse that interrupts the bank and string fuses that may not.
    const lists = [DEFAULT_HARDWARE, fusesWhere((a) => a === 400, 50000), fusesWhere((a) => a <= 150, 4000), fusesWhere((a) => a >= 250, 12000)]
    let kits = 0
    for (const hardware of lists) for (const volts of [12, 24, 48] as const) for (const watts of [1500, 3000, 4800, 6000, 9000, 14000]) for (const hours of [2, 8]) {
      const input = { ...load(watts), hours, volts, chemistry: 'lifepo4' as const }
      for (const option of compute(input, CATALOG_SNAPSHOT, hardware).batteryOptions) {
        const kit = compute({ ...input, batteryUnit: option.id }, CATALOG_SNAPSHOT, hardware)
        const where = `${watts} W, ${hours} h, ${volts} V, ${option.id}, list ${lists.indexOf(hardware)}`
        expect(kit.battery?.interruptOk, where).toBe(!cannotInterrupt(kit))
        expect(option.interruptOk, where).toBe(kit.battery?.interruptOk)
        kits++
      }
    }
    expect(kits).toBeGreaterThan(500)
  })

  test('the automatic bank is the one that passes the most, before the one with the fewest batteries', () => {
    // 3 kW at 12 V for 2 h falls back to a 4 kW inverter, 370 A. Two 400 Ah units ask each lead for 185 A; three 300 Ah
    // units put 22,500 A into a fault; four 200 Ah units fit their leads and stay at the fuses' 20,000 A.
    const r = compute({ ...load(3000), hours: 2, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.inverter).toMatchObject({ count: 1, w: 4000 })
    expect(r.battery).toMatchObject({ unitLabel: '12 V 200 Ah LiFePO₄', config: '1S4P', leadOk: true, interruptOk: true, bankShortCircuitA: 20000 })
    const failing = r.warnings.map((w) => w.code)
    expect(failing).not.toContain('fuseInterrupt')
    expect(failing).not.toContain('fuseAboveCable')
    expect(failing).not.toContain('cableUndersized')
  })

  test('past the parallel limit of the battery\'s maker, a string lead no single cable can carry is a cable warning that names the row', () => {
    // 6 kW at 12 V draws 556 A: five strings would keep each under 120 A, but the maker allows four.
    const r = compute({ ...load(4800), hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 50, insulationC: 75 } }, CATALOG_SNAPSHOT)
    expect(r.battery).toMatchObject({ config: '1S3P', parallelFor: { lead: 5 }, unit: { maxParallel: 4 } })
    expect(r.warnings.filter((w) => w.code === 'cableUndersized')).toEqual([
      { code: 'cableUndersized', params: { conductor: 'stringLeads', gauge: '4/0 AWG', maxA: 172.5, needA: 231.5, canCool: false, canRaiseInsulation: false, nextVolts: 24 } },
    ])
  })

  test('a main cable that six runs of the largest gauge cannot carry is a cable warning too', () => {
    // 6.4 kW is past every 12 V inverter: the 8 kW fallback draws 741 A, and six bundled runs of 4/0 at 40 °C carry 118 A each.
    const r = compute({ ...load(6400), hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 40, bundled: true } }, CATALOG_SNAPSHOT)
    expect([r.inverter.w, r.inverter.voltsOk, r.cable.runs, r.cable.gauge]).toEqual([8000, false, 6, '4/0 AWG'])
    expect(r.warnings.filter((w) => w.code === 'cableUndersized' && w.params.conductor === 'mainCable')).toEqual([
      { code: 'cableUndersized', params: { conductor: 'mainCable', gauge: '4/0 AWG', maxA: 118.3, needA: 154.4, canCool: false, canRaiseInsulation: false, nextVolts: 24 } },
    ])
  })
})

describe('engineering checks', () => {
  const at48 = (qty: Record<string, number>, extra: Partial<Parameters<typeof compute>[0]> = {}) =>
    compute({ qty, hours: 10, volts: 48, chemistry: 'lifepo4', ...extra }, CATALOG_SNAPSHOT)
  const item = (id: string) => CATALOG_SNAPSHOT.find((a) => a.id === id)!

  test('a duty override changes the energy and the average, and is clamped to 5%..100%', () => {
    const base = at48(ESSENTIALS)
    const full = at48(ESSENTIALS, { dutyOverrides: { fridge: 1 } })
    expect(full.loadWh).toBe(base.loadWh - 525 + 1500)
    expect(full.averageW).toBe(465)
    expect(full.items.find((i) => i.id === 'fridge')).toMatchObject({ effectiveDuty: 1, overridden: true })
    expect(base.items.find((i) => i.id === 'fridge')).toMatchObject({ effectiveDuty: 0.35, overridden: false, kind: 'cycling' })
    expect(at48(ESSENTIALS, { dutyOverrides: { fridge: 0 } }).items.find((i) => i.id === 'fridge')?.effectiveDuty).toBe(0.05)
    expect(at48(ESSENTIALS, { dutyOverrides: { fridge: 2 } }).items.find((i) => i.id === 'fridge')?.effectiveDuty).toBe(1)
    expect(at48(ESSENTIALS, { dutyOverrides: { ghost: 0.5 } }).loadWh).toBe(base.loadWh)
  })

  test('motors starting together add their surges, largest first; "all" counts every unit of a quantity', () => {
    const one = at48({ fridge: 2, ac2c: 1, well: 1 })
    const two = at48({ fridge: 2, ac2c: 1, well: 1 }, { simultaneousStarts: 2 })
    const all = at48({ fridge: 2, ac2c: 1, well: 1 }, { simultaneousStarts: 'all' })
    const delta = (id: string) => item(id).surge - item(id).watts
    expect(one.surgeW).toBe(one.runningW + delta('ac2c'))
    expect(two.surgeW).toBe(one.runningW + delta('ac2c') + Math.max(delta('well'), delta('fridge')))
    expect(all.surgeW).toBe(one.runningW + delta('ac2c') + delta('well') + 2 * delta('fridge'))
    expect(all.surgeProfile.starters).toHaveLength(4)
    expect(all.surgeProfile.starters[0]?.itemId).toBe('ac2c')
    expect(one.surgeSeconds).toBe(3)
    expect(one.items.find((i) => i.id === 'ac2c')?.startClass).toBe('compressor')
    expect(one.items.find((i) => i.id === 'lights')?.startClass ?? null).toBeNull()
  })

  test('a momentary load counts its bursts as energy and joins the start-up only when every motor starts', () => {
    // The catalog's parking barrier: 150 W, 450 W surge, 4 s lifts thirty times an hour.
    const r = at48({ fridge: 1, barrier: 1 })
    const b = r.items.find((i) => i.id === 'barrier')!
    expect(b).toMatchObject({ kind: 'momentary', startClass: 'motor', surgeSeconds: 1, overridden: false })
    expect(b.effectiveDuty).toBeCloseTo(120 / 3600)
    expect(b.wh).toBe(Math.round(150 * (120 / 3600) * 10))
    const two = at48({ fridge: 1, barrier: 1 }, { simultaneousStarts: 2 })
    expect(two.surgeW).toBe(two.runningW + (1200 - 150))
    const all = at48({ fridge: 1, barrier: 1 }, { simultaneousStarts: 'all' })
    expect(all.surgeW).toBe(all.runningW + (1200 - 150) + 300)
  })

  test('hot air and bundled runs derate the cable and step the gauge up', () => {
    // 1 AWG at 75% carries 97.5 A, enough for the 87 A design current but not for the 100 A fuse: 1/0 AWG.
    const hot = at48(ESSENTIALS, { cable: { ambientC: 50, insulationC: 75 } })
    expect(hot.cable).toMatchObject({ gauge: '1/0 AWG', ambientFactor: 0.75, insulationC: 75, ampacity: 113, fuseA: 100 })
    const cool = at48(ESSENTIALS, { cable: { ambientC: 50, insulationC: 90 } })
    expect(cool.cable).toMatchObject({ gauge: '2 AWG', ambientFactor: 0.82, ampacity: 107 })
    const bundled = compute({ qty: { fridge: 1, ac1c: 1, well: 1, micro: 1, lights: 1 }, hours: 10, volts: 12, chemistry: 'agm', cable: { bundled: true } }, CATALOG_SNAPSHOT)
    expect(bundled.cable.runs).toBeGreaterThanOrEqual(3)
    expect(bundled.cable.conductors).toBe(2 * bundled.cable.runs)
    expect(bundled.cable.bundleFactor).toBeLessThan(1)
    expect(bundled.cable.bundled).toBe(true)
  })

  test('warns when no cable is rated for the air temperature', () => {
    const r = at48(ESSENTIALS, { cable: { ambientC: 80, insulationC: 75 } })
    expect(r.warnings.map((w) => w.code)).toContain('cableAmbient')
    expect(r.cable.ambientFactor).toBe(0)
  })

  test('the inverter draw, not only the energy, sets how many strings a bank needs', () => {
    const r = compute({ qty: { fridge: 1, ac2c: 1, ac15i: 1 }, hours: 1, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-100' }, CATALOG_SNAPSHOT)
    expect(r.inverter.w).toBe(5000)
    // 8,400 W at start-up is 194 A, one unit's 200 A peak; the 116 A continuous draw needs two.
    expect(r.battery?.parallelFor).toEqual({ energy: 1, continuous: 2, peak: 1, lead: 1 })
    expect(r.battery?.parallel).toBe(2)
    expect(r.battery).toMatchObject({ dischargeOk: true, peakOk: true, bankContinuousA: 200, bankPeakA: 400 })
  })

  test('a unit that cannot feed the inverter within its parallel limit is flagged, warned about and runs 0 h worst case', () => {
    // 1,150 W running → 1.5 kW inverter → 139 A; a 12 V 100 Ah AGM gives 30 A and may only go four in parallel.
    const r = compute({ qty: { fridge: 1, micro: 1 }, hours: 2, volts: 12, chemistry: 'agm', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    expect(r.battery?.unitLabel).toBe('12 V 100 Ah AGM')
    expect(r.battery?.parallelFor.continuous).toBeGreaterThan(4)
    expect(r.battery?.overMaxParallel).toBe(false)
    expect(r.battery?.dischargeOk).toBe(false)
    expect(r.warnings.map((w) => w.code)).toContain('bankDischarge')
    expect(r.battery?.runtime.worstLimitedByDischarge).toBe(true)
    expect(r.battery?.runtime.worst).toBe(0)
    expect(r.batteryOptions.find((o) => o.id === '12-100')).toMatchObject({ dischargeOk: false, maxParallel: 4 })
    expect(r.batteryOptions.find((o) => o.isAuto)?.dischargeOk).toBe(true)
  })

  test('the automatic pick skips banks that fail a check when a healthy one exists', () => {
    const r = compute({ qty: { fridge: 1, micro: 1 }, hours: 2, volts: 12, chemistry: 'agm' }, CATALOG_SNAPSHOT)
    const small = r.batteryOptions.find((o) => o.id === '12-100')!
    expect(small.dischargeOk).toBe(false)
    expect(small.count).toBeLessThanOrEqual(r.battery!.count)
    expect(r.battery).toMatchObject({ unitLabel: '12 V 200 Ah AGM', dischargeOk: true, peakOk: true })
  })

  test('when no bank passes every check the automatic pick still returns the fewest batteries', () => {
    const r = compute({ qty: { fridge: 1, micro: 1, kettle: 1 }, hours: 2, volts: 12, chemistry: 'agm' }, CATALOG_SNAPSHOT)
    expect(r.inverter.w).toBe(4000)
    expect(r.batteryOptions.every((o) => !o.dischargeOk)).toBe(true)
    expect(r.battery).not.toBeNull()
    expect(r.warnings.map((w) => w.code)).toContain('bankDischarge')
  })

  test('runtime scenarios bracket the typical figure, and typical is the headline hours', () => {
    const r = at48(ESSENTIALS)
    const rt = r.battery!.runtime
    expect(rt.optimistic).toBeGreaterThan(rt.typical)
    expect(rt.typical).toBeGreaterThan(rt.worst)
    expect(rt.worst).toBeGreaterThan(0)
    expect(r.battery?.hoursActual).toBe(rt.typical)
    for (const o of r.batteryOptions) expect(o.hoursActual).toBe(o.runtime.typical)
  })

  const surgeWarning = (r: ReturnType<typeof compute>) => r.warnings.find((w) => w.code === 'surgeDuration')?.params

  test('a start-up above every surge rating is warned about, and its length is not blamed', () => {
    // Six 5 ton units starting together pull 99 kW for 3 s, inside the 10 s window of three 12 kW inverters: the 72 kW
    // they hold together is what falls short.
    const r = at48({ ac5c: 6 }, { simultaneousStarts: 'all' })
    expect(r.inverter.surgeOk).toBe(false)
    expect(surgeWarning(r)).toEqual({ surgeW: 99000, seconds: 3, ratedW: 72000, inverterW: 36000, inverters: 3, unitW: 12000, inverterSurgeW: 72000, tooLong: false })
  })

  test('a start-up within the surge rating that outlasts its window is warned about as too long', () => {
    // A unit that holds 4 kW for half a second and 2 kW after that: the pump's 3 kW start is within the rating, not the window.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 2000, surge: 4000, volts: [48] as const, surgeSeconds: 0.5 }] }
    const r = compute({ qty: { well: 1 }, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter).toMatchObject({ headroomOk: true, surgeOk: false })
    expect(surgeWarning(r)).toEqual({ surgeW: 3000, seconds: 1, ratedW: 2000, inverterW: 2000, inverters: 1, unitW: 2000, inverterSurgeW: 4000, tooLong: true })
  })

  test('a start-up that is both too long and above the surge rating is blamed on its watts', () => {
    // The same unit asked for 5 kW: no window would be long enough, because 5 kW is more than it ever holds.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 2000, surge: 4000, volts: [48] as const, surgeSeconds: 0.5 }] }
    const custom = [{ id: 'x', name: 'Pump', watts: 1000, surge: 5000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(surgeWarning(r)).toMatchObject({ surgeW: 5000, ratedW: 2000, inverterSurgeW: 4000, tooLong: false })
  })

  test('the configured start-up, not the inverter rating, is what the fuse must hold', () => {
    // The stock inverters surge exactly 2× and the fuse is at least 1.25×, so a 3× inverter is needed to reach the hold.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 1000, surge: 3000, volts: [12] as const, surgeSeconds: 3 }] }
    const r = compute({ qty: { well: 1 }, hours: 2, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.surgeW).toBe(3000)
    expect(r.warnings.map((w) => w.code)).toContain('fuseSurge')
    const calm = compute({ qty: { lights: 1, well: 1 }, hours: 2, volts: 12, chemistry: 'lifepo4', dutyOverrides: {} }, CATALOG_SNAPSHOT)
    expect(calm.warnings.map((w) => w.code)).not.toContain('fuseSurge')
  })

  test('a replacement hardware catalog drives the picks', () => {
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 20000, surge: 40000, volts: [48] as const, surgeSeconds: 10 }] }
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter.w).toBe(20000)
  })
})
