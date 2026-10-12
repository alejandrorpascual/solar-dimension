import { describe, expect, test } from 'vitest'
import { INVERTERS, type Inverter } from '../catalog'
import { asOne, dcAmps, headroomPct, pickInverter, surgeRatedFor, toInverterPick, wholeUnits } from './inverter'

const three = INVERTERS.find((i) => i.w === 3000)!
const one = INVERTERS.find((i) => i.w === 1000)!
const single = (unit: Inverter) => ({ unit, count: 1 })

describe('surgeRatedFor', () => {
  test('gives the full surge within its window, the long surge after, then only the rating', () => {
    expect(surgeRatedFor(three, 3)).toBe(6000)
    expect(surgeRatedFor(three, 5)).toBe(6000)
    expect(surgeRatedFor(three, 20)).toBe(4500)
    expect(surgeRatedFor(three, 31)).toBe(3000)
    expect(surgeRatedFor(one, 4)).toBe(1000)
  })
})

describe('pickInverter', () => {
  const profile = (surgeW: number, seconds: number) => ({ surgeW, seconds, starters: [] })

  test('needs headroom over the running load and a surge rating that lasts long enough', () => {
    expect(pickInverter(2000, profile(5000, 3), 48, INVERTERS)).toMatchObject({ unit: { w: 3000 }, count: 1 })
    expect(pickInverter(2000, profile(5000, 20), 48, INVERTERS)).toMatchObject({ unit: { w: 4000 }, count: 1 })
    expect(pickInverter(2000, profile(5000, 40), 48, INVERTERS)).toMatchObject({ unit: { w: 5000 }, count: 1 })
  })

  test('prefers an inverter sold for the voltage, then any single one that fits', () => {
    expect(pickInverter(1000, profile(2000, 1), 12, INVERTERS)).toMatchObject({ unit: { w: 1500 }, count: 1 })
    expect(pickInverter(5000, profile(6000, 1), 12, INVERTERS)).toMatchObject({ unit: { w: 8000, volts: [48] }, count: 1 })
  })
})

describe('pickInverter with units that run in parallel', () => {
  const profile = (surgeW: number, seconds: number) => ({ surgeW, seconds, starters: [] })
  const unit = (w: number, maxParallel?: number, volts: Inverter['volts'] = [48]): Inverter =>
    ({ w, surge: w * 2, volts, surgeSeconds: 5, ...(maxParallel ? { maxParallel } : {}) })

  test('when no single unit fits, the fewest identical units that carry the load with its headroom', () => {
    const table = [unit(3000), unit(8000, 4)]
    // 12 kW running needs 15 kW: two 8 kW units give 16 kW.
    expect(pickInverter(12000, profile(12000, 1), 48, table)).toEqual({ unit: table[1], count: 2 })
    // 13 kW needs 16.25 kW, more than two units' 16 kW.
    expect(pickInverter(13000, profile(13000, 1), 48, table)).toEqual({ unit: table[1], count: 3 })
  })

  test('the set must hold the start-up too, for as long as it lasts', () => {
    const table = [unit(8000, 4)]
    // 5 kW running fits one unit, but a 30 kW start needs the 32 kW surge of two, and a 40 kW start the 48 kW of three.
    expect(pickInverter(5000, profile(30000, 1), 48, table)).toEqual({ unit: table[0], count: 2 })
    expect(pickInverter(5000, profile(40000, 1), 48, table)).toEqual({ unit: table[0], count: 3 })
    // A start that outlasts the 5 s surge is held at the longer, lower rating: 12 kW a unit, so 30 kW takes three.
    const slow = [{ ...unit(8000, 4), surgeLong: { w: 12000, seconds: 30 } }]
    expect(pickInverter(5000, profile(30000, 5), 48, slow)).toEqual({ unit: slow[0], count: 2 })
    expect(pickInverter(5000, profile(30000, 20), 48, slow)).toEqual({ unit: slow[0], count: 3 })
    // Past the long window only the continuous rating holds it: four units.
    expect(pickInverter(5000, profile(30000, 60), 48, slow)).toEqual({ unit: slow[0], count: 4 })
  })

  test('the count agrees with the test a single unit takes, whatever the ratings divide to', () => {
    const profileOf = (surgeW: number) => ({ surgeW, seconds: 1, starters: [] })
    for (const w of [2999.7, 3333.3, 7000.1, 8000]) {
      for (const running of [4000.3, 9601, 12800, 15999.9, 16000.1]) {
        const table = [{ ...unit(w, 50), surge: w * 1.7 }]
        const { count } = pickInverter(running, profileOf(running * 2.1), 48, table)
        const carries = (n: number) => n * w >= running * 1.25 && n * w * 1.7 >= running * 2.1
        expect([w, running, carries(count), count === 2 || !carries(count - 1)]).toEqual([w, running, true, true])
      }
    }
  })

  test('a parallel limit far past any real one costs nothing to consider', () => {
    const table = [{ ...unit(8000), maxParallel: 1e9 }]
    expect(pickInverter(12000, profile(12000, 1), 48, table)).toEqual({ unit: table[0], count: 2 })
  })

  test('one unit that fits is never passed over for a set, even when it is sold for another voltage', () => {
    const table = [unit(3000, 6, [24]), unit(8000, 4)]
    expect(pickInverter(5000, profile(5000, 1), 24, table)).toEqual({ unit: table[1], count: 1 })
  })

  test('fewer units win even when they are sold for another voltage; between sets of the same size, the bank voltage comes first', () => {
    // 15 kW needed on a 24 V bank: three 5 kW units would keep it at 24 V and 694 A. Two 10 kW units carry the note that sends the bank to 48 V, where they draw 463 A.
    const mixed = [unit(5000, 6, [24]), unit(10000, 2)]
    expect(pickInverter(12000, profile(12000, 1), 24, mixed)).toEqual({ unit: mixed[1], count: 2 })
    const pairs = [unit(8000, 2, [24]), unit(10000, 2)]
    expect(pickInverter(12000, profile(12000, 1), 24, pairs)).toEqual({ unit: pairs[0], count: 2 })
    expect(pickInverter(12000, profile(12000, 1), 48, pairs)).toEqual({ unit: pairs[1], count: 2 })
  })

  test('a unit its maker does not allow in parallel is never doubled', () => {
    const table = [unit(8000)]
    expect(pickInverter(12000, profile(12000, 1), 48, table)).toEqual({ unit: table[0], count: 1 })
  })

  test('never more units than the maker allows: past that, the largest set the list can build is the fallback', () => {
    const table = [unit(3000), unit(8000, 2), unit(12000)]
    // 20 kW needs 25 kW; two 8 kW units are 16 kW, more than the single 12 kW.
    expect(pickInverter(20000, profile(20000, 1), 48, table)).toEqual({ unit: table[1], count: 2 })
    expect(pickInverter(50000, profile(90000, 1), 48, [unit(3000), unit(12000)])).toMatchObject({ unit: { w: 12000 }, count: 1 })
    // Two sets that reach the same 12 kW: the one made of fewer units.
    expect(pickInverter(50000, profile(90000, 1), 48, [unit(6000, 2), unit(12000)])).toMatchObject({ unit: { w: 12000 }, count: 1 })
    expect(pickInverter(50000, profile(90000, 1), 48, [unit(12000), unit(6000, 2)])).toMatchObject({ unit: { w: 12000 }, count: 1 })
  })

  test('the stock list: units of 3 kW and up run three in parallel at most, smaller ones alone', () => {
    expect(INVERTERS.map((i) => [i.w, i.maxParallel ?? 1])).toEqual([
      [1000, 1], [1500, 1], [2000, 1], [3000, 3], [4000, 3], [5000, 3], [6000, 3], [8000, 3], [10000, 3], [12000, 3],
    ])
    // 9,601 W needs a watt more than the 12 kW unit has: two 8 kW units, not three 5 kW ones.
    expect(pickInverter(9601, profile(9601, 1), 48, INVERTERS)).toMatchObject({ unit: { w: 8000 }, count: 2 })
    expect(pickInverter(15000, profile(15000, 1), 48, INVERTERS)).toMatchObject({ unit: { w: 10000 }, count: 2 })
    expect(pickInverter(19201, profile(19201, 1), 48, INVERTERS)).toMatchObject({ unit: { w: 10000 }, count: 3 })
    expect(pickInverter(28800, profile(28800, 1), 48, INVERTERS)).toMatchObject({ unit: { w: 12000 }, count: 3 })
    // Past 36 kW the list has nothing more: the largest set is the fallback.
    expect(pickInverter(50000, profile(90000, 1), 48, INVERTERS)).toMatchObject({ unit: { w: 12000 }, count: 3 })
    // A 24 V bank is pointed at 48 V units, as it is for one inverter: two of them, not three 5 kW units at 24 V.
    expect(pickInverter(11000, profile(11000, 1), 24, INVERTERS)).toMatchObject({ unit: { w: 8000, volts: [48] }, count: 2 })
  })

  test('a parallel limit of one, zero, a fraction, less than nothing or no number at all is read as a whole number of at least one unit', () => {
    const load = [20000, profile(20000, 1), 48] as const
    for (const limit of [1, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(pickInverter(...load, [{ ...unit(8000), maxParallel: limit }])).toMatchObject({ unit: { w: 8000 }, count: 1 })
    expect(pickInverter(...load, [{ ...unit(8000), maxParallel: 2.5 }])).toMatchObject({ count: 2 })
    // A bad limit on the largest unit does not hide it behind a smaller one.
    expect(pickInverter(...load, [unit(5000), { ...unit(12000), maxParallel: 0 }])).toMatchObject({ unit: { w: 12000 }, count: 1 })
  })

  test('among sets of the same size the smallest unit wins, whatever order the list is in', () => {
    const table = [unit(10000, 3), unit(8000, 3), unit(12000, 3)]
    expect(pickInverter(12000, profile(12000, 1), 48, table)).toEqual({ unit: table[1], count: 2 })
  })

  test('among sets that fit, the fewest units win, then the smallest total', () => {
    const table = [unit(5000, 6), unit(6000, 6), unit(8000, 6), unit(10000, 6)]
    // 15 kW needed: 3 × 5 kW is the tightest fit, but 2 × 8 kW is fewer boxes, cables and fuses.
    expect(pickInverter(12000, profile(12000, 1), 48, table)).toEqual({ unit: table[2], count: 2 })
    // 20 kW needed: 2 × 10 kW, not 4 × 5 kW.
    expect(pickInverter(16000, profile(16000, 1), 48, table)).toEqual({ unit: table[3], count: 2 })
  })
})

describe('wholeUnits', () => {
  test('a count is a whole number of at least one; anything that is no number counts as one', () => {
    expect([3, 1, 0, -2, 2.9, Number.NaN, Number.POSITIVE_INFINITY].map(wholeUnits)).toEqual([3, 1, 1, 1, 2, 1, 1])
  })
})

describe('an empty hardware list', () => {
  test('says so, instead of failing somewhere inside the pick', () => {
    expect(() => pickInverter(1000, { surgeW: 1000, seconds: 1, starters: [] }, 48, [])).toThrow('The hardware catalog lists no inverter')
  })
})

describe('asOne', () => {
  test('ratings add up across identical units; the surge windows stay one unit\'s', () => {
    expect(asOne({ unit: three, count: 2 })).toMatchObject({ w: 6000, surge: 12000, surgeSeconds: 5, surgeLong: { w: 9000, seconds: 30 }, volts: [12, 24, 48] })
    expect(asOne(single(three))).toEqual(three)
    expect(asOne({ unit: one, count: 3 })).not.toHaveProperty('surgeLong')
  })
})

describe('toInverterPick', () => {
  test('reports the applicable surge rating, whether it covers the peak, and the DC currents', () => {
    const pick = toInverterPick(single(three), { surgeW: 5000, seconds: 20, starters: [] }, 48, 2000)
    expect(pick).toMatchObject({ count: 1, unitW: 3000, w: 3000, voltsOk: true, surgeRatedW: 4500, surgeOk: false, surgeSeconds: 5, surgeLong: { w: 4500, seconds: 30 } })
    expect(pick.continuousA).toBeCloseTo(3000 / 48 / 0.9)
    expect(pick.surgeA).toBeCloseTo(6000 / 48 / 0.9)
    const noLong: Inverter = { w: 1000, surge: 2000, volts: [12], surgeSeconds: 3 }
    expect(toInverterPick(single(noLong), { surgeW: 1500, seconds: 1, starters: [] }, 24, 500)).toMatchObject({ voltsOk: false, surgeLong: null, surgeOk: true })
  })

  test('says whether the rating covers the running load, and whether the headroom is on top', () => {
    const quiet = { surgeW: 0, seconds: 0, starters: [] }
    expect(toInverterPick(single(three), quiet, 48, 2400)).toMatchObject({ runningOk: true, headroomOk: true })
    expect(toInverterPick(single(three), quiet, 48, 2401)).toMatchObject({ runningOk: true, headroomOk: false })
    expect(toInverterPick(single(three), quiet, 48, 3000)).toMatchObject({ runningOk: true, headroomOk: false })
    expect(toInverterPick(single(three), quiet, 48, 3001)).toMatchObject({ runningOk: false, headroomOk: false })
  })

  test('a parallel set is reported as a whole: totals for the ratings and currents, with the unit and the count beside them', () => {
    const pick = toInverterPick({ unit: three, count: 2 }, { surgeW: 8000, seconds: 20, starters: [] }, 48, 4800)
    expect(pick).toMatchObject({
      count: 2, unitW: 3000, w: 6000, surge: 12000, surgeSeconds: 5, surgeLong: { w: 9000, seconds: 30 },
      surgeRatedW: 9000, surgeOk: true, runningOk: true, headroomOk: true, voltsOk: true,
    })
    expect(pick.continuousA).toBeCloseTo(6000 / 48 / 0.9)
    expect(pick.surgeA).toBeCloseTo(12000 / 48 / 0.9)
    expect(toInverterPick({ unit: three, count: 2 }, { surgeW: 0, seconds: 0, starters: [] }, 48, 4801)).toMatchObject({ runningOk: true, headroomOk: false })
  })

  test('headroom is a whole percent rounded down, exact at whole fractions and never negative', () => {
    expect(headroomPct(12000, 9600)).toBe(25)
    expect(headroomPct(12000, 9601)).toBe(24)
    expect(headroomPct(12000, 10000)).toBe(20)
    expect(headroomPct(3000, 2500)).toBe(20)
    expect(headroomPct(12000, 12000)).toBe(0)
    expect(headroomPct(12000, 15000)).toBe(0)
  })

  test('dcAmps divides by voltage and inverter efficiency', () => {
    expect(dcAmps(900, 12)).toBeCloseTo(83.33)
  })
})
