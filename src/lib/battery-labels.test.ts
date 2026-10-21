import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { autoTitle, batteryTags } from './battery-labels'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { compute, type BatteryOption, type SizingInput } from './sizing'

const en = getDictionary('en')
const es = getDictionary('es')
const options = (input: SizingInput): BatteryOption[] => compute(input, CATALOG_SNAPSHOT).batteryOptions
const auto = (input: SizingInput): BatteryOption => options(input).find((o) => o.isAuto)!

/** A 12 V AGM heavy kit: 370 A that no bank can give. */
const HEAVY: SizingInput = { qty: { fridge: 1, micro: 1, kettle: 1 }, hours: 2, volts: 12, chemistry: 'agm' }
/** The fridge and the microwave alone: four 200 Ah units feed them, one 100 Ah unit does not. */
const MEDIUM: SizingInput = { qty: { fridge: 1, micro: 1 }, hours: 2, volts: 12, chemistry: 'agm' }

describe('the automatic row', () => {
  test('a bank that feeds the inverter is the best fit, in English and Spanish', () => {
    expect(autoTitle(en, auto(MEDIUM))).toBe('Auto · Best fit')
    expect(autoTitle(es, auto(MEDIUM))).toBe('Automático · La mejor opción')
  })

  test('a bank that fails discharge, peak or parallel is not called the best fit, in English and Spanish', () => {
    expect(autoTitle(en, auto(HEAVY))).toBe('Auto')
    expect(autoTitle(es, auto(HEAVY))).toBe('Automático')
    const fed = auto(MEDIUM)
    for (const failing of [{ dischargeOk: false }, { peakOk: false }, { overMaxParallel: true }]) {
      expect(autoTitle(en, { ...fed, ...failing })).toBe('Auto')
    }
    // Leads and interrupt are wiring: the bank still feeds the inverter, so it can still be the best fit.
    expect(autoTitle(en, { ...fed, leadOk: false, interruptOk: false })).toBe('Auto · Best fit')
  })
})

describe('the tags on a row', () => {
  test('a row that fails discharge and peak says so, in English and Spanish', () => {
    const small = options(HEAVY).find((o) => o.id === '12-100')!
    expect(small).toMatchObject({ dischargeOk: false, peakOk: false, overMaxParallel: false })
    expect(batteryTags(en, small)).toEqual(['Continuous current too low', 'Peak current too low'])
    expect(batteryTags(es, small)).toEqual(['Corriente continua insuficiente', 'Corriente pico insuficiente'])
  })

  test('a row that feeds the inverter has no tag, and one past the parallel limit keeps its own', () => {
    const fed = auto(MEDIUM)
    expect(batteryTags(en, fed)).toEqual([])
    expect(batteryTags(en, { ...fed, peakOk: false })).toEqual(['Peak current too low'])
    expect(batteryTags(en, { ...fed, overMaxParallel: true })).toEqual(['Many parallel strings'])
  })
})
