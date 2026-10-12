import { SIZING, type Fuse, type Gauge, type Voltage } from '../catalog'
import { ambientFactor, ampsAt, bundleFactor } from '../nec'
import { pickFuse } from './fuse'
import type { BatteryPick, CableConditions, ConductorKind, FusePick, LinkCable, StringCable, Warning } from './types'

/** One DC run is a positive and a negative lead: two current-carrying conductors. */
const CONDUCTORS_PER_RUN = 2
/** A string reaches the bus bars on a positive lead, through its fuse, and a negative one. */
const LEADS_PER_STRING = 2
const PERCENT = 100
const TENTHS = 10
/** Currents are compared and rounded as whole micro-amps, so float noise in a table factor (230 × 0.58 = 133.39999999999998) changes neither the verdict nor the printed tenth. */
const MICRO_PER_AMP = 1_000_000
const MICRO_PER_TENTH = MICRO_PER_AMP / TENTHS
const microAmps = (amps: number): number => Math.round(amps * MICRO_PER_AMP)

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
    // No gauge covers it: the largest goes out as it is, and `undersized` is what says so for the row that prints it.
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

/** The bank's layout and one unit's limits: all the wiring needs to know about the batteries. */
export type BankLayout = Pick<BatteryPick, 'series' | 'parallel' | 'unit'>

export interface BankWiringContext {
  /** Null when no bank could be picked. */
  battery: BankLayout | null
  /** The main cable as sized for `bankAmps` under `cond`: a one-string bank's links copy it. */
  main: MainCableSizing
  bankAmps: number
  bankSurgeAmps: number
  volts: Voltage
  cond: CableConditions
  gauges: readonly Gauge[]
  fuses: readonly Fuse[]
  surgeSeconds: number
}

/** `warnings` is the whole list for the bank's wiring: it already holds `string.warnings`, so spread only one of the two. */
export interface BankWiring { links: LinkCable | null; string: StringCable | null; warnings: Warning[] }

/** Links and string leads are short and in open air: the ambient correction applies, bundling and the main run's length do not. */
const jumperConditions = (cond: CableConditions): CableConditions => ({ ...cond, runLengthM: SIZING.LINK_LENGTH_M, bundled: false })

/**
 * The cable check's warning for a printed row whose conductors may each carry less, after derating, than the current
 * each is sized for. `ampacity` defaults to the sizing's own; a caller whose row uses that gauge under other conditions
 * (the links: unbundled) supplies that row's ampacity. Both currents go out to a tenth of an amp, the ampacity rounded
 * down and the design current rounded up, so the two never print alike. A row that may carry nothing says nothing
 * here: that is air too hot for the insulation, which `cableAmbient` already reports.
 */
export function undersized(conductor: ConductorKind, sized: MainCableSizing, ampacity = sized.ampacity): Warning[] {
  const carries = microAmps(ampacity)
  const needs = microAmps(sized.designA / sized.runs)
  if (carries === 0 || carries >= needs) return []
  const maxA = Math.floor(carries / MICRO_PER_TENTH) / TENTHS
  const needA = Math.ceil(needs / MICRO_PER_TENTH) / TENTHS
  return [{ code: 'cableUndersized', params: { conductor, gauge: sized.gauge.awg, maxA, needA } }]
}

/** One string's lead: its share of the current on one short run that is never split, with a fuse checked against one unit's limits. */
const sizeStringRun = (ctx: BankWiringContext, battery: BankLayout): MainCableSizing =>
  sizeMainCable(
    ctx.bankAmps / battery.parallel, ctx.bankSurgeAmps / battery.parallel, ctx.volts, jumperConditions(ctx.cond), ctx.gauges, ctx.fuses,
    { surgeSeconds: ctx.surgeSeconds, bankContinuousA: battery.unit.maxContinuousA, bankShortCircuitA: battery.unit.shortCircuitA }, 1,
  )

const toStringCable = (sized: MainCableSizing, parallel: number): StringCable => ({
  amps: Math.round(sized.amps), designA: Math.round(sized.designA), gauge: sized.gauge.awg, mm2: sized.gauge.mm2,
  ampacity: Math.round(sized.ampacity), lengthM: SIZING.LINK_LENGTH_M, dropPct: Math.round(sized.dropPct * TENTHS) / TENTHS,
  fuse: { ...sized.fuse, count: parallel }, leads: LEADS_PER_STRING * parallel,
  warnings: [...sized.warnings, ...undersized('stringLeads', sized)],
})

/**
 * A series link carries its whole string's current, so it copies the conductor that string feeds: the string lead when
 * strings are in parallel, otherwise the main cable, with one jumper per main run at every link.
 */
function sizeLinks(feeds: MainCableSizing, battery: BankLayout, cond: CableConditions): { links: LinkCable; warnings: Warning[] } {
  const ampacity = correctedAmpacity(feeds.gauge, jumperConditions(cond), CONDUCTORS_PER_RUN)
  const positions = (battery.series - 1) * battery.parallel
  return {
    links: {
      positions, perPosition: feeds.runs, count: positions * feeds.runs, gauge: feeds.gauge.awg, mm2: feeds.gauge.mm2,
      designA: Math.round(feeds.designA / feeds.runs), ampacity: Math.round(ampacity), lengthM: SIZING.LINK_LENGTH_M,
    },
    warnings: undersized('interconnects', feeds, ampacity),
  }
}

/** The cables between the battery terminals and the main run: series links, and a fused lead pair to the bus bars for each parallel string. */
export function sizeBankWiring(ctx: BankWiringContext): BankWiring {
  const { battery, main } = ctx
  if (!battery) return { links: null, string: null, warnings: [] }
  const stringRun = battery.parallel > 1 ? sizeStringRun(ctx, battery) : null
  const string = stringRun ? toStringCable(stringRun, battery.parallel) : null
  const linked = battery.series > 1 ? sizeLinks(stringRun ?? main, battery, ctx.cond) : null
  return { links: linked?.links ?? null, string, warnings: [...(string?.warnings ?? []), ...(linked?.warnings ?? [])] }
}
