import { describe, expect, test } from 'vitest'
import { CHEMISTRIES, DEFAULT_HARDWARE, INVERTERS, SIZING, VOLTAGES, type ChemistryId } from '../catalog'
import { CATALOG_SNAPSHOT } from '../catalog-snapshot'
import { compute, type SizingResult } from '../sizing'

/**
 * README, "What the checks can catch": on the generic ratings in `catalog.ts` the surge-duration and battery-peak
 * checks only bite with real product data. These tests hold the README to that, so a rating change that makes them
 * bite on generic data is noticed and the line gets rewritten.
 */
const CHEMISTRY_IDS: readonly ChemistryId[] = ['lifepo4', 'agm']
const APPLIANCES_AT_ONCE = 3
const MIN_KITS = 1000
const PEAK_OVER_CONTINUOUS = 2
const LONGEST_START_S = Math.max(...Object.values(SIZING.SURGE_SECONDS))
const BATTERY_UNITS = Object.values(CHEMISTRIES).flatMap((c) => c.units)

/** Every catalog appliance, three of it starting together, on each voltage and chemistry, with the automatic bank and each bank on offer. */
function genericKits(): SizingResult[] {
  const kits: SizingResult[] = []
  for (const volts of VOLTAGES) {
    for (const chemistry of CHEMISTRY_IDS) {
      for (const item of CATALOG_SNAPSHOT) {
        const input = { qty: { [item.id]: APPLIANCES_AT_ONCE }, hours: 6, volts, chemistry, simultaneousStarts: 'all' as const }
        const banks = compute(input, CATALOG_SNAPSHOT).batteryOptions.map((o) => o.id)
        for (const batteryUnit of [undefined, ...banks]) kits.push(compute({ ...input, batteryUnit }, CATALOG_SNAPSHOT))
      }
    }
  }
  return kits
}

describe('what the checks can catch on generic ratings', () => {
  test('every generic inverter holds its surge rating for as long as the longest start-up lasts', () => {
    for (const inv of INVERTERS) expect(inv.surgeSeconds, `${inv.w} W`).toBeGreaterThanOrEqual(LONGEST_START_S)
  })

  test('every generic battery peaks at twice its continuous current or more, for as long as the longest start-up lasts', () => {
    for (const unit of BATTERY_UNITS) {
      expect(unit.peakA, `${unit.v} V ${unit.ah} Ah`).toBeGreaterThanOrEqual(PEAK_OVER_CONTINUOUS * unit.maxContinuousA)
      expect(unit.peakSeconds, `${unit.v} V ${unit.ah} Ah`).toBeGreaterThanOrEqual(LONGEST_START_S)
    }
  })

  describe('over every catalog appliance, voltage, chemistry and bank', () => {
    const kits = genericKits()

    test('the sweep is wide enough to mean something', () => {
      expect(kits.length).toBeGreaterThan(MIN_KITS)
    })

    test('no start-up outlasts the surge window of an inverter whose rating it is within', () => {
      const tooLong = kits.filter((r) => r.warnings.some((w) => w.code === 'surgeDuration' && w.params.tooLong))
      expect(tooLong).toHaveLength(0)
    })

    test('a bank whose peak falls short of the start-up is already short of the continuous current', () => {
      const peakAlone = kits.filter((r) => {
        const codes = r.warnings.map((w) => w.code)
        return codes.includes('bankPeak') && !codes.includes('bankDischarge')
      })
      expect(peakAlone).toHaveLength(0)
    })
  })

  test('the surge-duration check does fire on a unit that holds its surge for half a second', () => {
    // The well pump's 3 kW start is within a 2 kW inverter's 4 kW surge rating and lasts 1 s.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 2000, surge: 4000, volts: [48] as const, surgeSeconds: 0.5 }] }
    const r = compute({ qty: { well: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(r.warnings.some((w) => w.code === 'surgeDuration' && w.params.tooLong)).toBe(true)
  })
})
