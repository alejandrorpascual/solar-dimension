import { describe, expect, test } from 'vitest'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { checkItems } from './quote-items'
import {
  gaugePos, GAUGE_ZONES, NEED_POS, quoteSizing, sizingRatio, sizingZone, SIZING_ZONES, suggestedInverterW, type SizingZone,
} from './quote-sizing'

describe('sizingRatio', () => {
  test('is the quote value over the kit need', () => {
    expect(sizingRatio(12000, 4000)).toBe(3)
  })
  test('is null when the quote states no size or the kit needs nothing', () => {
    expect(sizingRatio(undefined, 4000)).toBeNull()
    expect(sizingRatio(5000, 0)).toBeNull()
    expect(sizingRatio(5000, -1)).toBeNull()
    expect(sizingRatio(5000, Number.NaN)).toBeNull()
  })
})

describe('sizingZone', () => {
  test.each<[number, SizingZone]>([
    [0, 'short'], [0.99, 'short'], [1, 'just'], [1.3, 'just'], [1.31, 'roomy'], [2, 'roomy'], [2.01, 'over'], [12, 'over'],
  ])('%s is %s', (ratio, zone) => {
    expect(sizingZone(ratio)).toBe(zone)
  })
  test('the legend and the tip say "double", so the roomy zone ends at 2', () => {
    expect(SIZING_ZONES.ROOMY_MAX).toBe(2)
  })
})

describe('the gauge', () => {
  test('spans 0 to 250 %, clamped', () => {
    expect(gaugePos(0)).toBe(0)
    expect(gaugePos(1)).toBe(40)
    expect(gaugePos(2.5)).toBe(100)
    expect(gaugePos(4)).toBe(100)
    expect(NEED_POS).toBe(40)
  })
  test('zone widths match the design board and fill the bar', () => {
    expect(GAUGE_ZONES.map((z) => z.zone)).toEqual(['short', 'just', 'roomy', 'over'])
    expect(GAUGE_ZONES.map((z) => z.width)).toEqual([40, 12, 28, 20])
  })
})

describe('quoteSizing', () => {
  test('a 12 kW inverter and 34.8 kWh against the sample kit are both oversized', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.solartec, KIT), KIT)
    expect(s.inverter).toMatchObject({ have: 12000, need: 3860, zone: 'over', pos: 100 })
    expect(s.inverter?.ratio).toBeCloseTo(3.109, 3)
    expect(s.battery).toMatchObject({ have: 34816, need: 8000, zone: 'over', pos: 100 })
  })
  test('a 300 W inverter and 1.1 kWh are short', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.enerhogar, KIT), KIT)
    expect(s.inverter?.zone).toBe('short')
    expect(s.battery?.zone).toBe('short')
    expect(s.battery?.pos).toBeCloseTo(5.44, 2)
  })
  test('is null for a component whose size the quote does not state', () => {
    const s = quoteSizing(checkItems(extraction([line('inverter', 1000), line('battery', 2000)]), KIT), KIT)
    expect(s).toEqual({ inverter: null, battery: null })
  })
  test('is null for a bank whose usable energy depends on a chemistry it does not name: no one figure is the quote', () => {
    // 4 × 12 V 200 Ah: 4.8 kWh as AGM, 8.16 kWh as LiFePO₄, either side of the 8 kWh kit. The checks show both.
    const s = quoteSizing(checkItems(extraction([line('battery', 1, { qty: 4, specs: { batteryVolts: 12, ah: 200 } })]), KIT), KIT)
    expect(s.battery).toBeNull()
    // Past the kit at the lowest depth too, it has its figure, the one it is judged on.
    const sure = quoteSizing(checkItems(extraction([line('battery', 1, { qty: 4, specs: { batteryVolts: 12, ah: 400 } })]), KIT), KIT)
    expect(sure.battery).toMatchObject({ have: 9600 })
  })
  test('ignores a component the user marked not included', () => {
    const s = quoteSizing(checkItems(SAMPLE_QUOTES.solartec, KIT, { inverter: 'not_included' }), KIT)
    expect(s.inverter).toBeNull()
    expect(s.battery).not.toBeNull()
  })
  test('is null for the battery when the kit needs no stored energy', () => {
    const kit = { ...KIT, usableWh: 0 }
    expect(quoteSizing(checkItems(SAMPLE_QUOTES.solartec, kit), kit).battery).toBeNull()
  })
})

describe('suggestedInverterW', () => {
  test('is the next 500 W step above the running load plus 15 %', () => {
    expect(suggestedInverterW({ ...KIT, runningW: 5200, surgeW: 8000 })).toBe(6000)
  })
  test('never suggests one that cannot start the kit, assuming a 2× surge rating', () => {
    expect(suggestedInverterW(KIT)).toBe(5000)
    expect(suggestedInverterW({ ...KIT, runningW: 2000, surgeW: 9000 })).toBe(4500)
  })
})
