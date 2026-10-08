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
    expect(r.cable.string).toMatchObject({ count: 2, gauge: '6 AWG', lengthM: 0.3, fuse: { a: 60, count: 2 } })
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
    // Three 200 A fuses add up past the 540 A nine AGM strings can give, and nine strings can short at 21.6 kA.
    expect(codes).toEqual(['inverterVoltage', 'highCurrent', 'parallelStrings', 'dominantLoad', 'fuseAboveBank', 'fuseInterrupt'])
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
    const barrier = { ...item('cctv'), id: 'barrier', name: 'Parking barrier', watts: 150, surge: 450, duty: 0.033, kind: 'momentary' as const, burstSeconds: 4, cyclesPerHour: 30 }
    const list = [...CATALOG_SNAPSHOT, barrier]
    const r = compute({ qty: { fridge: 1, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, list)
    const b = r.items.find((i) => i.id === 'barrier')!
    expect(b.kind).toBe('momentary')
    expect(b.effectiveDuty).toBeCloseTo(120 / 3600)
    expect(b.wh).toBe(Math.round(150 * (120 / 3600) * 10))
    const two = compute({ qty: { fridge: 1, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4', simultaneousStarts: 2 }, list)
    expect(two.surgeW).toBe(two.runningW + (1200 - 150))
    const all = compute({ qty: { fridge: 1, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4', simultaneousStarts: 'all' }, list)
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
    expect(r.battery?.parallelFor).toEqual({ energy: 1, continuous: 2, peak: 2 })
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

  test('a start-up no inverter holds long enough is warned about', () => {
    const r = at48({ ac2c: 6 }, { simultaneousStarts: 'all' })
    expect(r.inverter.surgeOk).toBe(false)
    expect(r.warnings.map((w) => w.code)).toContain('surgeDuration')
  })

  test('a replacement hardware catalog drives the picks', () => {
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 20000, surge: 40000, volts: [48] as const, surgeSeconds: 10 }] }
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.inverter.w).toBe(20000)
  })
})
