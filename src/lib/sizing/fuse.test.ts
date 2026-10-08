import { describe, expect, test } from 'vitest'
import { FUSES } from '../catalog'
import { pickFuse, type FuseContext } from './fuse'

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

  test('one fuse per run, and their ratings add up against the bank', () => {
    const r = pickFuse(ctx({ runs: 3, bankContinuousA: 250 }))
    expect(r.fuse.count).toBe(3)
    expect(r.warnings).toEqual([{ code: 'fuseAboveBank', params: { fuseA: 100, maxA: 250 } }])
    expect(pickFuse(ctx({ runs: 3, bankContinuousA: 300 })).warnings).toEqual([])
    expect(pickFuse(ctx({ runs: 3, bankContinuousA: null })).warnings).toEqual([])
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

  test('skips fuses not listed for the bank voltage, and uses the largest when none is big enough', () => {
    const low = [{ a: 100, class: 'ANL' as const, aicA: 6000, maxVdc: 32 }, { a: 125, class: 'T' as const, aicA: 20000, maxVdc: 125 }]
    expect(pickFuse(ctx({ fuses: low })).fuse.a).toBe(125)
    expect(pickFuse(ctx({ fuses: low, volts: 12 })).fuse).toMatchObject({ a: 100, class: 'ANL' })
    expect(pickFuse(ctx({ perRunA: 2000, surgePerRunA: 2000, gaugeIndex: 8 })).fuse.a).toBe(400)
  })
})
