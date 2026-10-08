import { SIZING, type Fuse, type Voltage } from '../catalog'
import type { FusePick, Warning } from './types'

export interface FuseContext {
  /** Continuous and surge current through one fuse (per run). */
  perRunA: number
  surgePerRunA: number
  surgeSeconds: number
  /** How many fuses carry the circuit together; their ratings add up against the bank. */
  runs: number
  volts: Voltage
  /** Corrected ampacity of the gauge at each index, and where the search starts. */
  ampacityAt: (gaugeIndex: number) => number
  gaugeIndex: number
  lastGaugeIndex: number
  /** What the bank behind this fuse can deliver; null when there is no bank. */
  bankContinuousA: number | null
  bankShortCircuitA: number | null
  fuses: readonly Fuse[]
}

export interface FuseSizing { fuse: FusePick; gaugeIndex: number; warnings: Warning[] }

/**
 * The fuse that protects the cable: a standard rating at least the NEC continuous factor over the running current,
 * never above the cable's corrected ampacity (the gauge steps up until it fits). Then three checks against what the
 * bank and the start-up do to it.
 */
export function pickFuse(ctx: FuseContext): FuseSizing {
  const minA = ctx.perRunA * SIZING.NEC_CONTINUOUS
  const usable = ctx.fuses.filter((f) => f.maxVdc >= ctx.volts * SIZING.FUSE_VOLTAGE_MARGIN)
  const pool = usable.length > 0 ? usable : ctx.fuses
  const fuse = pool.find((f) => f.a >= minA) ?? pool[pool.length - 1]!
  let gi = ctx.gaugeIndex
  while (gi < ctx.lastGaugeIndex && fuse.a > ctx.ampacityAt(gi)) gi++

  const warnings: Warning[] = []
  // The bank is the weak link when the fuse is bigger than the one the bank's own continuous current would get.
  if (ctx.bankContinuousA !== null) {
    const bankMinA = (ctx.bankContinuousA / ctx.runs) * SIZING.NEC_CONTINUOUS
    const bankFuseA = pool.find((f) => f.a >= bankMinA)?.a ?? pool[pool.length - 1]!.a
    if (fuse.a > bankFuseA) warnings.push({ code: 'fuseAboveBank', params: { fuseA: fuse.a, maxA: ctx.bankContinuousA } })
  }
  const hold = SIZING.FUSE_SURGE_HOLD[fuse.class]
  const ratio = ctx.surgePerRunA / fuse.a
  if (ctx.surgeSeconds > 0 && (ratio > hold.factor || (ratio > 1 && ctx.surgeSeconds > hold.seconds))) {
    warnings.push({ code: 'fuseSurge', params: { fuseA: fuse.a, surgeA: Math.round(ctx.surgePerRunA), seconds: ctx.surgeSeconds } })
  }
  if (ctx.bankShortCircuitA !== null && ctx.bankShortCircuitA > fuse.aicA) {
    warnings.push({ code: 'fuseInterrupt', params: { shortCircuitA: ctx.bankShortCircuitA, aicA: fuse.aicA } })
  }
  return { fuse: { ...fuse, count: ctx.runs }, gaugeIndex: gi, warnings }
}
