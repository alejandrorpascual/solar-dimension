import { describe, expect, test } from 'vitest'
import { INVERTERS, type Inverter } from '../catalog'
import { dcAmps, headroomPct, pickInverter, surgeRatedFor, toInverterPick } from './inverter'

const three = INVERTERS.find((i) => i.w === 3000)!
const one = INVERTERS.find((i) => i.w === 1000)!

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
    expect(pickInverter(2000, profile(5000, 3), 48, INVERTERS).w).toBe(3000)
    expect(pickInverter(2000, profile(5000, 20), 48, INVERTERS).w).toBe(4000)
    expect(pickInverter(2000, profile(5000, 40), 48, INVERTERS).w).toBe(5000)
  })

  test('prefers an inverter sold for the voltage, then any that fits, then the biggest', () => {
    expect(pickInverter(1000, profile(2000, 1), 12, INVERTERS).w).toBe(1500)
    expect(pickInverter(5000, profile(6000, 1), 12, INVERTERS)).toMatchObject({ w: 8000, volts: [48] })
    expect(pickInverter(50000, profile(90000, 1), 48, INVERTERS).w).toBe(12000)
  })
})

describe('toInverterPick', () => {
  test('reports the applicable surge rating, whether it covers the peak, and the DC currents', () => {
    const pick = toInverterPick(three, { surgeW: 5000, seconds: 20, starters: [] }, 48, 2000)
    expect(pick).toMatchObject({ w: 3000, voltsOk: true, surgeRatedW: 4500, surgeOk: false, surgeSeconds: 5, surgeLong: { w: 4500, seconds: 30 } })
    expect(pick.continuousA).toBeCloseTo(3000 / 48 / 0.9)
    expect(pick.surgeA).toBeCloseTo(6000 / 48 / 0.9)
    const noLong: Inverter = { w: 1000, surge: 2000, volts: [12], surgeSeconds: 3 }
    expect(toInverterPick(noLong, { surgeW: 1500, seconds: 1, starters: [] }, 24, 500)).toMatchObject({ voltsOk: false, surgeLong: null, surgeOk: true })
  })

  test('says whether the rating covers the running load, and whether the headroom is on top', () => {
    const quiet = { surgeW: 0, seconds: 0, starters: [] }
    expect(toInverterPick(three, quiet, 48, 2400)).toMatchObject({ runningOk: true, headroomOk: true })
    expect(toInverterPick(three, quiet, 48, 2401)).toMatchObject({ runningOk: true, headroomOk: false })
    expect(toInverterPick(three, quiet, 48, 3000)).toMatchObject({ runningOk: true, headroomOk: false })
    expect(toInverterPick(three, quiet, 48, 3001)).toMatchObject({ runningOk: false, headroomOk: false })
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
