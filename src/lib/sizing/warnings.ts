import { needsSplitPhase, SIZING, VOLTAGES, type Voltage } from '../catalog'
import { HEADROOM_PCT, headroomPct } from './inverter'
import type { BatteryPick, InverterNote, InverterPick, ParallelNote, SelectedItem, SurgeProfile, Warning, WarningParams } from './types'

export interface WarningContext {
  items: readonly SelectedItem[]
  inverter: InverterPick
  runningW: number
  surgeProfile: SurgeProfile
  /** DC current of the whole inverter set at full output. */
  amps: number
  volts: Voltage
  battery: BatteryPick | null
  loadWh: number
  /** Warnings the cable and fuse sizing already raised, in their own order. */
  protection: readonly Warning[]
  missing: number
  /** DC current at the configured start-up. */
  startupA: number
}

/** The order codes appear in: the original five first, then the engineering checks, then the catalog note. */
export function buildWarnings(ctx: WarningContext): Warning[] {
  const missing: Warning[] = ctx.missing > 0 ? [{ code: 'missingAppliances', params: { count: ctx.missing } }] : []
  if (ctx.items.length === 0) return missing
  const { inverter: inv, battery: b } = ctx
  // The whole set's rating, with its size beside it so the wording can name "3 × 8,000 W" when there is more than one.
  const set = { inverterW: inv.w, inverters: inv.count, unitW: inv.unitW }
  const w: Warning[] = []
  if (!inv.voltsOk) {
    w.push({ code: 'inverterVoltage', params: { unitW: inv.unitW, voltsList: inv.volts.join(' / ') } })
  }
  const nextVolts = VOLTAGES.find((v) => v > ctx.volts) ?? null
  // Below the top bank voltage the whole DC side counts: a higher voltage would carry it on less current. At the top
  // there is none to suggest, so what counts is what one inverter's cables and fuse are asked for.
  const isPerInverter = nextVolts === null
  const amps = isPerInverter ? ctx.amps / inv.count : ctx.amps
  if (amps > SIZING.MAX_PRACTICAL_AMPS) {
    w.push({ code: 'highCurrent', params: { amps: Math.round(amps), volts: ctx.volts, nextVolts, ...(isPerInverter ? { inverters: inv.count } : {}) } })
  }
  if (b?.overMaxParallel) {
    w.push({ code: 'parallelStrings', params: { strings: b.parallel, maxParallel: b.unit.maxParallel, unitLabel: b.unitLabel } })
  }
  const dominant = ctx.items.find((i) => ctx.loadWh > 0 && i.wh / ctx.loadWh > SIZING.DOMINANT_SHARE)
  if (dominant) {
    w.push({ code: 'dominantLoad', params: { itemId: dominant.id, itemName: dominant.name, sharePct: Math.round((dominant.wh / ctx.loadWh) * 100) } })
  }
  const heavy = ctx.items.find(needsSplitPhase)
  if (heavy) {
    w.push({ code: 'splitPhase', params: { itemId: heavy.id, itemName: heavy.name } })
  }
  // pickInverter falls back to the largest set the list can build when none fits: say so instead of printing it as if it did.
  if (!inv.headroomOk) {
    w.push({ code: 'inverterUndersized', params: { ...set, runningW: ctx.runningW, headroomPct: headroomPct(inv.w, ctx.runningW), needPct: HEADROOM_PCT } })
  }
  if (!inv.surgeOk) {
    w.push({ code: 'surgeDuration', params: { ...set, surgeW: ctx.surgeProfile.surgeW, seconds: ctx.surgeProfile.seconds, ratedW: inv.surgeRatedW } })
  }
  if (b && !b.dischargeOk) {
    w.push({ code: 'bankDischarge', params: { unitLabel: b.unitLabel, needA: Math.round(inv.continuousA), maxA: b.bankContinuousA, strings: b.parallel, maxParallel: b.unit.maxParallel, inverters: inv.count } })
  }
  if (b && !b.peakOk) {
    w.push({ code: 'bankPeak', params: { unitLabel: b.unitLabel, needA: Math.round(ctx.startupA), maxA: b.bankPeakA, seconds: ctx.surgeProfile.seconds } })
  }
  return [...w, ...ctx.protection, ...missing]
}

/** What a bank with parallel strings needs on the install sheet. */
export function parallelNotes(battery: BatteryPick | null): ParallelNote[] {
  if (!battery || battery.parallel <= 1) return []
  return ['sameModelAge', 'equalLeadsOrBusbar', 'stringFuses', ...(battery.unit.bmsComms !== 'none' ? ['bmsComms' as const] : [])]
}

/** Whether a warning is about inverters working in parallel, which its wording then names as a set. */
export const isInverterSet = (p: WarningParams): boolean => (p.inverters ?? 1) > 1

/** What inverters working in parallel need on the install sheet. */
export function inverterNotes(inverter: InverterPick): InverterNote[] {
  return inverter.count > 1 ? ['builtForParallel', 'ownRunAndFuse'] : []
}
