import { describe, expect, test } from 'vitest'
import { GAUGES } from './catalog'
import { AMBIENT_CORRECTION, ambientFactor, ampsAt, BUNDLE_ADJUSTMENT, bundleFactor } from './nec'

// The NEC tables, typed in from the code book, not from the engine: changing any value the engine reads fails a test.

/** Table 310.16, copper: size, then the 75 °C and 90 °C columns, in amps. */
const NEC_310_16: readonly (readonly [string, number, number])[] = [
  ['8 AWG', 50, 55],
  ['6 AWG', 65, 75],
  ['4 AWG', 85, 95],
  ['2 AWG', 115, 130],
  ['1 AWG', 130, 145],
  ['1/0 AWG', 150, 170],
  ['2/0 AWG', 175, 195],
  ['3/0 AWG', 200, 225],
  ['4/0 AWG', 230, 260],
]

/**
 * Table 310.15(B)(1): the air from and to (°C, both included), then the factor for 75 °C and 90 °C insulation; 0 where
 * the code gives none. The first row is "10 or less": -10 °C stands in for colder air. The kit itself offers 30-50 °C.
 */
const NEC_AMBIENT: readonly (readonly [number, number, number, number])[] = [
  [-10, 10, 1.2, 1.15],
  [11, 15, 1.15, 1.12],
  [16, 20, 1.11, 1.08],
  [21, 25, 1.05, 1.04],
  [26, 30, 1, 1],
  [31, 35, 0.94, 0.96],
  [36, 40, 0.88, 0.91],
  [41, 45, 0.82, 0.87],
  [46, 50, 0.75, 0.82],
  [51, 55, 0.67, 0.76],
  [56, 60, 0.58, 0.71],
  [61, 65, 0.47, 0.65],
  [66, 70, 0.33, 0.58],
  [71, 75, 0, 0.5],
  [76, 80, 0, 0.41],
  [81, 85, 0, 0.29],
]

/** Table 310.15(C)(1): current-carrying conductors from and to (both included), then the factor. The last row is "41 and above". */
const NEC_BUNDLING: readonly (readonly [number, number, number])[] = [
  [2, 3, 1],
  [4, 6, 0.8],
  [7, 9, 0.7],
  [10, 20, 0.5],
  [21, 30, 0.45],
  [31, 40, 0.4],
  [41, 100, 0.35],
]

describe('the NEC tables, row by row', () => {
  test('the gauges are the 310.16 sizes, smallest first', () => {
    expect(GAUGES.map((g) => g.awg)).toEqual(NEC_310_16.map(([awg]) => awg))
  })

  test.each(NEC_310_16)('%s copper carries %i A in the 75 °C column and %i A in the 90 °C column', (awg, amps75, amps90) => {
    const g = GAUGES.find((x) => x.awg === awg)!
    expect([ampsAt(g, 75), ampsAt(g, 90)]).toEqual([amps75, amps90])
  })

  test.each(NEC_AMBIENT)('air from %i to %i °C takes %s on 75 °C cable and %s on 90 °C cable', (from, to, f75, f90) => {
    for (const ambientC of [from, to]) {
      expect([ambientFactor(ambientC, 75), ambientFactor(ambientC, 90)], `${ambientC} °C`).toEqual([f75, f90])
    }
  })

  // Reading both ends of every row asserts each edge where the factor steps: 3/4, 6/7, 9/10, 20/21, 30/31 and 40/41.
  test.each(NEC_BUNDLING)('%i to %i current-carrying conductors together take %s', (from, to, factor) => {
    expect([bundleFactor(from), bundleFactor(to)]).toEqual([factor, factor])
  })

  test('the tables hold no row the code book does not', () => {
    expect(AMBIENT_CORRECTION).toHaveLength(NEC_AMBIENT.length)
    expect(BUNDLE_ADJUSTMENT).toHaveLength(NEC_BUNDLING.length - 1)
  })
})

describe('ambientFactor', () => {
  test('is 1 at the 30 °C table base and drops just above it', () => {
    expect(ambientFactor(30, 75)).toBe(1)
    expect(ambientFactor(30, 90)).toBe(1)
    expect(ambientFactor(31, 75)).toBe(0.94)
    expect(ambientFactor(31, 90)).toBe(0.96)
  })

  test('rises below 30 °C and reads the last row up to 85 °C', () => {
    expect(ambientFactor(10, 75)).toBe(1.2)
    expect(ambientFactor(-5, 90)).toBe(1.15)
    expect(ambientFactor(85, 90)).toBe(0.29)
  })

  test('is 0 where the insulation cannot be used: 75 °C cable above 70 °C, anything above 85 °C', () => {
    expect(ambientFactor(71, 75)).toBe(0)
    expect(ambientFactor(86, 90)).toBe(0)
  })

  test('rows are ordered by temperature with factors falling', () => {
    const temps = AMBIENT_CORRECTION.map((r) => r.maxC)
    expect(temps).toEqual([...temps].sort((a, b) => a - b))
    const f90 = AMBIENT_CORRECTION.map((r) => r.f90)
    expect(f90).toEqual([...f90].sort((a, b) => b - a))
  })
})

describe('bundleFactor', () => {
  test('is 1 for three or fewer conductors and steps down from four', () => {
    expect(bundleFactor(2)).toBe(1)
    expect(bundleFactor(3)).toBe(1)
    expect(bundleFactor(4)).toBe(0.8)
    expect(bundleFactor(6)).toBe(0.8)
    expect(bundleFactor(7)).toBe(0.7)
    expect(bundleFactor(10)).toBe(0.5)
    expect(bundleFactor(41)).toBe(0.35)
    expect(bundleFactor(100)).toBe(0.35)
  })

  test('rows are ordered by conductor count', () => {
    const counts = BUNDLE_ADJUSTMENT.map((r) => r.minConductors)
    expect(counts).toEqual([...counts].sort((a, b) => a - b))
  })
})

describe('ampsAt', () => {
  test('reads the column asked for, and 90 °C is never below 75 °C', () => {
    const eight = GAUGES[0]!
    expect(ampsAt(eight, 75)).toBe(50)
    expect(ampsAt(eight, 90)).toBe(55)
    for (const g of GAUGES) expect(ampsAt(g, 90)).toBeGreaterThanOrEqual(ampsAt(g, 75))
  })
})
