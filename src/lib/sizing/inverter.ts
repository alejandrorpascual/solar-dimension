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

/** DC-side current for a given AC output at the engine's inverter efficiency. */
export const dcAmps = (watts: number, volts: Voltage): number => watts / volts / SIZING.INVERTER_EFF

export function toInverterPick(inv: Inverter, profile: SurgeProfile, volts: Voltage): InverterPick {
  const surgeRatedW = surgeRatedFor(inv, profile.seconds)
  return {
    w: inv.w, surge: inv.surge, volts: inv.volts, voltsOk: inv.volts.includes(volts),
    surgeSeconds: inv.surgeSeconds, surgeLong: inv.surgeLong ?? null,
    surgeRatedW, surgeOk: surgeRatedW >= profile.surgeW,
    continuousA: dcAmps(inv.w, volts), surgeA: dcAmps(inv.surge, volts),
  }
}
