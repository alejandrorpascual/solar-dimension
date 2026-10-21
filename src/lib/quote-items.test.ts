import { describe, expect, test } from 'vitest'
import { CHEMISTRIES } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { extraction, line, SAMPLE_KIT as KIT, SAMPLE_QUOTES } from './quote-fixtures'
import { checkItems, DEFAULT_MUSTS, itemsFor, kitNeeds, resolveMusts, setOverride, type ItemCheck, type ItemId, type KitNeeds } from './quote-items'
import type { QuoteExtraction, QuoteLine } from './quote-schema'
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
    expect(item(SAMPLE_QUOTES.solartec, 'inverter')).toMatchObject({
      status: 'ok', facts: { watts: 12000, surgeWatts: 24000, terms: [{ qty: 1, each: 12000 }], surgeTerms: [{ qty: 1, each: 24000 }] },
    })
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
  const bank = (qty: number, specs: object) => extraction([line('battery', 1, { qty, specs })])
  test('usable Wh uses kWh × qty × the depth of discharge of the stated chemistry, and says so', () => {
    const usable = 8 * 5120 * CHEMISTRIES.lifepo4.dod
    expect(item(SAMPLE_QUOTES.solartec, 'battery')).toMatchObject({ status: 'ok', facts: { usableWh: usable, terms: [{ qty: 8, each: 5120 }], dod: CHEMISTRIES.lifepo4.dod } })
  })
  test('falls back to volts × Ah', () => {
    expect(item(bank(2, { batteryVolts: 51.2, ah: 100, chemistry: 'lifepo4' }), 'battery').facts.usableWh).toBeCloseTo(2 * 5120 * CHEMISTRIES.lifepo4.dod)
  })
  test('a bank that names no chemistry passes when it passes at the lowest depth of discharge, whatever the project uses', () => {
    // 4 × 12 V 400 Ah = 19.2 kWh: 9.6 kWh even as AGM, enough for the 8 kWh kit.
    for (const chemistry of [null, 'other']) {
      expect(item(bank(4, { batteryVolts: 12, ah: 400, chemistry }), 'battery')).toMatchObject({
        status: 'ok', facts: { usableWh: 9600, dod: CHEMISTRIES.agm.dod, dodAssumed: true },
      })
    }
  })
  test('and depends on the chemistry when only the higher depth reaches the kit (AI-06)', () => {
    // 4 × 12 V 200 Ah = 9.6 kWh: 4.8 kWh as AGM, 8.16 kWh as LiFePO₄. A gel or flooded bank labelled "other" used to get 8.16.
    for (const chemistry of [null, 'other']) {
      expect(item(bank(4, { batteryVolts: 12, ah: 200, chemistry }), 'battery')).toMatchObject({
        status: 'unknown', facts: { usableLowWh: 4800, usableHighWh: 9600 * CHEMISTRIES.lifepo4.dod, terms: [{ qty: 4, each: 2400 }] },
      })
    }
    expect(item(bank(4, { batteryVolts: 12, ah: 200, chemistry: 'agm' }), 'battery')).toMatchObject({ status: 'short', facts: { usableWh: 4800, shortWh: 3200 } })
  })
  test('short when it falls short even at the highest depth of discharge', () => {
    expect(item(bank(1, { kWh: 5 }), 'battery')).toMatchObject({
      status: 'short', facts: { usableWh: 5000 * CHEMISTRIES.lifepo4.dod, dod: CHEMISTRIES.lifepo4.dod, dodAssumed: true },
    })
  })
  test("the project's chemistry no longer decides: in an AGM project an unnamed bank that passes as lithium is to confirm, not short", () => {
    const x = bank(2, { batteryVolts: 51.2, ah: 100 })
    expect(checkItems(x, { ...KIT, chemistry: 'agm' }).find((c) => c.id === 'battery')!.status).toBe('unknown')
  })
  test('a line with no capacity leaves a short bank to confirm, and does not stop one that passes without it', () => {
    const partial = extraction([line('battery', 1, { specs: { kWh: 5.12, chemistry: 'lifepo4' } }), line('battery', 0, { qty: 2, specs: { ah: 100 } })])
    expect(item(partial, 'battery')).toMatchObject({ status: 'unknown', facts: { capacityPartial: true, usableLowWh: 5120 * CHEMISTRIES.lifepo4.dod } })
    const enough = extraction([line('battery', 1, { qty: 2, specs: { kWh: 5.12, chemistry: 'lifepo4' } }), line('battery', 0, { specs: { ah: 100 } })])
    expect(item(enough, 'battery').status).toBe('ok')
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

describe('solar panels (AI-05)', () => {
  const solar: KitNeeds = { ...KIT, arrayW: 4400 }
  const panels = (qty: number, panelWatts: number | null, over = {}) => line('panel', 300 * qty, { qty, specs: { panelWatts }, ...over })
  const judge = (lines: QuoteLine[]) => checkItems(extraction(lines), solar).find((c) => c.id === 'panels')!
  test('only a kit with a solar array is checked for panels', () => {
    expect(itemsFor(KIT)).not.toContain('panels')
    expect(itemsFor(solar)).toContain('panels')
    expect(checkItems(SAMPLE_QUOTES.solartec, KIT).map((c) => c.id)).not.toContain('panels')
    expect(DEFAULT_MUSTS.panels).toBe(true)
  })
  test("the kit's array comes from the engine's solar side", () => {
    const r = compute({ qty: { fridge: 1, lights: 1, tv: 1, router: 1, fan: 2 }, hours: 8, volts: 48, chemistry: 'lifepo4', solar: { roofM2: 40, panels: null, sunHours: 4.8 } }, CATALOG_SNAPSHOT)
    expect(r.solar?.arrayW).toBeGreaterThan(0)
    expect(kitNeeds(r).arrayW).toBe(r.solar?.arrayW)
    expect(kitNeeds(compute({ qty: { fridge: 1 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)).arrayW).toBe(0)
  })
  test('the quoted array passes from 95% of the kit, and is short below', () => {
    expect(judge([panels(8, 550)])).toMatchObject({ status: 'ok', facts: { arrayW: 4400 } })
    expect(judge([panels(8, 530)])).toMatchObject({ status: 'ok', facts: { arrayW: 4240 } })
    expect(judge([panels(6, 550)])).toMatchObject({ status: 'short', facts: { arrayW: 3300, shortArrayW: 1100 } })
  })
  test('panels with no wattage are to confirm, and so is a short array with a line that states none', () => {
    expect(judge([panels(8, null)])).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    expect(judge([panels(6, 550), panels(2, null)])).toMatchObject({ status: 'unknown', facts: { arrayW: 3300 } })
  })
  test('none is unknown, and panels offered only as an extra are missing', () => {
    expect(judge([line('inverter', 1)]).status).toBe('unknown')
    expect(judge([panels(8, 550, { optional: true })])).toMatchObject({ status: 'missing', facts: { optionalPrice: 2400 } })
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
  /** The 48 V kit of the audit's probe C2: 5.9 kW running on an 8 kW inverter, so 2 runs in parallel of 1/0 AWG (231 A design) and 2 × 125 A. */
  const c2 = kitNeeds(compute({ qty: { ac2i: 2, fridge: 1, micro: 1, lights: 2 }, hours: 8, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT))
  const wiring = (awg: string, qty = 1) => line('wiring', 1, { qty, specs: { awg } })
  /** A wiring line as the quote writes it, so its words can say what its quantity counts. */
  const written = (text: string, awg: string, qty: number) => line('wiring', 1, { qty, description: text, source: { page: 1, text }, specs: { awg } })
  const fuse = (fuseAmps: number, qty = 1, fuseClass: string | null = 'T') => line('fuse', 1, { qty, specs: { fuseAmps, fuseClass } })
  const judge = (kit: KitNeeds, lines: QuoteLine[], id: ItemId) => checkItems(extraction(lines), kit).find((c) => c.id === id)!

  test('the probe kit is what the engine prints', () => {
    expect(c2).toMatchObject({ cableGauge: '1/0 AWG', cableRuns: 2, designA: 231, fuseA: 125, fuseCount: 2, fuseClass: 'T' })
    expect(c2.ampacityByGauge['1/0 AWG']).toBe(150)
  })
  test('cables thicker than the kit are ok, thinner are short', () => {
    expect(item(SAMPLE_QUOTES.solartec, 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
    expect(item(SAMPLE_QUOTES.enerhogar, 'cables')).toMatchObject({ status: 'short', facts: { gauge: '8 AWG' } })
  })
  test('gauges thinner than the table are short, not "size not stated" (AI-15)', () => {
    for (const awg of ['10', '12', '14']) expect(judge(KIT, [wiring(awg)], 'cables')).toMatchObject({ status: 'short', facts: { gauge: `${awg} AWG` } })
    expect(judge(KIT, [wiring('00')], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '2/0 AWG' } })
    expect(judge(KIT, [wiring('250 kcmil')], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '250 kcmil' } })
    expect(judge(KIT, [wiring('2 AWG THHN')], 'cables')).toMatchObject({ status: 'short', facts: { gauge: '2 AWG' } })
  })
  test('mm² counts when there is no AWG, within 5%', () => {
    expect(item(extraction([line('wiring', 1, { specs: { mm2: 70 } })]), 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '70 mm²' } })
  })
  test('a size that is not stated or cannot be read is to confirm, not ok (AI-15)', () => {
    expect(item(extraction([line('wiring', 1)]), 'cables')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    expect(item(extraction([wiring('heavy duty')]), 'cables')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    expect(item(extraction([line('fuse', 1)]), 'fuse')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
  })
  test('a count of runs written before the size reads as that size, not as a thin gauge', () => {
    expect(judge(KIT, [wiring('2 x 4/0 AWG')], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
  })
  test('a thinner size beside a cable with no size settles nothing: that cable could be the main one', () => {
    // A battery cable the quote doesn't size, and the solar cable the kit itself prints as 10 AWG.
    const unsized = line('wiring', 1, { description: 'Cableado de baterías' })
    expect(judge(KIT, [unsized, wiring('10')], 'cables')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    // Nor does it fail a fuse for being too big for the thin cable: 250 A is far above the 50 A of 8 AWG.
    expect(judge(KIT, [unsized, wiring('8'), fuse(250)], 'fuse').status).toBe('ok')
    // With every size read, the thickest is the main cable, and thinner than the kit's is short.
    expect(judge(KIT, [wiring('10'), wiring('8')], 'cables').status).toBe('short')
    // Lugs, connectors, conduit and the ground are no main cable, so they leave a thin one short.
    for (const text of ['Terminales y conectores', 'Tubo conduit 1"', 'Cable de tierra']) {
      expect(judge(KIT, [wiring('8'), line('wiring', 1, { description: text, source: { page: 1, text } })], 'cables').status).toBe('short')
    }
  })
  test('a size the kit needs two runs of is ok only when the quote counts their four leads; a count never fails it (AI-03)', () => {
    expect(judge(c2, [wiring('1/0')], 'cables')).toMatchObject({ status: 'unknown', facts: { gauge: '1/0 AWG', runs: 2, runsUnstated: true } })
    expect(judge(c2, [wiring('1/0', 4)], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '1/0 AWG', runs: 2 } })
    expect(judge(c2, [wiring('1/0', 4)], 'cables').facts.runsUnstated).toBeUndefined()
  })
  test('a quantity in metres, or not a whole number, counts no leads', () => {
    for (const x of [written('Cable 1/0 AWG, 10 m', '1/0', 10), written('Cable cal. 1/0, 12 mts', '1/0', 12), written('Cable 1/0 AWG', '1/0', 12.5)]) {
      expect(judge(c2, [x], 'cables')).toMatchObject({ status: 'unknown', facts: { runs: 2, runsUnstated: true } })
    }
    for (const text of ['Cable 1/0 AWG, 4 tramos de 2 m', 'Cable 1/0 AWG 12 mtrs', 'Cable 1/0 AWG 12 ml', 'Cable 1/0 AWG, precio por metro']) {
      expect(judge(c2, [written(text, '1/0', 12)], 'cables').status).toBe('unknown')
    }
    expect(judge(c2, [written('Cable 1/0 AWG, 4 piezas', '1/0', 4)], 'cables').status).toBe('ok')
    // Pesos written "M.N." or "m/n" are no length.
    expect(judge(c2, [written('Cable 1/0 AWG, 4 pzas, $1,250.00 M.N.', '1/0', 4)], 'cables').status).toBe('ok')
    expect(judge(KIT, [written('Cable 4/0 AWG, 12 m', '4/0', 12), fuse(450)], 'fuse')).toMatchObject({ status: 'unknown', facts: { runs: 2, runsUnstated: true } })
  })
  test('runs are counted in whole micro-amps, so float noise in a factor asks for no extra run', () => {
    // 85 × 0.7 is 59.49999999999999 in floating point: 119 A is two runs of it, not three.
    const kit: KitNeeds = { ...KIT, cableMm2: 53.5, cableGauge: '1/0 AWG', mainMm2: 53.5, designA: 119, ampacityByGauge: { ...KIT.ampacityByGauge, '1/0 AWG': 85 * 0.7 } }
    expect(judge(kit, [wiring('1/0', 4)], 'cables')).toMatchObject({ status: 'ok', facts: { runs: 2 } })
  })
  test('one run of a size that carries the whole current needs no count', () => {
    expect(judge(KIT, [wiring('4/0')], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
    expect(judge(KIT, [wiring('4/0')], 'cables').facts.runs).toBeUndefined()
  })
  test('the kit asks a quote for its thickest battery-side cable, which can be a string lead and not the main cable', () => {
    // 2 kW at 12 V on two strings, bundled in 50 °C air: three main runs of 2/0, but each string's lead carries half the bank on 3/0.
    const custom = [{ id: 'x', name: 'Load', watts: 2000, surge: 2000, note: '' }]
    const r = compute({ qty: { x: 1 }, custom, hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 50, insulationC: 90, bundled: true } }, CATALOG_SNAPSHOT)
    expect([r.battery?.config, r.cable.runs, r.cable.gauge, r.cable.string?.gauge]).toEqual(['1S2P', 3, '2/0 AWG', '3/0 AWG'])
    const kit = kitNeeds(r)
    expect(kit).toMatchObject({ cableGauge: '3/0 AWG', cableMm2: 85 })
    expect(judge(kit, [wiring('2/0', 6)], 'cables').status).toBe('short')
    // 347 A of design current is three runs of 3/0 at this site, so the six leads have to be there too.
    expect(judge(kit, [wiring('3/0')], 'cables')).toMatchObject({ status: 'unknown', facts: { runs: 3, runsUnstated: true } })
    expect(judge(kit, [wiring('3/0', 6)], 'cables').status).toBe('ok')
    // A quote that copies the parts list, three runs of 2/0 and two pairs of 3/0 string leads, carries what the kit's does.
    expect(judge(kit, [wiring('2/0', 6), wiring('3/0', 4)], 'cables').status).toBe('ok')
  })
  test('a kit with one string asks for its main cable', () => {
    const r = compute({ qty: { fridge: 1, lights: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
    expect(r.cable.string).toBeNull()
    expect(kitNeeds(r)).toMatchObject({ cableGauge: r.cable.gauge, cableMm2: r.cable.mm2 })
  })
  test('a fuse below the kit is short; none is unknown', () => {
    expect(item(extraction([fuse(150)]), 'fuse')).toMatchObject({ status: 'short', facts: { amps: 150 } })
    expect(item(SAMPLE_QUOTES.grupoluz, 'fuse').status).toBe('unknown')
  })
  test('a fuse above what a cable thinner than 1/0 carries is short: the probe C2 quote no longer fits (AI-03)', () => {
    const x = [wiring('1'), line('fuse', 1, { description: 'Fusible ANL 250 A', specs: { fuseAmps: 250, fuseClass: 'ANL' } })]
    expect(judge(c2, x, 'fuse')).toMatchObject({ status: 'short', facts: { amps: 250, gauge: '1 AWG', maxA: 130 } })
  })
  test('on 1/0 and up, a fuse above one run asks for the runs in parallel that carry it', () => {
    // 450 A on 4/0 (230 A a run) is two runs in parallel: fine with their four leads, to confirm with one line.
    expect(judge(KIT, [wiring('4/0'), fuse(450)], 'fuse')).toMatchObject({ status: 'unknown', facts: { amps: 450, gauge: '4/0 AWG', runs: 2, runsUnstated: true } })
    expect(judge(KIT, [wiring('4/0', 4), fuse(450)], 'fuse')).toMatchObject({ status: 'ok', facts: { amps: 450 } })
  })
  test("a fuse no larger than the kit's own never fails for its size", () => {
    // 5 kW at 12 V, bundled: six runs of 4/0 at 130 A each, and the engine can protect each only with a 175 A fuse.
    const custom = [{ id: 'x', name: 'Load', watts: 5000, surge: 5000, note: '' }]
    const kit = kitNeeds(compute({ qty: { x: 1 }, custom, hours: 1, volts: 12, chemistry: 'lifepo4', cable: { ambientC: 30, insulationC: 90, bundled: true } }, CATALOG_SNAPSHOT))
    expect(kit).toMatchObject({ cableGauge: '4/0 AWG', cableRuns: 6, fuseA: 175, fuseCount: 6 })
    expect(kit.ampacityByGauge['4/0 AWG']).toBe(130)
    expect(judge(kit, [wiring('4/0'), fuse(175, 6)], 'fuse').status).toBe('ok')
  })
  test("a class other than the kit's is to confirm; the word for class, and for fuse, is ignored", () => {
    expect(judge(KIT, [wiring('2/0'), fuse(175, 1, 'ANL')], 'fuse')).toMatchObject({ status: 'unknown', facts: { amps: 175, fuseClass: 'ANL', kitClass: 'T' } })
    for (const w of ['Fusible ANL', 'Tipo ANL']) expect(judge(KIT, [wiring('2/0'), fuse(175, 1, w)], 'fuse').facts.fuseClass).toBe('ANL')
    // The class field is kept to 12 characters, so these are what a reading stores.
    for (const w of ['T', 'Clase T', 'class-T', 'Clase tipo T', 'T (JLLN)', 'Class T (JLL']) {
      expect(judge(KIT, [wiring('2/0'), fuse(175, 1, w)], 'fuse').status).toBe('ok')
    }
  })
  test('a fuse that states no class is to confirm, unless its line writes the class', () => {
    expect(judge(KIT, [wiring('2/0'), fuse(175, 1, null)], 'fuse')).toMatchObject({ status: 'unknown', facts: { amps: 175, classUnstated: true, kitClass: 'T' } })
    const said = (text: string, fuseClass: string | null) => line('fuse', 1, { description: text, source: { page: 1, text }, specs: { fuseAmps: 175, fuseClass } })
    expect(judge(KIT, [wiring('2/0'), said('Fusible clase T 175 A', null)], 'fuse').status).toBe('ok')
    expect(item(SAMPLE_QUOTES.voltia, 'fuse').status).toBe('ok')
    // "Fusible clase T" cut to 12 characters: the word cut short is no class, and the line's words still say T.
    expect(judge(KIT, [wiring('2/0'), said('Fusible clase T 175 A', 'Fusible clas')], 'fuse').status).toBe('ok')
    expect(judge(KIT, [wiring('2/0'), said('Fusible 175 A', 'Fusible clas')], 'fuse').facts.classUnstated).toBe(true)
    // "Tipo" in a line's words is a kind, not a class.
    expect(judge(KIT, [wiring('2/0'), said('Fusible tipo cartucho 175 A', null)], 'fuse').facts.classUnstated).toBe(true)
  })
  test("fewer fuses than the kit's carry together are to confirm; fewer, larger ones on cable that carries them pass", () => {
    expect(judge(c2, [wiring('1', 4), fuse(125)], 'fuse')).toMatchObject({ status: 'unknown', facts: { amps: 125, fuses: 1 } })
    expect(judge(c2, [wiring('1', 4), fuse(125, 2)], 'fuse').status).toBe('ok')
    expect(judge(c2, [wiring('2/0', 4), fuse(250)], 'fuse').status).toBe('ok')
  })
  test("a fuse rated under the kit's protects something else and is not counted", () => {
    expect(judge(c2, [wiring('1', 4), fuse(125, 2), fuse(30, 1, 'ANL')], 'fuse')).toMatchObject({ status: 'ok', facts: { amps: 125 } })
  })

  describe('the battery cable, not the solar or AC wiring (AI-19)', () => {
    /** A wiring line in the quote's own words, with its size when it states one. */
    const named = (text: string, awg: string | null = null, qty = 1) =>
      line('wiring', 1, { qty, description: text, source: { page: 1, text }, specs: { awg } })
    const battery = named('Cable 4/0 AWG baterías', '4/0')
    const thinBattery = named('Cable 6 AWG baterías', '6')
    const unsizedBattery = named('Cableado de baterías')
    const acFeeder = named('Alimentador AC, cable 4/0 AWG', '4/0')
    const pvCable = named('Cable solar 6 mm² (10 AWG), 20 m', '10')

    test('an AC feeder beside a thin battery cable reads short, on the battery cable', () => {
      const cables = judge(KIT, [acFeeder, thinBattery], 'cables')
      expect(cables).toMatchObject({ status: 'short', facts: { gauge: '6 AWG' } })
      expect(cables.sources).toEqual([thinBattery.source])
    })
    test('a thick solar line beside a thin battery cable reads short too', () => {
      expect(judge(KIT, [named('Cable solar 4/0 AWG', '4/0'), thinBattery], 'cables')).toMatchObject({ status: 'short', facts: { gauge: '6 AWG' } })
    })
    test('sized solar or AC wiring alone reads unknown, whatever its size', () => {
      for (const only of [pvCable, acFeeder]) {
        expect(judge(KIT, [only], 'cables')).toMatchObject({ status: 'unknown', facts: { batteryCableUnstated: true }, sources: [only.source] })
      }
    })
    test('a solar line beside a sized battery cable is judged on the battery cable', () => {
      const cables = judge(KIT, [pvCable, battery], 'cables')
      expect(cables).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
      expect(cables.sources).toEqual([battery.source])
    })
    test('a solar or AC cable beside a battery cable with no size stays unknown, and cites the battery cable', () => {
      for (const other of [pvCable, acFeeder]) {
        expect(judge(KIT, [other, unsizedBattery], 'cables')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true }, sources: [unsizedBattery.source] })
      }
    })
    test('a solar or AC line thicker than a battery cable that passes does not decide: the verdict reads, and cites, the battery cable', () => {
      // The kit needs 2/0. The 4/0 beside it would be the main cable if it were not set aside, and the reading would quote it.
      const bank = named('Cable 2/0 AWG baterías', '2/0')
      for (const other of [named('Cable solar 4/0 AWG', '4/0'), acFeeder]) {
        const cables = judge(KIT, [other, bank], 'cables')
        expect(cables).toMatchObject({ status: 'ok', facts: { gauge: '2/0 AWG' } })
        expect(cables.sources).toEqual([bank.source])
      }
    })
    test("the ticket's own example reads short, in the quote's English", () => {
      const cables = judge(KIT, [named('Cable 4/0 AWG AC feeder', '4/0'), named('Cable 6 AWG battery', '6')], 'cables')
      expect(cables).toMatchObject({ status: 'short', facts: { gauge: '6 AWG' } })
    })
    test('capital letters set a line aside too: quotes print their wiring lines in capitals', () => {
      const texts = [
        'CABLE SOLAR 4/0 AWG', 'Cable Solar 4/0 AWG', 'CABLE FOTOVOLTAICO 4/0 AWG', 'PANELES SOLARES, CABLE 4/0 AWG',
        'ALIMENTADOR AC 4/0 AWG', 'CORRIENTE ALTERNA, CABLE 4/0 AWG', 'cable pv 4/0 awg', 'alimentador ca 4/0 awg',
      ]
      for (const text of texts) expect(judge(KIT, [named(text, '4/0'), thinBattery], 'cables').status, text).toBe('short')
    })
    test('one line that names the battery and the array is no battery cable: with nothing else beside it, it is to confirm', () => {
      expect(judge(KIT, [named('Cable 4/0 AWG baterías y paneles', '4/0')], 'cables')).toMatchObject({ status: 'unknown', facts: { batteryCableUnstated: true } })
    })
    test('the words that name the array or the AC side, in English and Spanish, set a line aside', () => {
      const texts = [
        'Cable PV 4/0 AWG', 'Cable FV 4/0 AWG', 'Cable fotovoltaico 4/0 AWG', 'Cable de paneles 4/0 AWG', 'Solar PV wire 4/0',
        'Alimentador CA 4/0 AWG', 'Cable de corriente alterna 4/0 AWG', 'AC output cable 4/0 AWG',
      ]
      for (const text of texts) expect(judge(KIT, [named(text, '4/0'), thinBattery], 'cables').status, text).toBe('short')
    })
    test('letters bound the words, as for a length: "caída", "cañería" and "acá" are no CA or AC (R2)', () => {
      const bank = named('Cable 2/0 AWG batería, caída de tensión 2%', '2/0')
      const piped = named('Cable 2/0 AWG baterías en cañería', '2/0')
      expect(judge(KIT, [bank], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '2/0 AWG' } })
      expect(judge(KIT, [piped], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '2/0 AWG' } })
      // Beside a thinner line, the 2/0 battery cable still decides: it is not set aside for the word in it.
      const cables = judge(KIT, [bank, named('Cable 10 AWG controlador', '10')], 'cables')
      expect(cables).toMatchObject({ status: 'ok', facts: { gauge: '2/0 AWG' } })
      expect(cables.sources).toEqual([bank.source])
      expect(judge(KIT, [named('Cable 4/0 AWG acá y allá', '4/0'), thinBattery], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
    })
    test('a dot or a digit is no letter: "C.A.", "A.C." and "PV1-F" name the AC side or the array (R3)', () => {
      const texts = ['Alimentador C.A. 4/0 AWG', 'Alimentador A.C. 4/0 AWG', 'Cable c.a. 4/0 AWG', 'Cable 4/0 AWG (A.C.)', 'Cable PV1-F 4/0 AWG', 'Cable FV2 4/0 AWG']
      for (const text of texts) expect(judge(KIT, [named(text, '4/0'), thinBattery], 'cables').status, text).toBe('short')
    })
    test('a ground wire or a lug left beside solar or AC wiring is no battery cable: the quote names none (R1)', () => {
      // Fittings are no main cable, so once the array and the AC side are set aside, a fitting alone leaves no cable to judge.
      const fittings = [named('Cable de tierra física 6 AWG', '6'), named('Cable desnudo tierra 6 AWG', '6'), named('Terminal de ojo 2/0 AWG', '2/0'), named('Zapatas')]
      for (const array of [named('Cable solar 4/0 AWG', '4/0'), acFeeder]) {
        for (const fitting of fittings) {
          const cables = judge(KIT, [array, fitting], 'cables')
          expect(cables, fitting.description).toMatchObject({ status: 'unknown', facts: { batteryCableUnstated: true } })
          expect(cables.sources, fitting.description).toEqual([array.source, fitting.source])
        }
      }
    })
    test('a fitting alone, with no solar or AC line set aside, reads as before: its size is what is to confirm', () => {
      expect(judge(KIT, [named('Terminales y conectores')], 'cables')).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    })
    test('a battery cable beside the ground wire and a solar line is still the one judged', () => {
      expect(judge(KIT, [pvCable, named('Cable de tierra física 6 AWG', '6'), battery], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
    })
    test('a line that names neither is a battery cable: the inverter, the DC side and an accented word do not set it aside', () => {
      for (const text of ['Cable 4/0 AWG baterías a inversor', 'Cable 4/0 AWG, lado CD', 'Cable 4/0 AWG, instalación mecánica']) {
        expect(judge(KIT, [named(text, '4/0')], 'cables')).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG' } })
      }
    })
    test('the runs a quote counts are those of the battery cable, not of the solar leads beside it', () => {
      // c2 needs two runs of 1/0, so four leads: four solar leads of 1/0 count for nothing.
      const solarLeads = named('Cable solar 1/0 AWG', '1/0', 4)
      expect(judge(c2, [solarLeads, named('Cable 1/0 AWG baterías', '1/0')], 'cables')).toMatchObject({ status: 'unknown', facts: { runs: 2, runsUnstated: true } })
      expect(judge(c2, [solarLeads, named('Cable 1/0 AWG baterías', '1/0', 4)], 'cables').status).toBe('ok')
    })
    test('the runs a fuse needs are counted in battery cable leads, not in the solar leads beside them', () => {
      // 450 A on 4/0 (230 A a run) is two runs in parallel, so four leads of battery cable.
      const bank = (qty: number) => named('Cable 4/0 AWG baterías', '4/0', qty)
      const solar = (qty: number) => named('Cable solar 4/0 AWG', '4/0', qty)
      expect(judge(KIT, [bank(1), solar(4), fuse(450)], 'fuse')).toMatchObject({ status: 'unknown', facts: { amps: 450, gauge: '4/0 AWG', runs: 2, runsUnstated: true } })
      expect(judge(KIT, [bank(4), solar(1), fuse(450)], 'fuse').status).toBe('ok')
    })
    test('the fuse is judged against the battery cable too: an AC feeder does not carry it, a solar cable does not fail it', () => {
      // 250 A is far above what 6 AWG carries, and an AC feeder of 4/0 beside it is no cable for the battery's fuse.
      expect(judge(KIT, [acFeeder, thinBattery, fuse(250)], 'fuse')).toMatchObject({ status: 'short', facts: { amps: 250, gauge: '6 AWG' } })
      // A thin solar cable alone is no cable for the fuse, so it fails nothing.
      expect(judge(KIT, [pvCable, fuse(250)], 'fuse').status).toBe('ok')
    })
    test('a ground wire left beside solar or AC wiring is no cable for the fuse either (R1)', () => {
      const ground = named('Cable de tierra física 6 AWG', '6')
      for (const array of [named('Cable solar 4/0 AWG', '4/0'), acFeeder]) {
        expect(judge(KIT, [array, ground, fuse(250)], 'fuse').status).toBe('ok')
      }
    })
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

describe('evidence (AI-18)', () => {
  /** A line as the quote writes it, on a given page, so its evidence can be told from another's. */
  const said = (kind: QuoteLine['kind'], page: number, text: string, qty: number, specs: object) =>
    line(kind, 1, { qty, description: text, source: { page, text }, specs })
  test('a bank summed from two battery lines cites both', () => {
    const x = extraction([
      said('battery', 1, 'Batería LiFePO4 5.12 kWh × 4', 4, { kWh: 5.12, chemistry: 'lifepo4' }),
      said('battery', 2, 'Batería LiFePO4 2.4 kWh × 2', 2, { kWh: 2.4, chemistry: 'lifepo4' }),
    ])
    expect(item(x, 'battery').sources).toEqual([
      { page: 1, text: 'Batería LiFePO4 5.12 kWh × 4' },
      { page: 2, text: 'Batería LiFePO4 2.4 kWh × 2' },
    ])
  })
  test('a bank left to confirm by a line with no capacity cites that line too', () => {
    const x = extraction([said('battery', 1, 'Batería LiFePO4 2.4 kWh', 1, { kWh: 2.4, chemistry: 'lifepo4' }), said('battery', 2, 'Banco de baterías', 2, {})])
    expect(item(x, 'battery')).toMatchObject({ status: 'unknown', facts: { capacityPartial: true } })
    expect(item(x, 'battery').sources.map((s) => s.text)).toEqual(['Batería LiFePO4 2.4 kWh', 'Banco de baterías'])
  })
  test('panels left to confirm by a line with no wattage cite that line too', () => {
    const x = extraction([said('panel', 1, 'Panel 550 W × 6', 6, { panelWatts: 550 }), said('panel', 2, 'Paneles adicionales', 2, {})])
    const panels = checkItems(x, { ...KIT, arrayW: 4400 }).find((c) => c.id === 'panels')!
    expect(panels).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    expect(panels.sources.map((s) => s.text)).toEqual(['Panel 550 W × 6', 'Paneles adicionales'])
  })
  test('inverters summed from two lines cite both', () => {
    const x = extraction([
      said('inverter', 1, 'Inversor 3 kW', 1, { watts: 3000, surgeWatts: 6000 }),
      said('inverter', 1, 'Inversor 2 kW', 1, { watts: 2000, surgeWatts: 4000 }),
    ])
    expect(item(x, 'inverter').sources.map((s) => s.text)).toEqual(['Inversor 3 kW', 'Inversor 2 kW'])
  })
  test('the cable check still cites only the thickest line, which decides it', () => {
    const x = extraction([
      said('wiring', 1, 'Cable 8 AWG para paneles', 2, { awg: '8' }),
      said('wiring', 2, 'Cable 4/0 AWG baterías', 2, { awg: '4/0' }),
    ])
    expect(item(x, 'cables').sources).toEqual([{ page: 2, text: 'Cable 4/0 AWG baterías' }])
  })
  test('a cable too thin for the kit cites only its thickest line, the one that falls short', () => {
    const x = extraction([
      said('wiring', 1, 'Cable 10 AWG para paneles', 2, { awg: '10' }),
      said('wiring', 2, 'Cable 2 AWG baterías', 2, { awg: '2' }),
    ])
    const cables = item(x, 'cables')
    expect(cables).toMatchObject({ status: 'short', facts: { gauge: '2 AWG' } })
    expect(cables.sources).toEqual([{ page: 2, text: 'Cable 2 AWG baterías' }])
  })
  test('a cable the kit needs in parallel runs cites only its thickest line', () => {
    // 400 A of design current is two runs of 4/0 (230 A a run); the four 4/0 leads count them.
    const heavy: KitNeeds = { ...KIT, designA: 400 }
    const x = extraction([
      said('wiring', 1, 'Cable 8 AWG para paneles', 2, { awg: '8' }),
      said('wiring', 2, 'Cable 4/0 AWG baterías', 4, { awg: '4/0' }),
    ])
    const cables = checkItems(x, heavy).find((c) => c.id === 'cables')!
    expect(cables).toMatchObject({ status: 'ok', facts: { gauge: '4/0 AWG', runs: 2 } })
    expect(cables.sources).toEqual([{ page: 2, text: 'Cable 4/0 AWG baterías' }])
  })
  test('cables with no readable size cite one line: the first that could be the main cable, not a fitting', () => {
    const x = extraction([
      said('wiring', 1, 'Terminales y zapatas', 10, {}),
      said('wiring', 1, 'Cableado de baterías e inversor', 1, {}),
      said('wiring', 2, 'Cableado AC', 1, {}),
    ])
    const cables = item(x, 'cables')
    expect(cables).toMatchObject({ status: 'unknown', facts: { sizeUnknown: true } })
    expect(cables.sources).toEqual([{ page: 1, text: 'Cableado de baterías e inversor' }])
  })
  test("a fuse check that counts and classes every main fuse cites each of them; one too small cites only itself", () => {
    const fuses = [
      said('wiring', 1, 'Cable 4/0 AWG', 2, { awg: '4/0' }),
      said('fuse', 1, 'Fusible clase T 175 A', 1, { fuseAmps: 175, fuseClass: 'T' }),
      said('fuse', 2, 'Fusible clase T 200 A', 1, { fuseAmps: 200, fuseClass: 'T' }),
    ]
    expect(item(extraction(fuses), 'fuse').sources.map((s) => s.text)).toEqual(['Fusible clase T 175 A', 'Fusible clase T 200 A'])
    const small = [said('fuse', 1, 'Fusible 100 A', 1, { fuseAmps: 100, fuseClass: 'T' }), said('fuse', 1, 'Fusible 30 A', 1, { fuseAmps: 30, fuseClass: 'T' })]
    expect(item(extraction(small), 'fuse')).toMatchObject({ status: 'short', sources: [{ page: 1, text: 'Fusible 100 A' }] })
  })
  test('an item the quote does not mention cites nothing', () => {
    expect(item(extraction([line('labor', 1)]), 'charger').sources).toEqual([])
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
