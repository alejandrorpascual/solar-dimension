import type { BatteryUnit, Chemistry, Voltage } from '../catalog'
import type { BatteryLimits, BatteryPick, RuntimeScenarios } from './types'

/**
 * What the inverter asks of the bank. When the wiring is being sized it also says the most one string's lead can carry
 * and the most fault current the fuses can interrupt; absent, neither limits the bank.
 */
export interface BankDemand { continuousA: number; surgeA: number; surgeSeconds: number; maxStringA?: number; maxShortCircuitA?: number }

const ONE_STRING = 1

/** Strings needed so that no string's share of the continuous current is more than its lead carries. */
function stringsForLead(demand: BankDemand): number {
  if (!demand.maxStringA || demand.maxStringA <= 0) return ONE_STRING
  return Math.max(ONE_STRING, Math.ceil(demand.continuousA / demand.maxStringA))
}

/** A bank a unit can build, before its runtime is known. */
export type BankCandidate = Omit<BatteryPick, 'hoursActual' | 'runtime'> & { id: string }

export const unitId = (v: number, ah: number) => `${v}-${ah}`

function unitLimits(u: BatteryUnit, chem: Chemistry): BatteryLimits {
  return {
    maxContinuousA: u.maxContinuousA, peakA: u.peakA, peakSeconds: u.peakSeconds, maxParallel: u.maxParallel, bmsComms: u.bmsComms,
    shortCircuitA: u.shortCircuitA ?? Math.round(u.ah * chem.shortCircuitPerAh),
  }
}

/**
 * Every bank this chemistry can build at this voltage, ordered bank-voltage units first, then by capacity. Each bank
 * has enough strings for the energy, the inverter's continuous draw and its surge, unless that would exceed what the
 * unit's maker allows in parallel; then it keeps the energy count and is flagged. Strings in parallel are also kept
 * within what one lead carries, as long as the maker allows that many and the fuses could still interrupt the bank;
 * otherwise the bank keeps its strings and is marked as short on its leads.
 */
export function batteryCandidates(chem: Chemistry, volts: Voltage, requiredAh: number, demand: BankDemand): BankCandidate[] {
  return chem.units
    .filter((u) => volts % u.v === 0)
    .map((u) => {
      const unit = unitLimits(u, chem)
      const series = volts / u.v
      const parallelFor = {
        energy: Math.max(1, Math.ceil(requiredAh / u.ah)),
        continuous: Math.max(1, Math.ceil(demand.continuousA / unit.maxContinuousA)),
        peak: Math.max(1, Math.ceil(demand.surgeA / unit.peakA)),
        lead: stringsForLead(demand),
      }
      const wanted = Math.max(parallelFor.energy, parallelFor.continuous, parallelFor.peak)
      // One string has no lead of its own: it feeds the main cable, which splits into runs as it must.
      const forLeads = wanted > ONE_STRING ? Math.max(wanted, parallelFor.lead) : wanted
      const maxShortCircuitA = demand.maxShortCircuitA ?? Infinity
      // A string added for the leads' sake must not trade a short lead for a fault the fuses cannot interrupt.
      const canTakeThem = forLeads <= unit.maxParallel && forLeads * unit.shortCircuitA <= maxShortCircuitA
      const needed = canTakeThem ? forLeads : wanted
      const parallel = needed <= unit.maxParallel ? needed : parallelFor.energy
      const count = series * parallel
      const bankWh = u.v * u.ah * count
      const bankContinuousA = parallel * unit.maxContinuousA
      const bankPeakA = parallel * unit.peakA
      const bankShortCircuitA = parallel * unit.shortCircuitA
      return {
        id: unitId(u.v, u.ah),
        unitLabel: `${u.v} V ${u.ah} Ah ${chem.short}`, unitV: u.v, unitAh: u.ah, unitWh: u.v * u.ah,
        series, parallel, count, config: `${series}S${parallel}P`,
        bankWh, usableWh: Math.round(bankWh * chem.dod), bankAh: u.ah * parallel,
        unit, bankContinuousA, bankPeakA, bankShortCircuitA, parallelFor,
        dischargeOk: bankContinuousA >= demand.continuousA,
        peakOk: bankPeakA >= demand.surgeA && unit.peakSeconds >= demand.surgeSeconds,
        overMaxParallel: parallel > unit.maxParallel,
        leadOk: parallel === ONE_STRING || parallel >= parallelFor.lead,
        interruptOk: bankShortCircuitA <= maxShortCircuitA,
      }
    })
    .sort((a, b) => b.unitV - a.unitV || a.unitAh - b.unitAh)
}

/** What the automatic pick reads of a bank: whether it can feed the inverter, and what its wiring would fail. */
type BankHealth = Pick<BankCandidate, 'dischargeOk' | 'peakOk' | 'overMaxParallel' | 'leadOk' | 'interruptOk' | 'count' | 'bankWh'>

const feedsInverter = (c: BankHealth): boolean => c.dischargeOk && c.peakOk && !c.overMaxParallel
/** How many of its wiring checks a bank fails: strings too heavy for their leads, a fault its fuses cannot interrupt. */
const wiringFaults = (c: BankHealth): number => Number(!c.leadOk) + Number(!c.interruptOk)

/**
 * The automatic pick. A bank that can feed the inverter comes before one that cannot. Among those that can, the one
 * whose wiring fails the fewest checks; then the fewest batteries; then the smallest bank. Among those that cannot,
 * the wiring settles nothing: tidy leads do not make a bank worth having.
 */
export function autoPick<T extends BankHealth>(candidates: readonly T[]): T | null {
  const faults = (c: T): number => (feedsInverter(c) ? wiringFaults(c) : 0)
  const byPreference = (a: T, b: T): number =>
    Number(feedsInverter(b)) - Number(feedsInverter(a)) || faults(a) - faults(b) || a.count - b.count || a.bankWh - b.bankWh
  return [...candidates].sort(byPreference)[0] ?? null
}

/** Strip the candidate id and attach how long this bank runs the load. */
export function toBatteryPick(candidate: BankCandidate, runtime: RuntimeScenarios): BatteryPick {
  const { id: _id, ...pick } = candidate
  return { ...pick, hoursActual: runtime.typical, runtime }
}
