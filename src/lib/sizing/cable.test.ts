import { describe, expect, test } from 'vitest'
import { FUSES, GAUGES } from '../catalog'
import { canInterruptFault, conductorsFor, correctedAmpacity, maxStringAmps, sizeBankWiring, sizeMainCable, undersized } from './cable'
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
    const fixed = sizeMainCable(463, 926, 12, room, GAUGES, FUSES, noBank, { fixedRuns: 1 })
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

  test('inverters in parallel are each fed by their own runs and fuse, sized as if each stood alone', () => {
    // Two inverters drawing 75 A each. As one circuit, 150 A would ride on a single 3/0 run with a 200 A fuse.
    const alone = sizeMainCable(75, 150, 48, room, GAUGES, FUSES, noBank)
    const asOneCircuit = sizeMainCable(150, 300, 48, room, GAUGES, FUSES, noBank)
    const pair = sizeMainCable(150, 300, 48, room, GAUGES, FUSES, noBank, { feeds: 2 })
    expect([alone.runs, asOneCircuit.runs, asOneCircuit.gauge.awg, asOneCircuit.fuse.a]).toEqual([1, 1, '3/0 AWG', 200])
    expect(pair).toMatchObject({ runs: 2, conductors: 2, gauge: alone.gauge, ampacity: alone.ampacity, fuse: { a: alone.fuse.a, count: 2 }, warnings: [] })
    expect([pair.gauge.awg, pair.fuse.a]).toEqual(['2 AWG', 100])
    expect(pair.perRun).toBeCloseTo(alone.amps)
    expect(pair.dropPct).toBeCloseTo(alone.dropPct)
  })

  test('runs in parallel to one inverter are 1/0 AWG or larger; one run to each inverter keeps the gauge it needs', () => {
    // 2 kW at 12 V: 231 A of design current is over 4/0, so two runs of 116 A, which 1 AWG would carry.
    expect(sizeMainCable(185.2, 370.4, 12, room, GAUGES, FUSES, noBank)).toMatchObject({ runs: 2, gauge: { awg: '1/0 AWG' }, ampacity: 150 })
    expect(sizeMainCable(20, 40, 48, room, GAUGES, FUSES, noBank, { fixedRuns: 2 })).toMatchObject({ runs: 2, gauge: { awg: '1/0 AWG' } })
    // Two inverters on a run each: 6 AWG, the least that takes the smallest 60 A fuse.
    expect(sizeMainCable(40, 80, 48, room, GAUGES, FUSES, noBank, { feeds: 2 })).toMatchObject({ runs: 2, gauge: { awg: '6 AWG' } })
  })

  test('a set number of runs and a share for each inverter cannot be asked for together', () => {
    // @ts-expect-error fixedRuns is for one string's lead and feeds for inverters in parallel: a layout names one or neither.
    const both: Parameters<typeof sizeMainCable>[7] = { fixedRuns: 1, feeds: 2 }
    expect(both).toBeDefined()
  })

  test('a count of inverters that is zero, a fraction or no number is read as a whole number of at least one', () => {
    const alone = sizeMainCable(150, 300, 48, room, GAUGES, FUSES, noBank)
    for (const feeds of [0, -1, Number.NaN]) expect(sizeMainCable(150, 300, 48, room, GAUGES, FUSES, noBank, { feeds })).toEqual(alone)
    expect(sizeMainCable(150, 300, 48, room, GAUGES, FUSES, noBank, { feeds: 2.5 }).runs).toBe(2)
  })

  test('runs come in multiples of the inverters fed, up to six for each', () => {
    // An 8 kW inverter at 48 V needs two runs on its own, so two of them need four and three need six: never five.
    expect(sizeMainCable(185.2, 370.4, 48, room, GAUGES, FUSES, noBank).runs).toBe(2)
    expect(sizeMainCable(2 * 185.2, 2 * 370.4, 48, room, GAUGES, FUSES, noBank, { feeds: 2 }).runs).toBe(4)
    expect(sizeMainCable(3 * 185.2, 3 * 370.4, 48, room, GAUGES, FUSES, noBank, { feeds: 3 }).runs).toBe(6)
    const hot = { ...room, ambientC: 50, insulationC: 75 as const }
    const huge = sizeMainCable(2 * 1500, 2 * 3000, 12, hot, GAUGES, FUSES, noBank, { feeds: 2 })
    expect(huge.runs).toBe(12)
    expect(huge.warnings.map((w) => w.code)).toContain('fuseAboveCable')
  })

  test('bundled, the conductors of every inverter count together; and all the fuses share the bank', () => {
    const bundled = sizeMainCable(150, 300, 48, { ...room, bundled: true }, GAUGES, FUSES, noBank, { feeds: 2 })
    expect([bundled.runs, bundled.conductors]).toEqual([2, 4])
    // A 100 A fuse on each inverter. Half of a 130 A bank gets a 100 A fuse too; half of a 120 A bank gets an 80 A one.
    // Read as one 150 A circuit, the 130 A bank would be flagged against a single 200 A fuse.
    const bank = (bankContinuousA: number) => sizeMainCable(150, 300, 48, room, GAUGES, FUSES, { ...noBank, bankContinuousA }, { feeds: 2 })
    expect(bank(130).fuse.a).toBe(100)
    expect(bank(130).warnings.map((w) => w.code)).not.toContain('fuseAboveBank')
    expect(bank(120).warnings.map((w) => w.code)).toContain('fuseAboveBank')
  })

  test('warns on a start-up drop the inverter would not ride through, and on air too hot for any cable', () => {
    const far = sizeMainCable(90, 1800, 12, { ...room, runLengthM: 10 }, GAUGES, FUSES, noBank)
    expect(far.warnings.map((w) => w.code)).toContain('startupDrop')
    const oven = sizeMainCable(69.4, 138.9, 48, { ...room, ambientC: 90 }, GAUGES, FUSES, noBank)
    expect(oven.warnings.map((w) => w.code)).toContain('cableAmbient')
    expect(oven.ampacity).toBe(0)
  })
})

describe('the fuse a run gets', () => {
  test('follows from its current alone: whatever bank is behind it, the fuse, the gauge and the runs are the same', () => {
    // Arrange
    const sizeBehind = (bank: { bankContinuousA: number | null; bankShortCircuitA: number | null }) =>
      sizeMainCable(370, 740, 48, room, GAUGES, FUSES, { surgeSeconds: 3, ...bank }, { feeds: 2 })
    const unbanked = sizeBehind({ bankContinuousA: null, bankShortCircuitA: null })

    // Act: a bank too weak for the fuse and far past its interrupting rating, then one with plenty of both.
    const weak = sizeBehind({ bankContinuousA: 50, bankShortCircuitA: 90000 })
    const strong = sizeBehind({ bankContinuousA: 1000, bankShortCircuitA: 100 })

    // Assert: only the warnings differ.
    for (const sized of [weak, strong]) expect({ fuse: sized.fuse, gauge: sized.gauge, runs: sized.runs }).toEqual({ fuse: unbanked.fuse, gauge: unbanked.gauge, runs: unbanked.runs })
    expect(weak.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['fuseAboveBank', 'fuseInterrupt']))
    expect(strong.warnings).toEqual(unbanked.warnings)
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
      const sized = sizeMainCable(amps, amps * 2, 12, cond, GAUGES, FUSES, noBank, { fixedRuns: 1 })
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
    const sized = sizeMainCable(300, 600, 12, hot, GAUGES, FUSES, noBank, { fixedRuns: 1 })
    expect(undersized('stringLeads', sized, at(hot, 12))[0]!.params.nextVolts).toBe(24)
    expect(undersized('stringLeads', sized, at(hot, 36))[0]!.params.nextVolts).toBe(48)
    expect(undersized('stringLeads', sized, at(hot, 48))[0]!.params.nextVolts).toBeNull()
  })
})

describe('maxStringAmps', () => {
  test('is the largest fuse that fits under the largest gauge, less the continuous margin', () => {
    // 4/0 carries 230 A at its lugs; the largest class T under it is 225 A, which protects 180 A continuous.
    expect(maxStringAmps(48, room, GAUGES, FUSES)).toBe(180)
    // A lead is short and in open air: bundling the main run does not derate it.
    expect(maxStringAmps(48, { ...room, bundled: true }, GAUGES, FUSES)).toBe(180)
    // 50 °C on 75 °C cable: 4/0 carries 172.5 A, a 150 A fuse fits, 120 A continuous.
    expect(maxStringAmps(48, { ...room, ambientC: 50, insulationC: 75 }, GAUGES, FUSES)).toBe(120)
    expect(maxStringAmps(48, { ...room, ambientC: 90 }, GAUGES, FUSES)).toBe(0)
  })

  test('a string at the limit sizes without a warning, and one amp past it does not', () => {
    const lead = (amps: number) => sizeMainCable(amps, amps, 48, { ...room, runLengthM: 0.3 }, GAUGES, FUSES, noBank, { fixedRuns: 1 })
    expect(lead(180).warnings).toEqual([])
    expect(lead(181).warnings.map((w) => w.code)).toContain('fuseAboveCable')
  })
})

describe('canInterruptFault', () => {
  const unit = { maxContinuousA: 200, peakA: 400, peakSeconds: 10, maxParallel: 16, bmsComms: 'none' as const, shortCircuitA: 5000 }
  /** 180 A continuous: one run on a 225 A fuse, sized before any bank is known. */
  const wiringFor = (fuses: typeof FUSES) => {
    const main = sizeMainCable(180, 360, 48, room, GAUGES, fuses, noBank)
    return { main, bankAmps: 180, bankSurgeAmps: 360, volts: 48 as const, cond: room, gauges: GAUGES, fuses, surgeSeconds: 3 }
  }
  const bank = (parallel: number, shortCircuitA = unit.shortCircuitA) => ({ series: 1, parallel, unit: { ...unit, shortCircuitA } })

  test('the main fuse is read against every string together, up to its rating and not past it', () => {
    const wiring = wiringFor(FUSES)
    expect(wiring.main.fuse).toMatchObject({ a: 225, aicA: 20000 })
    expect(canInterruptFault({ ...wiring, battery: bank(4) })).toBe(true)
    expect(canInterruptFault({ ...wiring, battery: bank(5) })).toBe(false)
  })

  test('each string\'s fuse is read against one battery, and a single string has no fuse of its own to fail', () => {
    // Below 225 A the list holds fuses that interrupt 4,000 A: three strings of 60 A each get one of those.
    const wiring = wiringFor(FUSES.map((f) => (f.a < 225 ? { ...f, aicA: 4000 } : f)))
    expect(wiring.main.fuse).toMatchObject({ a: 225, aicA: 20000 })
    expect(canInterruptFault({ ...wiring, battery: bank(3) })).toBe(false)
    expect(canInterruptFault({ ...wiring, battery: bank(3, 4000) })).toBe(true)
    expect(canInterruptFault({ ...wiring, battery: bank(1) })).toBe(true)
  })

  test('says what the wiring\'s own warnings say for the same bank', () => {
    const wiring = wiringFor(FUSES.map((f) => (f.a < 225 ? { ...f, aicA: 4000 } : f)))
    for (const battery of [bank(1), bank(2), bank(3), bank(3, 4000), bank(4), bank(5), bank(5, 3000)]) {
      const main = sizeMainCable(180, 360, 48, room, GAUGES, wiring.fuses, { surgeSeconds: 3, bankContinuousA: null, bankShortCircuitA: battery.parallel * battery.unit.shortCircuitA })
      const raised = [...main.warnings, ...sizeBankWiring({ ...wiring, main, battery }).warnings].some((w) => w.code === 'fuseInterrupt')
      expect(canInterruptFault({ ...wiring, battery }), `${battery.parallel} × ${battery.unit.shortCircuitA} A`).toBe(!raised)
    }
  })

  test('no bank is nothing to interrupt', () => {
    expect(canInterruptFault({ ...wiringFor(FUSES), battery: null })).toBe(true)
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
    // 185 A needs 231 A of cable, more than 4/0 carries, so the main cable is two runs in parallel, of 1/0 AWG, and so is each link.
    const { main, links, string, warnings } = wire(2, 1, 185.2)
    expect(main).toMatchObject({ runs: 2, gauge: { awg: '1/0 AWG' } })
    expect(links).toEqual({ positions: 1, perPosition: 2, count: 2, gauge: '1/0 AWG', mm2: 53.5, designA: 116, ampacity: 150, lengthM: 0.3 })
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
