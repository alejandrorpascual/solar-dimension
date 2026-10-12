import { needsSplitPhase, SIZING, VOLTAGES, type Voltage } from '../catalog'
import { HEADROOM_PCT, headroomPct } from './inverter'
import type { BatteryPick, InverterPick, ParallelNote, SelectedItem, SurgeProfile, Warning } from './types'

export interface WarningContext {
  items: readonly SelectedItem[]
  inverter: InverterPick
  runningW: number
  surgeProfile: SurgeProfile
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
  const w: Warning[] = []
  if (!inv.voltsOk) {
    w.push({ code: 'inverterVoltage', params: { inverterW: inv.w, voltsList: inv.volts.join(' / ') } })
  }
  if (ctx.amps > SIZING.MAX_PRACTICAL_AMPS) {
    w.push({ code: 'highCurrent', params: { amps: Math.round(ctx.amps), volts: ctx.volts, nextVolts: VOLTAGES.find((v) => v > ctx.volts) ?? null } })
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
  // pickInverter falls back to the largest inverter when none fits: say so instead of printing it as if it did.
  if (!inv.headroomOk) {
    w.push({ code: 'inverterUndersized', params: { inverterW: inv.w, runningW: ctx.runningW, headroomPct: headroomPct(inv.w, ctx.runningW), needPct: HEADROOM_PCT } })
  }
  if (!inv.surgeOk) {
    w.push({ code: 'surgeDuration', params: { surgeW: ctx.surgeProfile.surgeW, seconds: ctx.surgeProfile.seconds, ratedW: inv.surgeRatedW, inverterW: inv.w } })
  }
  if (b && !b.dischargeOk) {
    w.push({ code: 'bankDischarge', params: { unitLabel: b.unitLabel, needA: Math.round(inv.continuousA), maxA: b.bankContinuousA, strings: b.parallel, maxParallel: b.unit.maxParallel } })
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
