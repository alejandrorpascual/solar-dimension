import { describe, expect, test } from 'vitest'
import { CHEMISTRIES, DEFAULT_HARDWARE, INVERTERS, SIZING, VOLTAGES, type ChemistryId, type Inverter, type Voltage } from './catalog'
import { compute, type SizingResult } from './sizing'
import { unitId } from './sizing/battery'

/** NEC 210.19 / 706.30: the fuse on a continuous load is rated for at least 125% of it. */
const CONTINUOUS_FACTOR = 1.25
const MAX_DROP_PCT = 3

interface InverterSet { unit: Inverter; count: number }
interface BankUnit { chemistry: ChemistryId; id: string }

/** Every stock inverter alone, and in every parallel set its maker allows. */
const SETS: readonly InverterSet[] = INVERTERS.flatMap((unit) =>
  Array.from({ length: unit.maxParallel ?? 1 }, (_, i) => ({ unit, count: i + 1 })))

/** Every battery unit, of any chemistry, that builds a bank of this voltage. */
const unitsFor = (volts: Voltage): BankUnit[] =>
  Object.values(CHEMISTRIES).flatMap((chem) =>
    chem.units.filter((u) => volts % u.v === 0).map((u) => ({ chemistry: chem.id, id: unitId(u.v, u.ah) })))

/**
 * The kit for a load this set carries with its headroom and one unit fewer would not (half a unit past the rest), on
 * this battery, with the inverter list cut to that one model and the cable left at its defaults.
 */
function kitFor(volts: Voltage, { unit, count }: InverterSet, bank: BankUnit): SizingResult {
  // The engine's own headroom, read only to aim the load at this set.
  const watts = ((count - 0.5) * unit.w) / SIZING.HEADROOM
  return compute({
    qty: { load: 1 }, custom: [{ id: 'load', name: 'Load', watts, surge: watts, note: '' }],
    hours: 1, volts, chemistry: bank.chemistry, batteryUnit: bank.id,
  }, [], { ...DEFAULT_HARDWARE, inverters: [unit] })
}

/** What is wrong with one kit's main run, one line each; empty when the fuse and the cable hold. */
function breaches(r: SizingResult, set: InverterSet, bank: BankUnit): string[] {
  const label = `${r.volts} V · ${set.count} × ${set.unit.w} W · ${bank.chemistry} ${bank.id}`
  const runA = r.inverter.continuousA / r.cable.runs
  const warned = r.warnings.some((w) => w.code === 'fuseAboveCable')
  return [
    ...(r.inverter.count === set.count && r.inverter.unitW === set.unit.w ? [] : [`${label}: sized ${r.inverter.count} × ${r.inverter.unitW} W instead`]),
    ...(r.batteryUnit === bank.id ? [] : [`${label}: the bank fell back to ${r.battery?.unitLabel}`]),
    ...(r.fuse.a >= runA * CONTINUOUS_FACTOR ? [] : [`${label}: ${r.fuse.a} A fuse under 1.25 × the ${runA.toFixed(1)} A run`]),
    ...(r.fuse.a <= r.cable.ampacity || warned ? [] : [`${label}: ${r.fuse.a} A fuse over the ${r.cable.ampacity} A cable, and no fuseAboveCable`]),
    ...(r.cable.dropPct <= MAX_DROP_PCT ? [] : [`${label}: ${r.cable.dropPct}% drop`]),
  ]
}

describe('every stock kit at the default cable conditions', () => {
  const kits = VOLTAGES.flatMap((volts) => SETS.flatMap((set) => unitsFor(volts).map((bank) => ({ set, bank, r: kitFor(volts, set, bank) }))))

  test('is sized for a 1.5 m run in 30 °C open air on 90 °C cable', () => {
    for (const { r } of kits) {
      expect(r.cable).toMatchObject({ mainLengthM: 1.5, ambientC: 30, bundled: false, insulationC: 90 })
    }
  })

  test('gives each main run a fuse of at least 1.25 × its current, within its cable or warned, and a drop of 3% or less', () => {
    expect(kits.length).toBeGreaterThan(0)
    expect(kits.flatMap(({ r, set, bank }) => breaches(r, set, bank))).toEqual([])
  })
})
