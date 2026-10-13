import { describe, expect, test } from 'vitest'
import { CHEMISTRIES } from '../catalog'
import { autoPick, batteryCandidates, toBatteryPick, unitId } from './battery'

const lfp = CHEMISTRIES.lifepo4
const agm = CHEMISTRIES.agm
const easy = { continuousA: 50, surgeA: 100, surgeSeconds: 3 }
/** Fuses that all interrupt the same fault current, read against the whole bank. */
const fusesRated = (aicA: number) => (bank: { parallel: number; unit: { shortCircuitA: number } }): boolean => bank.parallel * bank.unit.shortCircuitA <= aicA

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

  test('no string is added for the leads that the fuses could not interrupt: the bank keeps its strings and says the leads are short', () => {
    // 280 Ah units can each put 7,000 A into a fault. Three pass a 20,000 A fuse rating; two stay inside it.
    const heavy = { continuousA: 370, surgeA: 400, surgeSeconds: 3, maxStringA: 180, canInterrupt: fusesRated(20000) }
    const stiff = batteryCandidates(lfp, 48, 100, heavy).find((c) => c.id === '48-280')!
    expect(stiff.unit.shortCircuitA).toBe(7000)
    expect(stiff).toMatchObject({ parallel: 2, bankShortCircuitA: 14000, parallelFor: { lead: 3 }, leadOk: false, interruptOk: true })
    // 200 Ah units give 5,000 A each, so the third string is taken.
    const soft = batteryCandidates(lfp, 48, 100, heavy).find((c) => c.id === '48-200')!
    expect(soft).toMatchObject({ parallel: 3, bankShortCircuitA: 15000, leadOk: true, interruptOk: true })
    // Without a fuse rating stated, nothing holds the third string back.
    const { canInterrupt: _canInterrupt, ...unrated } = heavy
    expect(batteryCandidates(lfp, 48, 100, unrated).find((c) => c.id === '48-280')).toMatchObject({ parallel: 3, leadOk: true, interruptOk: true })
  })

  test('a bank its energy alone takes past the fuses\' rating is still built, and marked', () => {
    // 1,500 Ah needs six 280 Ah strings: 42,000 A into a fault.
    const big = batteryCandidates(lfp, 48, 1500, { ...easy, maxStringA: 180, canInterrupt: fusesRated(20000) }).find((c) => c.id === '48-280')!
    expect(big).toMatchObject({ parallel: 6, leadOk: true, interruptOk: false })
  })

  test('one string, or strings that each fit their lead, need nothing of the leads', () => {
    for (const c of batteryCandidates(lfp, 48, 100, easy)) expect(c.leadOk && c.interruptOk).toBe(true)
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

  test('among banks that can feed the inverter, one whose strings fit their leads and whose fuses can interrupt it comes first', () => {
    // Two 8 kW inverters, 370 A, a short window: two 280 Ah units are the fewest batteries but ask each lead for 185 A.
    const heavy = { continuousA: 370, surgeA: 400, surgeSeconds: 3, maxStringA: 180, canInterrupt: fusesRated(20000) }
    const candidates = batteryCandidates(lfp, 48, 100, heavy)
    expect(candidates.find((c) => c.id === '48-280')).toMatchObject({ count: 2, leadOk: false })
    expect(autoPick(candidates)).toMatchObject({ id: '48-200', count: 3, leadOk: true, interruptOk: true })
    // With nothing known of the wiring, the fewest batteries win as before.
    const bare = batteryCandidates(lfp, 48, 100, { continuousA: 370, surgeA: 400, surgeSeconds: 3 })
    expect(autoPick(bare)).toMatchObject({ count: 2 })
  })

  test('a bank that cannot feed the inverter never beats one that can, whatever its wiring', () => {
    const feeds = { id: 'feeds', count: 9, bankWh: 9, dischargeOk: true, peakOk: true, overMaxParallel: false, leadOk: false, interruptOk: false }
    const starves = { id: 'starves', count: 1, bankWh: 1, dischargeOk: false, peakOk: true, overMaxParallel: false, leadOk: true, interruptOk: true }
    const pick = (...list: (typeof feeds)[]) => autoPick(list)?.id
    expect(pick(starves, feeds)).toBe('feeds')
    // Between two that feed it: fewer wiring faults first, then fewer batteries, then the smaller bank.
    const clean = { ...feeds, id: 'clean', leadOk: true, interruptOk: true }
    const halfway = { ...feeds, id: 'halfway', count: 2, leadOk: true }
    expect(pick(feeds, halfway, clean)).toBe('clean')
    expect(pick(feeds, halfway)).toBe('halfway')
    expect(pick({ ...clean, id: 'more', count: 10 }, clean, { ...clean, id: 'bigger', bankWh: 10 })).toBe('clean')
    // Among banks that cannot feed it, the wiring settles nothing: the fewest batteries, as when nothing is known of it.
    const tidy = { ...starves, id: 'tidy', count: 11, overMaxParallel: true }
    const short = { ...starves, id: 'short', count: 3, leadOk: false, interruptOk: false }
    expect(pick(tidy, short)).toBe('short')
  })

  test('with no bank that can feed the inverter, the stock list keeps the fewest batteries', () => {
    // 9.6 kW on a 12 V bank: 1,111 A. Nothing feeds it; three 400 Ah units stay the pick, not eleven 100 Ah ones.
    const demand = { continuousA: 1111, surgeA: 1111, surgeSeconds: 0, maxStringA: 180, canInterrupt: fusesRated(20000) }
    const candidates = batteryCandidates(lfp, 12, 1000, demand)
    expect(candidates.every((c) => !(c.dischargeOk && c.peakOk && !c.overMaxParallel))).toBe(true)
    const pick = autoPick(candidates)!
    expect(pick.count).toBe(Math.min(...candidates.map((c) => c.count)))
    expect(pick.count).toBeLessThan(candidates.find((c) => c.id === '12-100')!.count)
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
