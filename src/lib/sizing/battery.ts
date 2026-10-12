import type { BatteryUnit, Chemistry, Voltage } from '../catalog'
import type { BatteryLimits, BatteryPick, RuntimeScenarios } from './types'

/** What the inverter asks of the bank, and the most one string's lead can carry to it when the wiring is being sized. */
export interface BankDemand { continuousA: number; surgeA: number; surgeSeconds: number; maxStringA?: number }

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
 * within what one lead carries, as far as the maker's limit allows.
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
      const wired = wanted > ONE_STRING ? Math.max(wanted, parallelFor.lead) : wanted
      const needed = wired <= unit.maxParallel ? wired : wanted
      const parallel = needed <= unit.maxParallel ? needed : parallelFor.energy
      const count = series * parallel
      const bankWh = u.v * u.ah * count
      const bankContinuousA = parallel * unit.maxContinuousA
      const bankPeakA = parallel * unit.peakA
      return {
        id: unitId(u.v, u.ah),
        unitLabel: `${u.v} V ${u.ah} Ah ${chem.short}`, unitV: u.v, unitAh: u.ah, unitWh: u.v * u.ah,
        series, parallel, count, config: `${series}S${parallel}P`,
        bankWh, usableWh: Math.round(bankWh * chem.dod), bankAh: u.ah * parallel,
        unit, bankContinuousA, bankPeakA, bankShortCircuitA: parallel * unit.shortCircuitA, parallelFor,
        dischargeOk: bankContinuousA >= demand.continuousA,
        peakOk: bankPeakA >= demand.surgeA && unit.peakSeconds >= demand.surgeSeconds,
        overMaxParallel: parallel > unit.maxParallel,
      }
    })
    .sort((a, b) => b.unitV - a.unitV || a.unitAh - b.unitAh)
}

const isHealthy = (c: BankCandidate) => c.dischargeOk && c.peakOk && !c.overMaxParallel

/** The automatic pick: among banks that pass every check, the fewest batteries, then the smallest bank. */
export function autoPick(candidates: readonly BankCandidate[]): BankCandidate | null {
  const healthy = candidates.filter(isHealthy)
  const pool = healthy.length > 0 ? healthy : candidates
  return [...pool].sort((a, b) => a.count - b.count || a.bankWh - b.bankWh)[0] ?? null
}

/** Strip the candidate id and attach how long this bank runs the load. */
export function toBatteryPick(candidate: BankCandidate, runtime: RuntimeScenarios): BatteryPick {
  const { id: _id, ...pick } = candidate
  return { ...pick, hoursActual: runtime.typical, runtime }
}
