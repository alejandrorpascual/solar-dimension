import { describe, expect, test } from 'vitest'
import { CHEMISTRIES } from '../catalog'
import { autoPick, batteryCandidates, toBatteryPick, unitId } from './battery'

const lfp = CHEMISTRIES.lifepo4
const agm = CHEMISTRIES.agm
const easy = { continuousA: 50, surgeA: 100, surgeSeconds: 3 }

describe('batteryCandidates', () => {
  test('lists units the voltage divides by, bank-voltage units first then by capacity', () => {
    const ids = batteryCandidates(lfp, 24, 100, easy).map((c) => c.id)
    expect(ids).toEqual(['24-100', '24-200', '12-100', '12-200', '12-300', '12-400'])
    expect(batteryCandidates(agm, 12, 100, easy).map((c) => c.id)).toEqual(['12-100', '12-200', '6-225'])
  })

  test('strings follow the largest of energy, continuous and peak needs within the parallel limit', () => {
    const [unit] = batteryCandidates(lfp, 12, 150, { continuousA: 250, surgeA: 300, surgeSeconds: 3 })
    expect(unit?.id).toBe('12-100')
    expect(unit?.parallelFor).toEqual({ energy: 2, continuous: 3, peak: 2, lead: 1 })
    expect(unit).toMatchObject({ parallel: 3, config: '1S3P', bankContinuousA: 300, bankPeakA: 600, dischargeOk: true, peakOk: true, overMaxParallel: false })
    expect(unit?.bankShortCircuitA).toBe(3 * 100 * lfp.shortCircuitPerAh)
  })

  test('past the parallel limit the bank keeps the energy count and is flagged', () => {
    const [unit] = batteryCandidates(lfp, 12, 150, { continuousA: 600, surgeA: 300, surgeSeconds: 3 })
    expect(unit).toMatchObject({ parallel: 2, dischargeOk: false, peakOk: true, overMaxParallel: false })
    const [over] = batteryCandidates(lfp, 12, 550, easy)
    expect(over).toMatchObject({ parallel: 6, overMaxParallel: true })
  })

  test('a string is never asked for more than its lead carries: the bank adds strings until each share fits', () => {
    // 370 A from two 200 A units is 185 A a string; a lead that carries 180 A needs a third.
    const heavy = { continuousA: 370, surgeA: 400, surgeSeconds: 3, maxStringA: 180 }
    const big = batteryCandidates(lfp, 48, 100, heavy).find((c) => c.unit.maxContinuousA === 200)!
    expect(big.parallelFor).toMatchObject({ continuous: 2, lead: 3 })
    expect(big).toMatchObject({ parallel: 3, dischargeOk: true, overMaxParallel: false })
    expect(heavy.continuousA / big.parallel).toBeLessThanOrEqual(heavy.maxStringA)
    // The same bank without the limit stated stays at two strings.
    const { maxStringA: _maxStringA, ...unwired } = heavy
    expect(batteryCandidates(lfp, 48, 100, unwired).find((c) => c.id === big.id)).toMatchObject({ parallel: 2 })
  })

  test('one string has no lead of its own, so the lead limit never splits it', () => {
    const chem = { ...lfp, units: [{ ...lfp.units.find((u) => u.v === 48)!, maxContinuousA: 500, peakA: 1000 }] }
    const [unit] = batteryCandidates(chem, 48, 10, { continuousA: 370, surgeA: 400, surgeSeconds: 3, maxStringA: 180 })
    expect(unit).toMatchObject({ parallel: 1, dischargeOk: true })
    expect(unit?.parallelFor.lead).toBe(3)
  })

  test('when the lead limit would pass the maker\'s parallel limit, the bank keeps the strings its other needs ask for', () => {
    const chem = { ...lfp, units: [{ ...lfp.units.find((u) => u.v === 48)!, maxContinuousA: 200, peakA: 400, maxParallel: 2 }] }
    const [unit] = batteryCandidates(chem, 48, 10, { continuousA: 370, surgeA: 400, surgeSeconds: 3, maxStringA: 180 })
    expect(unit).toMatchObject({ parallel: 2, dischargeOk: true, overMaxParallel: false })
  })

  test('a surge longer than the BMS peak window fails the peak check', () => {
    const [unit] = batteryCandidates(lfp, 48, 50, { continuousA: 50, surgeA: 100, surgeSeconds: 30 })
    expect(unit?.peakOk).toBe(false)
  })

  test('a stated short-circuit current beats the chemistry estimate', () => {
    const chem = { ...lfp, units: [{ ...lfp.units[0]!, shortCircuitA: 999 }] }
    expect(batteryCandidates(chem, 12, 10, easy)[0]?.bankShortCircuitA).toBe(999)
  })
})

describe('autoPick', () => {
  test('takes the fewest batteries among healthy banks, then the smallest bank', () => {
    const candidates = batteryCandidates(lfp, 48, 100, easy)
    expect(autoPick(candidates)?.id).toBe('48-100')
  })

  test('falls back to every candidate when none is healthy', () => {
    const candidates = batteryCandidates(agm, 12, 50, { continuousA: 5000, surgeA: 100, surgeSeconds: 3 })
    expect(candidates.every((c) => !c.dischargeOk)).toBe(true)
    expect(autoPick(candidates)).not.toBeNull()
    expect(autoPick([])).toBeNull()
  })
})

test('toBatteryPick drops the id and sets the headline hours to the typical scenario', () => {
  const candidate = batteryCandidates(lfp, 48, 100, easy)[0]!
  const pick = toBatteryPick(candidate, { optimistic: 12, typical: 10, worst: 8, worstLimitedByDischarge: false })
  expect('id' in pick).toBe(false)
  expect(pick.hoursActual).toBe(10)
  expect(unitId(48, 100)).toBe('48-100')
})
