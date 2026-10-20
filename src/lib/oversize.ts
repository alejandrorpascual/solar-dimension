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
  /** The bank is the smallest the kit can build at its voltage: the battery sizes make it large, not the inverter. */
  isSmallestBank: boolean
  /** The kit's own voltage; `volts` and `bankWh` are the other voltage's. */
  kitVolts: Voltage
  /** The whole inverter set's rating: a bank larger than the smallest is that size to carry the set's full current. */
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

/** True when the bank in use is the automatic pick. One picked by hand is large because the user chose it, not because of the inverter. */
const isAutoPick = (r: SizingResult): boolean => r.batteryUnit === null || r.batteryOptions.some((o) => o.isAuto && o.id === r.batteryUnit)

/** The smallest bank the kit can build at its voltage: one string of its smallest battery. */
const smallestBankWh = (r: SizingResult): number => Math.min(...r.batteryOptions.map((o) => o.unitV * o.unitAh * o.series))

/** Smallest bank first; on a tie the higher voltage, which carries the same power on less current. */
const bySmallestBank = (a: Alternative, b: Alternative): number => a.bankWh - b.bankWh || b.volts - a.volts

/**
 * The note for a bank of at least OVERSIZE_RATIO times the energy the load needs, when another voltage sizes a smaller
 * one. Either the bank is already the smallest the kit can build at its voltage, or it is larger to carry the
 * inverter's full current, so a small load still gets a bank big enough for that.
 * Only the automatic battery pick gets the note, and a need that rounds to 0 Wh gets none. Null otherwise.
 */
export function oversizeNote(project: Project, appliances: readonly CatalogItem[]): OversizeNote | null {
  const kit = computeProject(project, appliances)
  if (kit.empty || !kit.battery || !isAutoPick(kit) || kit.requiredWh <= 0) return null
  if (kit.battery.bankWh < OVERSIZE_RATIO * kit.requiredWh) return null
  const bankWh = kit.battery.bankWh
  const smallest = VOLTAGES.filter((v) => v !== kit.volts)
    .map((volts) => ({ volts, r: computeProject({ ...project, volts, batteryUnit: null }, appliances) }))
    .flatMap(({ volts, r }) => (r.battery && r.battery.bankWh < bankWh && isNoWorse(r, kit) ? [{ volts, bankWh: r.battery.bankWh }] : []))
    .sort(bySmallestBank)[0]
  if (!smallest) return null
  return {
    ratio: Math.floor(bankWh / kit.requiredWh), needWh: kit.requiredWh, isSmallestBank: bankWh <= smallestBankWh(kit), kitVolts: kit.volts,
    inverterW: kit.inverter.w, ...smallest,
  }
}
