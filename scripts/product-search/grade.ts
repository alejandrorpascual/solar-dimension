import { CHEMISTRIES, VOLTAGES, type Voltage } from '../../src/lib/catalog'
import type { ProductNeeds } from './needs'
import type { BatteryFind, InverterFind, SpecValue, SurgeLevel } from './schema'

/** ok = meets the kit · fails = stated and too small or wrong · unclear = the page does not say */
export type Grade = 'ok' | 'fails' | 'unclear'
export interface Check { label: string; grade: Grade; detail: string }
export type Pairing = 'yes' | 'check' | 'no'

const check = (label: string, grade: Grade, detail: string): Check => ({ label, grade, detail })
const UNSTATED = 'not stated'

/** At least `need`; unclear when the value is not stated. */
function atLeast(label: string, spec: SpecValue, need: number, unit: string): Check {
  if (spec.value === null) return check(label, 'unclear', UNSTATED)
  return check(label, spec.value >= need ? 'ok' : 'fails', `${spec.value} ${unit} vs ${need} ${unit} needed`)
}

/** The worst grade wins: one failed check fails the product, one unknown leaves it unclear. */
export function overall(checks: readonly Check[]): Grade {
  if (checks.some((c) => c.grade === 'fails')) return 'fails'
  return checks.some((c) => c.grade === 'unclear') ? 'unclear' : 'ok'
}

type KnownLevel = SurgeLevel & { w: number; seconds: number }
const isKnown = (l: SurgeLevel): l is KnownLevel => l.w !== null && l.seconds !== null

/**
 * The watts this inverter holds for a start-up lasting `seconds`, read as the engine's surgeRatedFor does: the highest
 * level that lasts at least that long, else the continuous rating. Null when no level states both watts and duration.
 */
export function surgeRating(levels: readonly SurgeLevel[], continuousW: number | null, seconds: number): { w: number; level: KnownLevel | null } | null {
  const known = levels.filter(isKnown)
  if (known.length === 0) return null
  const lasting = known.filter((l) => l.seconds >= seconds)
  if (lasting.length === 0) return continuousW === null ? null : { w: continuousW, level: null }
  const best = lasting.reduce((a, l) => (l.w > a.w ? l : a))
  return { w: best.w, level: best }
}

function surgeCheck(inv: InverterFind, n: ProductNeeds): Check {
  const rated = surgeRating(inv.surges, inv.continuousW.value, n.surgeSeconds)
  if (rated === null) return check('surge', 'unclear', inv.surges.length > 0 ? 'no level states both watts and seconds' : UNSTATED)
  const from = rated.level ? `the ${rated.level.w} W / ${rated.level.seconds} s level` : 'the continuous rating'
  return check('surge', rated.w >= n.surgeW ? 'ok' : 'fails', `${rated.w} W for ${n.surgeSeconds} s from ${from} vs ${n.surgeW} W needed`)
}

export function gradeInverter(inv: InverterFind, n: ProductNeeds): Check[] {
  const volts = inv.batteryVolts.value
  const checks = [
    atLeast('continuous', inv.continuousW, n.inverterW, 'W'),
    surgeCheck(inv, n),
    volts === null
      ? check('battery V', 'unclear', UNSTATED)
      : check('battery V', volts === n.volts ? 'ok' : 'fails', `${volts} V vs ${n.volts} V bank`),
  ]
  if (n.splitPhase) {
    const sp = inv.splitPhase.value
    checks.push(check('split-phase', sp === null ? 'unclear' : sp ? 'ok' : 'fails', sp === null ? UNSTATED : String(sp)))
  }
  if (n.arrayW !== null) checks.push(atLeast('solar input', inv.pvInputW, n.arrayW, 'W'))
  return checks
}

/** Watt-hours of one unit: its kWh, or volts × Ah. */
const unitWh = (b: BatteryFind): number | null =>
  b.kWh.value !== null ? b.kWh.value * 1000 : b.nominalV.value !== null && b.ah.value !== null ? b.nominalV.value * b.ah.value : null

/** How far a datasheet's nominal voltage may sit from the system voltage it is sold as. */
const SYSTEM_V_TOLERANCE = 0.1
/**
 * The system voltage a unit is sold as. Datasheets give the cell math (16 LiFePO₄ cells × 3.2 V = 51.2 V) for what the
 * market, and this app's catalog, call a 48 V battery; 12.8 V and 25.6 V likewise mean 12 V and 24 V.
 */
export function systemVolts(nominalV: number): Voltage | null {
  return VOLTAGES.find((v) => Math.abs(nominalV - v) / v <= SYSTEM_V_TOLERANCE) ?? null
}

export interface BatteryBank { series: number; strings: number; units: number }

/** The bank this unit builds: units in series to reach the bank voltage, strings for energy and for current. */
export function bankFor(b: BatteryFind, n: ProductNeeds): BatteryBank | null {
  const v = b.nominalV.value === null ? null : systemVolts(b.nominalV.value)
  const wh = unitWh(b)
  if (v === null || wh === null || n.volts % v !== 0) return null
  const series = n.volts / v
  const dod = CHEMISTRIES[n.chemistry].dod
  const forEnergy = Math.ceil(n.usableWh / (wh * series * dod))
  const forCurrent = b.maxContinuousA.value ? Math.ceil(n.dcA / b.maxContinuousA.value) : 1
  const strings = Math.max(forEnergy, forCurrent)
  return { series, strings, units: series * strings }
}

export function gradeBattery(b: BatteryFind, n: ProductNeeds): { checks: Check[]; bank: BatteryBank | null } {
  const bank = bankFor(b, n)
  const chem = b.chemistry
  const v = b.nominalV.value
  const sysV = v === null ? null : systemVolts(v)
  const wh = unitWh(b)
  const maxP = b.maxParallel.value
  const checks = [
    check('chemistry', chem === null ? 'unclear' : chem === n.chemistry ? 'ok' : 'fails', chem ?? UNSTATED),
    v === null
      ? check('unit V', 'unclear', UNSTATED)
      : check('unit V', sysV !== null && n.volts % sysV === 0 ? 'ok' : 'fails', `${v} V (${sysV ?? '?'} V class) into a ${n.volts} V bank`),
    wh === null ? check('capacity', 'unclear', UNSTATED) : check('capacity', 'ok', `${(wh / 1000).toFixed(2)} kWh per unit`),
    b.maxContinuousA.value === null
      ? check('discharge', 'unclear', UNSTATED)
      : check('discharge', 'ok', `${b.maxContinuousA.value} A per string, ${n.dcA} A needed`),
    bank === null || maxP === null
      ? check('parallel', 'unclear', maxP === null ? 'parallel limit not stated' : 'bank not computable')
      : check('parallel', bank.strings <= maxP ? 'ok' : 'fails', `${bank.strings} strings, maker allows ${maxP}`),
  ]
  return { checks, bank }
}

/**
 * Whether this inverter and battery work together in this kit.
 *
 * yes   = you would sell them as a pair without asking anyone
 * check = plausible, but the installer must confirm with the seller (e.g. closed-loop comms not listed)
 * no    = they cannot work together in this kit
 *
 * Inputs you can use: inv.batteryVolts, bat.nominalV, bat.chemistry, inv.bmsComms / bat.bmsComms (['can', 'rs485']),
 * inv.compatibleBatteryBrands, bat.compatibleInverterBrands, inv.brand, bat.brand, and n.volts / n.chemistry.
 */
export function pairStatus(inv: InverterFind, bat: BatteryFind, n: ProductNeeds): Pairing {
  // TODO(you): the pairing rule. Until it is written, every pair reads as "check".
  void inv
  void bat
  void n
  return 'check'
}

export interface SpecShare { stated: number; sourced: number; fromDatasheet: number; total: number }

/** How many of a product's specs are stated, how many came with a source page, and how many from its datasheet. */
export function sourcedShare(specs: readonly SpecValue[], datasheetUrl: string | null): SpecShare {
  const stated = specs.filter((s) => s.value !== null)
  return {
    stated: stated.length,
    sourced: stated.filter((s) => s.source !== null).length,
    fromDatasheet: datasheetUrl === null ? 0 : stated.filter((s) => s.source === datasheetUrl).length,
    total: specs.length,
  }
}
