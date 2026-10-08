import { describe, expect, test } from 'vitest'
import { GAUGES } from './catalog'
import { AMBIENT_CORRECTION, ambientFactor, ampsAt, BUNDLE_ADJUSTMENT, bundleFactor } from './nec'

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
