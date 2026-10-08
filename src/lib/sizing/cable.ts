import { SIZING, type Fuse, type Gauge, type Voltage } from '../catalog'
import { ambientFactor, ampsAt, bundleFactor } from '../nec'
import { pickFuse } from './fuse'
import type { CableConditions, FusePick, StringCable, Warning } from './types'

/** One DC run is a positive and a negative lead: two current-carrying conductors. */
const CONDUCTORS_PER_RUN = 2
const PERCENT = 100

/** Ampacity of one run of this gauge here: the table column, corrected for air and bundling, capped at the lugs' rating. */
export function correctedAmpacity(g: Gauge, cond: CableConditions, conductors: number): number {
  const corrected = ampsAt(g, cond.insulationC) * ambientFactor(cond.ambientC, cond.insulationC) * bundleFactor(conductors)
  return Math.min(corrected, ampsAt(g, SIZING.TERMINATION_C))
}

/** Current-carrying conductors counted together: every run's pair when bundled, otherwise one run's pair. */
export const conductorsFor = (cond: CableConditions, runs: number): number =>
  cond.bundled ? CONDUCTORS_PER_RUN * runs : CONDUCTORS_PER_RUN

/** Round-trip voltage drop of one run, in percent of the bank voltage. */
const dropPct = (g: Gauge, amps: number, lengthM: number, volts: number): number =>
  ((2 * lengthM * amps * g.ohmPerM) / volts) * PERCENT

export interface MainCableSizing {
  amps: number
  perRun: number
  runs: number
  designA: number
  conductors: number
  gauge: Gauge
  ampacity: number
  dropPct: number
  startupDropPct: number
  fuse: FusePick
  warnings: Warning[]
}

export interface ProtectionContext {
  surgeSeconds: number
  bankContinuousA: number | null
  bankShortCircuitA: number | null
}

/**
 * The battery-to-inverter run, NEC style: the design current is the continuous draw plus 25%; runs split until one
 * fits the largest gauge; the gauge is the smallest whose corrected ampacity covers the design current and whose
 * drop stays under the limit; then the fuse is picked and the gauge steps up once more if the fuse needs it.
 */
export function sizeMainCable(
  amps: number, surgeAmps: number, volts: Voltage, cond: CableConditions, gauges: readonly Gauge[], fuses: readonly Fuse[],
  protection: ProtectionContext, fixedRuns?: number,
): MainCableSizing {
  const designA = amps * SIZING.NEC_CONTINUOUS
  const last = gauges.length - 1
  const top = gauges[last]!
  const sizeWithRuns = (runs: number) => {
    const conductors = conductorsFor(cond, runs)
    const perRun = amps / runs
    const ampacityAt = (gi: number) => correctedAmpacity(gauges[gi]!, cond, conductors)
    let gi = gauges.findIndex((_g, i) => ampacityAt(i) >= designA / runs)
    if (gi < 0) gi = last
    while (gi < last && dropPct(gauges[gi]!, perRun, cond.runLengthM, volts) > SIZING.MAX_DROP_PCT) gi++
    const sized = pickFuse({
      perRunA: perRun, surgePerRunA: surgeAmps / runs, surgeSeconds: protection.surgeSeconds, runs, volts,
      ampacityAt, gaugeIndex: gi, lastGaugeIndex: last,
      bankContinuousA: protection.bankContinuousA, bankShortCircuitA: protection.bankShortCircuitA, fuses,
    })
    return { runs, conductors, perRun, ampacityAt, sized }
  }
  // More runs until the design current fits the largest gauge and the fuse that protects it fits under that gauge too.
  let attempt = sizeWithRuns(fixedRuns ?? 1)
  if (fixedRuns === undefined) {
    while (attempt.runs < SIZING.MAX_RUNS && (
      designA / attempt.runs > correctedAmpacity(top, cond, conductorsFor(cond, attempt.runs)) || attempt.sized.fuse.a > attempt.ampacityAt(attempt.sized.gaugeIndex)
    )) attempt = sizeWithRuns(attempt.runs + 1)
  }
  const { runs, conductors, perRun, ampacityAt, sized } = attempt
  const g = gauges[sized.gaugeIndex]!
  const warnings = [...sized.warnings]
  if (sized.fuse.a > ampacityAt(sized.gaugeIndex)) {
    warnings.push({ code: 'fuseAboveCable', params: { fuseA: sized.fuse.a, maxA: Math.round(ampacityAt(sized.gaugeIndex)), count: runs } })
  }
  const startupDropPct = dropPct(g, surgeAmps / runs, cond.runLengthM, volts)
  if (startupDropPct > SIZING.MAX_STARTUP_DROP_PCT) {
    warnings.push({ code: 'startupDrop', params: { dropPct: Math.round(startupDropPct * 10) / 10 } })
  }
  if (ambientFactor(cond.ambientC, cond.insulationC) === 0) {
    warnings.push({ code: 'cableAmbient', params: { ambientC: cond.ambientC } })
  }
  return {
    amps, perRun, runs, designA, conductors, gauge: g, ampacity: ampacityAt(sized.gaugeIndex),
    dropPct: dropPct(g, perRun, cond.runLengthM, volts), startupDropPct, fuse: sized.fuse, warnings,
  }
}

export interface StringContext {
  bankAmps: number
  bankSurgeAmps: number
  parallel: number
  volts: Voltage
  cond: CableConditions
  gauges: readonly Gauge[]
  fuses: readonly Fuse[]
  surgeSeconds: number
  unitContinuousA: number
  unitShortCircuitA: number
}

/** The lead from each parallel string to the bus: its share of the current over a short run, with its own fuse. */
export function sizeStringCable(ctx: StringContext): StringCable {
  const amps = ctx.bankAmps / ctx.parallel
  const sized = sizeMainCable(
    amps, ctx.bankSurgeAmps / ctx.parallel, ctx.volts, { ...ctx.cond, runLengthM: SIZING.LINK_LENGTH_M, bundled: false }, ctx.gauges, ctx.fuses,
    { surgeSeconds: ctx.surgeSeconds, bankContinuousA: ctx.unitContinuousA, bankShortCircuitA: ctx.unitShortCircuitA }, 1,
  )
  return {
    amps: Math.round(amps), designA: Math.round(sized.designA), gauge: sized.gauge.awg, mm2: sized.gauge.mm2,
    ampacity: Math.round(sized.ampacity), lengthM: SIZING.LINK_LENGTH_M, dropPct: Math.round(sized.dropPct * 10) / 10,
    fuse: { ...sized.fuse, count: ctx.parallel }, count: ctx.parallel, warnings: sized.warnings,
  }
}
