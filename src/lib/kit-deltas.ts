import type { SizingResult } from './sizing'

/** How the four kit tiles moved between two versions of a project. Runtime is in whole hours, as the tile shows it. */
export interface KitDeltas { runningW: number; surgeW: number; requiredWh: number; runtimeH: number }

const runtime = (r: SizingResult) => (r.empty || !r.battery ? 0 : Math.round(r.battery.hoursActual))

export function kitDeltas(before: SizingResult, after: SizingResult): KitDeltas {
  return {
    runningW: after.runningW - before.runningW,
    surgeW: after.surgeW - before.surgeW,
    requiredWh: after.requiredWh - before.requiredWh,
    runtimeH: runtime(after) - runtime(before),
  }
}

export function hasDeltas(d: KitDeltas): boolean {
  return d.runningW !== 0 || d.surgeW !== 0 || d.requiredWh !== 0 || d.runtimeH !== 0
}
