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
  const at = (cond: CableConditions, volts: 12 | 24 | 36 | 48 = 12) => ({ cond, volts })

  test('says nothing about a cable that covers its design current', () => {
    expect(undersized('mainCable', sizeMainCable(69.4, 138.9, 48, room, GAUGES, FUSES, noBank), at(room, 48))).toEqual([])
  })

  test('names the row and gauge, with what one conductor carries rounded down and what it needs rounded up, to a tenth', () => {
    // Six runs of 4/0 at 172.5 A each against 1,500 A × 1.25 / 6 = 312.5 A.
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(undersized('mainCable', huge, at(hot))).toEqual([{
      code: 'cableUndersized',
      params: { conductor: 'mainCable', gauge: '4/0 AWG', maxA: 172.5, needA: 312.5, canCool: false, canRaiseInsulation: false, nextVolts: 24 },
    }])
  })

  test('judges a row cut from the same gauge by the ampacity it has where it is installed', () => {
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(undersized('interconnects', huge, at(hot), 320)).toEqual([])
  })

  test('a cable that carries exactly its design current passes, and a gap under a tenth of an amp still prints as a gap', () => {
    // 312.5 A a run.
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(undersized('interconnects', huge, at(hot), 312.5)).toEqual([])
    expect(undersized('interconnects', huge, at(hot), 312.46)[0]!.params).toMatchObject({ maxA: 312.4, needA: 312.5 })
  })

  test('float noise in a table factor does not shave a tenth off what the cable carries', () => {
    // 230 × 0.58 is 133.39999999999998 in floating point, and 133.4 A on the page.
    const huge = sizeMainCable(1500, 3000, 12, hot, GAUGES, FUSES, noBank)
    expect(230 * 0.58).toBeLessThan(133.4)
    expect(undersized('interconnects', huge, at(hot), 230 * 0.58)[0]!.params.maxA).toBe(133.4)
  })

  test('air too hot for the insulation is left to the ambient warning, not repeated as a 0 A row', () => {
    const oven = { ...room, ambientC: 90 }
    const sized = sizeMainCable(69.4, 138.9, 48, oven, GAUGES, FUSES, noBank)
    expect(sized.ampacity).toBe(0)
    expect(sized.warnings.map((w) => w.code)).toContain('cableAmbient')
    expect(undersized('mainCable', sized, at(oven, 48))).toEqual([])
  })

  test('offers a cool room or 90 °C cable only when the same gauge would then cover the design current', () => {
    const ways = (amps: number, cond: CableConditions) => {
      const sized = sizeMainCable(amps, amps * 2, 12, cond, GAUGES, FUSES, noBank, 1)
      const [w] = undersized('stringLeads', sized, at(cond))
      return [sized.gauge.awg, w!.params.maxA, w!.params.needA, w!.params.canCool, w!.params.canRaiseInsulation]
    }
    // A cool room: 4/0 sits at its 230 A terminations on either insulation, so neither a cooler spot nor hotter cable adds an amp.
    expect(ways(185.2, room)).toEqual(['4/0 AWG', 230, 231.5, false, false])
    expect(ways(185.2, { ...room, insulationC: 75 })).toEqual(['4/0 AWG', 230, 231.5, false, false])
    // 50 °C on 75 °C cable, 230 × 0.75: at 30 °C it carries 230 A and on 90 °C cable 213 A, either enough for 173.7 A.
    expect(ways(138.9, hot)).toEqual(['4/0 AWG', 172.5, 173.7, true, true])
    // The same room with 220 A to carry: a cool room would do it, 90 °C cable (213 A) would not.
    expect(ways(176, hot)).toEqual(['4/0 AWG', 172.5, 220, true, false])
    // 50 °C on 90 °C cable, 260 × 0.82: a cool room would do it; the cable is already the hotter kind.
    expect(ways(176, { ...room, ambientC: 50 })).toEqual(['4/0 AWG', 213.2, 220, true, false])
    // Past the 230 A terminations nothing about the room or the insulation is enough.
    expect(ways(300, hot)).toEqual(['4/0 AWG', 172.5, 375, false, false])
  })

  test('a bundled main cable is not told to cool down when a cool room would still leave it short', () => {
    // Six bundled runs of 4/0 at 40 °C on 90 °C cable carry 118.3 A each; at 30 °C they carry 130 A, still under 145.9 A.
    const cond = { ...room, ambientC: 40, bundled: true }
    const [w] = undersized('mainCable', sizeMainCable(700, 1400, 24, cond, GAUGES, FUSES, noBank), { cond, volts: 24 })
    expect(w!.params).toEqual({ conductor: 'mainCable', gauge: '4/0 AWG', maxA: 118.3, needA: 145.9, canCool: false, canRaiseInsulation: false, nextVolts: 36 })
  })

  test('offers a higher bank voltage only where there is one', () => {
    const sized = sizeMainCable(300, 600, 12, hot, GAUGES, FUSES, noBank, 1)
    expect(undersized('stringLeads', sized, at(hot, 12))[0]!.params.nextVolts).toBe(24)
    expect(undersized('stringLeads', sized, at(hot, 36))[0]!.params.nextVolts).toBe(48)
    expect(undersized('stringLeads', sized, at(hot, 48))[0]!.params.nextVolts).toBeNull()
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

  test('one string on three or more main runs: every link still gets a jumper per run, enough for the whole string', () => {
    // 463 A splits into three runs, 600 A into four of 3/0 and 900 A into five of 4/0.
    for (const [amps, runs] of [[463, 3], [600, 4], [900, 5]] as const) {
      const { main, links, warnings } = wire(3, 1, amps)
      expect(main.runs).toBe(runs)
      expect(links).toMatchObject({ positions: 2, perPosition: runs, count: 2 * runs, gauge: main.gauge.awg })
      expect(links!.perPosition * links!.ampacity).toBeGreaterThanOrEqual(amps * 1.25)
      expect(warnings).toEqual([])
    }
  })

  test('one string whose main cable is too small at six runs: its links are too, and the warning names them', () => {
    const hot = { ...room, ambientC: 50, insulationC: 75 as const }
    const { main, warnings } = wire(2, 1, 1500, hot)
    expect(main.runs).toBe(6)
    expect(warnings).toMatchObject([{ code: 'cableUndersized', params: { conductor: 'interconnects', gauge: '4/0 AWG', maxA: 172.5, needA: 312.5 } }])
    expect(warnings).toHaveLength(1)
  })

  test('a link is judged in open air: bundling that leaves the main run short does not flag the link', () => {
    // Six bundled runs of 4/0 at 40 °C carry 118.3 A each against 145.9 A; the same 4/0 as a jumper keeps 230 A.
    const { main, links, warnings } = wire(2, 1, 700, { ...room, ambientC: 40, bundled: true })
    expect(undersized('mainCable', main, { cond: { ...room, ambientC: 40, bundled: true }, volts: 24 })).toHaveLength(1)
    expect(links).toMatchObject({ perPosition: 6, gauge: '4/0 AWG', ampacity: 230 })
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
    expect(string).toMatchObject({ amps: 46, designA: 58, gauge: '6 AWG', lengthM: 0.3, leads: 4, fuse: { a: 60, count: 2 }, warnings: [] })
    expect(links).toBeNull()
    // The lead is 30 cm whatever the main run's length: a 10 m run thickens the main cable for drop, not the lead.
    const far = { ...cond, runLengthM: 10 }
    const farMain = sizeMainCable(92.6, 185, 12, far, GAUGES, FUSES, noBank)
    expect(GAUGES.indexOf(farMain.gauge)).toBeGreaterThan(GAUGES.indexOf(main.gauge))
    expect(sizeBankWiring({ ...ctx, main: farMain, cond: far, battery: { series: 1, parallel: 2, unit } }).string!.gauge).toBe('6 AWG')
    // 100 A per string against a 30 A unit: the unit would only justify the smallest fuse, and it can short past 20 kA.
    const weak = sizeBankWiring({ ...ctx, bankAmps: 200, bankSurgeAmps: 400, battery: { series: 1, parallel: 2, unit: { ...unit, maxContinuousA: 30, shortCircuitA: 30000 } } })
    expect(weak.string!.warnings.map((w) => w.code)).toEqual(['fuseAboveBank', 'fuseInterrupt'])
    expect(weak.warnings).toEqual(weak.string!.warnings)
  })

  test('parallel strings: each gets a lead pair and a fuse, and its links match the lead', () => {
    const { main, links, string, warnings } = wire(2, 3, 185.2)
    expect(string).toMatchObject({ amps: 62, designA: 77, gauge: '4 AWG', ampacity: 85, leads: 6, fuse: { a: 80, count: 3 } })
    expect(links).toMatchObject({ positions: 3, perPosition: 1, count: 3, gauge: '4 AWG', designA: 77, ampacity: 85 })
    expect(GAUGES.findIndex((g) => g.awg === links!.gauge)).toBeLessThan(GAUGES.indexOf(main.gauge))
    expect(warnings).toEqual([])
  })

  test('a string too heavy for any one cable warns for the leads and for the links in that string', () => {
    const hot = { ...room, ambientC: 50, insulationC: 75 as const }
    const { warnings } = wire(2, 2, 277.8, hot)
    const ways = { canCool: true, canRaiseInsulation: true, nextVolts: 36 }
    expect(warnings.filter((w) => w.code === 'cableUndersized').map((w) => w.params)).toEqual([
      { conductor: 'stringLeads', gauge: '4/0 AWG', maxA: 172.5, needA: 173.7, ...ways },
      { conductor: 'interconnects', gauge: '4/0 AWG', maxA: 172.5, needA: 173.7, ...ways },
    ])
  })
})
