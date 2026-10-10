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
