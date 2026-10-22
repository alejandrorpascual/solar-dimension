export type Step = 1 | 2 | 3 | 4

/** The wizard's steps in order: appliances, backup hours, solar panels, the kit. */
export const STEPS: readonly Step[] = [1, 2, 3, 4]

/** A step from the URL, or undefined for anything that is not 1–4. */
export function toStep(v: unknown): Step | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return STEPS.find((s) => s === n)
}

/** A step from the URL; anything that is not 1–4 starts at the appliances. */
export function parseStep(v: unknown): Step {
  return toStep(v) ?? 1
}

/** The appliances step is always open; the rest size a kit, so they need at least one appliance. */
export function isStepReachable(step: Step, hasAppliances: boolean): boolean {
  return step === 1 || hasAppliances
}

/** How the stepper draws one step. At most one of `isCurrent`, `isDone` and `isLocked` is true; none means still ahead. */
export interface StepState {
  step: Step
  isCurrent: boolean
  /** Behind the current step and open to go back to. */
  isDone: boolean
  /** Waiting for an appliance: the stepper will not open it, whether it is ahead of the current step or behind it. */
  isLocked: boolean
  /** The current step or one before it: the line leading to it is lit, across any locked step on the way. */
  isReached: boolean
}

/**
 * The four steps as the stepper shows them. The current step is never locked: the footer's Next and the URL both
 * open a later step on an empty project, and the step you are on must not read as one you cannot be on. The steps
 * that project skipped stay locked instead of done, so a tick always means a step you can go back to.
 */
export function stepStates(current: Step, hasAppliances: boolean): readonly StepState[] {
  return STEPS.map((step) => {
    const isCurrent = step === current
    const isLocked = !isCurrent && !isStepReachable(step, hasAppliances)
    return { step, isCurrent, isDone: step < current && !isLocked, isLocked, isReached: step <= current }
  })
}
