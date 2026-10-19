import { describe, expect, test } from 'vitest'
import { FUSES } from '../catalog'
import { interrupts, pickFuse, type FuseContext } from './fuse'

const ampacities = [50, 65, 85, 115, 130, 150, 175, 200, 230]
const ctx = (over: Partial<FuseContext> = {}): FuseContext => ({
  perRunA: 69.4, surgePerRunA: 138.9, surgeSeconds: 3, runs: 1, volts: 48,
  ampacityAt: (i) => ampacities[i]!, gaugeIndex: 3, lastGaugeIndex: ampacities.length - 1,
  bankContinuousA: 200, bankShortCircuitA: 5000, fuses: FUSES, ...over,
})

describe('pickFuse', () => {
  test('takes the first standard rating at 125% of the running current and keeps the gauge when it fits', () => {
    const r = pickFuse(ctx())
    expect(r.fuse).toEqual({ a: 100, class: 'T', aicA: 20000, maxVdc: 125, count: 1 })
    expect(r.gaugeIndex).toBe(3)
    expect(r.warnings).toEqual([])
  })

  test('steps the gauge up until the fuse is under the cable ampacity', () => {
    const r = pickFuse(ctx({ perRunA: 100, surgePerRunA: 150, gaugeIndex: 2 }))
    expect(r.fuse.a).toBe(125)
    expect(r.gaugeIndex).toBe(4)
  })

  test('one fuse per run; the bank is the weak link when it would only justify a smaller fuse', () => {
    const r = pickFuse(ctx({ runs: 3, bankContinuousA: 150 }))
    expect(r.fuse.count).toBe(3)
    // The three fuses are counted, so the note can say they pass 300 A between them where the bank gives 150 A.
    expect(r.warnings).toEqual([{ code: 'fuseAboveBank', params: { fuseA: 100, maxA: 150, count: 3 } }])
    expect(pickFuse(ctx({ runs: 1, bankContinuousA: 50 })).warnings).toEqual([{ code: 'fuseAboveBank', params: { fuseA: 100, maxA: 50 } }])
    // 250 A over three runs justifies a 125 A fuse per run, so a 100 A fuse is not above it.
    expect(pickFuse(ctx({ runs: 3, bankContinuousA: 250 })).warnings).toEqual([])
    expect(pickFuse(ctx({ runs: 3, bankContinuousA: null })).warnings).toEqual([])
  })

  test('a bank that just covers the inverter is not flagged for the 125% fuse rule', () => {
    // 185 A continuous → 250 A fuse; a 200 A bank would itself get a 250 A fuse.
    expect(pickFuse(ctx({ perRunA: 185, surgePerRunA: 200, gaugeIndex: 7, bankContinuousA: 200 })).warnings).toEqual([])
  })

  test('a start-up over twice the rating, or over the rating for longer than the fuse holds, may blow it', () => {
    expect(pickFuse(ctx({ surgePerRunA: 250 })).warnings.map((w) => w.code)).toEqual(['fuseSurge'])
    expect(pickFuse(ctx({ surgePerRunA: 150, surgeSeconds: 8 })).warnings.map((w) => w.code)).toEqual(['fuseSurge'])
    expect(pickFuse(ctx({ surgePerRunA: 150, surgeSeconds: 5 })).warnings).toEqual([])
    expect(pickFuse(ctx({ surgePerRunA: 250, surgeSeconds: 0 })).warnings).toEqual([])
  })

  test('a bank that can short above the interrupting rating is warned about', () => {
    expect(pickFuse(ctx({ bankShortCircuitA: 21600 })).warnings).toEqual([{ code: 'fuseInterrupt', params: { shortCircuitA: 21600, aicA: 20000 } }])
    expect(pickFuse(ctx({ bankShortCircuitA: null })).warnings).toEqual([])
  })

  test('a fuse interrupts a fault up to its rating, the rating included', () => {
    const classT = FUSES[0]!
    expect(interrupts(classT, 20000)).toBe(true)
    expect(interrupts(classT, 20001)).toBe(false)
  })

  test('skips fuses not listed for the bank voltage, and uses the largest when none is big enough', () => {
    const low = [{ a: 100, class: 'ANL' as const, aicA: 6000, maxVdc: 32 }, { a: 125, class: 'T' as const, aicA: 20000, maxVdc: 125 }]
    expect(pickFuse(ctx({ fuses: low })).fuse.a).toBe(125)
    expect(pickFuse(ctx({ fuses: low, volts: 12 })).fuse).toMatchObject({ a: 100, class: 'ANL' })
    expect(pickFuse(ctx({ perRunA: 2000, surgePerRunA: 2000, gaugeIndex: 8 })).fuse.a).toBe(400)
  })

  test('with no fuse listed for the bank voltage it still picks one, and warns that it is not rated for it', () => {
    // A 48 V bank rises on charge, so its fuse needs 48 × 1.25 = 60 V DC; a 32 V ANL fuse is all the list has.
    const only32 = [{ a: 100, class: 'ANL' as const, aicA: 6000, maxVdc: 32 }]
    const r = pickFuse(ctx({ fuses: only32, volts: 48 }))
    expect(r.fuse).toMatchObject({ a: 100, maxVdc: 32 })
    expect(r.warnings).toEqual([{ code: 'fuseVoltage', params: { fuseA: 100, maxVdc: 32, volts: 48, needVdc: 60 } }])
    // The same fuse on a 12 V bank is rated for the 15 V it needs.
    expect(pickFuse(ctx({ fuses: only32, volts: 12 })).warnings).toEqual([])
  })

  test('a fuse listed for exactly 1.25 × the bank voltage is rated for it, and one a volt under is not', () => {
    const listedFor = (maxVdc: number) => [{ a: 100, class: 'T' as const, aicA: 20000, maxVdc }]
    expect(pickFuse(ctx({ fuses: listedFor(60), volts: 48 })).warnings).toEqual([])
    expect(pickFuse(ctx({ fuses: listedFor(59), volts: 48 })).warnings.map((w) => w.code)).toEqual(['fuseVoltage'])
  })
})
