import { SIZING, type Chemistry, type Voltage } from '../catalog'
import type { RuntimeScenarios, SelectedItem } from './types'

export interface RuntimeContext {
  chem: Chemistry
  items: readonly SelectedItem[]
  hours: number
  loadWh: number
  runningW: number
  volts: Voltage
}

export interface BankForRuntime { bankWh: number; bankAh: number; bankContinuousA: number }


/**
 * Energy over the window with every cycling or momentary duty scaled; continuous loads do not move. No floor here:
 * a barrier's 3% stays 3%, the override floor lives in effectiveDuty.
 */
export function scenarioLoadWh(items: readonly SelectedItem[], hours: number, dutyFactor: number): number {
  return items.reduce((sum, i) => {
    const duty = i.kind === 'continuous' ? i.effectiveDuty : Math.min(1, i.effectiveDuty * dutyFactor)
    return sum + i.watts * duty * hours * i.qty
  }, 0)
}

/**
 * Capacity available at this discharge current relative to the rated hour rate (Peukert); 1 when the chemistry is
 * flat or the draw is below the rated rate. Only ever a loss, so the hard day never outlasts the typical one.
 */
export function peukertFactor(chem: Chemistry, bankAh: number, dischargeA: number): number {
  if (chem.peukertK <= 1 || dischargeA <= 0 || bankAh <= 0) return 1
  const ratedA = bankAh / chem.ratedHours
  return Math.min(1, (ratedA / dischargeA) ** (chem.peukertK - 1))
}

function hoursFor(bank: BankForRuntime, ctx: RuntimeContext, loadWh: number, eff: number, withPeukert: boolean): number {
  if (loadWh <= 0) return 0
  const avgW = loadWh / ctx.hours
  const factor = withPeukert ? peukertFactor(ctx.chem, bank.bankAh, avgW / ctx.volts / eff) : 1
  return (bank.bankWh * ctx.chem.dod * eff * factor) / avgW
}

/**
 * How long the bank lasts on a light day, a typical one and a hard one. Typical is the headline figure; worst case
 * runs every cycling load harder at a lower efficiency, counts lead-acid capacity loss at high current, and is 0
 * when the bank cannot feed the full running load at all.
 */
export function runtimeScenarios(bank: BankForRuntime, ctx: RuntimeContext): RuntimeScenarios {
  if (ctx.loadWh <= 0) return { optimistic: 0, typical: 0, worst: 0, worstLimitedByDischarge: false }
  const { optimistic, worst } = SIZING.SCENARIO
  const worstDemandA = ctx.runningW / ctx.volts / worst.eff
  const worstLimitedByDischarge = worstDemandA > bank.bankContinuousA
  return {
    optimistic: hoursFor(bank, ctx, scenarioLoadWh(ctx.items, ctx.hours, optimistic.duty), optimistic.eff, false),
    typical: hoursFor(bank, ctx, ctx.loadWh, SIZING.INVERTER_EFF, false),
    worst: worstLimitedByDischarge ? 0 : hoursFor(bank, ctx, scenarioLoadWh(ctx.items, ctx.hours, worst.duty), worst.eff, true),
    worstLimitedByDischarge,
  }
}
