import { SIZING, type Inverter, type Voltage } from '../catalog'
import type { InverterPick, SurgeProfile } from './types'

/** The power this inverter holds for a surge of this length: its short surge, its longer one, or only its rating. */
export function surgeRatedFor(inv: Inverter, seconds: number): number {
  if (seconds <= inv.surgeSeconds) return inv.surge
  if (inv.surgeLong && seconds <= inv.surgeLong.seconds) return inv.surgeLong.w
  return inv.w
}

/** Identical units working in parallel as one inverter; a single inverter is a set of one. */
export interface InverterSet { unit: Inverter; count: number }

const SOLO = 1

/** The set seen as one inverter: the ratings of identical units in parallel add up, the surge windows stay one unit's. */
export const asOne = ({ unit, count }: InverterSet): Inverter => ({
  ...unit, w: unit.w * count, surge: unit.surge * count,
  ...(unit.surgeLong ? { surgeLong: { w: unit.surgeLong.w * count, seconds: unit.surgeLong.seconds } } : {}),
})

/** A count of inverters as the engine uses it: a whole number of at least one. Anything that is no number counts as one. */
export const wholeUnits = (n: number): number => (Number.isFinite(n) ? Math.max(SOLO, Math.trunc(n)) : SOLO)

/** How many of this unit may work as one; a unit with no limit stated works alone. */
const maxUnits = (unit: Inverter): number => wholeUnits(unit.maxParallel ?? SOLO)

const PAIR = 2

/**
 * The fewest of this unit that carry the load and hold the start-up together, or null when its maker allows fewer.
 * Ratings add up across a set, so the count follows from each requirement over what one unit gives. A division can
 * land a hair either side of a whole number, so the count is settled with the test a single unit takes.
 */
function smallestSet(unit: Inverter, needW: number, profile: SurgeProfile, fits: (inv: Inverter) => boolean): InverterSet | null {
  const estimate = Math.max(PAIR, Math.ceil(needW / unit.w), Math.ceil(profile.surgeW / surgeRatedFor(unit, profile.seconds)))
  const count = [estimate - 1, estimate, estimate + 1].find((n) => n >= PAIR && fits(asOne({ unit, count: n })))
  return count !== undefined && count <= maxUnits(unit) ? { unit, count } : null
}

/**
 * How sets that all carry the load are ranked, best first. The fewest units: each one adds a cable pair, a fuse, a
 * link to its neighbours and its own idle draw. Then one sold for the bank voltage, then the smallest. Count comes
 * before voltage because a set sold for another voltage carries the note that sends the bank there, where fewer,
 * larger units draw less current than more small ones would at the lower voltage.
 */
const bySetPreference = (volts: Voltage) => (a: InverterSet, b: InverterSet): number =>
  a.count - b.count || Number(b.unit.volts.includes(volts)) - Number(a.unit.volts.includes(volts)) || a.unit.w - b.unit.w

const totalW = (s: InverterSet): number => s.unit.w * s.count

/** The most the list can deliver when nothing carries the load: the biggest set, built from the fewest units. */
function largestSet(inverters: readonly Inverter[]): InverterSet {
  return inverters
    .map((unit) => ({ unit, count: maxUnits(unit) }))
    .reduce((best, s) => (totalW(s) > totalW(best) || (totalW(s) === totalW(best) && s.count < best.count) ? s : best))
}

/**
 * The first inverter in the list, which is kept smallest first, with headroom over the running load that holds the
 * start-up for as long as it lasts: one sold for the bank voltage, then one sold for another. When no single unit
 * does, identical units in parallel; and when not even those do, the largest set the list can build, which the checks
 * then flag.
 */
export function pickInverter(runningW: number, profile: SurgeProfile, volts: Voltage, inverters: readonly Inverter[]): InverterSet {
  if (inverters.length === 0) throw new Error('The hardware catalog lists no inverter')
  const needW = runningW * SIZING.HEADROOM
  const fits = (inv: Inverter) => inv.w >= needW && surgeRatedFor(inv, profile.seconds) >= profile.surgeW
  const single = inverters.find((inv) => inv.volts.includes(volts) && fits(inv)) ?? inverters.find(fits)
  if (single) return { unit: single, count: SOLO }
  // More units of a model that already carries the load are never better, so each model offers its smallest set.
  const sets = inverters.flatMap((unit) => smallestSet(unit, needW, profile, fits) ?? [])
  return [...sets].sort(bySetPreference(volts))[0] ?? largestSet(inverters)
}

const PERCENT = 100
/** The headroom the engine plans for over the running load, in whole percent. */
export const HEADROOM_PCT = Math.round((SIZING.HEADROOM - 1) * PERCENT)

/**
 * Whole percent of rating left over the running load, rounded down; 0 when the load is at or past the rating. The
 * difference is multiplied before it is divided, so whole watts give an exact 20% and not 19.999…%.
 */
export const headroomPct = (inverterW: number, runningW: number): number =>
  runningW > 0 ? Math.max(0, Math.floor(((inverterW - runningW) * PERCENT) / runningW)) : HEADROOM_PCT

/** DC-side current for a given AC output at the engine's inverter efficiency. */
export const dcAmps = (watts: number, volts: Voltage): number => watts / volts / SIZING.INVERTER_EFF

/** The set as the kit reports it: every rating and current is the whole set's, with one unit's size and the count beside them. */
export function toInverterPick(set: InverterSet, profile: SurgeProfile, volts: Voltage, runningW: number): InverterPick {
  const inv = asOne(set)
  const surgeRatedW = surgeRatedFor(inv, profile.seconds)
  return {
    count: set.count, unitW: set.unit.w,
    w: inv.w, surge: inv.surge, volts: inv.volts, voltsOk: inv.volts.includes(volts),
    surgeSeconds: inv.surgeSeconds, surgeLong: inv.surgeLong ?? null,
    surgeRatedW, surgeOk: surgeRatedW >= profile.surgeW,
    runningOk: inv.w >= runningW, headroomOk: inv.w >= runningW * SIZING.HEADROOM,
    continuousA: dcAmps(inv.w, volts), surgeA: dcAmps(inv.surge, volts),
  }
}
