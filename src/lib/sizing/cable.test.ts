import { describe, expect, test } from 'vitest'
import { FUSES, GAUGES } from '../catalog'
import { conductorsFor, correctedAmpacity, sizeMainCable, sizeStringCable } from './cable'
import type { CableConditions } from './types'

const room: CableConditions = { runLengthM: 1.5, ambientC: 30, bundled: false, insulationC: 90 }
const noBank = { surgeSeconds: 3, bankContinuousA: null, bankShortCircuitA: null }
const two = GAUGES.find((g) => g.awg === '2 AWG')!

describe('correctedAmpacity', () => {
  test('caps a 90 °C conductor at the 75 °C column in a cool room', () => {
    expect(correctedAmpacity(two, room, 2)).toBe(115)
    expect(correctedAmpacity(two, { ...room, insulationC: 75 }, 2)).toBe(115)
  })
  test('applies the ambient and bundling factors to the insulation column before the cap', () => {
    expect(correctedAmpacity(two, { ...room, ambientC: 50 }, 2)).toBeCloseTo(130 * 0.82)
    expect(correctedAmpacity(two, { ...room, ambientC: 50, insulationC: 75 }, 2)).toBeCloseTo(115 * 0.75)
    expect(correctedAmpacity(two, room, 6)).toBeCloseTo(130 * 0.8)
    expect(correctedAmpacity(two, { ...room, ambientC: 40 }, 4)).toBeCloseTo(130 * 0.91 * 0.8)
  })
  test('counts both leads of every run only when the runs are bundled', () => {
    expect(conductorsFor(room, 3)).toBe(2)
    expect(conductorsFor({ ...room, bundled: true }, 3)).toBe(6)
  })
})

describe('sizeMainCable', () => {
  test('sizes for 125% of the continuous current, then the drop, then the fuse', () => {
    const r = sizeMainCable(69.4, 138.9, 48, room, GAUGES, FUSES, noBank)
    expect(r).toMatchObject({ runs: 1, conductors: 2, gauge: { awg: '2 AWG' }, ampacity: 115, fuse: { a: 100, count: 1 }, warnings: [] })
    expect(r.designA).toBeCloseTo(86.75)
    expect(r.dropPct).toBeLessThan(1)
  })

  test('a long run steps the gauge up for voltage drop', () => {
    const short = sizeMainCable(69.4, 138.9, 12, room, GAUGES, FUSES, noBank)
    const long = sizeMainCable(69.4, 138.9, 12, { ...room, runLengthM: 10 }, GAUGES, FUSES, noBank)
    expect(GAUGES.indexOf(long.gauge)).toBeGreaterThan(GAUGES.indexOf(short.gauge))
    expect(long.dropPct).toBeLessThanOrEqual(3)
  })

  test('splits into runs when the design current is over the largest gauge, more when bundled', () => {
    const r = sizeMainCable(463, 926, 12, room, GAUGES, FUSES, noBank)
    expect(r.runs).toBe(3)
    const bundled = sizeMainCable(463, 926, 12, { ...room, bundled: true }, GAUGES, FUSES, noBank)
    expect(bundled.runs).toBeGreaterThanOrEqual(3)
    expect(bundled.conductors).toBe(2 * bundled.runs)
    const fixed = sizeMainCable(463, 926, 12, room, GAUGES, FUSES, noBank, 1)
    expect(fixed.runs).toBe(1)
  })

  test('adds a run when the fuse the top gauge needs would exceed what it carries, and warns when even six runs cannot', () => {
    // 2 kW at 36 V in 50 °C air on 75 °C cable: 4/0 carries 172.5 A, under the 175 A fuse that one run would need.
    const hot = { ...room, ambientC: 50, insulationC: 75 as const }
    const r = sizeMainCable(2860 / 36 / 0.9 * 1.5, 300, 36, hot, GAUGES, FUSES, noBank)
    expect(r.runs).toBe(2)
    expect(r.fuse.a).toBeLessThanOrEqual(r.ampacity)
    expect(r.warnings.map((w) => w.code)).not.toContain('fuseAboveCable')
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(huge.runs).toBe(6)
    expect(huge.warnings.map((w) => w.code)).toContain('fuseAboveCable')
  })

  test('warns on a start-up drop the inverter would not ride through, and on air too hot for any cable', () => {
    const far = sizeMainCable(90, 1800, 12, { ...room, runLengthM: 10 }, GAUGES, FUSES, noBank)
    expect(far.warnings.map((w) => w.code)).toContain('startupDrop')
    const oven = sizeMainCable(69.4, 138.9, 48, { ...room, ambientC: 90 }, GAUGES, FUSES, noBank)
    expect(oven.warnings.map((w) => w.code)).toContain('cableAmbient')
    expect(oven.ampacity).toBe(0)
  })
})

describe('sizeStringCable', () => {
  test('gives each string its share over a short unbundled lead with its own fuse', () => {
    const s = sizeStringCable({
      bankAmps: 92.6, bankSurgeAmps: 185, parallel: 2, volts: 12, cond: { ...room, bundled: true }, gauges: GAUGES, fuses: FUSES,
      surgeSeconds: 3, unitContinuousA: 200, unitShortCircuitA: 7500,
    })
    expect(s).toMatchObject({ amps: 46, designA: 58, gauge: '6 AWG', lengthM: 0.3, count: 2, fuse: { a: 60, count: 2 }, warnings: [] })
    // 100 A per string against a 30 A unit: the unit would only justify the smallest fuse, and it can short past 20 kA.
    const weak = sizeStringCable({
      bankAmps: 200, bankSurgeAmps: 400, parallel: 2, volts: 12, cond: room, gauges: GAUGES, fuses: FUSES,
      surgeSeconds: 3, unitContinuousA: 30, unitShortCircuitA: 30000,
    })
    expect(weak.warnings.map((w) => w.code)).toEqual(['fuseAboveBank', 'fuseInterrupt'])
  })
})
