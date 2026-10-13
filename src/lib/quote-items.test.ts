import { describe, expect, test } from 'vitest'
import { CHEMISTRIES } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { checkItems, DEFAULT_MUSTS, gaugeMm2, kitNeeds, resolveMusts, setOverride, type ItemCheck, type ItemId } from './quote-items'
import type { QuoteExtraction } from './quote-schema'
import { compute } from './sizing'

const item = (x: QuoteExtraction, id: ItemId, overrides = {}): ItemCheck => checkItems(x, KIT, overrides).find((c) => c.id === id)!

describe('must-haves and overrides', () => {
  test('defaults: Wi-Fi and warranty are nice-to-haves, everything else is a must-have', () => {
    expect(Object.entries(DEFAULT_MUSTS).filter(([, v]) => !v).map(([k]) => k)).toEqual(['wifi', 'warranty'])
  })
  test('stored must-haves win over the defaults', () => {
    expect(resolveMusts({ charger: false }).charger).toBe(false)
    expect(resolveMusts(null)).toEqual(DEFAULT_MUSTS)
  })
  test('setOverride adds, replaces and removes without mutating', () => {
    const a = {}
    const b = setOverride(a, 'charger', 'included')
    expect(b).toEqual({ charger: 'included' })
    expect(a).toEqual({})
    expect(setOverride(b, 'charger', null)).toEqual({})
  })
})

describe('inverter', () => {
  test('ok when running and surge watts cover the kit', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'inverter')).toMatchObject({ status: 'ok', facts: { watts: 12000, surgeWatts: 24000 } })
  })
  test('short with the gap when running watts are below the kit', () => {
    expect(item(SAMPLE_QUOTES.enerhogar, 'inverter')).toMatchObject({ status: 'short', facts: { watts: 300, shortW: 3560 } })
  })
  test('short when surge is stated and too low', () => {
    const x = extraction([line('inverter', 1, { specs: { watts: 5000, surgeWatts: 8000 } })])
    expect(item(x, 'inverter')).toMatchObject({ status: 'short', facts: { shortSurgeW: 1400 } })
  })
  test('unknown, not ok, when the surge is not stated and the running watts are below the kit surge', () => {
    // 5,000 W covers the 3,860 W running load, but nothing says it can start the 9,400 W surge.
    const x = extraction([line('inverter', 1, { specs: { watts: 5000 } })])
    expect(item(x, 'inverter')).toMatchObject({ status: 'unknown', facts: { watts: 5000, surgeUnknown: true } })
    expect(item(x, 'inverter').facts.shortSurgeW).toBeUndefined()
  })
  test('ok with surgeUnknown when the running watts alone cover the kit surge', () => {
    const x = extraction([line('inverter', 1, { specs: { watts: KIT.surgeW } })])
    expect(item(x, 'inverter')).toMatchObject({ status: 'ok', facts: { watts: KIT.surgeW, surgeUnknown: true } })
  })
  test('short, not unknown, when the running watts fall short even though the surge is not stated', () => {
    const x = extraction([line('inverter', 1, { specs: { watts: 3000 } })])
    expect(item(x, 'inverter')).toMatchObject({ status: 'short', facts: { watts: 3000, shortW: 860, surgeUnknown: true } })
  })
  test('one inverter without a stated surge makes the whole surge unknown', () => {
    const x = extraction([
      line('inverter', 1, { specs: { watts: 3000, surgeWatts: 9000 } }),
      line('inverter', 1, { specs: { watts: 3000 } }),
    ])
    expect(item(x, 'inverter')).toMatchObject({ status: 'unknown', facts: { watts: 6000, surgeUnknown: true } })
  })
  test('unknown without an inverter line or without watts', () => {
    expect(item(extraction([line('labor', 1)]), 'inverter').status).toBe('unknown')
    expect(item(extraction([line('inverter', 1)]), 'inverter').status).toBe('unknown')
  })
})

describe('battery', () => {
  test('usable Wh uses kWh × qty × DoD', () => {
    const usable = 8 * 5120 * CHEMISTRIES.lifepo4.dod
    expect(item(SAMPLE_QUOTES.solartec, 'battery')).toMatchObject({ status: 'ok', facts: { usableWh: usable } })
  })
  test('falls back to volts × Ah, and to the project chemistry', () => {
    const x = extraction([line('battery', 1, { qty: 2, specs: { batteryVolts: 51.2, ah: 100 } })])
    expect(item(x, 'battery').facts.usableWh).toBeCloseTo(2 * 5120 * CHEMISTRIES.lifepo4.dod)
  })
  test('short with the gap', () => {
    const c = item(SAMPLE_QUOTES.enerhogar, 'battery')
    expect(c.status).toBe('short')
    expect(c.facts.shortWh).toBeCloseTo(8000 - 1280 * CHEMISTRIES.lifepo4.dod)
  })
  test('unknown without a capacity', () => {
    expect(item(extraction([line('battery', 1)]), 'battery').status).toBe('unknown')
  })
})

describe('charger and Wi-Fi', () => {
  test('a charger line is ok, with its amps', () => {
    expect(item(SAMPLE_QUOTES.enerhogar, 'charger')).toMatchObject({ status: 'ok', facts: { amps: 60 } })
  })
  test('a charger built into the inverter is ok', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'charger')).toMatchObject({ status: 'ok', facts: { builtIn: true, amps: 120 } })
  })
  test('an optional line is missing, with its price', () => {
    expect(item(SAMPLE_QUOTES.enerhogar, 'wifi')).toMatchObject({ status: 'missing', facts: { optionalPrice: 120 } })
  })
  test('an inverter that says it has no charger is missing', () => {
    const x = extraction([line('inverter', 1, { specs: { watts: 5000, hasCharger: false } })])
    expect(item(x, 'charger').status).toBe('missing')
  })
  test('silence is unknown', () => {
    expect(item(SAMPLE_QUOTES.grupoluz, 'charger').status).toBe('unknown')
    expect(item(SAMPLE_QUOTES.grupoluz, 'wifi').status).toBe('unknown')
  })
})

describe('cables and fuse', () => {
  test('gauges parse with or without "AWG" and "#"', () => {
    expect(gaugeMm2('2/0')).toBe(67.4)
    expect(gaugeMm2('#4 AWG')).toBe(21.2)
    expect(gaugeMm2('70 mm2')).toBeNull()
  })
  test('cables thicker than the kit are ok, thinner are short', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
    expect(item(SAMPLE_QUOTES.enerhogar, 'cables')).toMatchObject({ status: 'short', facts: { gauge: '8 AWG' } })
  })
  test('the kit asks a quote for its thickest battery-side cable, which can be a string lead and not the main cable', () => {
    // 2 kW at 12 V on two strings, bundled in 50 °C air: three main runs of 2/0, but each string's lead carries half the bank on 3/0.
    const custom = [{ id: 'x', name: 'Load', watts: 2000, surge: 2000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 50, insulationC: 90, bundled: true } }, CATALOG_SNAPSHOT)
    expect([r.battery?.config, r.cable.runs, r.cable.gauge, r.cable.string?.gauge]).toEqual(['1S2P', 3, '2/0 AWG', '3/0 AWG'])
    const kit = kitNeeds(r)
    expect(kit).toMatchObject({ cableGauge: '3/0 AWG', cableMm2: 85 })
    const cables = (awg: string) => checkItems(extraction([line('wiring', 1, { specs: { awg } })]), kit, {}).find((c) => c.id === 'cables')!
    expect(cables('2/0').status).toBe('short')
    expect(cables('3/0').status).toBe('ok')
  })
  test('a kit with one string asks for its main cable', () => {
    const r = compute({ qty: { fridge: 1, lights: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.cable.string).toBeNull()
    expect(kitNeeds(r)).toMatchObject({ cableGauge: r.cable.gauge, cableMm2: r.cable.mm2 })
  })
  test('mm² counts when there is no AWG, within 5%', () => {
    expect(item(extraction([line('wiring', 1, { specs: { mm2: 70 } })]), 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '70 mm²' } })
  })
  test('a size that is not stated is ok with sizeUnknown', () => {
    expect(item(extraction([line('wiring', 1)]), 'cables')).toMatchObject({ status: 'ok', facts: { sizeUnknown: true } })
    expect(item(extraction([line('fuse', 1)]), 'fuse')).toMatchObject({ status: 'ok', facts: { sizeUnknown: true } })
  })
  test('a fuse below the kit is short; none is unknown', () => {
    expect(item(extraction([line('fuse', 1, { specs: { fuseAmps: 150 } })]), 'fuse')).toMatchObject({ status: 'short', facts: { amps: 150 } })
    expect(item(SAMPLE_QUOTES.grupoluz, 'fuse').status).toBe('unknown')
  })
})

describe('an optional extra bundled into a line', () => {
  test('is priced by its cheapest line that has a price, not by a split line at 0', () => {
    const x = extraction([line('labor', 0, { optional: true }), line('labor', 300, { optional: true }), line('labor', 250, { optional: true })])
    expect(item(x, 'installation')).toMatchObject({ status: 'missing', facts: { optionalPrice: 250 } })
  })
  test('has no price when every line is at 0, and is still missing', () => {
    const c = item(extraction([line('labor', 0, { optional: true })]), 'installation')
    expect(c.status).toBe('missing')
    expect(c.facts.optionalPrice).toBeUndefined()
  })
})

describe('installation and warranty', () => {
  test('a labor line is ok; an optional one is missing; none is unknown', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'installation').status).toBe('ok')
    expect(item(extraction([line('labor', 300, { optional: true })]), 'installation')).toMatchObject({ status: 'missing', facts: { optionalPrice: 300 } })
    expect(item(extraction([line('inverter', 1)]), 'installation').status).toBe('unknown')
  })
  test('warranty years per part', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'warranty')).toMatchObject({ status: 'ok', facts: { batteryYears: 10, inverterYears: 5 } })
    expect(item(extraction([line('inverter', 1)]), 'warranty').status).toBe('unknown')
  })
})

describe('overrides', () => {
  test('included turns an unknown into ok, marked as confirmed', () => {
    expect(item(SAMPLE_QUOTES.grupoluz, 'charger', { charger: 'included' })).toMatchObject({ status: 'ok', facts: { confirmed: true } })
  })
  test('not_included turns anything into missing', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'wifi', { wifi: 'not_included' }).status).toBe('missing')
  })
  test('returns the items in ITEM_IDS order', () => {
    expect(checkItems(SAMPLE_QUOTES.solartec, KIT).map((c) => c.id)).toEqual(['inverter', 'battery', 'charger', 'wifi', 'cables', 'fuse', 'installation', 'warranty'])
  })
})
