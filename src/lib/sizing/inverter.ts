import { SIZING, type Inverter, type Voltage } from '../catalog'
import type { InverterPick, SurgeProfile } from './types'

/** The power this inverter holds for a surge of this length: its short surge, its longer one, or only its rating. */
export function surgeRatedFor(inv: Inverter, seconds: number): number {
  if (seconds <= inv.surgeSeconds) return inv.surge
  if (inv.surgeLong && seconds <= inv.surgeLong.seconds) return inv.surgeLong.w
  return inv.w
}

/** The smallest inverter with headroom over the running load that holds the start-up for as long as it lasts. */
export function pickInverter(runningW: number, profile: SurgeProfile, volts: Voltage, inverters: readonly Inverter[]): Inverter {
  const needW = runningW * SIZING.HEADROOM
  const fits = (inv: Inverter) => inv.w >= needW && surgeRatedFor(inv, profile.seconds) >= profile.surgeW
  return (
    inverters.find((inv) => inv.volts.includes(volts) && fits(inv)) ??
    inverters.find(fits) ??
    inverters[inverters.length - 1]!
  )
}

const PERCENT = 100
/** The headroom the engine plans for over the running load, in whole percent; rounded because a factor such as 1.2 gives 19.999…. */
export const HEADROOM_PCT = Math.round((SIZING.HEADROOM - 1) * PERCENT)

/**
 * The spare rating as a whole percent of the running load, the base SIZING.HEADROOM uses, rounded down; 0 when the
 * load is at or past the rating. The difference is taken in watts before anything is divided, so an exact fraction
 * keeps its percent: (12000 / 10000 - 1) * 100 is 19.999…, and this gives 20. With no running load there is no ratio,
 * and HEADROOM_PCT stands in so the result never reads as short.
 */
export const headroomPct = (inverterW: number, runningW: number): number =>
  runningW > 0 ? Math.max(0, Math.floor(((inverterW - runningW) * PERCENT) / runningW)) : HEADROOM_PCT

/** DC-side current for a given AC output at the engine's inverter efficiency. */
export const dcAmps = (watts: number, volts: Voltage): number => watts / volts / SIZING.INVERTER_EFF

export function toInverterPick(inv: Inverter, profile: SurgeProfile, volts: Voltage, runningW: number): InverterPick {
  const surgeRatedW = surgeRatedFor(inv, profile.seconds)
  return {
    w: inv.w, surge: inv.surge, volts: inv.volts, voltsOk: inv.volts.includes(volts),
    surgeSeconds: inv.surgeSeconds, surgeLong: inv.surgeLong ?? null,
    surgeRatedW, surgeOk: surgeRatedW >= profile.surgeW,
    runningOk: inv.w >= runningW, headroomOk: inv.w >= runningW * SIZING.HEADROOM,
    continuousA: dcAmps(inv.w, volts), surgeA: dcAmps(inv.surge, volts),
  }
}
