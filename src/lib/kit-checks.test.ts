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
    expect(by.surge!.lines[0]).toBe('465 W running on a 3,000 W inverter · 1,515 W for 3 s, within its assumed 6,000 W surge rating')
    expect(by.surge!.lines[1]).toBe('465 W running + 1,050 W (Refrigerator) starting')
    expect(kitChecks(es, kit(ESSENTIALS), 'es')[0]!.lines[0]).toBe('465 W en marcha con un inversor de 3,000 W · 1,515 W durante 3 s, dentro de sus 6,000 W de arranque supuestos')
    expect(by.batteryContinuous!.lines).toEqual(['Bank gives an assumed 200 A continuous; the inverter draws up to 69 A'])
    expect(by.batteryPeak!.lines).toEqual(['Bank peak of an assumed 400 A covers the 35 A start-up for 3 s'])
    expect(by.parallel!.lines).toEqual(['One string, nothing to balance · assumed limit of 16 in parallel'])
    expect(by.fuse!.lines[0]).toBe("100 A class T: under the cable's 115 A, 20 kA interrupting, start-up 35 A within what it holds")
    expect(by.cable!.lines[0]).toBe('2 AWG carries 115 A after derating (30 °C) for a 87 A design current · 0.2% drop, 0.1% at start-up')
    expect(kitChecks(es, kit(ESSENTIALS), 'es').at(-1)!.lines[0]).toBe('2 AWG soporta 115 A tras la corrección (30 °C) para 87 A de diseño · 0.2% de caída, 0.1% al arrancar')
  })

  test('names come from the dictionary in both languages', () => {
    expect(kitChecks(en, kit(ESSENTIALS), 'en').map((c) => c.name)).toEqual(['Inverter size', 'Battery continuous current', 'Battery peak current', 'Parallel strings', 'Fuse', 'Cable'])
    expect(kitChecks(es, kit(ESSENTIALS), 'es').map((c) => c.name)).toEqual(['Tamaño del inversor', 'Corriente continua de la batería', 'Corriente pico de la batería', 'Ramas en paralelo', 'Fusible', 'Cable'])
  })

  test('a failing check shows its warnings instead of the pass line, and lists every starter', () => {
    const r = kit({ fridge: 1, micro: 1 }, { volts: 12, chemistry: 'agm', batteryUnit: '12-100', simultaneousStarts: 2 })
    const by = Object.fromEntries(kitChecks(en, r, 'en').map((c) => [c.id, c]))
    expect(by.batteryContinuous!.status).toBe('warn')
    expect(by.batteryContinuous!.lines[0]).toContain('BMS would cut out')
    expect(by.surge!.lines.at(-1)).toContain('Refrigerator')
    expect(r.surgeProfile.starters.length).toBeGreaterThanOrEqual(1)
  })

  test('3 kW at 12 V over a 10 m run drops more than 3% at full load: the cable check warns and says so', () => {
    const custom = [{ id: 'x', name: 'Load', watts: 2000, surge: 2000, note: '' }]
    const r = kit({ x: 1 }, { custom, hours: 1, volts: 12, cable: { runLengthM: 10 } })
    expect([r.inverter.w, r.cable.runs, r.cable.gauge, r.cable.dropPct]).toEqual([3000, 2, '4/0 AWG', 3.7])
    const cable = (t: typeof en, locale: 'en' | 'es') => kitChecks(t, r, locale).find((c) => c.id === 'cable')!
    expect(cable(en, 'en')).toMatchObject({ status: 'warn', lines: ['The cable drops 3.7% at full load, more than the 3% it is sized for, even on the largest gauge. Shorten the run or pick a higher bank voltage.'] })
    expect(cable(es, 'es').lines).toEqual(['El cable cae 3.7% a plena carga, más del 3% previsto, aun con el calibre más grueso. Acorta el tramo o elige un voltaje de banco mayor.'])
  })

  test('parallel strings report the assumed limit, and the bundled cable says so', () => {
    const r = kit(ESSENTIALS, { volts: 12, cable: { bundled: true } })
    const by = Object.fromEntries(kitChecks(en, r, 'en').map((c) => [c.id, c]))
    expect(by.parallel!.lines).toEqual(['2 in parallel, within the assumed limit of 4'])
    expect(kitChecks(es, r, 'es').find((c) => c.id === 'parallel')!.lines).toEqual(['2 en paralelo, dentro del límite supuesto de 4'])
    expect(by.cable!.lines[0]).toContain('(30 °C · bundled)')
  })

  // The battery and inverter ratings are generic, not a maker's datasheet; the fuse and cable lines rest on code tables.
  test.each([['en', 'assumed'], ['es', 'supuesto']] as const)('the pass lines resting on a generic rating say it is assumed, the fuse and cable lines do not (%s)', (locale, word) => {
    const t = locale === 'en' ? en : es
    // One string at 48 V, two in parallel at 12 V: both of the parallel check's pass lines.
    for (const r of [kit(ESSENTIALS), kit(ESSENTIALS, { volts: 12 })]) {
      const by = Object.fromEntries(kitChecks(t, r, locale).map((c) => [c.id, c]))
      for (const id of ['surge', 'batteryContinuous', 'batteryPeak', 'parallel'] as const) {
        expect(by[id]!.status).toBe('pass')
        expect(by[id]!.lines[0]).toContain(word)
      }
      for (const id of ['fuse', 'cable'] as const) {
        expect(by[id]!.status).toBe('pass')
        expect(by[id]!.lines.join(' ')).not.toContain(word)
      }
    }
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

  // A list whose units work alone: past its largest one there is nothing to add, so the single inverter is flagged.
  const solo = { ...DEFAULT_HARDWARE, inverters: DEFAULT_HARDWARE.inverters.map(({ maxParallel: _maxParallel, ...unit }) => unit) }
  const load = (watts: number, extra: Partial<SizingInput> = {}, surge = watts) =>
    compute({ qty: { custom1: 1 }, custom: [{ id: 'custom1', name: 'Workshop', watts, surge, note: '' }], hours: 10, volts: 48, chemistry: 'lifepo4', ...extra }, CATALOG_SNAPSHOT, solo)
  // The check with id `surge` is the one shown as "Inverter size".
  const inverter = (r: ReturnType<typeof kit>, locale: 'en' | 'es') => kitChecks(locale === 'en' ? en : es, r, locale).find((c) => c.id === 'surge')!

  test('an inverter under the running load, or short of its headroom, fails the inverter size check with its own wording in both languages', () => {
    expect(inverter(load(9600), 'en').status).toBe('pass')
    const tight = load(9601)
    expect(inverter(tight, 'en').status).toBe('warn')
    expect(inverter(tight, 'en').lines).toEqual(['The 12,000 W inverter leaves 24% headroom over the 9,601 W running load; this kit plans for 25%. Trim the load, or ask an installer about a larger inverter or units built to run in parallel.'])
    expect(inverter(tight, 'es').lines).toEqual(['El inversor de 12,000 W deja 24% de margen sobre la carga en marcha de 9,601 W; este kit prevé 25%. Reduce la carga o pregunta a un instalador por un inversor mayor o por equipos hechos para trabajar en paralelo.'])
    const over = load(15000)
    expect(inverter(over, 'en').lines).toEqual(['The 12,000 W inverter is smaller than the 15,000 W running load and cannot carry it. Trim the load, or ask an installer about a larger inverter or units built to run in parallel.'])
    expect(inverter(over, 'es').lines).toEqual(['El inversor de 12,000 W es menor que la carga en marcha de 15,000 W y no puede sostenerla. Reduce la carga o pregunta a un instalador por un inversor mayor o por equipos hechos para trabajar en paralelo.'])
    expect(uncheckedWarnings(over).map((w) => w.code)).not.toContain('inverterUndersized')
    // A load equal to the rating is carried with nothing to spare: the headroom wording, not "smaller than".
    const level = load(12000)
    expect(inverter(level, 'en').lines[0]).toMatch(/^The 12,000 W inverter leaves 0% headroom over the 12,000 W running load; this kit plans for 25%\./)
    expect(inverter(level, 'es').lines[0]).toMatch(/^El inversor de 12,000 W deja 0% de margen sobre la carga en marcha de 12,000 W; este kit prevé 25%\./)
  })

  test('an inverter short of the load and of the start-up at once lists both, the running load first', () => {
    const check = inverter(load(15000, {}, 30000), 'en')
    expect(check.status).toBe('warn')
    expect(check.lines).toHaveLength(3)
    expect(check.lines[0]).toContain('is smaller than the 15,000 W running load and cannot carry it')
    expect(check.lines[1]).toContain("A 30,000 W start-up is more than the 12,000 W inverter's 24,000 W surge rating")
    expect(check.lines[2]).toBe('15.0 kW running + 15.0 kW (Workshop) starting')
  })

  test('a start-up the inverter cannot hold says why, in both languages: above its surge rating, or within it and too long', () => {
    // 2 kW running with a 30 kW start, inside the 12 kW inverter's window: the watts are over its 24 kW surge rating.
    const above = load(2000, {}, 30000)
    expect(inverter(above, 'en').lines[0]).toBe("A 30,000 W start-up is more than the 12,000 W inverter's 24,000 W surge rating. Choose a bigger inverter or let fewer motors start at once.")
    expect(inverter(above, 'es').lines[0]).toBe('Un arranque de 30,000 W supera los 24,000 W de arranque del inversor de 12,000 W. Elige un inversor mayor o deja que arranquen menos motores a la vez.')
    // A unit that holds 4 kW for half a second: the well pump's 3 kW start is within that rating and outlasts its window.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 2000, surge: 4000, volts: [48] as const, surgeSeconds: 0.5 }] }
    const long = compute({ qty: { well: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    expect(inverter(long, 'en').lines[0]).toBe("A 3,000 W start-up lasting 1 s is longer than the 2,000 W inverter's surge window; it only holds 2,000 W that long. Choose a bigger inverter or let fewer motors start at once.")
    expect(inverter(long, 'es').lines[0]).toBe('Un arranque de 3,000 W durante 1 s supera la ventana de arranque del inversor de 2,000 W; solo sostiene 2,000 W ese tiempo. Elige un inversor mayor o deja que arranquen menos motores a la vez.')
  })

  test('an inverter sold for another voltage is a note beside the checks, and the inverter size check still passes', () => {
    // 4,001 W at 24 V is past the largest 24 V inverter, so the engine lists a 6 kW one sold for 48 V.
    const r = load(4001, { volts: 24 })
    expect(r.inverter).toMatchObject({ w: 6000, voltsOk: false, headroomOk: true })
    expect(inverter(r, 'en').status).toBe('pass')
    expect(uncheckedWarnings(r).map((w) => w.code)).toContain('inverterVoltage')
  })

  test('inverters in parallel pass as a set: the lines name how many, what they give together and what each one draws', () => {
    // One model, so the pick does not depend on how sets are ranked: 7 kW needs 8.75 kW, two 5 kW units.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 5000, surge: 10000, volts: [48] as const, surgeSeconds: 5, maxParallel: 4 }] }
    const r = compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 7000, surge: 7000, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const lines = (locale: 'en' | 'es') => Object.fromEntries(kitChecks(locale === 'en' ? en : es, r, locale).map((c) => [c.id, c.lines[0]]))
    expect(kitChecks(en, r, 'en').map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass'])
    expect(lines('en').surge).toBe('7,000 W running on 2 × 5,000 W inverters (10.0 kW together) · 7,000 W for 0 s, within their assumed 20.0 kW surge rating')
    expect(lines('es').surge).toBe('7,000 W en marcha con 2 inversores de 5,000 W (10.0 kW en total) · 7,000 W durante 0 s, dentro de sus 20.0 kW de arranque supuestos')
    expect(lines('en').batteryContinuous).toMatch(/^Bank gives an assumed \d+ A continuous; the 2 inverters draw up to 231 A together$/)
    expect(lines('es').batteryContinuous).toMatch(/^El banco entrega \d+ A continuos supuestos; los 2 inversores toman hasta 231 A en total$/)
    // The 162 A start-up is split between the two fuses.
    expect(lines('en').fuse).toBe("150 A class T: under the cable's 150 A, 20 kA interrupting, start-up 81 A within what it holds")
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
    // Its eight fuses are judged against the bank's share for each, and the note counts them.
    const above = starved.warnings.find((w) => w.code === 'fuseAboveBank')!
    expect(above.params).toEqual({ fuseA: 125, maxA: 550, count: 8 })
    expect(warningText(en, above, [])).toBe('The 8 × 125 A fuses are sized for more than the 550 A the bank can deliver, so the BMS, not a fuse, would trip on an overload. Pick a bank that delivers more.')
    expect(warningText(es, above, [])).toBe('Los 8 fusibles de 125 A están dimensionados para más de los 550 A que el banco puede entregar, así que cortaría el BMS y no un fusible en una sobrecarga. Elige un banco que entregue más.')
    expect(warningText(en, discharge, starved.items)).toMatch(/^The 4 inverters draw up to 741 A together at full load; \d+ × 48 V 50 Ah LiFePO₄ allows [\d,]+ A continuous and its BMS would cut out\. /)
    expect(warningText(es, discharge, starved.items)).toMatch(/^Los 4 inversores toman hasta 741 A en total a plena carga; \d+ × 48 V 50 Ah LiFePO₄ permite [\d,]+ A continuos y su BMS cortaría\. /)
    // 2 kW running fits the pair; a 30 kW start is more than the 20 kW the pair ever holds in a surge, at any length.
    const start = load(2000, 30000)
    expect(start.inverter).toMatchObject({ count: 2, headroomOk: true, surgeOk: false })
    const surge = start.warnings.find((w) => w.code === 'surgeDuration')!
    expect(warningText(en, surge, start.items)).toBe('A 30,000 W start-up is more than the 20,000 W surge rating of the 2 × 5,000 W inverters together. Let fewer motors start at once.')
    expect(warningText(es, surge, start.items)).toBe('Un arranque de 30,000 W supera los 20,000 W de arranque de los 2 inversores de 5,000 W juntos. Deja que arranquen menos motores a la vez.')
    // A pair that holds 4 kW for half a second and 2 kW after that: a 3 kW start is within the rating and only outlasts the window.
    const brief = compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 1000, surge: 3000, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, { ...hardware, inverters: [{ w: 1000, surge: 2000, volts: [48] as const, surgeSeconds: 0.5, maxParallel: 2 }] })
    expect(brief.inverter).toMatchObject({ count: 2, headroomOk: true, surgeOk: false })
    const long = brief.warnings.find((w) => w.code === 'surgeDuration')!
    expect(long.params).toMatchObject({ inverters: 2, ratedW: 2000, inverterSurgeW: 4000, tooLong: true })
    expect(warningText(en, long, brief.items)).toBe(`A 3,000 W start-up lasting ${brief.surgeSeconds} s is longer than the surge window of the 2 × 1,000 W inverters; together they only hold 2,000 W that long. Let fewer motors start at once.`)
    expect(warningText(es, long, brief.items)).toBe(`Un arranque de 3,000 W durante ${brief.surgeSeconds} s supera la ventana de arranque de los 2 inversores de 1,000 W; juntos solo sostienen 2,000 W ese tiempo. Deja que arranquen menos motores a la vez.`)
  })

  test('a start-up between the two surge windows is too long up to the full surge rating, and names what the longer rating holds', () => {
    // A pair whose units each hold 2 kW for half a second, 1.5 kW for two seconds and 1 kW after that.
    const hardware = { ...DEFAULT_HARDWARE, inverters: [{ w: 1000, surge: 2000, volts: [48] as const, surgeSeconds: 0.5, surgeLong: { w: 1500, seconds: 2 }, maxParallel: 2 }] }
    const start = (surge: number) =>
      compute({ qty: { x: 1 }, custom: [{ id: 'x', name: 'Workshop', watts: 1000, surge, note: '' }], hours: 2, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const warning = (r: ReturnType<typeof start>) => r.warnings.find((w) => w.code === 'surgeDuration')!
    // 3.5 kW for 1 s is within the 4 kW the pair ever holds and over the 3 kW it holds that long.
    const within = start(3500)
    expect(warning(within).params).toEqual({ inverterW: 2000, inverters: 2, unitW: 1000, surgeW: 3500, seconds: 1, ratedW: 3000, inverterSurgeW: 4000, tooLong: true })
    expect(warningText(en, warning(within), within.items)).toBe('A 3,500 W start-up lasting 1 s is longer than the surge window of the 2 × 1,000 W inverters; together they only hold 3,000 W that long. Let fewer motors start at once.')
    expect(warningText(es, warning(within), within.items)).toBe('Un arranque de 3,500 W durante 1 s supera la ventana de arranque de los 2 inversores de 1,000 W; juntos solo sostienen 3,000 W ese tiempo. Deja que arranquen menos motores a la vez.')
    // A start-up of exactly the surge rating is still within it: its length is the reason, not its watts.
    const atRating = start(4000)
    expect(warning(atRating).params).toMatchObject({ surgeW: 4000, ratedW: 3000, inverterSurgeW: 4000, tooLong: true })
    expect(warningText(en, warning(atRating), atRating.items)).toBe('A 4,000 W start-up lasting 1 s is longer than the surge window of the 2 × 1,000 W inverters; together they only hold 3,000 W that long. Let fewer motors start at once.')
    expect(warningText(es, warning(atRating), atRating.items)).toBe('Un arranque de 4,000 W durante 1 s supera la ventana de arranque de los 2 inversores de 1,000 W; juntos solo sostienen 3,000 W ese tiempo. Deja que arranquen menos motores a la vez.')
    // One watt more is over the rating at any length.
    const over = start(4001)
    expect(warning(over).params).toMatchObject({ surgeW: 4001, inverterSurgeW: 4000, tooLong: false })
    expect(warningText(en, warning(over), over.items)).toBe('A 4,001 W start-up is more than the 4,000 W surge rating of the 2 × 1,000 W inverters together. Let fewer motors start at once.')
    expect(warningText(es, warning(over), over.items)).toBe('Un arranque de 4,001 W supera los 4,000 W de arranque de los 2 inversores de 1,000 W juntos. Deja que arranquen menos motores a la vez.')
  })

  test('a cable row that cannot carry its design current fails the cable check and names the row, in both languages', () => {
    // 6 kW at 12 V in 50 °C air on 75 °C cable: the maker's four strings are not enough, so three carry 185 A each
    // and need 231.5 A of cable, where 4/0 carries 172.5 A.
    const custom = [{ id: 'custom1', name: 'Workshop', watts: 4800, surge: 4800, note: '' }]
    const r = kit({ custom1: 1 }, { custom, hours: 1, volts: 12, cable: { ambientC: 50, insulationC: 75 } })
    const cable = kitChecks(en, r, 'en').find((c) => c.id === 'cable')!
    expect(cable.status).toBe('warn')
    expect(cable.lines).toContain('4/0 AWG for the string leads carries only 172.5 A after derating, under the 231.5 A design current of each cable. Raise the voltage to 24 V or trim the load.')
    expect(kitChecks(es, r, 'es').find((c) => c.id === 'cable')!.lines).toContain('El 4/0 AWG para los cables de rama solo soporta 172.5 A tras la corrección, menos que la corriente de diseño de 231.5 A de cada cable. Sube el voltaje a 24 V o reduce la carga.')
  })

  test('the short-cable line offers only what would work: no higher voltage at 48 V, no cooler spot in a cool room', () => {
    // 8.1 kW at 48 V in 50 °C air on 75 °C cable, on 314 Ah units picked by hand: a third string would put more into a
    // fault than the fuses interrupt, so two carry 138.9 A each. There is no bank voltage above 48 V to go to.
    const big = [{ id: 'custom1', name: 'Workshop', watts: 8100, surge: 8100, note: '' }]
    const hot = kit({ custom1: 1 }, { custom: big, hours: 1, volts: 48, batteryUnit: '48-314', cable: { ambientC: 50, insulationC: 75 } })
    expect(hot.battery!.config).toBe('1S2P')
    expect(kitChecks(en, hot, 'en').find((c) => c.id === 'cable')!.lines).toContain('4/0 AWG for the string leads carries only 172.5 A after derating, under the 173.7 A design current of each cable. Move the bank somewhere cooler, use 90 °C cable or trim the load.')
    // The same bank layout at 24 V, on 12 V 400 Ah units in series: every way out is open, and the next voltage is 36 V.
    const lower = kit({ custom1: 1 }, { custom: [{ ...big[0]!, watts: 4800, surge: 4800 }], hours: 1, volts: 24, batteryUnit: '12-400', cable: { ambientC: 50, insulationC: 75 } })
    expect(lower.battery!.config).toBe('2S2P')
    expect(kitChecks(en, lower, 'en').find((c) => c.id === 'cable')!.lines).toContain('4/0 AWG for the string leads carries only 172.5 A after derating, under the 173.7 A design current of each cable. Move the bank somewhere cooler, use 90 °C cable, raise the voltage to 36 V or trim the load.')
    // A heater and a microwave at 12 V in a cool room, on two 400 Ah units picked by hand: 4/0 is at its terminations, so
    // only a higher voltage or less load helps. (Left to itself the bank takes a third string and the lead fits.)
    const cool = kit({ heater: 1, micro: 1 }, { hours: 2, volts: 12, batteryUnit: '12-400' })
    expect(cool.battery!.config).toBe('1S2P')
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

  test('a fuse list with nothing rated for the bank voltage fails the fuse check, in both languages', () => {
    // Essentials at 48 V need a 100 A fuse; the only one listed is a 32 V ANL fuse, under the 60 V a 48 V bank needs.
    const hardware = { ...DEFAULT_HARDWARE, fuses: [{ a: 100, class: 'ANL' as const, aicA: 6000, maxVdc: 32 }] }
    const r = compute({ qty: ESSENTIALS, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT, hardware)
    const fuse = (locale: 'en' | 'es') => kitChecks(locale === 'en' ? en : es, r, locale).find((c) => c.id === 'fuse')!
    expect(fuse('en')).toMatchObject({
      status: 'warn',
      lines: ['The 100 A fuse is listed for only 32 V DC, and a 48 V bank needs 60 V DC or more: it may not break a fault. Use a fuse listed for at least 60 V DC.'],
    })
    expect(fuse('es')).toMatchObject({
      status: 'warn',
      lines: ['El fusible de 100 A solo está certificado para 32 V CC, y un banco de 48 V necesita 60 V CC o más: podría no cortar una falla. Usa un fusible certificado para al menos 60 V CC.'],
    })
    expect(uncheckedWarnings(r).map((w) => w.code)).not.toContain('fuseVoltage')
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
