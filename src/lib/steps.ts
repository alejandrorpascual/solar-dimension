export type Step = 1 | 2 | 3 | 4

/** The wizard's steps in order: appliances, backup hours, solar panels, the kit. */
export const STEPS: readonly Step[] = [1, 2, 3, 4]

/** A step from the URL; anything that is not 1–4 starts at the appliances. */
export function parseStep(v: unknown): Step {
  const n = typeof v === 'string' ? Number(v) : v
  return STEPS.find((s) => s === n) ?? 1
}

/** The appliances step is always open; the rest size a kit, so they need at least one appliance. */
export function isStepReachable(step: Step, hasAppliances: boolean): boolean {
  return step === 1 || hasAppliances
}

/** How the stepper draws one step. */
export interface StepState {
  step: Step
  isCurrent: boolean
  /** Behind the current step. */
  isDone: boolean
  /** Waiting for an appliance: the stepper will not open it. */
  isLocked: boolean
}

/**
 * The four steps as the stepper shows them. The current step is never locked: the footer's Next and the URL both
 * open a later step on an empty project, and the step you are on must not read as one you cannot be on.
 */
export function stepStates(current: Step, hasAppliances: boolean): readonly StepState[] {
  return STEPS.map((step) => {
    const isCurrent = step === current
    return { step, isCurrent, isDone: step < current, isLocked: !isCurrent && !isStepReachable(step, hasAppliances) }
  })
}
