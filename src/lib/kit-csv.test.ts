import { describe, expect, test } from 'vitest'
import { getDictionary } from '../i18n'
import { CATALOG_SNAPSHOT } from './catalog-snapshot'
import { csvFor } from './kit-csv'
import { buildParts } from './kit-parts'
import { compute } from './sizing'
import { DEFAULT_QTY } from './store'

const en = getDictionary('en')
const es = getDictionary('es')

describe('csvFor', () => {
  const result = compute({ qty: { ...DEFAULT_QTY, barrier: 1 }, hours: 10, volts: 48, chemistry: 'lifepo4' }, CATALOG_SNAPSHOT)

  test('writes the schedule by kind with an average column, then the parts', () => {
    const lines = csvFor(result, buildParts(result, en, 'en'), { appliances: true, parts: true }, en).slice(1).split('\r\n')
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
    const lines = csvFor(bank, parts, { appliances: false, parts: true }, en).slice(1).split('\r\n')
    expect(parts.map((p) => p.id)).toEqual(['inverter', 'batteries', 'mainCable', 'interconnects', 'stringLeads', 'fuse', 'stringFuses'])
    for (const p of parts) expect(lines.some((l) => l.startsWith(`${p.name},`) && l.endsWith(`,${p.qty}`))).toBe(true)
    expect(lines).toContain('Interconnects,"6 AWG jumpers, 30 cm each",Between batteries in series · 43 A design current · 65 A after derating,6')
    expect(lines).toContain('String leads,"6 AWG (13.3 mm²) copper, 30 cm each",A positive and a negative from each string to the bus bars (bus bars not listed) · 43 A design current · 65 A after derating,4')
    const spanish = csvFor(bank, buildParts(bank, es, 'es'), { appliances: false, parts: true }, es)
    expect(spanish).toContain('Cables de rama,"6 AWG (13.3 mm²) de cobre, 30 cm cada uno",')
  })

  test('translates the kinds and headers', () => {
    const csv = csvFor(result, [], { appliances: true, parts: false }, es)
    expect(csv).toContain('Aparato,Tipo,Cantidad,C/u (W),En marcha (W),Promedio (W),Wh en 10 h')
    expect(csv).toContain('Refrigerador,Encienden y apagan,1,150,150,53,525')
  })

  test('drops the blocks that are switched off', () => {
    expect(csvFor(result, buildParts(result, en, 'en'), { appliances: false, parts: true }, en)).not.toContain('Refrigerator')
  })
})
