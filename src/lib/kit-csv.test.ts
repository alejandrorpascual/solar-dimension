import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { csvDelimiter } from './export-csv'
import { csvFor, type KitCsvFile } from './kit-csv'
import { buildParts } from './kit-parts'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

const en = getDictionary('en')
const es = getDictionary('es')

/** The estimate line as the file writes it: one cell, quoted because the sentence has a comma. */
const ESTIMATE_EN = '"An estimate for requesting quotes, not an installation design. Have a licensed electrician verify it against the actual equipment and your local electrical code before you buy or install anything."'
const ESTIMATE_ES = '"Una estimación para pedir cotizaciones, no un diseño de instalación. Pide a un electricista matriculado que la verifique con los equipos reales y la normativa eléctrica local antes de comprar o instalar nada."'

/** What the solar side does not size, as the file writes it: one cell, quoted for its commas. */
const NOT_SIZED_EN = `"This kit does not size the solar side's ground-fault and surge protection, grounding, the controller's voltage window or the roof structure; a qualified installer designs them."`
const NOT_SIZED_ES = '"De la parte solar, este kit no dimensiona la protección contra fallas a tierra y sobretensiones, la puesta a tierra, la ventana de voltaje del controlador ni la estructura del techo; las diseña un instalador calificado."'

const FILE: KitCsvFile = { projectName: 'Home', date: 'Oct 19, 2026', delimiter: ',' }
/** The file's lines without the BOM. */
const rows = (csv: string) => csv.slice(1).split('\r\n')
/** The lines under the four project rows and the blank row that closes them. */
const body = (csv: string) => rows(csv).slice(5)

describe('csvFor', () => {
  const result = compute({ qty: { ...DEFAULT_QTY, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)
  /** The audit's 12 V stress project: several checks fail and several notes apply. */
  const stress = compute({ qty: { ...DEFAULT_QTY, heater: 2, kettle: 2, wheater: 1 }, hours: 10, volts: 12, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)

  test('opens with the project name, date, backup hours and bank voltage in the UI language, then a blank row', () => {
    const english = rows(csvFor(result, [], { appliances: true, parts: false }, en, FILE))
    expect(english.slice(0, 6)).toEqual([
      'Project name,Home', 'Date,"Oct 19, 2026"', 'Hours without the grid,10 h', 'Battery voltage,48 V', '',
      'Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h',
    ])
    const spanish = rows(csvFor(result, [], { appliances: false, parts: false }, es, { projectName: 'Casa; playa', date: '19 oct 2026', delimiter: ';' }))
    expect(spanish.slice(0, 5)).toEqual(['Nombre del proyecto;"Casa; playa"', 'Fecha;19 oct 2026', 'Horas sin red eléctrica;10 h', 'Voltaje del banco;48 V', ''])
  })

  test('a project named like a formula opens as text in the name row, never as a formula', () => {
    const named = (projectName: string, delimiter: KitCsvFile['delimiter']) => rows(csvFor(result, [], { appliances: false, parts: false }, en, { ...FILE, projectName, delimiter }))[0]
    expect(named('=HYPERLINK("https://example.com")', ',')).toBe(`Project name,"'=HYPERLINK(""https://example.com"")"`)
    expect(named('@SUM(A1:A9)', ';')).toBe("Project name;'@SUM(A1:A9)")
  })

  test('with browser locale es-VE the cells split on ";", with en-US on ","', () => {
    const forLocale = (locale: string) => body(csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en, { ...FILE, delimiter: csvDelimiter(locale) }))
    const venezuela = forLocale('es-VE')
    expect(venezuela[0]).toBe('Appliance;Kind;Quantity;Each (W);Running (W);Average (W);Wh over 10 h')
    expect(venezuela).toContain('Refrigerator;Cycles on and off;1;150;150;53;525')
    // The TV's name holds a comma, the delimiter of en-US but not of es-VE: quoted in one file, plain in the other.
    expect(venezuela).toContain('TV, 55-inch LED;Always on;1;120;120;120;1200')
    expect(venezuela).toContain('Part;Specification;Note;Quantity')
    const us = forLocale('en-US')
    expect(us[0]).toBe('Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h')
    expect(us).toContain('"TV, 55-inch LED",Always on,1,120,120,120,1200')
  })

  test('writes the schedule by kind with an average column, then the parts', () => {
    const lines = body(csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en, FILE))
    expect(lines[0]).toBe('Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 10 h')
    expect(lines.slice(1, 4)).toEqual(['LED lighting (10 bulbs),Always on,1,90,90,90,900', '"TV, 55-inch LED",Always on,1,120,120,120,1200', 'Wi-Fi router + modem,Always on,1,20,20,20,200'])
    expect(lines).toContain('Refrigerator,Cycles on and off,1,150,150,53,525')
    expect(lines).toContain('Parking barrier,Short bursts,1,150,150,5,50')
    expect(lines).toContain('Part,Specification,Note,Quantity')
    expect(lines.some((l) => l.startsWith('Fuse,100 A class T'))).toBe(true)
  })

  test('the parts block carries the link and string-lead rows the kit prints, at their own gauge', () => {
    const bank = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '12-100' }, CATALOG_SNAPSHOT)
    const parts = buildParts(bank, en, 'en')
    const lines = csvFor(bank, parts, { appliances: false, parts: true }, en, FILE).slice(1).split('\r\n')
    expect(parts.map((p) => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'interconnects', 'stringLeads', 'fuse', 'stringFuses'])
    for (const p of parts) expect(lines.some((l) => l.startsWith(`${p.name},`) && l.endsWith(`,${p.qty}`))).toBe(true)
    expect(lines).toContain('Interconnects,"6 AWG jumpers, 30 cm each",Between batteries in series · 43 A design current · 65 A after derating,6')
    expect(lines).toContain('String leads,"6 AWG (13.3 mm²) copper, 30 cm each",A positive and a negative from each string to the bus bars (bus bars not listed) · 43 A design current · 65 A after derating,4')
    const spanish = csvFor(bank, buildParts(bank, es, 'es'), { appliances: false, parts: true }, es, FILE)
    expect(spanish).toContain('Cables de rama,"6 AWG (13.3 mm²) de cobre, 30 cm cada uno",')
  })

  test('failing checks and notes follow the parts as a block of their own, whatever is ticked', () => {
    const lines = csvFor(stress, buildParts(stress, en, 'en'), { appliances: false, parts: true }, en, FILE).slice(1).split('\r\n')
    const start = lines.indexOf('Needs attention,Note')
    expect(start).toBeGreaterThan(lines.indexOf('Part,Specification,Note,Quantity'))
    expect(lines[start - 1]).toBe('')
    const block = lines.slice(start + 1)
    expect(block).toContain('Note,Electric water heater usually runs on 240 V. You need a split-phase (240 V) inverter or two stacked units.')
    expect(block).toContain('Note,"8,000 W inverters are normally built for 48 V. Change the battery voltage or trim the load."')
    expect(block.some((l) => l.startsWith('Cable,') && l.includes('is hard to wire safely'))).toBe(true)
    expect(block.some((l) => l.startsWith('Fuse,'))).toBe(true)
    // Two 8 kW units carry the 11 kW, so the inverter size check passes and stays out of the block.
    expect(block.some((l) => l.startsWith('Inverter size,'))).toBe(false)
    const bare = csvFor(stress, [], { appliances: false, parts: false }, es, FILE)
    expect(bare).toContain('Revisar,Nota')
    expect(bare).toContain('Nota,Calentador de agua eléctrico normalmente funciona a 240 V.')
  })

  test('the file ends by saying it is an estimate, in the file\'s language, whatever is ticked', () => {
    const english = csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en, FILE).split('\r\n')
    expect(english.slice(-2)).toEqual(['', ESTIMATE_EN])
    const bare = csvFor(result, [], { appliances: false, parts: false }, es, FILE)
    expect(body(bare)).toEqual([ESTIMATE_ES])
  })

  test('with failing checks and notes in the file, the estimate line still closes it, right after them', () => {
    const cases = [
      { t: en, locale: 'en', header: 'Needs attention,Note', estimate: ESTIMATE_EN },
      { t: es, locale: 'es', header: 'Revisar,Nota', estimate: ESTIMATE_ES },
    ] as const
    for (const { t, locale, header, estimate } of cases) {
      for (const include of [{ appliances: true, parts: true }, { appliances: false, parts: false }]) {
        const lines = csvFor(stress, buildParts(stress, t, locale), include, t, FILE).slice(1).split('\r\n')
        const block = lines.slice(lines.indexOf(header), -2)
        // The block runs from its header to the blank row before the estimate with no blank inside: nothing comes between.
        expect(block[0]).toBe(header)
        expect(block.length).toBeGreaterThan(1)
        expect(block).not.toContain('')
        expect(lines.slice(-2)).toEqual(['', estimate])
      }
    }
  })

  test('a kit with panels lists one controller-to-battery row per controller and, whatever is ticked, closes with what the solar side does not size', () => {
    const solar = compute({ qty: DEFAULT_QTY, hours: 10, volts: 48, chemistry: 'lifepo4', batteryUnit: '48-200', solar: { roofM2: 40, panels: 10, sunHours: 5 } }, CATALOG_SNAPSHOT)
    const english = rows(csvFor(solar, buildParts(solar, en, 'en'), { appliances: false, parts: true }, en, FILE))
    expect(english.filter((l) => l.startsWith('Controller to battery: cable and fuse,125 A class T fuse · 1 AWG (42.4 mm²) copper,') && l.endsWith(',1'))).toHaveLength(1)
    expect(english.slice(-3)).toEqual(['', ESTIMATE_EN, NOT_SIZED_EN])
    const spanish = csvFor(solar, buildParts(solar, es, 'es'), { appliances: false, parts: true }, es, FILE)
    expect(rows(spanish).some((l) => l.startsWith('Controlador a batería: cable y fusible,Fusible de 125 A clase T · 1 AWG (42.4 mm²) de cobre,'))).toBe(true)
    expect(body(csvFor(solar, [], { appliances: false, parts: false }, es, FILE))).toEqual([ESTIMATE_ES, NOT_SIZED_ES])
  })

  test('a kit without panels has neither the controller row nor the solar sentence', () => {
    const csv = csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en, FILE)
    expect(csv).not.toContain('Controller to battery')
    expect(csv).not.toContain(NOT_SIZED_EN)
  })

  test('a sound kit has no attention block', () => {
    expect(csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en, FILE)).not.toContain('Needs attention')
  })

  test('translates the kinds and headers', () => {
    const csv = csvFor(result, [], { appliances: true, parts: false }, es, FILE)
    expect(csv).toContain('Aparato,Tipo,Cantidad,C/u (W),En marcha (W),Promedio (W),Wh en 10 h')
    expect(csv).toContain('Refrigerador,Encienden y apagan,1,150,150,53,525')
  })

  test('drops the blocks that are switched off', () => {
    expect(csvFor(result, buildParts(result, en, 'en'), { appliances: false, parts: true }, en, FILE)).not.toContain('Refrigerator')
  })

  test('a microwave set to 5% of each hour lists 1,440 Wh over 24 h, where its typical 8% lists 2,304', () => {
    const microwave = (dutyOverrides: Record<string, number>) => {
      const day = compute({ qty: { micro: 1 }, hours: 24, volts: 48, chemistry: 'lifepo4', dutyOverrides }, CATALOG_SNAPSHOT)
      return body(csvFor(day, [], { appliances: true, parts: false }, en, FILE))
    }
    expect(microwave({ micro: 0.05 }).slice(0, 2)).toEqual([
      'Appliance,Kind,Quantity,Each (W),Running (W),Average (W),Wh over 24 h', 'Microwave (1000 W),Cycles on and off,1,1200,1200,60,1440',
    ])
    expect(microwave({})[1]).toBe('Microwave (1000 W),Cycles on and off,1,1200,1200,96,2304')
  })
})
