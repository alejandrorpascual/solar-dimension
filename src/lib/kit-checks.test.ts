import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { DEFAULT_HARDWARE } from './catalog'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { CHECK_IDS, CHECK_WARNINGS, kitChecks, uncheckedWarnings, warningKey, warningText } from './kit-checks'
import { compute, type SizingInput } from './sizing'

const en = getDictionary('en')
const es = getDictionary('es')
const ESSENTIALS = { fridge: 1, lights: 1, router: 1, tv: 1, phone: 2, laptop: 1 }
const kit = (qty: Record<string, number>, extra: Partial<SizingInput> = {}) =>
  compute({ qty, hours: 10, volts: 48, chemistry: 'lifepo4', ...extra }, CATALOG_SNAPSHOT)

describe('kitChecks', () => {
  test('a sound kit passes all six checks, each with a line that names its figures', () => {
    const checks = kitChecks(en, kit(ESSENTIALS), 'en')
    expect(checks.map((c) => c.id)).toEqual(CHECK_IDS)
    expect(checks.every((c) => c.status === 'pass')).toBe(true)
    const by = Object.fromEntries(checks.map((c) => [c.id, c]))
    expect(by.surge!.lines[0]).toBe('465 W running on a 3,000 W inverter · 1,515 W for 3 s, within its 6,000 W surge rating')
    expect(by.surge!.lines[1]).toBe('465 W running + 1,050 W (Refrigerator) starting')
    expect(by.batteryContinuous!.lines).toEqual(['Bank gives 200 A continuous; the inverter draws up to 69 A'])
    expect(by.batteryPeak!.lines).toEqual(['Bank peak 400 A covers the 35 A start-up for 3 s'])
    expect(by.parallel!.lines).toEqual(['One string, nothing to balance'])
    expect(by.fuse!.lines[0]).toBe("100 A class T: under the cable's 115 A, 20 kA interrupting, start-up 35 A within what it holds")
    expect(by.cable!.lines[0]).toBe('2 AWG carries 115 A after derating (30 °C) for a 87 A design current · 0.1% drop at start-up')
  })

  test('names come from the dictionary in both languages', () => {
    expect(kitChecks(en, kit(ESSENTIALS), 'en').map((c) => c.name)).toEqual(['Inverter', 'Battery continuous current', 'Battery peak current', 'Parallel strings', 'Fuse', 'Cable'])
    expect(kitChecks(es, kit(ESSENTIALS), 'es').map((c) => c.name)).toEqual(['Inversor', 'Corriente continua de la batería', 'Corriente pico de la batería', 'Ramas en paralelo', 'Fusible', 'Cable'])
  })

  test('a failing check shows its warnings instead of the pass line, and lists every starter', () => {
    const r = kit({ fridge: 1, micro: 1 }, { volts: 12, chemistry: 'agm', batteryUnit: '12-100', simultaneousStarts: 2 })
    const by = Object.fromEntries(kitChecks(en, r, 'en').map((c) => [c.id, c]))
    expect(by.batteryContinuous!.status).toBe('warn')
    expect(by.batteryContinuous!.lines[0]).toContain('BMS would cut out')
    expect(by.surge!.lines.at(-1)).toContain('Refrigerator')
    expect(r.surgeProfile.starters.length).toBeGreaterThanOrEqual(1)
  })

  test('parallel strings report the maker limit, and the bundled cable says so', () => {
    const r = kit(ESSENTIALS, { volts: 12, cable: { bundled: true } })
    const by = Object.fromEntries(kitChecks(en, r, 'en').map((c) => [c.id, c]))
    expect(by.parallel!.lines).toEqual(['2 in parallel, within the 4 the maker allows'])
    expect(by.cable!.lines[0]).toContain('(30 °C · bundled)')
  })

  test('with several runs the cable line reads per run', () => {
    const custom = [{ id: 'custom1', name: 'Workshop', watts: 7000, surge: 7000, note: '' }]
    const r = kit({ custom1: 1 }, { custom })
    const cable = kitChecks(en, r, 'en').find((c) => c.id === 'cable')!
    expect(r.cable.runs).toBe(2)
    expect(cable.status).toBe('pass')
    expect(cable.lines[0]).toContain('2 × 1/0 AWG carries 150 A')
    expect(cable.lines[0]).toContain('145 A design current per run')
  })

  test('an inverter under the running load, or short of its headroom, fails the inverter check with its own wording in both languages', () => {
    // A list whose units work alone: past its largest one there is nothing to add, so the single inverter is flagged.
    const hardware = { ...DEFAULT_HARDWARE, inverters: DEFAULT_HARDWARE.inverters.map(({ maxParallel: _maxParallel, ...unit }) => unit) }
    const load = (watts: number) =>
      compute({ qty: { custom1: 1 }, custom: [{ id: 'custom1', name: 'Workshop', watts, surge: watts, note: '' }], hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const inverter = (r: ReturnType<typeof kit>, locale: 'en' | 'es') => kitChecks(locale === 'en' ? en : es, r, locale).find((c) => c.id === 'surge')!
    expect(inverter(load(9600), 'en').status).toBe('pass')
    const tight = load(9601)
    expect(inverter(tight, 'en').status).toBe('warn')
    expect(inverter(tight, 'en').lines).toEqual(['The 12,000 W inverter leaves 24% headroom over the 9,601 W running load; this kit plans for 25%. Trim the load, or ask an installer about a larger inverter or units built to run in parallel.'])
    expect(inverter(tight, 'es').lines).toEqual(['El inversor de 12,000 W deja 24% de margen sobre la carga en marcha de 9,601 W; este kit prevé 25%. Reduce la carga o pregunta a un instalador por un inversor mayor o por equipos hechos para trabajar en paralelo.'])
    const over = load(15000)
    expect(inverter(over, 'en').lines).toEqual(['The 12,000 W inverter is smaller than the 15,000 W running load and cannot carry it. Trim the load, or ask an installer about a larger inverter or units built to run in parallel.'])
    expect(inverter(over, 'es').lines).toEqual(['El inversor de 12,000 W es menor que la carga en marcha de 15,000 W y no puede sostenerla. Reduce la carga o pregunta a un instalador por un inversor mayor o por equipos hechos para trabajar en paralelo.'])
    expect(uncheckedWarnings(over).map((w) => w.code)).not.toContain('inverterUndersized')
  })

  test('inverters in parallel pass as a set: the lines name how many, what they give together and what each one draws', () => {
    // One model, so the pick does not depend on how sets are ranked: 7 kW needs 8.75 kW, two 5 kW units.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 5000, surge: 10000, volts: [48] as const, surgeSeconds: 5, maxParallel: 4 }] }
    const r = compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 7000, surge: 7000, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const lines = (locale: 'en' | 'es') => Object.fromEntries(kitChecks(locale === 'en' ? en : es, r, locale).map((c) => [c.id, c.lines[0]]))
    expect(kitChecks(en, r, 'en').map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass'])
    expect(lines('en').surge).toBe('7,000 W running on 2 × 5,000 W inverters (10.0 kW together) · 7,000 W for 0 s, within their 20.0 kW surge rating')
    expect(lines('es').surge).toBe('7,000 W en marcha con 2 inversores de 5,000 W (10.0 kW en total) · 7,000 W durante 0 s, dentro de sus 20.0 kW de arranque')
    expect(lines('en').batteryContinuous).toMatch(/^Bank gives \d+ A continuous; the 2 inverters draw up to 231 A together$/)
    expect(lines('es').batteryContinuous).toMatch(/^El banco entrega \d+ A continuos; los 2 inversores toman hasta 231 A en total$/)
    expect(lines('en').cable).toContain('2 × 1/0 AWG carries 150 A after derating')
    expect(lines('en').cable).toContain('for a 145 A design current per inverter')
    expect(lines('es').cable).toContain('145 A de diseño por inversor')
  })

  test('a set that still falls short fails the inverter check and is named as a set, in both languages', () => {
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 5000, surge: 10000, volts: [48] as const, surgeSeconds: 5, maxParallel: 2 }] }
    const load = (watts: number, surge = watts) =>
      compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts, surge, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const inverter = (r: ReturnType<typeof load>, locale: 'en' | 'es') => kitChecks(locale === 'en' ? en : es, r, locale).find((c) => c.id === 'surge')!.lines
    expect(inverter(load(9000), 'en')).toEqual(['The 2 × 5,000 W inverters in parallel (10,000 W) leave 11% headroom over the 9,000 W running load; this kit plans for 25%. Trim the load, or ask an installer about a system built for it.'])
    expect(inverter(load(9000), 'es')).toEqual(['Los 2 inversores de 5,000 W en paralelo (10,000 W) dejan 11% de margen sobre la carga en marcha de 9,000 W; este kit prevé 25%. Reduce la carga o pregunta a un instalador por un sistema hecho para ella.'])
    expect(inverter(load(12000), 'en')).toEqual(['The 2 × 5,000 W inverters in parallel (10,000 W) are smaller than the 12,000 W running load and cannot carry it. Trim the load, or ask an installer about a system built for it.'])
    expect(inverter(load(12000), 'es')).toEqual(['Los 2 inversores de 5,000 W en paralelo (10,000 W) son menores que la carga en marcha de 12,000 W y no pueden sostenerla. Reduce la carga o pregunta a un instalador por un sistema hecho para ella.'])
    // Two 8 kW units on a 24 V bank draw 741 A between them: a higher voltage would carry that on less, so the whole DC side is named.
    const low = (watts: number) =>
      compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts, surge: watts, note: '' }], hours: 2, volts: 24, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, { ...hardware, inverters: [{ w: 8000, surge: 16000, volts: [24] as const, surgeSeconds: 5, maxParallel: 2 }] })
    const high = low(9000).warnings.find((w) => w.code === 'highCurrent')!
    expect(high.params).toEqual({ amps: 741, volts: 24, nextVolts: 36 })
    expect(warningText(en, high, [])).toBe('741 A on the DC side at 24 V is hard to wire safely. Consider 36 V.')
    expect(warningText(es, high, [])).toBe('741 A en el lado de CC a 24 V es difícil de cablear con seguridad. Considera 36 V.')
    expect(warningText(en, low(5000).warnings.find((w) => w.code === 'highCurrent')!, [])).toBe('370 A on the DC side at 24 V is hard to wire safely. Consider 36 V.')
    // At 48 V there is no higher voltage to suggest: the note is about what one inverter's cables are asked for.
    const top = compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 20000, surge: 20000, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, { ...hardware, inverters: [{ w: 15000, surge: 30000, volts: [48] as const, surgeSeconds: 5, maxParallel: 2 }] })
    const each = top.warnings.find((w) => w.code === 'highCurrent')!
    expect(each.params).toEqual({ amps: 347, volts: 48, nextVolts: null, inverters: 2 })
    expect(warningText(en, each, [])).toBe('347 A to each inverter at 48 V is hard to wire safely.')
    expect(warningText(es, each, [])).toBe('347 A hacia cada inversor a 48 V es difícil de cablear con seguridad.')
    // Four 8 kW units draw 741 A; an hour of it takes eleven 50 A units, 550 A, so the bank is named as short for the set.
    const starved = compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 20000, surge: 20000, note: '' }], hours: 1, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-50' }, CATALOG_SNAPSHOT, { ...hardware, inverters: [{ w: 8000, surge: 16000, volts: [48] as const, surgeSeconds: 5, maxParallel: 4 }] })
    const discharge = starved.warnings.find((w) => w.code === 'bankDischarge')!
    expect(discharge.params).toMatchObject({ inverters: 4, needA: 741, maxA: 550, strings: 11 })
    expect(warningText(en, discharge, starved.items)).toMatch(/^The 4 inverters draw up to 741 A together at full load; \d+ × 48 V 50 Ah LiFePO₄ allows [\d,]+ A continuous and its BMS would cut out\. /)
    expect(warningText(es, discharge, starved.items)).toMatch(/^Los 4 inversores toman hasta 741 A en total a plena carga; \d+ × 48 V 50 Ah LiFePO₄ permite [\d,]+ A continuos y su BMS cortaría\. /)
    // 2 kW running fits the pair; a 30 kW start does not fit its 20 kW surge.
    const start = load(2000, 30000)
    expect(start.inverter).toMatchObject({ count: 2, headroomOk: true, surgeOk: false })
    const surge = start.warnings.find((w) => w.code === 'surgeDuration')!
    expect(warningText(en, surge, start.items)).toBe(`A 30,000 W start-up lasting ${start.surgeSeconds} s is longer than the surge window of the 2 × 5,000 W inverters; together they only hold 20,000 W that long. Let fewer motors start at once.`)
    expect(warningText(es, surge, start.items)).toBe(`Un arranque de 30,000 W durante ${start.surgeSeconds} s supera la ventana de arranque de los 2 inversores de 5,000 W; juntos solo sostienen 20,000 W ese tiempo. Deja que arranquen menos motores a la vez.`)
  })

  test('a cable row that cannot carry its design current fails the cable check and names the row, in both languages', () => {
    // 3 kW at 12 V on two strings in 50 °C air on 75 °C cable: 139 A a string needs 174 A, and 4/0 carries 172.5 A there.
    const custom = [{ id: 'custom1', name: 'Workshop', watts: 2400, surge: 2400, note: '' }]
    const r = kit({ custom1: 1 }, { custom, hours: 1, volts: 12, cable: { ambientC: 50, insulationC: 75 } })
    const cable = kitChecks(en, r, 'en').find((c) => c.id === 'cable')!
    expect(cable.status).toBe('warn')
    expect(cable.lines).toEqual(['4/0 AWG for the string leads carries only 172.5 A after derating, under its 173.7 A design current. Raise the voltage, trim the load or move the bank somewhere cooler.'])
    expect(kitChecks(es, r, 'es').find((c) => c.id === 'cable')!.lines).toEqual(['El 4/0 AWG para los cables de rama solo soporta 172.5 A tras la corrección, menos que su corriente de diseño de 173.7 A. Sube el voltaje, reduce la carga o lleva el banco a un lugar más fresco.'])
  })

  test('nothing to check for an empty kit', () => {
    expect(kitChecks(en, kit({}), 'en')).toEqual([])
  })

  test('every warning code the checks own is a real code, and no code is owned twice', () => {
    const owned = Object.values(CHECK_WARNINGS).flat()
    expect(new Set(owned).size).toBe(owned.length)
    for (const code of owned) expect(typeof en.warnings[code]).toBe('function')
  })
})

describe('uncheckedWarnings and keys', () => {
  test('general notes stay out of the checks and keep their own text', () => {
    const r = kit({ wheater: 1, fridge: 1, ac1c: 1 })
    const codes = uncheckedWarnings(r).map((w) => w.code)
    expect(codes).toContain('splitPhase')
    for (const code of codes) expect(Object.values(CHECK_WARNINGS).flat()).not.toContain(code)
    const split = r.warnings.find((w) => w.code === 'splitPhase')!
    expect(warningText(es, split, r.items)).toContain('Calentador de agua eléctrico')
  })

  test('warningKey tells apart two warnings with the same code', () => {
    expect(warningKey({ code: 'splitPhase', params: { itemId: 'a' } })).not.toBe(warningKey({ code: 'splitPhase', params: { itemId: 'b' } }))
    expect(warningKey({ code: 'highCurrent', params: { amps: 1 } })).toBe(warningKey({ code: 'highCurrent', params: { amps: 2 } }))
  })
})
