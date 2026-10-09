import type { Gauge, InsulationC } from './catalog'

/**
 * NEC ampacity corrections for copper conductors. The tables in 310.16 assume 30 °C air and at most three
 * current-carrying conductors together; hotter air and bundling both lower what a conductor may carry.
 */

/** 310.15(B)(1): correction by ambient temperature, for the 75 °C and 90 °C columns. Rows end at `maxC` inclusive. */
export interface AmbientRow { maxC: number; f75: number; f90: number }
export const AMBIENT_CORRECTION: readonly AmbientRow[] = [
  { maxC: 10, f75: 1.2, f90: 1.15 },
  { maxC: 15, f75: 1.15, f90: 1.12 },
  { maxC: 20, f75: 1.11, f90: 1.08 },
  { maxC: 25, f75: 1.05, f90: 1.04 },
  { maxC: 30, f75: 1, f90: 1 },
  { maxC: 35, f75: 0.94, f90: 0.96 },
  { maxC: 40, f75: 0.88, f90: 0.91 },
  { maxC: 45, f75: 0.82, f90: 0.87 },
  { maxC: 50, f75: 0.75, f90: 0.82 },
  { maxC: 55, f75: 0.67, f90: 0.76 },
  { maxC: 60, f75: 0.58, f90: 0.71 },
  { maxC: 65, f75: 0.47, f90: 0.65 },
  { maxC: 70, f75: 0.33, f90: 0.58 },
  { maxC: 75, f75: 0, f90: 0.5 },
  { maxC: 80, f75: 0, f90: 0.41 },
  { maxC: 85, f75: 0, f90: 0.29 },
]

/** 310.15(C)(1): adjustment for more than three current-carrying conductors bundled or in one raceway. */
export interface BundleRow { minConductors: number; factor: number }
export const BUNDLE_ADJUSTMENT: readonly BundleRow[] = [
  { minConductors: 4, factor: 0.8 },
  { minConductors: 7, factor: 0.7 },
  { minConductors: 10, factor: 0.5 },
  { minConductors: 21, factor: 0.45 },
  { minConductors: 31, factor: 0.4 },
  { minConductors: 41, factor: 0.35 },
]

/** The ambient factor for a column; 0 when the air is hotter than the insulation can be used in. */
export function ambientFactor(ambientC: number, insulationC: InsulationC): number {
  const row = AMBIENT_CORRECTION.find((r) => ambientC <= r.maxC)
  if (!row) return 0
  return insulationC === 75 ? row.f75 : row.f90
}

/** The bundling factor for this many current-carrying conductors together; 1 for three or fewer. */
export function bundleFactor(currentCarrying: number): number {
  const rows = BUNDLE_ADJUSTMENT.filter((r) => currentCarrying >= r.minConductors)
  return rows.length > 0 ? rows[rows.length - 1]!.factor : 1
}

/** A gauge's table ampacity in the given column. */
export function ampsAt(g: Gauge, insulationC: InsulationC): number {
  return insulationC === 75 ? g.amps75 : g.amps90
}
