import { describe, expect, test } from 'vitest'
import { FUSES, GAUGES } from '../catalog'
import { conductorsFor, correctedAmpacity, sizeBankWiring, sizeMainCable, undersized } from './cable'
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

describe('undersized', () => {
  const hot = { ...room, ambientC: 50, insulationC: 75 as const }

  test('says nothing about a cable that covers its design current', () => {
    expect(undersized('mainCable', sizeMainCable(69.4, 138.9, 48, room, GAUGES, FUSES, noBank))).toEqual([])
  })

  test('names the row and gauge, with what one conductor carries rounded down and what it needs rounded up, to a tenth', () => {
    // Six runs of 4/0 at 172.5 A each against 1,500 A × 1.25 / 6 = 312.5 A.
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(undersized('mainCable', huge)).toEqual([{ code: 'cableUndersized', params: { conductor: 'mainCable', gauge: '4/0 AWG', maxA: 172.5, needA: 312.5 } }])
  })

  test('judges a row cut from the same gauge by the ampacity it has where it is installed', () => {
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(undersized('interconnects', huge, 320)).toEqual([])
  })
})

describe('sizeBankWiring', () => {
  const unit = { maxContinuousA: 200, peakA: 400, peakSeconds: 10, maxParallel: 4, bmsComms: 'none' as const, shortCircuitA: 7500 }
  const wire = (series: number, parallel: number, amps: number, cond: CableConditions = room) => {
    const main = sizeMainCable(amps, amps * 2, 24, cond, GAUGES, FUSES, noBank)
    const wiring = sizeBankWiring({ battery: { series, parallel, unit }, main, bankAmps: amps, bankSurgeAmps: amps * 2, volts: 24, cond, gauges: GAUGES, fuses: FUSES, surgeSeconds: 3 })
    return { main, ...wiring }
  }

  test('a single battery, or no bank at all, needs no links and no string leads', () => {
    expect(wire(1, 1, 185)).toMatchObject({ links: null, string: null, warnings: [] })
    const main = sizeMainCable(185, 370, 24, room, GAUGES, FUSES, noBank)
    expect(sizeBankWiring({ battery: null, main, bankAmps: 185, bankSurgeAmps: 370, volts: 24, cond: room, gauges: GAUGES, fuses: FUSES, surgeSeconds: 3 })).toEqual({ links: null, string: null, warnings: [] })
  })

  test('one string: every series link gets one jumper per main run, at the main gauge', () => {
    // 185 A needs 231 A of cable, more than 4/0 carries, so the main cable is two runs of 1 AWG and so is each link.
    const { main, links, string, warnings } = wire(2, 1, 185.2)
    expect(main).toMatchObject({ runs: 2, gauge: { awg: '1 AWG' } })
    expect(links).toEqual({ positions: 1, perPosition: 2, count: 2, gauge: '1 AWG', mm2: 42.4, designA: 116, ampacity: 130, lengthM: 0.3 })
    expect(links!.perPosition * links!.ampacity).toBeGreaterThanOrEqual(185.2 * 1.25)
    expect(string).toBeNull()
    expect(warnings).toEqual([])
  })

  test('a link sits in open air: it keeps the full ampacity of a gauge the bundled main run had to derate', () => {
    const { main, links } = wire(3, 1, 185.2, { ...room, bundled: true })
    expect(links!.gauge).toBe(main.gauge.awg)
    expect(links!.perPosition).toBe(main.runs)
    expect(links!.ampacity).toBeGreaterThan(Math.round(main.ampacity))
  })

  test('gives each string its share over a short unbundled lead with its own fuse', () => {
    const cond = { ...room, bundled: true }
    const main = sizeMainCable(92.6, 185, 12, cond, GAUGES, FUSES, noBank)
    const ctx = { main, bankAmps: 92.6, bankSurgeAmps: 185, volts: 12 as const, cond, gauges: GAUGES, fuses: FUSES, surgeSeconds: 3 }
    const { string, links } = sizeBankWiring({ ...ctx, battery: { series: 1, parallel: 2, unit } })
    expect(string).toMatchObject({ amps: 46, designA: 58, gauge: '6 AWG', lengthM: 0.3, count: 2, leads: 4, fuse: { a: 60, count: 2 }, warnings: [] })
    expect(links).toBeNull()
    // 100 A per string against a 30 A unit: the unit would only justify the smallest fuse, and it can short past 20 kA.
    const weak = sizeBankWiring({ ...ctx, bankAmps: 200, bankSurgeAmps: 400, battery: { series: 1, parallel: 2, unit: { ...unit, maxContinuousA: 30, shortCircuitA: 30000 } } })
    expect(weak.string!.warnings.map((w) => w.code)).toEqual(['fuseAboveBank', 'fuseInterrupt'])
    expect(weak.warnings).toEqual(weak.string!.warnings)
  })

  test('parallel strings: each gets a lead pair and a fuse, and its links match the lead', () => {
    const { main, links, string, warnings } = wire(2, 3, 185.2)
    expect(string).toMatchObject({ amps: 62, designA: 77, gauge: '4 AWG', ampacity: 85, count: 3, leads: 6, fuse: { a: 80, count: 3 } })
    expect(links).toMatchObject({ positions: 3, perPosition: 1, count: 3, gauge: '4 AWG', designA: 77, ampacity: 85 })
    expect(GAUGES.findIndex((g) => g.awg === links!.gauge)).toBeLessThan(GAUGES.indexOf(main.gauge))
    expect(warnings).toEqual([])
  })

  test('a string too heavy for any one cable warns for the leads and for the links in that string', () => {
    const hot = { ...room, ambientC: 50, insulationC: 75 as const }
    const { warnings } = wire(2, 2, 277.8, hot)
    expect(warnings.filter((w) => w.code === 'cableUndersized').map((w) => w.params)).toEqual([
      { conductor: 'stringLeads', gauge: '4/0 AWG', maxA: 172.5, needA: 173.7 },
      { conductor: 'interconnects', gauge: '4/0 AWG', maxA: 172.5, needA: 173.7 },
    ])
  })
})
