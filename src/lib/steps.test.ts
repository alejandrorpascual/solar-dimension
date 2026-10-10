import { describe, expect, test } from 'vitest'
import { isStepReachable, parseStep, STEPS } from './steps'

describe('isStepReachable', () => {
  test('the appliances step is always open', () => {
    expect(isStepReachable(1, false)).toBe(true)
    expect(isStepReachable(1, true)).toBe(true)
  })

  test('later steps wait for at least one appliance', () => {
    for (const s of [2, 3, 4] as const) {
      expect(isStepReachable(s, false)).toBe(false)
      expect(isStepReachable(s, true)).toBe(true)
    }
  })
})

describe('parseStep', () => {
  test('reads numbers and numeric strings, anything else is step 1', () => {
    expect(STEPS.map((s) => parseStep(s))).toEqual([1, 2, 3, 4])
    expect(STEPS.map((s) => parseStep(String(s)))).toEqual([1, 2, 3, 4])
    expect(parseStep(5)).toBe(1)
    expect(parseStep('x')).toBe(1)
    expect(parseStep(undefined)).toBe(1)
  })
})
