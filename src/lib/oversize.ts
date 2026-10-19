import { VOLTAGES, type CatalogItem, type Voltage } from './catalog'
import { computeProject } from './project-summary'
import type { Project } from './schema'
import type { SizingResult } from './sizing'

/** A bank that holds at least this many times the energy the load needs is oversized. */
export const OVERSIZE_RATIO = 3

/** Why a small load gets a large bank, and the voltage that would size the smallest one. */
export interface OversizeNote {
  /** Whole times the bank holds the energy the load needs, rounded down. */
  ratio: number
  needWh: number
  /** The whole inverter set's rating: the bank has to carry its full current. */
  inverterW: number
  volts: Voltage
  bankWh: number
}

interface Alternative { volts: Voltage; bankWh: number }

/** True when `other` raises no warning `kit` does not: a smaller bank that fails a check this kit passes is no answer. */
const isNoWorse = (other: SizingResult, kit: SizingResult): boolean => {
  const codes = new Set(kit.warnings.map((w) => w.code))
  return other.warnings.every((w) => codes.has(w.code))
}

/** Smallest bank first; on a tie the higher voltage, which carries the same power on less current. */
const bySmallestBank = (a: Alternative, b: Alternative): number => a.bankWh - b.bankWh || b.volts - a.volts

/**
 * The note for a bank of at least OVERSIZE_RATIO times the energy the load needs, when another voltage sizes a smaller
 * one: the bank has to carry the inverter's full current, so a small load still gets a bank big enough for that.
 * The kit is measured with its own battery pick; the other voltages with their automatic one. Null otherwise.
 */
export function oversizeNote(project: Project, appliances: readonly CatalogItem[]): OversizeNote | null {
  const kit = computeProject(project, appliances)
  if (kit.empty || !kit.battery || kit.battery.bankWh < OVERSIZE_RATIO * kit.requiredWh) return null
  const bankWh = kit.battery.bankWh
  const smallest = VOLTAGES.filter((v) => v !== kit.volts)
    .map((volts) => ({ volts, r: computeProject({ ...project, volts, batteryUnit: null }, appliances) }))
    .flatMap(({ volts, r }) => (r.battery && r.battery.bankWh < bankWh && isNoWorse(r, kit) ? [{ volts, bankWh: r.battery.bankWh }] : []))
    .sort(bySmallestBank)[0]
  if (!smallest) return null
  return { ratio: Math.floor(bankWh / kit.requiredWh), needWh: kit.requiredWh, inverterW: kit.inverter.w, ...smallest }
}
