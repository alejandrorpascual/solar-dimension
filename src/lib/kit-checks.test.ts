import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
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
    expect(by.surge!.lines[0]).toBe("1,515 W for 3 s, within the inverter's 6,000 W surge rating")
    expect(by.surge!.lines[1]).toBe('465 W running + 1,050 W (Refrigerator) starting')
    expect(by.batteryContinuous!.lines).toEqual(['Bank gives 200 A continuous; the inverter draws up to 69 A'])
    expect(by.batteryPeak!.lines).toEqual(['Bank peak 400 A covers the 35 A start-up for 3 s'])
    expect(by.parallel!.lines).toEqual(['One string, nothing to balance'])
    expect(by.fuse!.lines[0]).toBe("100 A class T: under the cable's 115 A, 20 kA interrupting, start-up 35 A within what it holds")
    expect(by.cable!.lines[0]).toBe('2 AWG carries 115 A after derating (30 °C) for a 87 A design current · 0.1% drop at start-up')
  })

  test('names come from the dictionary in both languages', () => {
    expect(kitChecks(en, kit(ESSENTIALS), 'en').map((c) => c.name)).toEqual(['Start-up peak', 'Battery continuous current', 'Battery peak current', 'Parallel strings', 'Fuse', 'Cable'])
    expect(kitChecks(es, kit(ESSENTIALS), 'es').map((c) => c.name)).toEqual(['Pico de arranque', 'Corriente continua de la batería', 'Corriente pico de la batería', 'Ramas en paralelo', 'Fusible', 'Cable'])
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

  test('a cable row that cannot carry its design current fails the cable check and names the row, in both languages', () => {
    // 3 kW at 12 V on two strings in 50 °C air on 75 °C cable: 139 A a string needs 174 A, and 4/0 carries 172.5 A there.
    const custom = [{ id: 'custom1', name: 'Workshop', watts: 2400, surge: 2400, note: '' }]
    const r = kit({ custom1: 1 }, { custom, hours: 1, volts: 12, cable: { ambientC: 50, insulationC: 75 } })
    const cable = kitChecks(en, r, 'en').find((c) => c.id === 'cable')!
    expect(cable.status).toBe('warn')
    expect(cable.lines).toEqual(['4/0 AWG for the string leads carries only 172.5 A after derating, under the 173.7 A design current of each cable. Move the bank somewhere cooler, use 90 °C cable, raise the voltage to 24 V or trim the load.'])
    expect(kitChecks(es, r, 'es').find((c) => c.id === 'cable')!.lines).toEqual(['El 4/0 AWG para los cables de rama solo soporta 172.5 A tras la corrección, menos que la corriente de diseño de 173.7 A de cada cable. Lleva el banco a un lugar más fresco, usa cable de 90 °C, sube el voltaje a 24 V o reduce la carga.'])
  })

  test('the short-cable line offers only what would work: no higher voltage at 48 V, no cooler spot in a cool room', () => {
    // 8.1 kW at 48 V on two strings in 50 °C air on 75 °C cable: there is no bank voltage above 48 V to go to.
    const big = [{ id: 'custom1', name: 'Workshop', watts: 8100, surge: 8100, note: '' }]
    const hot = kit({ custom1: 1 }, { custom: big, hours: 1, volts: 48, cable: { ambientC: 50, insulationC: 75 } })
    expect(hot.battery!.config).toBe('1S2P')
    expect(kitChecks(en, hot, 'en').find((c) => c.id === 'cable')!.lines).toEqual(['4/0 AWG for the string leads carries only 172.5 A after derating, under the 173.7 A design current of each cable. Move the bank somewhere cooler, use 90 °C cable or trim the load.'])
    // A heater and a microwave at 12 V in a cool room: 4/0 is at its terminations, so only a higher voltage or less load helps.
    const cool = kit({ heater: 1, micro: 1 }, { hours: 4, volts: 12 })
    const line = '4/0 AWG for the string leads carries only 230 A after derating, under the 231.5 A design current of each cable. Raise the voltage to 24 V or trim the load.'
    expect(kitChecks(en, cool, 'en').find((c) => c.id === 'cable')!.lines).toContain(line)
    expect(kitChecks(es, cool, 'es').find((c) => c.id === 'cable')!.lines).toContain('El 4/0 AWG para los cables de rama solo soporta 230 A tras la corrección, menos que la corriente de diseño de 231.5 A de cada cable. Sube el voltaje a 24 V o reduce la carga.')
  })

  test('with several runs the passing cable line states one run\'s design current, rounded once', () => {
    // 4,801 W at 36 V: 154.3 A a run. Halving the rounded total (309 A) would print 155.
    const custom = [{ id: 'custom1', name: 'Workshop', watts: 4801, surge: 4801, note: '' }]
    const cable = kitChecks(en, kit({ custom1: 1 }, { custom, hours: 2, volts: 36 }), 'en').find((c) => c.id === 'cable')!
    expect(cable.status).toBe('pass')
    expect(cable.lines[0]).toContain('2 × 2/0 AWG carries 175 A')
    expect(cable.lines[0]).toContain('for a 154 A design current per run')
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
    expect(warningKey({ code: 'cableUndersized', params: { conductor: 'stringLeads' } })).not.toBe(warningKey({ code: 'cableUndersized', params: { conductor: 'interconnects' } }))
  })
})
