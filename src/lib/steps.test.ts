import { assertType, describe, expect, test } from 'vitest'
import type { StepperProps } from '../components/Stepper'
import { isStepReachable, parseStep, STEPS, stepStates } from './steps'

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

describe('stepStates', () => {
  const lockedSteps = (current: Parameters<typeof stepStates>[0], hasAppliances: boolean) =>
    stepStates(current, hasAppliances).filter((s) => s.isLocked).map((s) => s.step)

  test('returns the four steps in order, with exactly one current', () => {
    for (const current of STEPS) {
      const states = stepStates(current, true)
      expect(states.map((s) => s.step)).toEqual([1, 2, 3, 4])
      expect(states.filter((s) => s.isCurrent).map((s) => s.step)).toEqual([current])
    }
  })

  test('steps before the current one are done, the current one and those after are not', () => {
    expect(stepStates(1, true).map((s) => s.isDone)).toEqual([false, false, false, false])
    expect(stepStates(3, true).map((s) => s.isDone)).toEqual([true, true, false, false])
    expect(stepStates(4, true).map((s) => s.isDone)).toEqual([true, true, true, false])
  })

  test('with an appliance nothing is locked', () => {
    for (const current of STEPS) expect(lockedSteps(current, true)).toEqual([])
  })

  test('on the appliances step of an empty project, the three later steps are locked', () => {
    expect(lockedSteps(1, false)).toEqual([2, 3, 4])
  })

  test('the current step is never locked, even when an empty project is on a later step', () => {
    expect(lockedSteps(2, false)).toEqual([3, 4])
    expect(lockedSteps(3, false)).toEqual([2, 4])
    expect(lockedSteps(4, false)).toEqual([2, 3])
  })
})

// Checked by `tsc` (npm run typecheck), not at run time: an unused @ts-expect-error fails the typecheck.
describe('StepperProps', () => {
  const onGo = () => undefined

  test('a stepper either only shows the step or navigates with the appliance flag', () => {
    assertType<StepperProps>({ step: 1 })
    assertType<StepperProps>({ step: 2, onGo, hasAppliances: false })
  })

  test('a stepper that navigates must say whether the project has appliances', () => {
    // @ts-expect-error Without the flag the stepper cannot tell which steps to lock.
    assertType<StepperProps>({ step: 2, onGo })
  })

  test('the appliance flag means nothing without navigation', () => {
    // @ts-expect-error Nothing can be clicked, so there is nothing for the flag to lock.
    assertType<StepperProps>({ step: 2, hasAppliances: true })
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
